import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase/admin';
import { isSupersededRecord } from '@/lib/transactions/record-scope';
import type { ExportRecord } from './transaction-export';

export class ExportDataUnavailableError extends Error {
  readonly code = 'EXPORT_DATA_UNAVAILABLE';
  constructor() { super('Could not load a complete, owner-verified export. Please retry.'); }
}
type Doc = { id: string; ref: { path: string }; data(): FirebaseFirestore.DocumentData | undefined };
export function ownedExportRecord(doc: Doc, uid: string, inheritedOwner = false): ExportRecord {
  const data = doc.data() ?? {};
  const owners = [data.userId, data.user_id].filter(value => value !== undefined && value !== null);
  if (owners.some(value => value !== uid) || (!inheritedOwner && !owners.includes(uid))) throw new ExportDataUnavailableError();
  if (/^(user_profiles|users)\//.test(doc.ref.path) && doc.ref.path.split('/')[1] !== uid) throw new ExportDataUnavailableError();
  return { ...data, id: doc.id, recordPath: doc.ref.path };
}
export function exportReference(kind: string, value: string): string {
  return `${kind}-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}
/** Owner-verified top-level tax records for one year (gross_receipts, income_1099, income_reconciliations, ...). */
export async function readOwnedYearRecords(uid: string, collection: string, taxYear: number): Promise<ExportRecord[]> {
  try {
    const snapshot = await adminDb.collection(collection).where('userId', '==', uid).where('taxYear', '==', taxYear).get();
    return snapshot.docs.map(doc => ownedExportRecord(doc, uid));
  } catch { throw new ExportDataUnavailableError(); }
}
export interface ReadOwnedTransactionsOptions {
  /**
   * Also return records superseded by historical-overlap reconciliation. Only the
   * complete owner archive and exclusion counters want them; totals never do.
   */
  includeSuperseded?: boolean;
}
export async function readOwnedTransactions(uid: string, options: ReadOwnedTransactionsOptions = {}): Promise<ExportRecord[]> {
  try {
    const accounts = await adminDb.collection('user_profiles').doc(uid).collection('accounts').get();
    const queried = await Promise.all(['userId', 'user_id'].map(field => adminDb.collectionGroup('transactions').where(field, '==', uid).get()));
    const records = new Map<string, ExportRecord>();
    const nestedSeen = new Map<string, number>();
    queried.forEach(snapshot => snapshot.docs.forEach(doc => {
      records.set(doc.ref.path, ownedExportRecord(doc, uid));
      const parts = doc.ref.path.split('/');
      if (parts[0] === 'user_profiles' && parts[2] === 'accounts' && parts[4] === 'transactions') nestedSeen.set(parts[3], (nestedSeen.get(parts[3]) ?? 0) + 1);
    }));
    // Rows written before the owner field existed are invisible to the collection-group queries.
    // A count() aggregation per account (one read per 1,000 rows) decides whether that account
    // needs a full walk, so a normal user costs A + N document reads instead of A + 3N.
    await Promise.all(accounts.docs.map(async account => {
      ownedExportRecord(account, uid, true);
      const collection = adminDb.collection('user_profiles').doc(uid).collection('accounts').doc(account.id).collection('transactions');
      const total = (await collection.count().get()).data().count;
      if (total === (nestedSeen.get(account.id) ?? 0)) return;
      const snapshot = await collection.get();
      snapshot.docs.forEach(doc => records.set(doc.ref.path, ownedExportRecord(doc, uid, true)));
    }));
    const selected = [...records.values()].filter(record => options.includeSuperseded || !isSupersededRecord(record));
    return selected.sort((a, b) => String(a.recordPath).localeCompare(String(b.recordPath))).map(record => ({
      ...record, exportReference: exportReference('transaction', `${uid}/${record.recordPath}`),
      accountReference: exportReference('account', `${uid}/${record.account_id ?? record.accountId ?? String(record.recordPath).split('/')[3] ?? 'unknown'}`),
    }));
  } catch { throw new ExportDataUnavailableError(); }
}
