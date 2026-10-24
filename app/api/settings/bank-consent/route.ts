import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import {
  grantBankDataConsent, isBankConsentInput, readBankConsentStatus, withdrawBankDataConsent,
} from '@/lib/onboarding/bank-consent';
import { BANK_CONSENT_SAVE_ERROR } from '@/lib/onboarding/bank-consent-copy';
import { isValidTimeZone } from '@/lib/openai/consent-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const postInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('withdraw') }).strict(),
  z.object({
    action: z.literal('grant'),
    acknowledged: z.literal(true),
    timeZone: z.string().trim().min(1).max(120),
  }).strict(),
]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return json({ error: 'Unauthorized' }, 401);
  try {
    return json({ success: true, ...(await readBankConsentStatus(user.uid)) });
  } catch {
    return json({ error: BANK_CONSENT_SAVE_ERROR }, 500);
  }
}

/** Owner only. Grant and withdraw write bank fields and leave every other consent untouched. */
export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return json({ error: 'Unauthorized' }, 401);
  const parsed = postInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Send a supported consent action.' }, 400);
  const requestedAt = new Date();
  try {
    if (parsed.data.action === 'withdraw') return json({ success: true, ...(await withdrawBankDataConsent(user.uid, requestedAt)) });
    if (!isValidTimeZone(parsed.data.timeZone)) return json({ error: 'Send a supported consent action.' }, 400);
    return json({ success: true, ...(await grantBankDataConsent(user.uid, parsed.data.timeZone, requestedAt)) });
  } catch (cause) {
    if (isBankConsentInput(cause)) return json({ error: 'Send a supported consent action.' }, 400);
    return json({ error: BANK_CONSENT_SAVE_ERROR }, 500);
  }
}
