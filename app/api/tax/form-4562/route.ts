import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getFederalTaxRules, getSection179Limits, SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
import { loadScheduleCRecords } from '@/lib/reports/load-schedule-se';
import { calc4562, DE_MINIMIS_SAFE_HARBOR_LIMIT, SECTION_179_CALCULATION_YEARS } from '@/lib/reports/calc4562';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REVIEW_CODES = ['EXPORT_REVIEW_REQUIRED', 'INCOME_RECONCILIATION_REQUIRED', 'FILING_STATUS_REVIEW_REQUIRED', 'DEPRECIATION_REVIEW_REQUIRED'];

/**
 * Selected-year Form 4562 planning worksheet for the assets page: the same calc4562 call the
 * annual estimate makes, with the §179(b)(3)(A) business income taken from the shared Schedule C
 * records instead of a client-supplied figure. Unsupported assets return the shared 422 review.
 */
export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam === null ? new Date().getFullYear() : /^\d{4}$/.test(yearParam) ? Number(yearParam) : NaN;
  try { getFederalTaxRules(year); } catch { return NextResponse.json({ error: `Supported tax years: ${SUPPORTED_TAX_YEARS.join(', ')}` }, { status: 400 }); }
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const records = await loadScheduleCRecords(user.uid, year);
    const calculation = records.assets.length ? calc4562(records.assets, records.section179BusinessIncome, year, records.depreciationElections) : null;
    return NextResponse.json({
      taxYear: year, assets: records.assets, calculation, businessIncome: records.section179BusinessIncome,
      elections: records.depreciationElections, deMinimisElected: records.depreciationElections.deMinimisSafeHarborYears.includes(year),
      deMinimisLimit: DE_MINIMIS_SAFE_HARBOR_LIMIT,
      section179Limits: SECTION_179_CALCULATION_YEARS.includes(year) ? { ...getSection179Limits(year), taxYear: year } : null,
      scope: 'Planning worksheet, not Form 4562. Bonus depreciation, vehicles and listed property, prior-year assets, straight-line and mid-quarter cases require review.',
    }, { headers });
  } catch (calcError) {
    const code = calcError && typeof calcError === 'object' && 'code' in calcError ? String(calcError.code) : '';
    if (REVIEW_CODES.includes(code)) return NextResponse.json({ error: calcError instanceof Error ? calcError.message : 'Review the asset records before calculating.', code }, { status: 422, headers });
    return NextResponse.json({ error: 'Could not load all records needed for this worksheet. Please retry.' }, { status: 503 });
  }
}
