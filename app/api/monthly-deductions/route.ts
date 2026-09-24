import { TaxCalculationScopeReviewRequiredError } from '@/lib/tax-rules/calculation-scope';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { getUserTaxRate, TaxRateReviewRequiredError } from '@/lib/tax-rules/federal-brackets';
import { FilingStatusReviewRequiredError } from '@/lib/tax-rules/filing-status';
import { getFederalTaxRules, UnsupportedTaxYearError } from '@/lib/tax-rules/federal-year-rules';
import { ExportReviewRequiredError } from '@/lib/reports/transaction-export';
import { buildMonthlySavings } from '@/lib/tax/savings-summary';

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(request);
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const rawYear = request.nextUrl.searchParams.get('year');
    const year = rawYear === null ? new Date().getUTCFullYear() : /^\d{4}$/.test(rawYear) ? Number(rawYear) : NaN;
    if (!Number.isFinite(year)) return NextResponse.json({ error: 'Provide a valid four-digit tax year.', code: 'TAX_YEAR_UNAVAILABLE' }, { status: 400 });
    getFederalTaxRules(year);
    const [profile, transactions] = await Promise.all([getUserProfileServer(user.uid), getTransactionsServer(user.uid)]);
    if (profile.error || transactions.error) return NextResponse.json({ error: 'Could not load tax estimate inputs. Please retry.' }, { status: 503 });
    const rate = getUserTaxRate(profile.data ?? undefined, year);
    return NextResponse.json({ success: true, data: buildMonthlySavings(transactions.data ?? [], year, rate) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof UnsupportedTaxYearError) return NextResponse.json({ error: error.message, code: 'TAX_YEAR_UNAVAILABLE' }, { status: 400 });
    if (error instanceof TaxCalculationScopeReviewRequiredError || error instanceof FilingStatusReviewRequiredError || error instanceof TaxRateReviewRequiredError || error instanceof ExportReviewRequiredError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    return NextResponse.json({ error: 'Could not calculate the monthly estimate. Please retry.' }, { status: 503 });
  }
}
