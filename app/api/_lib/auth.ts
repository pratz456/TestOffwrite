import { adminAuth } from '@/lib/firebase/admin';

export async function getUserFromReqOrThrow(req: Request) {
  const header = req.headers.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  const idToken = m?.[1];
  
  if (!idToken) {
    throw new Error('Missing or invalid Authorization header');
  }

  // Verify with Admin Auth.
  // Note: avoid "checkRevoked" here since it requires additional Google APIs/quotas
  // and can break local dev setups that don't have Identity Toolkit enabled.
  const decoded = await adminAuth.verifyIdToken(idToken);
  return { uid: decoded.uid };
}
