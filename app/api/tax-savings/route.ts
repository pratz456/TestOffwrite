import { TaxCalculationScopeReviewRequiredError } from '@/lib/tax-rules/calculation-scope';
import { NextRequest, NextResponse } from 'next/server';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { getUserTaxRate, TaxRateReviewRequiredError } from '@/lib/tax-rules/federal-brackets';
import { FilingStatusReviewRequiredError } from '@/lib/tax-rules/filing-status';
import { UnsupportedTaxYearError } from '@/lib/tax-rules/federal-year-rules';
import { ExportReviewRequiredError } from '@/lib/reports/transaction-export';
import { buildMonthlySavings } from '@/lib/tax/savings-summary';

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(request);
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const now = new Date(), year = now.getUTCFullYear(), month = now.getUTCMonth();
    const [profile, transactions] = await Promise.all([getUserProfileServer(user.uid), getTransactionsServer(user.uid)]);
    if (profile.error || transactions.error) return NextResponse.json({ error: 'Could not load tax estimate inputs. Please retry.' }, { status: 503 });
    const rate = getUserTaxRate(profile.data ?? undefined, year);
    const summary = buildMonthlySavings(transactions.data ?? [], year, rate, now);
    const current = summary.monthlyData[month];
    const monthlyTarget = 10000 / 12; // Display-only default planning goal, never a tax rule.
    return NextResponse.json({ success: true, data: {
      taxYear: year, estimateKind: summary.estimateKind, estimateNotice: summary.estimateNotice,
      taxSavings: { yearToDate: summary.summary.yearToDateTotal, currentMonth: current.total, projectedAnnual: summary.summary.yearToDateTotal / (month + 1) * 12 },
      deductions: { yearToDate: summary.summary.deductionBasis, currentMonth: current.deductionBasis, monthlyTarget, monthlyTargetPercentage: current.deductionBasis / monthlyTarget * 100, targetSource: 'default_planning_goal' },
      transactionCounts: { yearToDate: summary.diagnostics.deductibleInYear, currentMonth: current.count },
    } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof UnsupportedTaxYearError) return NextResponse.json({ error: error.message, code: 'TAX_YEAR_UNAVAILABLE' }, { status: 400 });
    if (error instanceof TaxCalculationScopeReviewRequiredError || error instanceof FilingStatusReviewRequiredError || error instanceof TaxRateReviewRequiredError || error instanceof ExportReviewRequiredError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    return NextResponse.json({ error: 'Could not calculate the tax estimate. Please retry.' }, { status: 503 });
  }
}
