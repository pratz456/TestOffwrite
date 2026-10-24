import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import {
  acceptDisclosureConsent, acceptReuseConsent, declineModelConsent, readModelConsentBundle, withdrawModelConsent,
} from '@/lib/openai/consent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const postInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('withdraw') }).strict(),
  z.object({ action: z.literal('decline') }).strict(),
  z.object({
    action: z.literal('accept'),
    acknowledged: z.literal(true),
    signedName: z.string().trim().min(1).max(200),
  }).strict(),
  z.object({
    action: z.literal('accept_reuse'),
    acknowledged: z.literal(true),
  }).strict(),
]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return json({ error: 'Unauthorized' }, 401);
  try {
    return json({ success: true, ...(await readModelConsentBundle(user.uid)) });
  } catch {
    return json({ error: 'Consent status could not be loaded.' }, 500);
  }
}

/** Owner only. The uid always comes from the session. Disclosure and reuse are separate writes. */
export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return json({ error: 'Unauthorized' }, 401);
  const parsed = postInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Send a supported consent action.' }, 400);
  const requestedAt = new Date();
  try {
    if (parsed.data.action === 'withdraw') return json({ success: true, ...(await withdrawModelConsent(user.uid, requestedAt)) });
    if (parsed.data.action === 'decline') return json({ success: true, ...(await declineModelConsent(user.uid, requestedAt)) });
    if (parsed.data.action === 'accept_reuse') return json({ success: true, ...(await acceptReuseConsent(user.uid, requestedAt)) });
    return json({ success: true, ...(await acceptDisclosureConsent(user.uid, parsed.data.signedName, requestedAt)) });
  } catch {
    return json({ error: 'Consent could not be saved.' }, 500);
  }
}
