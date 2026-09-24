import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { actOnReconnect, getReconnectView, latestReconnectSession, ReconnectError } from '@/lib/plaid/reconnect';
import type { ReconnectAction } from '@/lib/plaid/reconnect-contract';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(request)); } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers }); }
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('sessionId') || await latestReconnectSession(uid);
    if (!id) return NextResponse.json({ success: true, reconnect: null }, { headers });
    return NextResponse.json({ success: true, reconnect: await getReconnectView(uid, id, url.searchParams.get('cursor') || undefined) }, { headers });
  } catch { return NextResponse.json({ error: 'Bank review could not be loaded. Refresh and retry.' }, { status: 409, headers }); }
}
export async function POST(request: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(request)); } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers }); }
  const limit = await enforceRateLimit({ ...RATE_LIMITS.plaidSync, limit: 120, windowMs: 10 * 60_000, key: `reconnect:${uid}` });
  if (!limit.allowed) return rateLimitResponse(limit, { error: 'Please wait a moment before continuing bank review.' });
  try {
    const body = await request.json();
    if (!body || !['start', 'map', 'decide', 'sync', 'activate', 'cancel'].includes(body.action)) return NextResponse.json({ error: 'Invalid bank review action' }, { status: 400, headers });
    return NextResponse.json({ success: true, reconnect: await actOnReconnect(uid, body as ReconnectAction) }, { headers });
  } catch (error) {
    // Only our validation errors contain owner-safe prose. Provider details remain private.
    const message = error instanceof ReconnectError ? error.message : 'Bank review could not finish. Please retry.';
    return NextResponse.json({ error: message }, { status: 409, headers });
  }
}
