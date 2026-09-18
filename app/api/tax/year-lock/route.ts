/** Historical local locks are not evidence of a provider or IRS acknowledgment. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const raw = request.nextUrl.searchParams.get('year') ?? String(SUPPORTED_TAX_YEARS.at(-1));
  const taxYear = /^\d{4}$/.test(raw) ? Number(raw) : NaN;
  if (!(SUPPORTED_TAX_YEARS as readonly number[]).includes(taxYear)) return NextResponse.json({ error: 'Choose a supported tax year.' }, { status: 400, headers });
  try {
    const doc = await adminDb.collection('tax_year_locks').doc(`${user.uid}_${taxYear}`).get();
    const data = doc.data();
    if (doc.exists && (data?.userId !== user.uid || data?.taxYear !== taxYear)) throw new Error('Record ownership mismatch');
    return NextResponse.json({ lock: null, status: doc.exists ? 'unverified' : 'open', taxYear,
      // Preserve conservative legacy lock state without presenting it as filing proof.
      isLocked: !!data && ['submitted', 'accepted', 'filed'].includes(data.status),
      legacyRecordExists: doc.exists, verifiedFilingStatus: null,
      message: 'Local records do not verify filing or IRS acceptance. Confirm status with your filing provider.' }, { headers });
  } catch { return NextResponse.json({ error: 'Historical lock status could not be loaded. Please retry.' }, { status: 503, headers }); }
}
export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  return NextResponse.json({ error: 'Filing status must come from a verified filing provider. It cannot be set by this request.', code: 'PROVIDER_STATUS_REQUIRED' }, { status: 409, headers });
}
