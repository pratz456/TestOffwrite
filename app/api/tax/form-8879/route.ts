/** Legacy authorization records are historical app records, not IRS filing evidence.
 * Actual return review/signatures must take place in the connected filing provider.
 * Never collect or store new self-select PINs against WriteOff planning estimates.
 */
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
  const year = /^\d{4}$/.test(raw) ? Number(raw) : NaN;
  if (!(SUPPORTED_TAX_YEARS as readonly number[]).includes(year)) return NextResponse.json({ error: 'Choose a supported tax year.' }, { status: 400, headers });
  try {
    const snap = await adminDb.collection('form_8879').where('userId', '==', user.uid).where('taxYear', '==', year).limit(1).get();
    // Deliberately omit PINs, claimed consent, tax amounts and any fabricated "signed" status.
    return NextResponse.json({ taxYear: year, authorization: null, legacyRecordExists: !snap.empty,
      filingAvailable: false, message: 'A saved WriteOff record is not evidence of a signed provider return or an IRS submission. Complete review and authorization with your filing provider.' }, { headers });
  } catch {
    return NextResponse.json({ error: 'Unable to load the historical record. Please retry.' }, { status: 503, headers });
  }
}
export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  return NextResponse.json({ code: 'FILING_PROVIDER_REQUIRED', error: 'WriteOff does not collect e-file PINs or authorize filing from a planning estimate. Review and sign the completed return inside an authorized filing provider.' }, { status: 409, headers });
}
