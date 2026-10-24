import { POST as exchange } from '../exchange-public-token/route';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { NextResponse } from 'next/server';
import { BANK_CONSENT_REQUIRED_BODY, isBankConsentRequired, requireBankDataConsent } from '@/lib/onboarding/bank-consent';
export { DELETE } from '../items/route';
export async function POST(request: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(request)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  try { await requireBankDataConsent(uid); }
  catch (error) {
    if (isBankConsentRequired(error)) return NextResponse.json(BANK_CONSENT_REQUIRED_BODY, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ error: 'Unable to connect bank. Please retry.' }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  return exchange(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify({ public_token: body.publicToken ?? body.public_token }) }));
}
