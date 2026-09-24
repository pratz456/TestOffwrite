import { inflateRawSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ archive: vi.fn(), originals: vi.fn(), audit: vi.fn(), docs: new Map<string, any>(), files: new Map<string, Buffer>(), reads: [] as string[] }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: () => ({ doc: (id: string) => ({ get: async () => ({ exists: mock.docs.has(id), data: () => mock.docs.get(id) }) }) }) } }));
vi.mock('@/lib/reports/data-export', async original => ({ ...await original<typeof import('@/lib/reports/data-export')>(), generateUserDataExport: mock.archive }));
vi.mock('@/lib/reports/export-records', async original => ({ ...await original<typeof import('@/lib/reports/export-records')>(), readOwnedTransactions: mock.originals }));
vi.mock('@/lib/reports/audit-support-packet', () => ({ readAuditSupportPacket: mock.audit, auditSupportPacketCSV: () => 'Audit records\nConfirmed,75' }));
vi.mock('@/lib/firebase/receipt-security', async original => ({ ...await original<typeof import('@/lib/firebase/receipt-security')>(), receiptBucket: () => ({ file: (path: string) => {
  mock.reads.push(path); return { getMetadata: async () => { if (!mock.files.has(path)) throw new Error('Missing secret Storage path'); return [{ size: mock.files.get(path)!.length }]; }, download: async () => [mock.files.get(path)!] };
} }) }));
import { buildPreparerPackage, ownedReceiptBytes, preparerQuestions, MAX_PACKAGE_RECEIPTS } from '@/lib/reports/preparer-package';

/** Read the generated ZIP's central directory, then inflate each archived payload. */
function unzip(bytes: Buffer) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(0);
  let offset = bytes.readUInt32LE(end + 16); const entries = new Map<string, Buffer>();
  for (let count = 0; count < bytes.readUInt16LE(end + 10); count++) {
    expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
    const method = bytes.readUInt16LE(offset + 10), length = bytes.readUInt32LE(offset + 20), nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30), commentLength = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString(), local = bytes.readUInt32LE(offset + 42);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28), payload = bytes.subarray(start, start + length);
    entries.set(name, method === 8 ? inflateRawSync(payload) : payload); offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
const tx = { id: 'transaction-safe', exportReference: 'transaction-safe', amount: 75, date: '2026-09-01', merchant_name: 'Office shop', category: 'OFFICE_EXPENSE', iso_currency_code: 'USD', review_status: 'confirmed', is_deductible: true };
const receipt = { id: 'r1', transactionId: 'transaction-safe', receiptUrl: '/api/receipts/r1' };
const original = { ...tx, id: 'raw-document', trans_id: 'raw-transaction' };
let archive: any;
beforeEach(() => {
  vi.clearAllMocks(); mock.docs.clear(); mock.files.clear(); mock.reads = [];
  archive = { exportInfo: { userId: 'owner', taxYear: 2026 }, userProfile: { profession: 'Designer' }, accounts: [], transactions: [tx], receipts: [receipt], aiAnalysis: [], taxRecords: {} };
  mock.archive.mockImplementation(async () => archive); mock.originals.mockResolvedValue([original]); mock.audit.mockResolvedValue({ packetInfo: { taxYear: 2026 }, deductions: [] });
  mock.docs.set('r1', { userId: 'owner', transactionId: 'raw-transaction', mimeType: 'application/pdf', storagePath: 'receipts/owner/raw-transaction/r1' });
  mock.files.set('receipts/owner/raw-transaction/r1', Buffer.from('%PDF-1.7\nSYNTHETIC ORIGINAL RECEIPT'));
});

describe('receipt-inclusive preparer ZIP', () => {
  it('includes exact original bytes, structured/CSV records, audit support and a checkable manifest', async () => {
    const result = await buildPreparerPackage('owner', 2026), entries = unzip(result.bytes);
    expect(result.manifest).toMatchObject({ taxYear: 2026, records: 1, receiptFiles: 1, receiptIssues: 0, completeReceiptCoverage: true });
    expect(entries.get(result.manifest.receipts[0].file!)).toEqual(mock.files.values().next().value);
    expect([...entries.keys()]).toEqual(expect.arrayContaining(['README.txt', 'manifest.json', 'records.json', 'transactions.csv', 'audit-support.json', 'audit-support.csv', 'unresolved-questions.json', 'receipt-status.json']));
    expect(JSON.parse(entries.get('manifest.json')!.toString()).files).toEqual(result.manifest.files);
    expect(entries.get('transactions.csv')!.toString()).toContain('Office shop');
    expect(mock.archive).toHaveBeenCalledWith('owner', 2026);
    expect(mock.reads).toEqual(['receipts/owner/raw-transaction/r1']);
  });
  it.each([
    ['foreign owner', { userId: 'victim' }], ['contradictory owner', { user_id: 'victim' }],
    ['other transaction', { transactionId: 'another' }], ['foreign path', { storagePath: 'receipts/victim/raw-transaction/r1' }],
    ['traversal', { storagePath: 'receipts/owner/raw-transaction/..' }], ['arbitrary URL', { storagePath: 'https://attacker.test/receipt' }],
    ['legacy embedded content', { storagePath: undefined, dataUrl: 'data:application/pdf;base64,c2VjcmV0' }],
  ])('refuses %s without opening any Storage key', async (_name, change) => {
    mock.docs.set('r1', { ...mock.docs.get('r1'), ...change });
    const result = await buildPreparerPackage('owner', 2026);
    expect(result.manifest).toMatchObject({ receiptFiles: 0, receiptIssues: 1, completeReceiptCoverage: false });
    expect(result.filename).toContain('receipt-review-needed'); expect(mock.reads).toEqual([]);
    expect(unzip(result.bytes).get('README.txt')!.toString()).toContain('1 receipt issues');
  });
  it('lists absent, corrupt and unavailable originals explicitly and never fetches a receipt URL', async () => {
    archive.transactions.push({ ...tx, id: 'transaction-missing', exportReference: 'transaction-missing' });
    archive.receipts[0].receiptUrl = 'https://attacker.test/private';
    mock.files.set('receipts/owner/raw-transaction/r1', Buffer.from('<script>alert(1)</script>'));
    const result = await buildPreparerPackage('owner', 2026);
    expect(result.manifest.receipts.map(item => item.status)).toEqual(['unavailable', 'missing']);
    expect(result.manifest.receiptIssues).toBe(2);
    expect([...unzip(result.bytes).keys()].some(key => key.startsWith('receipts/'))).toBe(false);
  });
  it('fails the entire package when source datasets fail or the package is too large', async () => {
    mock.audit.mockRejectedValueOnce(new Error('incomplete dataset'));
    await expect(buildPreparerPackage('owner', 2026)).rejects.toThrow('incomplete dataset');
    archive.receipts = Array.from({ length: MAX_PACKAGE_RECEIPTS + 1 }, () => receipt);
    await expect(buildPreparerPackage('owner', 2026)).rejects.toMatchObject({ status: 413 });
  });
  it('collects unresolved AI and bookkeeping questions without altering user confirmations', () => {
    const confirmed = { ...tx, ai_suggestion: { questions: ['Was this reimbursed?'] }, tax_review_required: true };
    expect(preparerQuestions([confirmed, { ...tx, id: 'foreign', review_status: 'pending', iso_currency_code: 'EUR', pending: true }])).toEqual([
      { transactionReference: 'transaction-safe', questions: ['Resolve the saved tax-treatment review before claiming a deduction.', 'Was this reimbursed?'] },
      { transactionReference: 'transaction-safe', questions: ['Confirm the category, business purpose and tax treatment.', 'Reconcile this pending bank entry against the posted record.', 'Verify currency and any required U.S. dollar conversion.'] },
    ]);
    expect(confirmed.review_status).toBe('confirmed');
  });
  it('rejects malformed receipt identifiers before any lookup or Storage read', async () => {
    await expect(ownedReceiptBytes('owner', '../r1', 'raw-transaction')).rejects.toMatchObject({ code: 'RECEIPT_UNAVAILABLE' });
    expect(mock.reads).toEqual([]);
  });
});
