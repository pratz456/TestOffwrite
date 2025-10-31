import { NextRequest, NextResponse } from 'next/server';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get current date info
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const startOfYear = new Date(currentYear, 0, 1);
    const startOfMonth = new Date(currentYear, currentMonth, 1);
    const endOfMonth = new Date(currentYear, currentMonth + 1, 0);

    // Fetch all transactions for the user using Firebase
    const { data: allTransactions, error } = await getTransactionsServer(user.uid);

    if (error) {
      console.error('❌ [Tax Savings API] Error fetching transactions:', error);
      console.error('❌ [Tax Savings API] Error type:', typeof error);
      console.error('❌ [Tax Savings API] Error details:', JSON.stringify(error, null, 2));
      
      // Provide more specific error messages
      let errorMessage = 'Failed to fetch transactions for tax calculation';
      if (error.code === 'permission-denied') {
        errorMessage = 'Permission denied. Please check your authentication.';
      } else if (error.code === 'unavailable') {
        errorMessage = 'Database temporarily unavailable. Please try again.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }

    // Filter for deductible transactions (expenses) - handle both positive and negative amounts
    const transactions = allTransactions?.filter(transaction => 
      transaction.is_deductible === true && transaction.amount !== undefined && transaction.amount !== null
    ) || [];

    // Calculate totals
    const allDeductibleTransactions = transactions || [];
    
    // Year-to-date deductible expenses
    const yearToDateTransactions = allDeductibleTransactions.filter(t => {
      const transactionDate = new Date(t.date);
      return transactionDate >= startOfYear;
    });
    
    // Current month deductible expenses
    const currentMonthTransactions = allDeductibleTransactions.filter(t => {
      const transactionDate = new Date(t.date);
      return transactionDate >= startOfMonth && transactionDate <= endOfMonth;
    });

    // Calculate totals using absolute transaction amounts (expenses are typically negative)
    const yearToDateTotal = yearToDateTransactions.reduce((sum, t) => {
      return sum + Math.abs(t.amount);
    }, 0);
    const currentMonthTotal = currentMonthTransactions.reduce((sum, t) => {
      return sum + Math.abs(t.amount);
    }, 0);
    
    // Tax savings calculation (assuming 30% tax rate)
    const taxRate = 0.30;
    const yearToDateTaxSavings = yearToDateTotal * taxRate;
    const currentMonthTaxSavings = currentMonthTotal * taxRate;
    
    // Projected annual savings (based on current year-to-date)
    const monthsElapsed = now.getMonth() + 1;
    const projectedAnnualSavings = monthsElapsed > 0 ? (yearToDateTaxSavings / monthsElapsed) * 12 : 0;
    
    // Monthly target (assuming $10,000 annual deduction goal)
    const annualDeductionGoal = 10000;
    const monthlyTarget = annualDeductionGoal / 12;
    const monthlyTargetPercentage = monthlyTarget > 0 ? (currentMonthTotal / monthlyTarget) * 100 : 0;

    console.log('📊 Tax savings calculation:', {
      userId: user.uid,
      totalTransactions: allTransactions?.length || 0,
      deductibleTransactions: transactions.length,
      yearToDateTransactions: yearToDateTransactions.length,
      currentMonthTransactions: currentMonthTransactions.length,
      yearToDateTotal,
      currentMonthTotal,
      yearToDateTaxSavings,
      currentMonthTaxSavings,
      projectedAnnualSavings,
      monthlyTargetPercentage,
      sampleTransactions: yearToDateTransactions.slice(0, 3).map(t => ({
        id: t.id || t.trans_id,
        amount: t.amount,
        date: t.date,
        category: t.category
      }))
    });

    return NextResponse.json({
      success: true,
      data: {
        taxSavings: {
          yearToDate: yearToDateTaxSavings,
          currentMonth: currentMonthTaxSavings,
          projectedAnnual: projectedAnnualSavings
        },
        deductions: {
          yearToDate: yearToDateTotal,
          currentMonth: currentMonthTotal,
          monthlyTarget: monthlyTarget,
          monthlyTargetPercentage: monthlyTargetPercentage
        },
        transactionCounts: {
          yearToDate: yearToDateTransactions.length,
          currentMonth: currentMonthTransactions.length
        }
      }
    });
  } catch (error) {
    console.error('❌ [Tax Savings API] Error in tax savings API:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Failed to calculate tax savings';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
} 