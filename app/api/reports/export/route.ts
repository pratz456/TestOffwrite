export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { requireFeatureAccess } from '@/lib/subscriptions/feature-access';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { readTaxExportTransactions } from '@/lib/reports/tax-export-transactions';
import { getHomeOfficeSettings, getAssetsSettings } from '@/lib/firebase/settings-server';
import { generateForm8829PDF } from '@/lib/reports/form8829';
import { generateForm4562PDF } from '@/lib/reports/form4562';
import { generateScheduleSEPDF } from '@/lib/reports/scheduleSE';
import { loadScheduleSEData } from '@/lib/reports/load-schedule-se';
import { getFederalTaxRules, SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
import { exportYear } from '@/lib/reports/transaction-export';

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
  try {
    let bytes: Uint8Array;
    if (type === 'scheduleSE') {
      bytes = await generateScheduleSEPDF(await loadScheduleSEData(uid, year));
    } else {
      const [profile, transactions] = await Promise.all([getUserProfileServer(uid), readTaxExportTransactions(uid, year)]);
      if (profile.error || !profile.data) throw new Error('Data unavailable');
      if (type === 'form8829') {
        const settings = await getHomeOfficeSettings(uid);
        if (settings.error) throw new Error('Data unavailable');
        if (!settings.data) return NextResponse.json({ error: 'Complete your home office settings before preparing this worksheet.' }, { status: 400 });
        bytes = await generateForm8829PDF({ userProfile: profile.data, homeOfficeSettings: settings.data, transactions, taxYear: year });
      } else {
        const assets = await getAssetsSettings(uid);
        if (assets.error) throw new Error('Data unavailable');
        if (!assets.data?.length) return NextResponse.json({ error: 'Add your business assets before preparing this worksheet.' }, { status: 400 });
        bytes = await generateForm4562PDF({ userProfile: profile.data, assetsSettings: assets.data, transactions, taxYear: year });
      }
    }
    return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="writeoff-${type}-preparer-${year}.pdf"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (['EXPORT_REVIEW_REQUIRED', 'DEPRECIATION_REVIEW_REQUIRED', 'HOME_OFFICE_DETAILS_REQUIRED', 'INVALID_HOME_OFFICE_INPUT', 'FILING_STATUS_REVIEW_REQUIRED', 'INCOME_RECONCILIATION_REQUIRED'].includes(code)) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Additional tax details required', code }, { status: 422 });
    }
    return NextResponse.json({ error: 'Could not load a complete report. Please retry.' }, { status: 503 });
  }
}
