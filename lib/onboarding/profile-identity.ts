import { auth } from '@/lib/firebase/client';

type IdentityAuth = { currentUser: { uid: string; email: string | null; reload(): Promise<void> } | null };
const pendingReloads = new WeakMap<object, Promise<void>>();

/** Refresh only the signed-in identity; never read a replacement account's email. */
export async function reloadProfileEmail(expectedUid: string, client: IdentityAuth = auth): Promise<string> {
  const current = client.currentUser;
  if (!expectedUid || current?.uid !== expectedUid) throw new Error('Your account changed. Return to your current account to continue.');
  try {
    if (!current.email?.trim()) {
      let pending = pendingReloads.get(current);
      if (!pending) {
        pending = current.reload().finally(() => { pendingReloads.delete(current); });
        pendingReloads.set(current, pending);
      }
      await pending;
    }
  } catch {
    throw new Error('We could not load your account email. Check your connection and try again.');
  }
  if (client.currentUser?.uid !== expectedUid) throw new Error('Your account changed. Return to your current account to continue.');
  if (!client.currentUser.email?.trim()) throw new Error('We could not load your account email. Please try again.');
  return client.currentUser.email;
}
