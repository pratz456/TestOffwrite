import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getFederalTaxRules, SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
import { loadScheduleSEData } from '@/lib/reports/load-schedule-se';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const year = Number(request.nextUrl.searchParams.get('year') ?? new Date().getFullYear());
  try { getFederalTaxRules(year); } catch { return NextResponse.json({ error: `Supported tax years: ${SUPPORTED_TAX_YEARS.join(', ')}` }, { status: 400 }); }
  try {
    const result = await loadScheduleSEData(user.uid, year);
    return NextResponse.json({ data: { year, netProfit: result.netProfit, totalIncome: result.grossReceipts,
      totalExpenses: result.totalExpenses + result.depreciationDeduction, confirmedExpenses: result.totalExpenses,
      depreciationDeduction: result.depreciationDeduction,
      message: 'Provisional business subtotal. Review returns/allowances, COGS, home office and other uncollected adjustments before filing.' } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (['EXPORT_REVIEW_REQUIRED', 'INCOME_RECONCILIATION_REQUIRED', 'FILING_STATUS_REVIEW_REQUIRED', 'DEPRECIATION_REVIEW_REQUIRED'].includes(code)) return NextResponse.json({ error: error instanceof Error ? error.message : 'Review business records.', code }, { status: 422 });
    return NextResponse.json({ error: 'Could not load business records. Please retry.' }, { status: 503 });
  }
}
