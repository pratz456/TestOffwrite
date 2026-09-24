import type { Firestore } from 'firebase-admin/firestore';

const HANDOFF_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validUid = (uid: unknown): uid is string => typeof uid === 'string' && /^[^/\\\u0000-\u001f\u007f]{1,256}$/.test(uid) && !['.', '..'].includes(uid);
export const RETENTION_QUERY_LIMIT = 100;
export const RETENTION_CONCURRENCY = 4;
interface SnapshotBucket { file(path: string): { delete(options: { ignoreNotFound: true }): Promise<unknown> } }
export interface RetentionResult { examined: number; deleted: number; skipped: number; failed: number; batchFull: boolean }

function eligible(data: Record<string, unknown> | undefined, now: number) {
  return !!data && ((Number.isSafeInteger(data.expiresAt) && Number(data.expiresAt) <= now)
    || (Number.isSafeInteger(data.revokedAt) && Number(data.revokedAt) > 0 && Number(data.revokedAt) <= now));
}

/**
 * Snapshots cannot be renewed or reassigned. Delete the fixed owner/id object first,
 * then remove metadata and its active-link slot together. A Storage failure leaves
 * the metadata available for the next scheduled attempt. Already expired/revoked
 * snapshots stay inaccessible throughout retries; no token or record is logged.
 */
export async function cleanupPreparerHandoffs(db: Firestore, bucket: SnapshotBucket, now = Date.now()): Promise<RetentionResult> {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('HANDOFF_RETENTION_INVALID_TIME');
  const collection = db.collection('preparer_handoffs');
  // Each query uses its field's automatic single-field index. The upper bound is
  // 200 snapshots per run, independent of the size of the customer database.
  const [expired, revoked] = await Promise.all([
    collection.where('expiresAt', '<=', now).orderBy('expiresAt').limit(RETENTION_QUERY_LIMIT).get(),
    collection.where('revokedAt', '>', 0).where('revokedAt', '<=', now).orderBy('revokedAt').limit(RETENTION_QUERY_LIMIT).get(),
  ]);
  const candidates = [...new Map([...expired.docs, ...revoked.docs].map(doc => [doc.id, doc])).values()];
  const result: RetentionResult = { examined: candidates.length, deleted: 0, skipped: 0, failed: 0,
    batchFull: expired.size === RETENTION_QUERY_LIMIT || revoked.size === RETENTION_QUERY_LIMIT };
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(RETENTION_CONCURRENCY, candidates.length) }, async () => {
    while (index < candidates.length) {
      const doc = candidates[index++];
      try {
        // Read again because revocation/account deletion may have run since selection.
        const current = await doc.ref.get(), data = current.data();
        if (!current.exists || !eligible(data, now)) { result.skipped++; continue; }
        const uid = data!.userId;
        if (!HANDOFF_ID.test(doc.id) || !validUid(uid)) throw new Error('HANDOFF_RETENTION_INVALID_RECORD');
        // Never trust a persisted path, URL, bucket or prefix as a deletion target.
        await bucket.file(`preparer_handoffs/${uid}/${doc.id}/package.zip`).delete({ ignoreNotFound: true });
        const removed = await db.runTransaction(async tx => {
          const ownerRef = db.doc(`preparer_handoff_owners/${uid}`);
          const [fresh, owner] = await Promise.all([tx.get(doc.ref), tx.get(ownerRef)]);
          if (!fresh.exists) return false;
          if (fresh.data()?.userId !== uid || !eligible(fresh.data(), now)) throw new Error('HANDOFF_RETENTION_RECORD_CHANGED');
          if (owner.exists) {
            const slots = { ...(owner.data()?.slots ?? {}) }; delete slots[doc.id];
            tx.update(ownerRef, { slots });
          }
          tx.delete(doc.ref);
          return true;
        });
        if (removed) result.deleted++; else result.skipped++;
      } catch {
        // Continue through the bounded batch; the scheduler retries after this run.
        result.failed++;
      }
    }
  }));
  return result;
}
