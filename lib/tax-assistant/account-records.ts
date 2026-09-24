import { adminDb } from '@/lib/firebase/admin';
import { ownedExportRecord } from '@/lib/reports/export-records';
import { exportDate } from '@/lib/reports/transaction-export';
import { ACCOUNT_FIELDS, ACCOUNT_SCAN_LIMIT } from './account-tools';

/**
 * Bounded raw reads preserve owner/currency/date evidence. Do not use the list hydrator here:
 * it normalizes fields and tolerates partial reads, neither of which can prove a checklist empty.
 * Missing indexes and failed owner queries propagate; they never become an empty successful result.
 */
export async function readAssistantTransactions(uid: string): Promise<Record<string, any>[]> {
  const fields = [...new Set([...ACCOUNT_FIELDS, 'trans_id', 'account_id', 'accountId', 'userId', 'user_id'])];
  const snapshots = await Promise.all(['userId', 'user_id'].map(owner => adminDb.collectionGroup('transactions')
    .where(owner, '==', uid).orderBy('date', 'desc').select(...fields).limit(ACCOUNT_SCAN_LIMIT).get()));
  const records = new Map<string, Record<string, any>>();
  for (const snapshot of snapshots) for (const doc of snapshot.docs) {
    // Validates every owner spelling and any inherited user_profiles/users path.
    const record = ownedExportRecord(doc, uid);
    const day = exportDate(record.date);
    if (!day) throw new Error('Invalid dated record in assistant checklist');
    records.set(doc.ref.path, { ...record, date: day });
  }
  return [...records.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)) ||
    String(a.recordPath).localeCompare(String(b.recordPath))).slice(0, ACCOUNT_SCAN_LIMIT);
}
