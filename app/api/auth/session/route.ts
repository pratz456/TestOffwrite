import { NextResponse, type NextRequest } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';
import { isSameOriginRequest } from '@/lib/firebase/api-auth';

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Cross-site session creation is not allowed' }, { status: 403 });
  }
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const idToken = body?.idToken;
  if (typeof idToken !== 'string' || !idToken.trim()) {
    return NextResponse.json({ error: 'Missing idToken' }, { status: 400 });
  }
  try {
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    if (decoded.email_verified !== true) {
      return NextResponse.json({ error: 'Verify your email before signing in' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }
  try {
    const expiresIn = 14 * 24 * 60 * 60 * 1000;
    const session = await adminAuth.createSessionCookie(idToken, { expiresIn });
    const response = NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'private, no-store' } });
    response.cookies.set('__session', session, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', path: '/',
      maxAge: expiresIn / 1000, sameSite: 'lax',
    });
    // Remove the old JavaScript-readable duplicate of the long-lived session.
    response.cookies.set('firebase-auth-token', '', { path: '/', maxAge: 0, sameSite: 'lax' });
    return response;
  } catch {
    return NextResponse.json({ error: 'Unable to start your session. Please try again.' }, { status: 503 });
  }
}
