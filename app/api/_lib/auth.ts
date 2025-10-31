import { adminAuth } from '@/lib/firebase/admin';

export async function getUserFromReqOrThrow(req: Request) {
  const header = req.headers.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  const idToken = m?.[1];
  
  if (!idToken) {
    throw new Error('Missing or invalid Authorization header');
  }

  // verify with Admin Auth
  const decoded = await adminAuth.verifyIdToken(idToken, true);
  return { uid: decoded.uid };
}
