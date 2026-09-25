import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthenticatedUser, isSameOriginRequest } from '@/lib/firebase/api-auth';
import { adminAuth } from '@/lib/firebase/admin';

function clearAuthCookies(response: NextResponse) {
  const secure = process.env.NODE_ENV === 'production';
  response.cookies.set('__session', '', { httpOnly: true, secure, path: '/', maxAge: 0, sameSite: 'lax' });
  response.cookies.set('firebase-auth-token', '', { httpOnly: false, secure, path: '/', maxAge: 0, sameSite: 'lax' });
  return response;
}

export async function POST(request: NextRequest) {
  // A cross-site page must not be able to force a sign-out.
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Cross-site request rejected' }, { status: 403 });
  }
  try {
    const { user } = await getAuthenticatedUser(request);
    if (user) await adminAuth.revokeRefreshTokens(user.uid);
    return clearAuthCookies(NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'private, no-store' } }));
  } catch {
    // Local credentials are still removed; the 503 tells the client that server-side
    // revocation could not be confirmed and should be retried.
    return clearAuthCookies(NextResponse.json(
      { error: 'Signed out locally, but server session revocation could not be confirmed. Please retry.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    ));
  }
}
