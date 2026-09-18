import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

export async function getUserFromReqOrThrow(req: Request) {
  const { user } = await getAuthenticatedUser(req);
  if (!user) throw new Error('Missing or invalid Authorization credentials');
  return { uid: user.uid };
}
