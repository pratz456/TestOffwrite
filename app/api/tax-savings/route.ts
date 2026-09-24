import { NextRequest, NextResponse } from 'next/server';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { getUserTaxRate } from '@/lib/tax-rules/federal-brackets';
import { FilingStatusReviewRequiredError } from '@/lib/tax-rules/filing-status';
import { UnsupportedTaxYearError } from '@/lib/tax-rules/federal-year-rules';

const OWNER_DATA_CACHE_CONTROL = 'private, no-store';

export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get current date info
    const now = new Date();
    const calendarYear = now.getFullYear();
    const yearParam = request.nextUrl.searchParams.get('year');
    if (yearParam !== null && !/^\d{4}$/.test(yearParam)) {
      return NextResponse.json({ error: 'Year must be a four-digit tax year' }, { status: 400 });
    }
    const selectedYear = yearParam === null ? calendarYear : Number(yearParam);
    if (!Number.isInteger(selectedYear) || selectedYear < 2000 || selectedYear > calendarYear) {
      return NextResponse.json({ error: `Year must be from 2000 through ${calendarYear}` }, { status: 400 });
    }
    const { data: userProfile } = await getUserProfileServer(user.uid);
    const rawIncome = typeof userProfile?.income === 'string'
      ? Number(userProfile.income.replace(/[,$\s]/g, ''))
      : userProfile?.income;
    const taxRateAvailable = Number.isFinite(rawIncome) && Number(rawIncome) > 0;
    const taxRate = taxRateAvailable ? getUserTaxRate(userProfile, selectedYear) : null;
    const selectedMonth = selectedYear === calendarYear ? now.getMonth() : 11;
    const startOfYear = new Date(selectedYear, 0, 1);
    const endOfYear = new Date(selectedYear, 11, 31, 23, 59, 59, 999);
    const startOfMonth = new Date(selectedYear, selectedMonth, 1);
    const endOfMonth = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59, 999);

    // Only aggregate inputs are projected; reads are billed
    // per document regardless, but the payload and SSR memory shrink to a few fields per row.
    const { data: allTransactions, error } = await getTransactionsServer(user.uid, { fields: ['date', 'amount', 'is_deductible', 'category'] });

    if (error) {
      console.error('❌ [Tax Savings API] Error fetching transactions:', error);
      return NextResponse.json({ error: 'Failed to fetch transactions for tax calculation' }, { status: 500 });
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
      return transactionDate >= startOfYear && transactionDate <= endOfYear;
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
    
    // Tax savings calculation (user-specific tax rate)
    const yearToDateTaxSavings = taxRate === null ? null : yearToDateTotal * taxRate;
    const currentMonthTaxSavings = taxRate === null ? null : currentMonthTotal * taxRate;
    
    // Project only a current-year estimate. A past year is complete, and a missing income
    // profile withholds the estimate instead of applying a fabricated percentage.
    const monthsElapsed = selectedYear === calendarYear ? now.getMonth() + 1 : 12;
    const projectedAnnualSavings = yearToDateTaxSavings === null
      ? null
      : monthsElapsed > 0 ? (yearToDateTaxSavings / monthsElapsed) * 12 : 0;

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
          monthlyTarget: null,
          monthlyTargetPercentage: null
        },
        transactionCounts: {
          yearToDate: yearToDateTransactions.length,
          currentMonth: currentMonthTransactions.length
        },
        estimate: {
          taxYear: selectedYear,
          taxRate,
          reviewMessage: taxRateAvailable ? null : 'Add self-employment income in Profile before estimating tax savings.',
        },
      }
    }, { headers: { 'Cache-Control': OWNER_DATA_CACHE_CONTROL } });
  } catch (error) {
    if (error instanceof FilingStatusReviewRequiredError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    if (error instanceof UnsupportedTaxYearError) {
      return NextResponse.json({ error: error.message, code: 'TAX_YEAR_UNAVAILABLE' }, { status: 422 });
    }
    console.error('❌ [Tax Savings API] Error in tax savings API:', error);
    return NextResponse.json({ error: 'Failed to calculate tax savings' }, { status: 500 });
  }
}
