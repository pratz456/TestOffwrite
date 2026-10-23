import { randomUUID } from 'node:crypto';
import type { DocumentReference } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { analysisTaskId, staleAnalysisUpdate } from '@/lib/ai/analysis-jobs';
import { taxDecisionUpdate } from './tax-decision';
import { hasTransactionFactChange, TRANSACTION_FACT_FIELDS } from './fact-changes';

/** A fact edit and its durable revision are committed together, so closing the app cannot lose analysis. */
export async function saveTransactionChanges(ref: DocumentReference, userId: string, updates: Record<string, unknown>) {
  const parts = ref.path.split('/');
  if (parts.length !== 6 || parts[0] !== 'user_profiles' || parts[1] !== userId || parts[2] !== 'accounts' || parts[4] !== 'transactions') {
    throw new Error('Transaction not found');
  }
  return adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const record = snapshot.data();
    if (!snapshot.exists || !record || [record.userId, record.user_id].some(owner => owner != null && owner !== userId) ||
        [record.account_id, record.accountId].some(account => account != null && account !== parts[3])) throw new Error('Transaction not found');
    // Keep the canonical saved value for whitespace/order-only edits; otherwise its input hash
    // would become stale even though no new tax fact was supplied.
    const changes = { ...updates };
    for (const field of TRANSACTION_FACT_FIELDS) {
      if (field in changes && !hasTransactionFactChange(record, { [field]: changes[field] })) delete changes[field];
    }
    const factsChanged = hasTransactionFactChange(record, changes);
    const refresh = factsChanged ? {
      ...staleAnalysisUpdate(record), deduction_score: null,
      analysisInputRevision: randomUUID(), analysisRefreshReason: 'transaction_changed',
      analysisJobId: analysisTaskId({ userId, accountId: parts[3], transactionId: parts[5] }),
    } : {};
    const update = { ...changes, ...taxDecisionUpdate(record, changes), ...refresh, updated_at: new Date() };
    tx.update(ref, update);
    return { ...record, ...update, id: snapshot.id, trans_id: record.trans_id || snapshot.id };
  });
}
