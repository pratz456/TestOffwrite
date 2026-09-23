import { createHash, randomUUID } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { analysisProfileFieldsKey } from '@/functions-analysis/src/profile-fields';
import { enqueueBankTransactionAnalysis, validAnalysisId } from './analysis-jobs';

export const PROFILE_REFRESH_PAGE_SIZE = 25;
const LEASE_MS = 120_000;
const fingerprint = (profile: Record<string, unknown>) => createHash('sha256').update(analysisProfileFieldsKey(profile)).digest('hex');
const jobRef = (uid: string) => adminDb.doc(`profile_analysis_refresh/${uid}`);
function newJob(userId: string, profile: Record<string, unknown>) {
  return { userId, fingerprint: fingerprint(profile), generation: randomUUID(), status: 'queued',
    activeAccountId: null, afterAccountId: null, transactionCursor: null, scanned: 0,
    requestedAt: Date.now(), updatedAt: Date.now(), leaseToken: null, leaseExpiresAt: null };
}

/** A retried/out-of-order event reads the latest profile; duplicate events never restart the same scan. */
export async function enqueueProfileAnalysisRefresh(userId: string) {
  if (!validAnalysisId(userId)) return { status: 'invalid' };
  return adminDb.runTransaction(async tx => {
    const [profile, job] = await Promise.all([tx.get(adminDb.doc(`user_profiles/${userId}`)), tx.get(jobRef(userId))]);
    if (!profile.exists) return { status: 'skipped' };
    if (job.data()?.fingerprint === fingerprint(profile.data()!)) return { status: 'unchanged' };
    const next = newJob(userId, profile.data()!);
    tx.set(jobRef(userId), next);
    return { status: 'queued', generation: next.generation };
  });
}

/** One bounded page per delivery. Persisted continuation generations make large histories resumable. */
export async function processProfileAnalysisRefresh(userId: string, generation: string): Promise<{ status: string; retry: boolean }> {
  if (!validAnalysisId(userId) || !validAnalysisId(generation)) return { status: 'invalid', retry: false };
  const ref = jobRef(userId);
  const claim = await adminDb.runTransaction(async tx => {
    const [job, profile] = await Promise.all([tx.get(ref), tx.get(adminDb.doc(`user_profiles/${userId}`))]);
    const work = job.data();
    if (!work || work.generation !== generation || work.status === 'completed') return { status: 'obsolete' as const };
    if (!profile.exists) {
      tx.update(ref, { status: 'completed', leaseToken: null, leaseExpiresAt: null, updatedAt: Date.now() });
      return { status: 'obsolete' as const };
    }
    if (work.fingerprint !== fingerprint(profile.data()!)) {
      tx.set(ref, newJob(userId, profile.data()!));
      return { status: 'obsolete' as const };
    }
    if (work.leaseToken && work.leaseExpiresAt > Date.now()) return { status: 'busy' as const };
    const leaseToken = randomUUID();
    tx.update(ref, { status: 'running', leaseToken, leaseExpiresAt: Date.now() + LEASE_MS, updatedAt: Date.now() });
    return { status: 'claimed' as const, work, leaseToken };
  });
  if (claim.status !== 'claimed') return { status: claim.status, retry: claim.status === 'busy' };

  try {
    const accounts = adminDb.collection(`user_profiles/${userId}/accounts`);
    let accountId = claim.work.activeAccountId as string | null;
    if (!accountId) {
      let query = accounts.orderBy(FieldPath.documentId()).limit(1);
      if (claim.work.afterAccountId) query = query.startAfter(claim.work.afterAccountId);
      accountId = (await query.get()).docs[0]?.id ?? null;
    }
    let scanned = 0;
    let lastTransaction: string | null = null;
    if (accountId) {
      let query = accounts.doc(accountId).collection('transactions').orderBy(FieldPath.documentId()).limit(PROFILE_REFRESH_PAGE_SIZE);
      if (claim.work.transactionCursor) query = query.startAfter(claim.work.transactionCursor);
      const page = await query.get();
      for (const row of page.docs) {
        await enqueueBankTransactionAnalysis({ userId, accountId, transactionId: row.id }, true, { refreshProfile: true });
        scanned++;
        lastTransaction = row.id;
      }
    }
    const hasMoreInAccount = scanned === PROFILE_REFRESH_PAGE_SIZE;
    return await adminDb.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.generation !== generation || current.leaseToken !== claim.leaseToken) return { status: 'obsolete', retry: false };
      tx.update(ref, { status: accountId ? 'queued' : 'completed', generation: accountId ? randomUUID() : generation,
        activeAccountId: hasMoreInAccount ? accountId : null,
        afterAccountId: hasMoreInAccount ? claim.work.afterAccountId : accountId ?? claim.work.afterAccountId,
        transactionCursor: hasMoreInAccount ? lastTransaction : null,
        scanned: current.scanned + scanned,
        leaseToken: null, leaseExpiresAt: null, updatedAt: Date.now(), ...(accountId ? {} : { completedAt: Date.now() }) });
      return { status: accountId ? 'queued' : 'completed', retry: false };
    });
  } catch (error) {
    // Keep the same generation for Eventarc retry; already queued rows are idempotent on replay.
    await adminDb.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.generation === generation && current.leaseToken === claim.leaseToken) {
        tx.update(ref, { status: 'queued', leaseToken: null, leaseExpiresAt: null, updatedAt: Date.now() });
      }
    });
    throw error;
  }
}
