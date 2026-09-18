import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getFederalTaxRules, SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
import { loadScheduleCRecords, scheduleCProfitFromRecords } from '@/lib/reports/load-schedule-se';
import { homeOfficeReviewReasons } from '@/lib/reports/calc8829';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REVIEW_CODES = ['EXPORT_REVIEW_REQUIRED', 'INCOME_RECONCILIATION_REQUIRED', 'FILING_STATUS_REVIEW_REQUIRED', 'DEPRECIATION_REVIEW_REQUIRED', 'HOME_OFFICE_REVIEW_REQUIRED'];

/**
 * Selected-year simplified-method planning worksheet (Rev. Proc. 2013-13) for the Form 8829
 * page. The income limit is the same Schedule C line 29 amount the annual estimate uses, so
 * the page never shows a home office figure the 1040 estimate would not. Incomplete facts
 * return the shared 422 review response with the specific unanswered questions.
 */
export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const yearParam = request.nextUrl.searchParams.get('year');
  const year = yearParam === null ? new Date().getFullYear() : /^\d{4}$/.test(yearParam) ? Number(yearParam) : NaN;
  try { getFederalTaxRules(year); } catch { return NextResponse.json({ error: `Supported tax years: ${SUPPORTED_TAX_YEARS.join(', ')}` }, { status: 400 }); }
  let records: Awaited<ReturnType<typeof loadScheduleCRecords>>;
  try { records = await loadScheduleCRecords(user.uid, year); }
  catch (loadError) {
    const code = loadError && typeof loadError === 'object' && 'code' in loadError ? String(loadError.code) : '';
    if (REVIEW_CODES.includes(code)) return NextResponse.json({ error: loadError instanceof Error ? loadError.message : 'Review the tax records before calculating.', code }, { status: 422 });
    return NextResponse.json({ error: 'Could not load all records needed for this worksheet. Please retry.' }, { status: 503 });
  }
  const reviewReasons = homeOfficeReviewReasons(records.homeOffice);
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const scheduleC = scheduleCProfitFromRecords(records);
    return NextResponse.json({
      taxYear: year, settings: records.homeOffice, reviewReasons, worksheet: scheduleC.homeOffice.calculation, deduction: scheduleC.homeOfficeDeduction,
      scheduleC: {
        grossReceipts: records.receipts.grossReceipts, confirmedExpenses: records.expense.totalDeductible, profitBeforeAssets: scheduleC.profitBeforeAssets,
        deMinimisExpense: scheduleC.deMinimisExpense, depreciationDeduction: scheduleC.depreciationDeduction, tentativeProfit: scheduleC.tentativeProfit, netProfit: scheduleC.netProfit,
      },
      warnings: scheduleC.warnings,
      scope: 'Planning worksheet for Schedule C line 30 under the simplified method; not Form 8829 and not an eligibility determination.',
    }, { headers });
  } catch (calcError) {
    const code = calcError && typeof calcError === 'object' && 'code' in calcError ? String(calcError.code) : '';
    if (REVIEW_CODES.includes(code)) {
      return NextResponse.json({ error: calcError instanceof Error ? calcError.message : 'Review the tax records before calculating.', code, reviewReasons, settings: records.homeOffice }, { status: 422, headers });
    }
    return NextResponse.json({ error: 'Could not calculate the home office worksheet. Please retry.' }, { status: 503 });
  }
}
