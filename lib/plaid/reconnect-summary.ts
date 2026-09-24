import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase/admin';
export interface BankHistoryReviewSummary {
  ready: boolean;
  pendingRecords: number;
  deferredRecords: number;
  sessions: Array<{ reference: string; phase: string; historyReady: boolean; mappingComplete: boolean; pendingRecords: number; deferredRecords: number }>;
  note: string;
}
/** Metadata only: private staged amounts never join tax records or aggregates. */
export async function readBankHistoryReviewSummary(uid: string, year?: number): Promise<BankHistoryReviewSummary> {
  const saved = await adminDb.collection(`user_profiles/${uid}/bank_reconnects`).get();
  const sessions = await Promise.all(saved.docs.filter(doc => doc.data().phase !== 'cancelled').map(async doc => {
    if (doc.data().uid !== uid) throw new Error('Bank review ownership mismatch');
    const imported = await adminDb.collection(`user_profiles/${uid}/bank_reconnects/${doc.id}/import_records`).get();
    const records = imported.docs.map(d => d.data()).filter(row => year === undefined || String(row.payload?.date).slice(0, 4) === String(year));
    if (records.some(row => row.uid !== uid)) throw new Error('Bank review ownership mismatch');
    return { reference: `bank-review-${createHash('sha256').update(`${uid}/${doc.id}`).digest('hex').slice(0, 24)}`, phase: doc.data().phase,
      historyReady: doc.data().historyReady === true, mappingComplete: doc.data().mappingComplete === true,
      pendingRecords: records.filter(row => row.status === 'pending').length, deferredRecords: records.filter(row => row.status === 'deferred').length };
  }));
  return { ready: sessions.every(s => s.phase === 'active' && s.historyReady && s.mappingComplete && !s.pendingRecords && !s.deferredRecords),
    pendingRecords: sessions.reduce((n, s) => n + s.pendingRecords, 0), deferredRecords: sessions.reduce((n, s) => n + s.deferredRecords, 0), sessions,
    note: 'Unreviewed bank history remains private and is excluded from transaction totals. Pending corrections leave the previously reviewed record unchanged until accepted. Bank review readiness does not establish tax-return completeness.' };
}
