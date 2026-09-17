import { adminDb } from '@/lib/firebase/admin';
import { validateReceiptPreviewPath } from '@/lib/receipts/preview-path';
import { readOwnedTransactions, ownedExportRecord, exportReference, ExportDataUnavailableError } from './export-records';
import { convertTransactionsToCSV, exportDate, selectExportYear, ExportReviewRequiredError, type ExportRecord } from './transaction-export';
export { convertTransactionsToCSV } from './transaction-export';

const TOP_LEVEL = ['gross_receipts', 'income_1099', 'w2_income', 'tax_deductions', 'tax_organizers'] as const;
const PROFILE_CHILDREN = ['assets', 'settings', 'mileage_trips', 'quarterly_payments'] as const;
const excludedKey = (key: string) => {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return /token|secret|password|privatekey|plaid|stripe|signature|ssn|socialsecuritynumber|pin$|bankaccount|bankrouting|routingnumber|accountnumber/.test(normalized)
    || ['efin', 'clientid', 'itemid', 'recordpath', 'storagepath', 'image', 'imagebase64', 'base64', 'dataurl', 'receiptdata', 'receiptbase64'].includes(normalized);
};
/** Never include connector credentials, tax identity ciphertexts or legacy signing PINs. */
export function sanitizeExportValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if ('toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(sanitizeExportValue);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excludedKey(key)).map(([key, entry]) => [key, sanitizeExportValue(entry)]));
}
function clean(record: ExportRecord): ExportRecord { return sanitizeExportValue(record) as ExportRecord; }
function privateReceiptLink(value: unknown) { return typeof value === 'string' ? validateReceiptPreviewPath(value) ?? null : null; }
function yearRecords(records: ExportRecord[], year?: number): ExportRecord[] {
  if (year === undefined) return records;
  return records.filter(record => {
    const savedYear = record.taxYear ?? record.year ?? String(record.id).match(/^Q[1-4]_(\d{4})$/)?.[1];
    if (!/^\d{4}$/.test(String(savedYear))) throw new ExportReviewRequiredError('Some saved tax records have no valid tax year. Export all years for review or correct the record year.');
    return Number(savedYear) === year;
  });
}
export interface UserDataExport {
  exportInfo: { exportDate: string; userId: string; exportId: string; dataVersion: string; taxYear: number | null; purpose: string };
  userProfile: ExportRecord | null;
  accounts: ExportRecord[];
  transactions: ExportRecord[];
  receipts: ExportRecord[];
  aiAnalysis: ExportRecord[];
  taxRecords: Record<string, ExportRecord[]>;
}

/** Owner data archive / preparer handoff. It is not a filed return or a completeness certification. */
export async function generateUserDataExport(userId: string, year?: number): Promise<UserDataExport> {
  try {
    const profileRef = adminDb.collection('user_profiles').doc(userId);
    const [profile, accountsSnapshot, rawTransactions, receiptSnapshot, ...datasets] = await Promise.all([
      profileRef.get(), profileRef.collection('accounts').get(), readOwnedTransactions(userId),
      Promise.all(['userId', 'user_id'].map(field => adminDb.collection('receipts').where(field, '==', userId).get()))
        .then(snapshots => ({ docs: [...new Map(snapshots.flatMap(snapshot => snapshot.docs.map(doc => [doc.ref.path, doc] as const))).values()] })),
      ...TOP_LEVEL.map(async name => {
        const snapshots = await Promise.all(['userId', 'user_id'].map(field => adminDb.collection(name).where(field, '==', userId).get()));
        const records = new Map<string, ExportRecord>();
        snapshots.forEach(snapshot => snapshot.docs.forEach(doc => records.set(doc.ref.path, ownedExportRecord(doc, userId))));
        return [name, yearRecords([...records.values()], year).map(clean)] as const;
      }),
      ...PROFILE_CHILDREN.map(async name => {
        const snapshot = await profileRef.collection(name).get();
        let records = snapshot.docs.map(doc => ownedExportRecord(doc, userId, true));
        if (name === 'mileage_trips') records = selectExportYear(records, year);
        if (name === 'quarterly_payments') records = yearRecords(records, year);
        return [name, records.map(clean)] as const;
      }),
    ]);
    const selected = selectExportYear(rawTransactions, year);
    const transactions = selected.map(record => {
      const result = clean(record);
      result.id = record.exportReference; result.trans_id = record.exportReference;
      result.account_id = record.accountReference; delete result.accountId; delete result.transaction_id; delete result.transactionId;
      delete result.transaction_code; delete result.merchant_entity_id; delete result.pending_transaction_id;
      delete result.ai_analysis; delete result.ai;
      result.receipt_url = privateReceiptLink(record.receipt_url);
      return result;
    });
    const receipts: ExportRecord[] = receiptSnapshot.docs.map(doc => ownedExportRecord(doc, userId)).flatMap(record => {
      const transaction = selected.find(tx => (tx.trans_id ?? tx.id) === record.transactionId);
      if (year !== undefined && !transaction) return [];
      return [{ ...Object.fromEntries(['id', 'filename', 'originalName', 'mimeType', 'size', 'uploadedAt'].filter(key => record[key] !== undefined).map(key => [key, sanitizeExportValue(record[key])])), transactionId: transaction?.exportReference ?? null,
        receiptUrl: privateReceiptLink(`/api/receipts/${record.id}`), linkRequiresSignIn: true }];
    });
    // Preserve legacy transaction-linked metadata, but never embed receipt bytes or external bearer URLs.
    for (const record of transactions) {
      if ((record.receipt_url || record.receipt_filename) && !receipts.some(receipt => receipt.transactionId === record.exportReference)) {
        receipts.push({ transactionId: record.exportReference, receiptFilename: record.receipt_filename, receiptUrl: privateReceiptLink(record.receipt_url), linkRequiresSignIn: true });
      }
    }
    const accounts = accountsSnapshot.docs.map(doc => {
      const record = ownedExportRecord(doc, userId, true);
      return { id: exportReference('account', `${userId}/${doc.id}`), ...Object.fromEntries(['name', 'official_name', 'type', 'subtype', 'mask', 'usageType', 'iso_currency_code', 'createdAt'].filter(key => record[key] !== undefined).map(key => [key, sanitizeExportValue(record[key])])) };
    });
    const aiAnalysis = selected.filter(tx => tx.ai_analysis || tx.ai || tx.analyzed).map(tx => {
      let analysis: unknown = tx.ai_analysis ?? tx.ai ?? null;
      let parseStatus = 'as_recorded';
      if (typeof analysis === 'string') { try { analysis = JSON.parse(analysis); } catch { analysis = null; parseStatus = 'invalid_saved_json'; } }
      return { transactionReference: tx.exportReference, advisoryOnly: true, parseStatus, analysis: sanitizeExportValue(analysis), deductionScore: tx.deduction_score, recordedDeductibility: tx.is_deductible };
    });
    return {
      exportInfo: { exportDate: new Date().toISOString(), userId, exportId: `export_${crypto.randomUUID()}`, dataVersion: '2.0', taxYear: year ?? null, purpose: 'Owner data archive and tax-preparer handoff; not an official tax return' },
      userProfile: profile.exists ? clean(ownedExportRecord(profile as Parameters<typeof ownedExportRecord>[0], userId, true)) : null,
      accounts, transactions, receipts, aiAnalysis, taxRecords: Object.fromEntries(datasets),
    };
  } catch (error) {
    if (error instanceof ExportReviewRequiredError) throw error;
    throw new ExportDataUnavailableError();
  }
}
export function generateDataPackage(data: UserDataExport) {
  const counts = { accounts: data.accounts.length, transactions: data.transactions.length, receipts: data.receipts.length, aiAnalysis: data.aiAnalysis.length,
    ...Object.fromEntries(Object.entries(data.taxRecords).map(([name, records]) => [name, records.length])) };
  const dates = data.transactions.map(tx => exportDate(tx.date ?? tx.datetime)).filter((date): date is string => date !== null).sort();
  const limitations = [
    'This is an owner data archive and tax-preparer handoff, not an official tax return, TXF import or filing confirmation.',
    'Signed amounts preserve the stored convention: positive is an outflow and negative an inflow. An inflow may be a refund or transfer, not taxable income.',
    'Recorded categories and deductibility are declarations; AI analysis is advisory. Pending, unreviewed, duplicate and mixed-use records require reconciliation. No filing deduction or refund is certified.',
    'Receipt metadata and private sign-in links are included; receipt image/PDF binaries are NOT attached. A preparer cannot open these links without authorized account access.',
    'A selected-year archive includes only receipt metadata linked to transactions in that year. Use an all-years archive to include unlinked receipt metadata.',
    'Tax datasets can overlap (for example bank deposits, gross receipts and 1099s). Do not sum them without reconciling duplicate income.',
    'Assets, settings and profile are current all-year snapshots; transaction, mileage, payment and tax-year records honor the selected year when supplied.',
    'Authentication credentials, Plaid/Stripe connection details, SSN ciphertexts, bank account/routing numbers and legacy authorization PINs are excluded. Provide needed filing identity details separately through a secure preparer workflow.',
    'Only records saved in WriteOff are included. Missing W2/1099 forms, basis, carryovers, credits and other tax facts must be supplied separately.',
    'Audit support records (each confirmed deduction with its records on file, missing substantiation elements, mileage log and Pub 583 retention note) are a separate owner export from Reports > Audit support records; JSON and CSV are included on every plan.',
  ];
  return { json: data, csv: convertTransactionsToCSV(data.transactions), summary: { exportInfo: data.exportInfo, counts,
    dateRange: { earliest: dates[0] ?? null, latest: dates.at(-1) ?? null }, receiptBinariesIncluded: false, limitations },
    readme: `WriteOff - preparer data handoff\n\nGenerated: ${data.exportInfo.exportDate}\nScope: ${data.exportInfo.taxYear ?? 'All saved years'}\n\nPackage: JSON contains all datasets plus the transaction CSV and this README as text. Some download screens save those text fields as separate files; the filing hub downloads one JSON package. No source records are modified by this export.\n\nRecord counts:\n${Object.entries(counts).map(([name, count]) => `- ${name}: ${count}`).join('\n')}\n\nLimits and interpretation:\n${limitations.map(text => `- ${text}`).join('\n')}\n`,
  };
}
export function validateExportData(data: UserDataExport) {
  return { isValid: Boolean(data.exportInfo.userId && data.exportInfo.exportDate), errors: data.exportInfo.userId ? [] : ['Missing user ID'],
    warnings: [!data.userProfile && 'No saved profile', !data.transactions.length && 'No saved transactions', !data.accounts.length && 'No saved accounts'].filter((value): value is string => Boolean(value)) };
}
