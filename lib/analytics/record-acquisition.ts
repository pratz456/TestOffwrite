/**
 * Writes `acquisition` once on the caller's own user_profiles document.
 * Client security rules deny every profile create and update, so this uses the
 * Admin SDK and does not require a rules change. A document that already has
 * `acquisition` is left unchanged.
 */

import { ACQUISITION_TTL_MS, acquisitionFromUnknown } from '@/lib/analytics/acquisition';
import { adminAuth, adminDb } from '@/lib/firebase/admin';

export async function recordAcquisitionOnce(uid: string, input: unknown, now = Date.now()): Promise<boolean> {
  const acquisition = acquisitionFromUnknown(input, now);
  if (!acquisition || !uid) return false;
  const created = Date.parse((await adminAuth.getUser(uid)).metadata.creationTime ?? '');
  if (!Number.isFinite(created) || created > now + 5 * 60 * 1000 || now - created > ACQUISITION_TTL_MS) return false;
  const ref = adminDb.doc(`user_profiles/${uid}`);
  let saved = false;
  await adminDb.runTransaction(async transaction => {
    saved = false;
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data()?.acquisition : undefined;
    if (current && typeof current === 'object' && !Array.isArray(current)) return;
    transaction.set(ref, { acquisition }, { merge: true });
    saved = true;
  });
  return saved;
}
