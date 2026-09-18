import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isSameOriginRequest } from '@/lib/firebase/api-auth';

export async function POST(request: NextRequest) {
  // A cross-site page must not be able to force a sign-out.
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Cross-site request rejected' }, { status: 403 });
  }
  try {
    const res = NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'private, no-store' } });
    const secure = process.env.NODE_ENV === 'production';
    // Clearing matches on name/path, so use the same SameSite policy as session creation.
    res.cookies.set('__session', '', { httpOnly: true, secure, path: '/', maxAge: 0, sameSite: 'lax' });
    res.cookies.set('firebase-auth-token', '', { httpOnly: false, secure, path: '/', maxAge: 0, sameSite: 'lax' });
    return res;
  } catch (error) {
    console.error('Error clearing session cookie:', error);
    return NextResponse.json({ error: 'Failed to clear session' }, { status: 500 });
  }
}
