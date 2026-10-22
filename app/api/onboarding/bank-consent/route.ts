export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { invalidJsonResponse, readJsonObject } from '@/app/api/_lib/body';
import { appendBankConsent } from '@/lib/onboarding/bank-consent';
import { BANK_CONSENT_VERSION } from '@/lib/onboarding/bank-consent-copy';

const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  const body = await readJsonObject(req);
  if (!body) return invalidJsonResponse();
  if (Object.keys(body).some(key => key !== 'accepted_at' && key !== 'version')) {
    return NextResponse.json({ error: 'Bank acknowledgment contains fields that cannot be saved' }, { status: 400 });
  }
  if (body.version !== BANK_CONSENT_VERSION) {
    return NextResponse.json({ error: 'Bank acknowledgment is out of date. Refresh and try again.' }, { status: 400 });
  }
  if (typeof body.accepted_at !== 'string' || body.accepted_at.length > 40 || Number.isNaN(Date.parse(body.accepted_at))) {
    return NextResponse.json({ error: 'Bank acknowledgment is missing the time it was accepted' }, { status: 400 });
  }
  if (new Date(body.accepted_at).getTime() > Date.now() + MAX_FUTURE_MS) {
    return NextResponse.json({ error: 'Bank acknowledgment time is not valid' }, { status: 400 });
  }
  try {
    await appendBankConsent(uid, new Date(body.accepted_at).toISOString());
  } catch {
    return NextResponse.json({ error: 'We could not save your bank acknowledgment. Please try again.' }, { status: 503 });
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
