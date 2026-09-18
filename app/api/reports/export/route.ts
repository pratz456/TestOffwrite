export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { requireFeatureAccess } from '@/lib/subscriptions/feature-access';
import { generateForm8829PDF } from '@/lib/reports/form8829';
import { generateForm4562PDF } from '@/lib/reports/form4562';
import { generateScheduleSEPDF } from '@/lib/reports/scheduleSE';
import { loadScheduleCRecords, loadScheduleSEData, scheduleCProfitFromRecords } from '@/lib/reports/load-schedule-se';
import { getFederalTaxRules, SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
import { exportYear } from '@/lib/reports/transaction-export';
import { HomeOfficeReviewRequiredError, homeOfficeReviewReasons } from '@/lib/reports/calc8829';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';

const REVIEW_CODES = ['EXPORT_REVIEW_REQUIRED', 'DEPRECIATION_REVIEW_REQUIRED', 'HOME_OFFICE_REVIEW_REQUIRED', 'HOME_OFFICE_DETAILS_REQUIRED', 'INVALID_HOME_OFFICE_INPUT', 'FILING_STATUS_REVIEW_REQUIRED', 'INCOME_RECONCILIATION_REQUIRED'];

export async function POST(request: NextRequest) {
  let uid: string;
  try { uid = (await getUserFromReqOrThrow(request)).uid; }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  const denied = await requireFeatureAccess(uid, 'exports');
  if (denied) return denied;
  let type: string, year: number;
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['type', 'year'].includes(key))) throw new Error();
    if (!['form8829', 'form4562', 'scheduleSE'].includes(body.type)) throw new Error();
    type = body.type; year = exportYear(body.year) ?? new Date().getFullYear();
    getFederalTaxRules(year);
  } catch { return NextResponse.json({ error: `Provide form8829, form4562 or scheduleSE and a supported year (${SUPPORTED_TAX_YEARS.join(', ')}).` }, { status: 400 }); }
  const limit = await enforceRateLimit({ ...RATE_LIMITS.reportExport, key: uid });
  if (!limit.allowed) return rateLimitResponse(limit, { error: 'Too many report downloads. Please wait a few minutes and try again.' });
  try {
    let bytes: Uint8Array;
    if (type === 'scheduleSE') {
      bytes = await generateScheduleSEPDF(await loadScheduleSEData(uid, year));
    } else {
      const records = await loadScheduleCRecords(uid, year);
      if (type === 'form8829') {
        if (!records.homeOffice) return NextResponse.json({ error: 'Complete the Home Office section in Settings before preparing this worksheet.' }, { status: 400 });
        // The line 29 income limit comes from the same ordering the annual estimate uses.
        const scheduleC = scheduleCProfitFromRecords(records);
        if (!scheduleC.homeOffice.calculation) {
          throw new HomeOfficeReviewRequiredError(homeOfficeReviewReasons(records.homeOffice).join(' ') || 'Choose the simplified method and answer the home office questions in Settings.');
        }
        bytes = await generateForm8829PDF({ userProfile: records.profile, homeOfficeSettings: records.homeOffice, transactions: records.transactions, taxYear: year, simplified: scheduleC.homeOffice.calculation });
      } else {
        if (!records.assets.length) return NextResponse.json({ error: 'Add your business assets before preparing this worksheet.' }, { status: 400 });
        bytes = await generateForm4562PDF({
          userProfile: records.profile, assetsSettings: records.assets, transactions: records.transactions, taxYear: year,
          businessIncome: records.section179BusinessIncome, elections: records.depreciationElections,
        });
      }
    }
    return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="writeoff-${type}-preparer-${year}.pdf"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (REVIEW_CODES.includes(code)) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Additional tax details required', code }, { status: 422 });
    }
    return NextResponse.json({ error: 'Could not load a complete report. Please retry.' }, { status: 503 });
  }
}
