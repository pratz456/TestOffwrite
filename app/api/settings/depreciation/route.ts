import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getDepreciationSettings, saveDepreciationSettings } from '@/lib/firebase/settings-server';
import { SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';

export const dynamic = 'force-dynamic';

/**
 * settings/depreciation: annual elections that are not attributes of one asset.
 * `deMinimisSafeHarborYears` records each tax year for which the taxpayer states they elect
 * the Reg. §1.263(a)-1(f) de minimis safe harbor on a timely filed original return.
 */
export async function GET(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await getDepreciationSettings(user.uid);
  if (error || !data) return NextResponse.json({ error: 'Failed to load depreciation settings' }, { status: 500 });
  return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Send the depreciation settings as JSON.' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'deMinimisSafeHarborYears')) {
    return NextResponse.json({ error: 'Provide deMinimisSafeHarborYears only.' }, { status: 400 });
  }
  const years = (body as { deMinimisSafeHarborYears?: unknown }).deMinimisSafeHarborYears;
  if (!Array.isArray(years) || years.some(year => !SUPPORTED_TAX_YEARS.includes(year as typeof SUPPORTED_TAX_YEARS[number]))) {
    return NextResponse.json({ error: `deMinimisSafeHarborYears must list supported tax years only (${SUPPORTED_TAX_YEARS.join(', ')}).`, code: 'INVALID_DEPRECIATION_INPUT' }, { status: 400 });
  }
  const { data, error } = await saveDepreciationSettings(user.uid, { deMinimisSafeHarborYears: years as number[] });
  if (error || !data) return NextResponse.json({ error: 'Failed to save depreciation settings' }, { status: 500 });
  return NextResponse.json({ success: true, data });
}
