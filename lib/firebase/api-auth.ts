import { adminAuth } from './admin';
import { isTrustedApplicationRequest } from '@/lib/security/request-origin';

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

/** Cookie credentials are automatic, so reject mutations originating at another site. */
export function isSameOriginRequest(request: Request): boolean {
  return isTrustedApplicationRequest(request);
}

function cookieValue(request: Request, name: string): string | undefined {
  const value = request.headers.get('cookie')?.split(';')
    .map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : undefined;
}

export async function getAuthenticatedUser(request: Request): Promise<{
  user: AuthenticatedUser | null;
  error: string | null;
}> {
  try {
    const header = request.headers.get('authorization');
    let decoded;
    if (header !== null) {
      const match = header.match(/^Bearer\s+(\S+)$/i);
      if (!match) return { user: null, error: 'Invalid Authorization header' };
      // An invalid explicit credential must not fall back to another account's cookie.
      decoded = await adminAuth.verifyIdToken(match[1], true);
    } else {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !isSameOriginRequest(request)) {
        return { user: null, error: 'Cross-site request rejected' };
      }
      const session = cookieValue(request, '__session');
      const legacyIdToken = cookieValue(request, 'firebase-auth-token');
      if (session) decoded = await adminAuth.verifySessionCookie(session, true);
      else if (legacyIdToken) decoded = await adminAuth.verifyIdToken(legacyIdToken, true);
      else return { user: null, error: 'No authentication token found' };
    }
    if (decoded.email_verified !== true) return { user: null, error: 'Email verification required' };
    return {
      user: { uid: decoded.uid, email: decoded.email || null, emailVerified: decoded.email_verified === true },
      error: null,
    };
  } catch {
    return { user: null, error: 'Invalid or expired token' };
  }
}

export function createAuthHeaders(idToken: string): HeadersInit {
  return { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };
}
