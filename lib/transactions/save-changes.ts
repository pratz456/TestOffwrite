import { randomUUID } from 'node:crypto';
import type { DocumentReference } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { analysisSuggestionUpdate } from '@/lib/ai/analysis-persistence';
import { analysisTaskId, staleAnalysisUpdate } from '@/lib/ai/analysis-jobs';
import { analysisProfileHash } from '@/lib/ai/profile-context';
import { TRANSACTION_TAX_POLICY_VERSION } from '@/lib/ai/transaction-tax-policy';
import { hiredVehicleFare } from '@/lib/ai/vehicle-separate-costs';
import { mileageVehicleCopyEnabled } from '@/lib/mileage/vehicle-copy';
import { vehicleFromDocument } from '@/lib/mileage/vehicles';
import { withHomeOfficeSources } from '@/lib/profile/home-office';
import { taxDecisionUpdate } from './tax-decision';
import { hasTransactionFactChange, TRANSACTION_FACT_FIELDS } from './fact-changes';

function definedFields(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function merchantText(record: Record<string, unknown>): string {
  return ['merchant_name', 'name', 'description'].map(key => typeof record[key] === 'string' ? record[key] as string : '').filter(Boolean).join(' ');
}

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
    // The answer code is switch-on only. A switched-off save leaves the record as it was.
    if (!mileageVehicleCopyEnabled()) delete changes.hired_fare_use;
    for (const field of TRANSACTION_FACT_FIELDS) {
      if (field in changes && !hasTransactionFactChange(record, { [field]: changes[field] })) delete changes[field];
    }
    if (!Object.keys(changes).length) return { ...record, id: snapshot.id, trans_id: record.trans_id || snapshot.id };
    const factsChanged = hasTransactionFactChange(record, changes);
    const fareAnswerOnly = mileageVehicleCopyEnabled() && factsChanged && hiredVehicleFare(merchantText(record)) &&
      Object.keys(changes).every(key => key === 'hired_fare_use');
    let fareUpdate: Record<string, unknown> = {};
    if (fareAnswerOnly) {
      const profileRef = adminDb.doc(`${parts[0]}/${parts[1]}`);
      const vehicleRead = tx.get(profileRef.collection('vehicles')).then(vehicleSnap => {
        const docs = (vehicleSnap as { docs?: Array<{ id: string; data: () => Record<string, unknown> }> }).docs;
        return Array.isArray(docs) ? docs.map(doc => vehicleFromDocument(doc.id, doc.data())) : undefined;
      }).catch(() => undefined);
      const [profileSnap, settingsSnap, vehicles] = await Promise.all([
        tx.get(profileRef), tx.get(adminDb.doc(`${profileRef.path}/settings/homeOffice`)), vehicleRead,
      ]);
      const merged = { ...record, ...changes };
      const profileData = profileSnap.exists ? profileSnap.data() as Record<string, unknown> : null;
      const existing = record.ai_suggestion && typeof record.ai_suggestion === 'object' ? record.ai_suggestion as { profileHash?: unknown } : null;
      const savedHash = typeof existing?.profileHash === 'string' ? existing.profileHash : '';
      const date = typeof record.date === 'string' ? record.date : '';
      const profileHash = savedHash || (profileData ? analysisProfileHash(profileData, date) : '');
      const vehicleId = typeof merged.vehicleId === 'string' ? merged.vehicleId : typeof merged.vehicle_id === 'string' ? merged.vehicle_id : null;
      fareUpdate = definedFields(analysisSuggestionUpdate({
        status: 'ok', is_deductible: true, expense_type: 'business', category: 'vehicle_expense', deductible_percent: 100,
        confidence: 1, customized_reason: 'Choose what this ride was for before it can count.',
        key_analysis_factor: 'Choose what this ride was for before it can count.', transaction_kind: 'expense',
        policy_version: TRANSACTION_TAX_POLICY_VERSION,
      }, Date.now(), merged, profileHash, withHomeOfficeSources(profileData, settingsSnap.exists ? settingsSnap.data() : null), {
        vehicles, vehicleId, savedProfile: profileData,
      }));
    }
    const refresh = factsChanged && !fareAnswerOnly ? {
      ...staleAnalysisUpdate(record), deduction_score: null,
      analysisInputRevision: randomUUID(), analysisRefreshReason: 'transaction_changed',
      analysisJobId: analysisTaskId({ userId, accountId: parts[3], transactionId: parts[5] }),
    } : {};
    const update = { ...changes, ...taxDecisionUpdate(record, changes), ...refresh, ...fareUpdate, updated_at: new Date() };
    tx.update(ref, update);
    return { ...record, ...update, id: snapshot.id, trans_id: record.trans_id || snapshot.id };
  });
}
