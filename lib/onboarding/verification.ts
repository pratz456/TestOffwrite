import type { User } from 'firebase/auth';

/** Verify both email state and session creation before allowing navigation. */
export async function establishVerifiedSession(
  user: Pick<User, 'reload' | 'emailVerified' | 'getIdToken'> | null,
  request: typeof fetch = fetch,
): Promise<boolean> {
  if (!user) throw new Error('Sign in again to check your email verification.');
  await user.reload();
  if (!user.emailVerified) return false;
  // Verification happened in another tab; the previous token may still say false.
  const idToken = await user.getIdToken(true);
  const response = await request('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) throw new Error('Your email is verified, but we could not start your session. Try again or sign in.');
  return true;
}
