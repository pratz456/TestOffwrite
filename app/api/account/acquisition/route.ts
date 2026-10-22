import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';
import { isSameOriginRequest } from '@/lib/firebase/api-auth';
import { acquisitionFromUnknown } from '@/lib/analytics/acquisition';
import { recordAcquisitionOnce } from '@/lib/analytics/record-acquisition';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function cookieValue(request: Request, name: string): string | undefined {
  const value = request.headers.get('cookie')?.split(';')
    .map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : undefined;
}

/** Accepts a new account's ID token before the email is verified. The token still has to be valid. */
async function authenticatedUid(request: Request): Promise<string | null> {
  try {
    const header = request.headers.get('authorization');
    if (header !== null) {
      const match = header.match(/^Bearer\s+(\S+)$/i);
      if (!match) return null;
      return (await adminAuth.verifyIdToken(match[1], true)).uid || null;
    }
    const session = cookieValue(request, '__session');
    if (!session) return null;
    return (await adminAuth.verifySessionCookie(session, true)).uid || null;
  } catch {
    return null;
  }
}

function acquisitionFromBody(body: unknown, now: number) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  return acquisitionFromUnknown('acquisition' in record ? record.acquisition : body, now);
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Cross-site request rejected' }, { status: 403, headers: NO_STORE });
  }
  const uid = await authenticatedUid(request);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: NO_STORE }); }
  const now = Date.now();
  const acquisition = acquisitionFromBody(body, now);
  if (!acquisition) {
    return NextResponse.json({ error: 'No acquisition to record' }, { status: 400, headers: NO_STORE });
  }
  try {
    const saved = await recordAcquisitionOnce(uid, acquisition, now);
    return NextResponse.json({ saved }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'Failed to record acquisition' }, { status: 503, headers: NO_STORE });
  }
}
