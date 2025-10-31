import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const res = NextResponse.json({ success: true });
    // Clear the __session cookie (httpOnly)
    res.cookies.set('__session', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });

    // Also clear the firebase-auth-token cookie
    res.cookies.set('firebase-auth-token', '', {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });
    return res;
  } catch (error) {
    console.error('Error clearing session cookie:', error);
    return NextResponse.json({ error: 'Failed to clear session' }, { status: 500 });
  }
}
