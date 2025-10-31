// Ensure this runs on Node.js (Admin SDK doesn't work on Edge)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminAuth, adminDb } from '@/lib/firebase/admin';

function tryDecodeJwtUid(token: string | null) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    // base64url -> base64
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const obj = JSON.parse(json);
    // firebase tokens may use 'user_id', 'uid' or 'sub'
    return obj?.user_id || obj?.uid || obj?.sub || null;
  } catch (e) {
    return null;
  }
}

function clean<T extends Record<string, any>>(obj: T) {
  // remove undefined / null (Firestore rejects undefined)
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)
  ) as T;
}

export async function POST(req: Request) {
  // helpful default
  const err = (error: string, status = 400, details?: string) =>
    NextResponse.json({ ok: false, error, details }, { status });

  try {
    // 1) verify session cookie
    const cookieStore = await cookies();
    const session = cookieStore.get('__session')?.value;

    // If session cookie is missing, allow Authorization: Bearer <idToken> as a fallback
    // (helps browser dev environments or clients that cannot send httpOnly cookies).
    const authHeader = (req.headers.get('authorization') || '') as string;
    const bearerMatch = authHeader.match(/^Bearer\s+(.*)$/i);

    let uid: string | undefined;

    if (session) {
      try {
        const decoded = await adminAuth.verifySessionCookie(session, true);
        uid = decoded.uid;
      } catch (e: any) {
        console.warn('[api/user/profile] verifySessionCookie failed:', String(e?.message ?? e));
        // In development, fall back to decoding a client-sent token if Admin SDK isn't configured.
        if (process.env.NODE_ENV !== 'production') {
          try {
            const rawToken = req.headers.get('authorization')?.match(/^Bearer\s+(.*)$/i)?.[1]
              || (await cookies()).get('firebase-auth-token')?.value || null;
            const fallbackUid = tryDecodeJwtUid(rawToken);
            if (fallbackUid) {
              console.warn('[api/user/profile] using dev fallback uid from token (unsafe in prod)');
              uid = fallbackUid;
            } else {
              return err('invalid_session_cookie', 401, 'Session cookie invalid or expired');
            }
          } catch (decodeErr) {
            return err('invalid_session_cookie', 401, 'Session cookie invalid or expired');
          }
        } else {
          return err('invalid_session_cookie', 401, 'Session cookie invalid or expired');
        }
      }
    } else if (bearerMatch) {
      const idToken = bearerMatch[1];
      try {
        const decoded = await adminAuth.verifyIdToken(idToken);
        uid = decoded.uid;
      } catch (e: any) {
        console.warn('[api/user/profile] verifyIdToken failed (bearer fallback):', String(e?.message ?? e));
        // In development, attempt to decode UID from the bearer token without verification
        if (process.env.NODE_ENV !== 'production') {
          const fallbackUid = tryDecodeJwtUid(idToken);
          if (fallbackUid) {
            console.warn('[api/user/profile] using dev fallback uid from bearer token (unsafe in prod)');
            uid = fallbackUid;
          } else {
            return err('invalid_id_token', 401, 'ID token invalid or expired');
          }
        } else {
          return err('invalid_id_token', 401, 'ID token invalid or expired');
        }
      }
    } else {
      return err('no_session_cookie', 401);
    }

    // Ensure we have a uid
    if (!uid) {
      return err('no_authenticated_user', 401);
    }

    // 2) parse & validate JSON
    let body: any;
    try {
      body = await req.json();
    } catch {
      return err('invalid_json_body', 400);
    }

    // Debug: log that we received a request and whether session cookie exists
    try {
      // Note: avoid logging tokens, just presence
      const cookieHeader = req.headers.get('cookie') || '';
      console.log('[api/user/profile] received POST; cookie header length=', cookieHeader.length);
    } catch (e) {
      // ignore
    }

    // whitelist only the fields we expect from the form
    const {
      businessEntityType,
      primaryWorkLocation,
      workRelatedTravelPattern,
      annualIncomeRange,
    } = body ?? {};

    if (
      !businessEntityType ||
      !primaryWorkLocation ||
      !workRelatedTravelPattern ||
      !annualIncomeRange
    ) {
      return err('missing_required_fields', 422);
    }

    const doc = clean({
      userId: uid,
      businessEntityType,
      primaryWorkLocation,
      workRelatedTravelPattern,
      annualIncomeRange,
      updated_at: new Date(),
    });

    // Debug: log the doc we intend to write (without exposing sensitive tokens)
    try {
      console.log('[api/user/profile] writing doc for uid=', uid, 'doc=', JSON.stringify(doc));
    } catch (e) {
      // ignore serialization issues
    }

    // 3) Admin write (bypasses security rules)
    try {
      await adminDb.collection('user_profiles').doc(uid).set(doc, { merge: true });
    } catch (e: any) {
      return err('firestore_write_failed', 500, String(e?.message ?? e));
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: 'unexpected_server_error', details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}