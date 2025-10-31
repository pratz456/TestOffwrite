import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';

// POST /api/auth/session
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const idToken = body?.idToken;
    
    console.log('[api/auth/session] Starting session creation process');
    console.log('[api/auth/session] Environment:', process.env.NODE_ENV);
    console.log('[api/auth/session] Has idToken:', !!idToken);
    console.log('[api/auth/session] idToken length:', idToken?.length || 0);
    
    if (!idToken) {
      console.error('[api/auth/session] Missing idToken in request body');
      return NextResponse.json({ error: 'Missing idToken' }, { status: 400 });
    }

    // Create session cookie (14 days). Adjust expiration as needed.
    const expiresIn = 14 * 24 * 60 * 60 * 1000; // 14 days in ms
    let sessionCookie: string | null = null;
    
    // Check if Firebase Admin SDK is properly configured
    const hasAdminConfig = !!(
      process.env.FIREBASE_ADMIN_PROJECT_ID &&
      process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
      process.env.FIREBASE_ADMIN_PRIVATE_KEY
    );
    
    console.log('[api/auth/session] Firebase Admin SDK configured:', hasAdminConfig);
    console.log('[api/auth/session] FIREBASE_ADMIN_PROJECT_ID set:', !!process.env.FIREBASE_ADMIN_PROJECT_ID);
    console.log('[api/auth/session] FIREBASE_ADMIN_CLIENT_EMAIL set:', !!process.env.FIREBASE_ADMIN_CLIENT_EMAIL);
    console.log('[api/auth/session] FIREBASE_ADMIN_PRIVATE_KEY set:', !!process.env.FIREBASE_ADMIN_PRIVATE_KEY);
    
    try {
      console.log('[api/auth/session] Attempting to create session cookie with Firebase Admin SDK');
      sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn });
      console.log('[api/auth/session] Session cookie created successfully, length:', sessionCookie?.length || 0);
    } catch (e: any) {
      console.error('[api/auth/session] createSessionCookie failed:', String(e?.message ?? e));
      console.error('[api/auth/session] Error details:', {
        code: e?.code,
        message: e?.message,
        stack: e?.stack?.split('\n').slice(0, 3).join('\n')
      });
      
      // If Admin SDK isn't configured (common in local dev), provide a dev-only fallback
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[api/auth/session] falling back to dev behavior: setting __session and firebase-auth-token without Admin SDK verification. This is UNSAFE for production.');
        // For a local dev fallback we will use the raw idToken as the session cookie value and
        // set a client-readable `firebase-auth-token` as well so other middleware/routes can find it.
        sessionCookie = idToken;
      } else {
        console.error('[api/auth/session] Firebase Admin SDK failed in production. Check environment variables.');
        throw e;
      }
    }

    const res = NextResponse.json({ success: true });

    // Set HttpOnly cookie named __session per Firebase hosting conventions
    // Only set Secure in production so localhost/dev (http) still receives the cookie.
    if (!sessionCookie) {
      console.error('[api/auth/session] sessionCookie is unexpectedly null');
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
    }

    console.log('[api/auth/session] Setting cookies...');
    console.log('[api/auth/session] Cookie secure setting:', process.env.NODE_ENV === 'production');
    console.log('[api/auth/session] Cookie maxAge:', Math.floor(expiresIn / 1000));

    // Set HttpOnly session cookie
    res.cookies.set('__session', sessionCookie as string, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: Math.floor(expiresIn / 1000),
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });

    // Set client-readable cookie for middleware (works in both dev and production)
    // This cookie is required by the middleware to detect authentication state
    res.cookies.set('firebase-auth-token', sessionCookie, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: Math.floor(expiresIn / 1000),
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });

    console.log('[api/auth/session] Session creation completed successfully');
    return res;
  } catch (error) {
    console.error('Error creating session cookie:', error);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}
