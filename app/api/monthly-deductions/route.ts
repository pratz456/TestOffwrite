export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { getUserTaxRate } from '@/lib/tax-rules/federal-brackets';

export async function GET(request: NextRequest) {
  try {
    console.log('🔄 [Monthly Deductions API] Starting request...');
    
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      console.error('❌ [Monthly Deductions API] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: userProfile } = await getUserProfileServer(user.uid);
    const TAX_RATE = getUserTaxRate(userProfile ?? undefined);

    console.log('✅ [Monthly Deductions API] User authenticated:', user.uid);

    // Support optional year query param for viewing previous years (e.g. ?year=2024)
    const now = new Date();
    const currentYearActual = now.getFullYear();
    const yearParam = request.nextUrl.searchParams.get('year');
    const requestedYear = yearParam ? parseInt(yearParam, 10) : currentYearActual;
    const currentYear = Number.isNaN(requestedYear) || requestedYear < 2000 || requestedYear > currentYearActual
      ? currentYearActual
      : requestedYear;
    const startOfYear = new Date(currentYear, 0, 1);
    const endOfYear = new Date(currentYear, 11, 31);

    console.log('📅 [Monthly Deductions API] Processing year:', currentYear);

    // Fetch all transactions for the user using Firebase server function
    const { data: allTransactions, error } = await getTransactionsServer(user.uid);

    if (error) {
      console.error('❌ [Monthly Deductions API] Error fetching transactions:', error);
      return NextResponse.json({ 
        error: 'Failed to fetch transactions',
        details: error.message || error
      }, { status: 500 });
    }

    // Years that have transaction activity (for year selector)
    const availableYears = allTransactions && allTransactions.length > 0
      ? [...new Set(allTransactions.map((t: { date: string }) => new Date(t.date).getFullYear()))]
          .filter((y: number) => y >= 2000 && y <= currentYearActual)
          .sort((a: number, b: number) => b - a)
      : [currentYearActual];

    if (!allTransactions || allTransactions.length === 0) {
      console.log('⚠️ [Monthly Deductions API] No transactions found for user:', user.uid);
      
      // Return empty data structure instead of error
      const emptyMonthlyData = Array.from({ length: 12 }, (_, i) => ({
        month: i,
        monthName: new Date(currentYear, i, 1).toLocaleDateString('en-US', { month: 'short' }),
        total: 0,
        count: 0
      }));

      return NextResponse.json({
        success: true,
        data: {
          monthlyData: emptyMonthlyData,
          summary: {
            currentMonthTotal: 0,
            monthOverMonthChange: 0,
            avgMonthly: 0,
            monthsWithData: 0,
            yearToDateTotal: 0,
            estimatedRefund: 0
          },
          availableYears,
          diagnostics: {
            expensesInYear: 0,
            deductibleInYear: 0,
            unclassifiedInYear: 0,
          },
        }
      });
    }

    // Filter transactions for current year and positive amounts (expenses)
    const transactions = allTransactions.filter(transaction => {
      const transactionDate = new Date(transaction.date);
      return transaction.amount > 0 && 
             transactionDate >= startOfYear && 
             transactionDate <= endOfYear;
    });

    const deductibleInYear = transactions.filter(t => t.is_deductible === true).length;
    const unclassifiedInYear = transactions.filter(t => t.is_deductible === null || t.is_deductible === undefined).length;

    console.log(`📊 [Monthly Deductions API] Year ${currentYear}: ${transactions.length} expenses, ${deductibleInYear} deductible, ${unclassifiedInYear} unclassified`);
    if (transactions.length > 0 && deductibleInYear === 0) {
      console.warn(`⚠️ [Monthly Deductions API] User ${user.uid} has ${transactions.length} expenses in ${currentYear} but 0 are marked deductible (${unclassifiedInYear} unclassified). Tax savings will be $0.`);
    }

    // Group transactions by month
    const monthlyData = Array.from({ length: 12 }, (_, i) => ({
      month: i,
      monthName: new Date(currentYear, i, 1).toLocaleDateString('en-US', { month: 'short' }),
      total: 0,
      count: 0
    }));

    // Calculate monthly estimated tax savings
    let totalDeductibleTransactions = 0;
    let totalNonDeductibleTransactions = 0;

    transactions.forEach(transaction => {
      const transactionDate = new Date(transaction.date);
      const month = transactionDate.getMonth();
      
      if (transactionDate.getFullYear() === currentYear) {
        // Calculate estimated tax savings based on is_deductible status
        let taxSavings = 0;
        if (transaction.is_deductible === true) {
          // Use full transaction amount for deductible transactions
          taxSavings = transaction.amount * TAX_RATE;
          totalDeductibleTransactions++;
        } else if (transaction.is_deductible === false) {
          // For explicitly non-deductible transactions, use 0
          taxSavings = 0;
          totalNonDeductibleTransactions++;
        } else {
          // For transactions with null/undefined is_deductible, use 0
          // User must review and classify these transactions
          taxSavings = 0;
          totalNonDeductibleTransactions++;
        }
        
        monthlyData[month].total += taxSavings;
        if (taxSavings > 0) {
          monthlyData[month].count += 1;
        }
      }
    });

    console.log(`📊 [Monthly Deductions API] Deductible transactions: ${totalDeductibleTransactions}, Non-deductible: ${totalNonDeductibleTransactions}`);

    // Calculate summary statistics (for past years use full year; for current year use up to current month)
    const isCurrentYear = currentYear === currentYearActual;
    const currentMonth = isCurrentYear ? now.getMonth() : 11; // Past year: treat as through December
    const currentMonthTotal = monthlyData[currentMonth].total;
    const lastMonthTotal = currentMonth > 0 ? monthlyData[currentMonth - 1].total : 0;
    const monthOverMonthChange = lastMonthTotal > 0 ? ((currentMonthTotal - lastMonthTotal) / lastMonthTotal) * 100 : 0;

    // Calculate average monthly deductions (excluding future months for current year)
    const monthsWithData = monthlyData.slice(0, currentMonth + 1).filter(m => m.total > 0);
    const avgMonthly = monthsWithData.length > 0 
      ? monthsWithData.reduce((sum, m) => sum + m.total, 0) / monthsWithData.length 
      : 0;

    // Calculate year-to-date total tax savings
    const yearToDateTotal = monthlyData.reduce((sum, m) => sum + m.total, 0);

    // Estimated federal refund is now the same as year-to-date total since we're already calculating tax savings
    const estimatedRefund = yearToDateTotal;

    const responseData = {
      monthlyData,
      summary: {
        currentMonthTotal,
        monthOverMonthChange,
        avgMonthly,
        monthsWithData: monthsWithData.length,
        yearToDateTotal,
        estimatedRefund
      },
      availableYears,
      diagnostics: {
        expensesInYear: transactions.length,
        deductibleInYear,
        unclassifiedInYear,
      },
    };

    console.log('✅ [Monthly Deductions API] Successfully calculated reports data:', {
      totalTransactions: transactions.length,
      deductibleTransactions: totalDeductibleTransactions,
      yearToDateTotal,
      estimatedRefund
    });

    return NextResponse.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('❌ [Monthly Deductions API] Unexpected error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to calculate monthly deductions',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
