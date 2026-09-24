import { createHash } from 'node:crypto';
import archiver from 'archiver';
import { adminDb } from '@/lib/firebase/admin';
import { MAX_RECEIPT_BYTES, receiptBucket, receiptMimeType, receiptSignatureMatches } from '@/lib/firebase/receipt-security';
import { generateUserDataExport, sanitizeExportValue } from './data-export';
import { readOwnedTransactions } from './export-records';
import { readAuditSupportPacket, auditSupportPacketCSV } from './audit-support-packet';
import { convertTransactionsToCSV, type ExportRecord } from './transaction-export';

export const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
export const MAX_PACKAGE_RECEIPT_BYTES = 16 * 1024 * 1024;
export const MAX_PACKAGE_RECEIPTS = 250;
const MAX_PACKAGE_RECORDS = 5000;
const SAFE_SEGMENT = /^[^/\\\u0000-\u001f\u007f]{1,256}$/;
export class PreparerPackageError extends Error {
  constructor(message: string, public readonly code = 'PREPARER_PACKAGE_UNAVAILABLE', public readonly status = 503) { super(message); }
}
export interface PackageReceipt {
  transactionReference: string | null; receiptReference: string | null; file: string | null;
  status: 'included' | 'unavailable' | 'missing'; reason: string | null; bytes: number; sha256: string | null;
}
export interface PreparerPackageManifest {
  version: 1; taxYear: number; generatedAt: string; purpose: string; records: number;
  receiptFiles: number; receiptBytes: number; receiptIssues: number; completeReceiptCoverage: boolean;
  unresolvedQuestions: number; receipts: PackageReceipt[]; limitations: string[];
  files: Array<{ file: string; bytes: number; sha256: string }>;
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const text = (value: unknown) => typeof value === 'string' ? value : '';
const validSegment = (value: unknown): value is string => typeof value === 'string' && SAFE_SEGMENT.test(value) && !['.', '..'].includes(value);

/** Storage keys come only from owned receipt metadata and must match its selected transaction. */
export async function ownedReceiptBytes(uid: string, receiptId: string, transactionId: string) {
  if (![uid, receiptId, transactionId].every(validSegment)) throw new PreparerPackageError('Receipt metadata needs review.', 'RECEIPT_UNAVAILABLE', 422);
  const snap = await adminDb.collection('receipts').doc(receiptId).get();
  const receipt = snap.data();
  if (!snap.exists || !receipt || receipt.userId !== uid || receipt.user_id != null && receipt.user_id !== uid || receipt.transactionId !== transactionId) {
    throw new PreparerPackageError('Receipt ownership or transaction could not be verified.', 'RECEIPT_UNAVAILABLE', 422);
  }
  const mime = receiptMimeType(receipt.mimeType);
  const parts = typeof receipt.storagePath === 'string' ? receipt.storagePath.split('/') : [];
  if (!mime || parts.length !== 4 || parts[0] !== 'receipts' || parts[1] !== uid || parts[2] !== transactionId || !parts.every(validSegment)) {
    throw new PreparerPackageError('Original receipt file is unavailable. Upload the original again.', 'RECEIPT_UNAVAILABLE', 422);
  }
  const file = receiptBucket().file(parts.join('/'));
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_RECEIPT_BYTES) throw new PreparerPackageError('Receipt exceeds the file limit.', 'RECEIPT_UNAVAILABLE', 422);
  // The bounded range remains safe if the object changes after its metadata is read.
  const [bytes] = await file.download({ start: 0, end: MAX_RECEIPT_BYTES });
  if (!receiptSignatureMatches(bytes, mime)) throw new PreparerPackageError('Receipt content could not be verified.', 'RECEIPT_UNAVAILABLE', 422);
  return { bytes, extension: ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf' } as Record<string, string>)[mime] };
}

export function preparerQuestions(transactions: ExportRecord[]) {
  return transactions.flatMap(record => {
    const questions = new Set<string>();
    if (record.review_status !== 'confirmed') questions.add('Confirm the category, business purpose and tax treatment.');
    if (record.tax_review_required === true) questions.add('Resolve the saved tax-treatment review before claiming a deduction.');
    if (record.pending === true) questions.add('Reconcile this pending bank entry against the posted record.');
    if (record.iso_currency_code !== 'USD' || record.unofficial_currency_code) questions.add('Verify currency and any required U.S. dollar conversion.');
    const suggestion = record.ai_suggestion && typeof record.ai_suggestion === 'object' ? record.ai_suggestion as Record<string, unknown> : null;
    const savedQuestions = Array.isArray(suggestion?.questions) ? suggestion.questions : record.ai_questions;
    if (Array.isArray(savedQuestions)) for (const question of savedQuestions) if (typeof question === 'string' && question.trim()) questions.add(question.trim().slice(0, 2000));
    return questions.size ? [{ transactionReference: record.exportReference ?? record.id, questions: [...questions] }] : [];
  });
}

async function zip(entries: Array<{ name: string; bytes: Buffer }>) {
  return new Promise<Buffer>((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks: Buffer[] = []; let size = 0;
    archive.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_PACKAGE_BYTES) { archive.abort(); reject(new PreparerPackageError('This package exceeds 20 MB. Download smaller sets of records or receipts separately.', 'PREPARER_PACKAGE_TOO_LARGE', 413)); } else chunks.push(chunk); });
    archive.on('error', reject); archive.on('warning', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    for (const entry of entries) archive.append(entry.bytes, { name: entry.name });
    void archive.finalize().catch(reject);
  });
}

/** A fixed selected-year records snapshot. It never follows receipt URLs or changes source records. */
export async function buildPreparerPackage(uid: string, taxYear: number) {
  const [data, audit, originals] = await Promise.all([generateUserDataExport(uid, taxYear), readAuditSupportPacket(uid, taxYear), readOwnedTransactions(uid, { includeSuperseded: true })]);
  if (data.transactions.length > MAX_PACKAGE_RECORDS || data.receipts.length > MAX_PACKAGE_RECEIPTS) throw new PreparerPackageError('This package exceeds 5,000 records or 250 receipts. Export the records archive and download receipts separately.', 'PREPARER_PACKAGE_TOO_LARGE', 413);
  const originalByReference = new Map(originals.map(record => [record.exportReference, record]));
  const entries: Array<{ name: string; bytes: Buffer }> = [];
  const receipts: PackageReceipt[] = [];
  let receiptBytes = 0;
  for (const receipt of data.receipts) {
    const transactionReference = text(receipt.transactionId) || null;
    const receiptReference = text(receipt.id) ? `receipt-${createHash('sha256').update(text(receipt.id)).digest('hex').slice(0, 24)}` : null;
    const original = originalByReference.get(transactionReference);
    let outcome: PackageReceipt = { transactionReference, receiptReference, file: null, status: 'unavailable', reason: 'No verified original receipt file is available. Supply it separately.', bytes: 0, sha256: null };
    if (original && receipt.id) {
      try {
        const loaded = await ownedReceiptBytes(uid, text(receipt.id), text(original.trans_id ?? original.id));
        receiptBytes += loaded.bytes.length;
        if (receiptBytes > MAX_PACKAGE_RECEIPT_BYTES) throw new PreparerPackageError('Original receipts exceed the 16 MB package limit. Download receipts separately.', 'PREPARER_PACKAGE_TOO_LARGE', 413);
        const filename = `receipts/${String(entries.length + 1).padStart(3, '0')}-${receiptReference}.${loaded.extension}`;
        entries.push({ name: filename, bytes: loaded.bytes });
        outcome = { transactionReference, receiptReference, file: filename, status: 'included', reason: null, bytes: loaded.bytes.length, sha256: digest(loaded.bytes) };
      } catch (error) {
        if (error instanceof PreparerPackageError && error.status === 413) throw error;
        // A missing individual original is explicit in both manifest and user-facing download metadata.
        outcome.reason = error instanceof PreparerPackageError ? error.message : 'Receipt storage could not supply this original. Retry or provide it separately.';
      }
    }
    receipts.push(outcome);
  }
  for (const record of data.transactions) {
    const reference = text(record.exportReference ?? record.id);
    if (Number(record.amount) > 0 && record.pending !== true && record.is_deductible !== false && !record.superseded_by && !receipts.some(receipt => receipt.transactionReference === reference)) {
      receipts.push({ transactionReference: reference, receiptReference: null, file: null, status: 'missing', reason: 'No original receipt is saved for this expense. Supply proof of payment and business purpose separately.', bytes: 0, sha256: null });
    }
  }
  const questions = preparerQuestions(data.transactions);
  const limitations = [
    'Records for preparer review, not a filed tax return, e-file submission or certification of deductibility.',
    'Only saved records are included. W-2/1099 source documents, basis, carryovers, credits and other missing facts must be supplied separately.',
    'AI recommendations are advisory. Confirmed decisions remain the user\'s saved decisions. Resolve unresolved questions before filing.',
    'Profile, assets and settings describe the current saved state; dated transaction and tax records follow the selected year.',
    'Original receipts can contain sensitive personal information. Only selected-year transaction-linked Storage originals are attached. Legacy embedded receipts and external URLs are listed as unavailable.',
    'Missing or unreadable receipts are listed explicitly. An included receipt is not a determination that substantiation is sufficient.',
    'Identity credentials and encrypted tax identifiers are excluded from structured exports. Original uploaded receipt documents are unredacted.',
  ];
  const manifest: PreparerPackageManifest = { version: 1, taxYear, generatedAt: new Date().toISOString(), purpose: 'Fixed records snapshot for tax-preparer review', records: data.transactions.length,
    receiptFiles: receipts.filter(receipt => receipt.status === 'included').length, receiptBytes, receiptIssues: receipts.filter(receipt => receipt.status !== 'included').length,
    completeReceiptCoverage: receipts.every(receipt => receipt.status === 'included'), unresolvedQuestions: questions.length, receipts, limitations, files: [] };
  const json = (value: unknown) => Buffer.from(JSON.stringify(sanitizeExportValue(value), null, 2));
  // Audit-support's legacy receipt links remain references; manifest maps original bytes included here.
  entries.push({ name: 'records.json', bytes: json(data) }, { name: 'transactions.csv', bytes: Buffer.from(convertTransactionsToCSV(data.transactions)) },
    { name: 'audit-support.json', bytes: json(audit) }, { name: 'audit-support.csv', bytes: Buffer.from(auditSupportPacketCSV(audit)) },
    { name: 'unresolved-questions.json', bytes: json(questions) }, { name: 'receipt-status.json', bytes: json(receipts) },
    { name: 'README.txt', bytes: Buffer.from(`WRITEOFF PREPARER PACKAGE — ${taxYear}\nGenerated ${manifest.generatedAt}\n\n${manifest.receiptFiles} original receipt files included; ${manifest.receiptIssues} receipt issues; ${manifest.unresolvedQuestions} transactions with unresolved questions.\n\nRead manifest.json, receipt-status.json and unresolved-questions.json before using these records. Audit-support files describe confirmed deductions and may contain private original links; use the receipt manifest for files actually attached to this ZIP.\n\n${limitations.map(value => `- ${value}`).join('\n')}\n`) });
  if (entries.reduce((sum, entry) => sum + entry.bytes.length, 0) > MAX_PACKAGE_BYTES) throw new PreparerPackageError('The package exceeds 20 MB. Export records and original receipts separately.', 'PREPARER_PACKAGE_TOO_LARGE', 413);
  manifest.files = entries.map(entry => ({ file: entry.name, bytes: entry.bytes.length, sha256: digest(entry.bytes) }));
  entries.push({ name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest, null, 2)) });
  return { bytes: await zip(entries), manifest, filename: `writeoff-preparer-${taxYear}${manifest.receiptIssues ? '-receipt-review-needed' : ''}.zip` };
}
