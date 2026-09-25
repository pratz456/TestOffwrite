import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { adminDb } from '@/lib/firebase/admin';
import { receiptBucket } from '@/lib/firebase/receipt-security';
import { MAX_PACKAGE_BYTES, PreparerPackageError, type PreparerPackageManifest } from '@/lib/reports/preparer-package';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const MAX_HANDOFF_DAYS = 7;
export const MAX_ACTIVE_HANDOFFS = 5;
export interface HandoffSummary { id: string; taxYear: number; createdAt: number; expiresAt: number; revokedAt: number | null; receiptFiles: number; receiptIssues: number; unresolvedQuestions: number; bytes: number }
const hashToken = (token: string) => createHash('sha256').update(`writeoff-preparer-v1:${token}`).digest('hex');
const validUid = (uid: string) => /^[^/\\\u0000-\u001f\u007f]{1,256}$/.test(uid) && !['.', '..'].includes(uid);
function storagePath(uid: string, id: string) {
  if (!validUid(uid) || !ID.test(id)) throw new PreparerPackageError('Invalid handoff.', 'HANDOFF_UNAVAILABLE', 404);
  return `preparer_handoffs/${uid}/${id}/package.zip`;
}
function summary(data: Record<string, any>, id: string): HandoffSummary {
  return { id, taxYear: data.taxYear, createdAt: data.createdAt, expiresAt: data.expiresAt, revokedAt: data.revokedAt ?? null,
    receiptFiles: data.receiptFiles, receiptIssues: data.receiptIssues, unresolvedQuestions: data.unresolvedQuestions, bytes: data.bytes };
}
export async function listPreparerHandoffs(uid: string) {
  if (!validUid(uid)) throw new PreparerPackageError('Invalid owner.', 'HANDOFF_UNAVAILABLE', 404);
  const owner = await adminDb.doc(`preparer_handoff_owners/${uid}`).get();
  const ids = Object.entries(owner.data()?.slots ?? {}).filter(([id, expiry]) => ID.test(id) && typeof expiry === 'number' && expiry > Date.now()).map(([id]) => id);
  const rows = await Promise.all(ids.slice(0, MAX_ACTIVE_HANDOFFS).map(id => adminDb.doc(`preparer_handoffs/${id}`).get()));
  return rows.filter(doc => doc.exists && doc.data()?.userId === uid && doc.data()?.revokedAt == null).map(doc => summary(doc.data()!, doc.id)).sort((a, b) => b.createdAt - a.createdAt);
}
export async function createPreparerHandoff(uid: string, bundle: { bytes: Buffer; filename: string; manifest: PreparerPackageManifest }, expiresInDays: number) {
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > MAX_HANDOFF_DAYS || bundle.bytes.length > MAX_PACKAGE_BYTES) throw new PreparerPackageError('Choose an expiry from 1 to 7 days.', 'HANDOFF_INVALID', 400);
  const id = randomUUID(), token = randomBytes(32).toString('base64url');
  const now = Date.now(), expiresAt = now + expiresInDays * 86_400_000;
  const path = storagePath(uid, id), file = receiptBucket().file(path);
  if ((await adminDb.doc(`account_deletions/${uid}`).get()).data()?.deletionRequested === true) throw new PreparerPackageError('Account deletion is in progress.', 'HANDOFF_UNAVAILABLE', 409);
  // No Firebase download token or public ACL: clients cannot read the snapshot directly.
  await file.save(bundle.bytes, { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/zip', cacheControl: 'private, no-store' } });
  try {
    await adminDb.runTransaction(async tx => {
      const ownerRef = adminDb.doc(`preparer_handoff_owners/${uid}`);
      const profileRef = adminDb.doc(`user_profiles/${uid}`);
      const [owner, profile, deletion] = await Promise.all([tx.get(ownerRef), tx.get(profileRef), tx.get(adminDb.doc(`account_deletions/${uid}`))]);
      if (!profile.exists || deletion.data()?.deletionRequested === true) throw new PreparerPackageError('Account is no longer available.', 'HANDOFF_UNAVAILABLE', 404);
      const slots = Object.fromEntries(Object.entries(owner.data()?.slots ?? {}).filter(([, expiry]) => typeof expiry === 'number' && expiry > now));
      if (Object.keys(slots).length >= MAX_ACTIVE_HANDOFFS) throw new PreparerPackageError('Revoke an existing link before creating another. You can have five active links.', 'HANDOFF_LIMIT', 409);
      tx.set(ownerRef, { userId: uid, slots: { ...slots, [id]: expiresAt } });
      tx.set(adminDb.doc(`preparer_handoffs/${id}`), { userId: uid, tokenHash: hashToken(token), taxYear: bundle.manifest.taxYear,
        createdAt: now, expiresAt, revokedAt: null, storagePath: path, sha256: createHash('sha256').update(bundle.bytes).digest('hex'),
        filename: bundle.filename, bytes: bundle.bytes.length, receiptFiles: bundle.manifest.receiptFiles,
        receiptIssues: bundle.manifest.receiptIssues, unresolvedQuestions: bundle.manifest.unresolvedQuestions });
    });
  } catch (error) { await file.delete({ ignoreNotFound: true }).catch(() => undefined); throw error; }
  return { id, token, expiresAt, receiptFiles: bundle.manifest.receiptFiles, receiptIssues: bundle.manifest.receiptIssues, unresolvedQuestions: bundle.manifest.unresolvedQuestions };
}

export async function revokePreparerHandoff(uid: string, id: string) {
  if (!validUid(uid) || !ID.test(id)) return false;
  const revoked = await adminDb.runTransaction(async tx => {
    const ref = adminDb.doc(`preparer_handoffs/${id}`), ownerRef = adminDb.doc(`preparer_handoff_owners/${uid}`);
    const [snap, owner] = await Promise.all([tx.get(ref), tx.get(ownerRef)]);
    if (!snap.exists || snap.data()?.userId !== uid) return false;
    const slots = { ...(owner.data()?.slots ?? {}) }; delete slots[id];
    tx.update(ref, { revokedAt: Date.now() }); tx.set(ownerRef, { userId: uid, slots });
    return true;
  });
  // Revocation takes effect before deleting the snapshot. Storage failures cannot reopen access.
  if (revoked) await receiptBucket().file(storagePath(uid, id)).delete({ ignoreNotFound: true }).catch(() => undefined);
  return revoked;
}

function matches(data: Record<string, any> | undefined, token: string, now: number) {
  if (!data || data.revokedAt != null || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= now || typeof data.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.tokenHash)) return false;
  return timingSafeEqual(Buffer.from(hashToken(token), 'hex'), Buffer.from(data.tokenHash, 'hex'));
}
/** Tokens arrive in a POST body, never a request URL; possession grants only this fixed ZIP. */
export async function downloadPreparerHandoff(id: string, token: string) {
  if (!ID.test(id) || !TOKEN.test(token)) return null;
  const ref = adminDb.doc(`preparer_handoffs/${id}`);
  const first = await ref.get(), data = first.data();
  if (!matches(data, token, Date.now())) return null;
  const path = storagePath(data!.userId, id);
  if (data!.storagePath !== path || !Number.isSafeInteger(data!.bytes) || data!.bytes <= 0 || data!.bytes > MAX_PACKAGE_BYTES) return null;
  const file = receiptBucket().file(path);
  const [metadata] = await file.getMetadata();
  if (Number(metadata.size) !== data!.bytes) throw new PreparerPackageError('Package integrity could not be verified. Request a new link.', 'HANDOFF_UNAVAILABLE', 503);
  const [bytes] = await file.download({ start: 0, end: MAX_PACKAGE_BYTES });
  if (bytes.length !== data!.bytes || createHash('sha256').update(bytes).digest('hex') !== data!.sha256) throw new PreparerPackageError('Package integrity could not be verified. Request a new link.', 'HANDOFF_UNAVAILABLE', 503);
  // A revoke, expiry or account deletion during the read must stop the response.
  const [current, profile, deletion] = await Promise.all([ref.get(), adminDb.doc(`user_profiles/${data!.userId}`).get(), adminDb.doc(`account_deletions/${data!.userId}`).get()]);
  if (!profile.exists || deletion.data()?.deletionRequested === true || !matches(current.data(), token, Date.now())) return null;
  const year = Number(data!.taxYear);
  return { bytes, filename: `writeoff-preparer-${Number.isInteger(year) ? year : 'records'}${data!.receiptIssues ? '-receipt-review-needed' : ''}.zip`, receiptIssues: Number(data!.receiptIssues) || 0 };
}

/** Account deletion calls this before deleting the owner's remaining records. Metadata errors must propagate. */
export async function deletePreparerHandoffsForUser(uid: string) {
  if (!validUid(uid)) throw new Error('Invalid handoff owner');
  const ownerRef = adminDb.doc(`preparer_handoff_owners/${uid}`);
  const ownerExists = (await ownerRef.get()).exists;
  let hadSnapshots = false;
  for (;;) {
    const rows = await adminDb.collection('preparer_handoffs').where('userId', '==', uid).limit(100).get();
    if (!rows.docs.length) break;
    if (!ownerExists && !hadSnapshots) {
      await ownerRef.set({ userId: uid, slots: {}, deletionCleanupPending: true }, { merge: true });
    }
    hadSnapshots = true;
    for (const doc of rows.docs) {
      if (ID.test(doc.id)) {
        await receiptBucket().file(storagePath(uid, doc.id)).delete({ ignoreNotFound: true });
      }
      // Removing metadata revokes token-based access and is idempotent if a
      // retention task already deleted the row after this query completed.
      await doc.ref.delete();
    }
  }
  // A user who never created a handoff has no owner marker or snapshot, so
  // there is no Storage cleanup to perform. This keeps empty-state deletion
  // idempotent while known handoff owners still fail closed on Storage errors.
  if (ownerExists || hadSnapshots) {
    await receiptBucket().deleteFiles({ prefix: `preparer_handoffs/${uid}/` });
  }
  // Keep this retry marker until every known and orphaned snapshot is gone.
  await ownerRef.delete();
}
