/**
 * Support access is doubly gated: the caller's UID must be in the server-only
 * SUPPORT_ADMIN_UIDS allowlist (comma-separated) AND the verified token must
 * carry the Firebase custom claim `admin: true`. With no allowlist configured
 * the support routes do not exist (404), so a claim alone never grants access.
 *
 * Every successful lookup is recorded in the server-only `support_audit`
 * collection (who looked at which account, when, and which view) without any
 * of the returned data. Firestore rules deny all client access to it.
 */
import { adminDb } from '@/lib/firebase/admin';
import type { AuthenticatedUser } from '@/lib/firebase/api-auth';

export const SUPPORT_AUDIT_COLLECTION = 'support_audit';
const UID = /^[^/\\\u0000-\u001f\u007f\s,]{1,128}$/;

export function supportAdminUids(configured: string | undefined = process.env.SUPPORT_ADMIN_UIDS): Set<string> {
  const uids = new Set<string>();
  for (const entry of (configured ?? '').split(',')) {
    const uid = entry.trim();
    if (uid && UID.test(uid)) uids.add(uid);
  }
  return uids;
}

export function isSupportAdmin(user: Pick<AuthenticatedUser, 'uid' | 'admin'> | null | undefined,
  allowlist: Set<string> = supportAdminUids()): boolean {
  return Boolean(user && allowlist.size > 0 && allowlist.has(user.uid) && user.admin === true);
}

/** Fails closed: a lookup whose audit record cannot be written is not returned. */
export async function recordSupportAccess(entry: { actorUid: string; subjectUid: string; action: string }): Promise<void> {
  await adminDb.collection(SUPPORT_AUDIT_COLLECTION).add({
    actorUid: entry.actorUid, subjectUid: entry.subjectUid, action: entry.action, at: new Date(),
  });
}
