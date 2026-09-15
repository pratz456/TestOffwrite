import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), processReceipt: vi.fn(), matching: vi.fn(),
  createTransaction: vi.fn(), getTransaction: vi.fn(), getTransactions: vi.fn(), updateTransaction: vi.fn(),
  collection: vi.fn(), runTransaction: vi.fn(), accountGet: vi.fn(), accountCreate: vi.fn(), receiptCreate: vi.fn(), receiptDelete: vi.fn(),
  bucket: vi.fn(), storageFile: vi.fn(), storageSave: vi.fn(), storageDelete: vi.fn(),
  profile: vi.fn(), analyze: vi.fn(), context: vi.fn(),
}));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: mocks.auth }));
vi.mock('@/lib/ocr/receipt-processor', () => ({ receiptProcessor: {
  processReceipt: mocks.processReceipt,
  inferReceiptDirectionFromText: () => ({ direction: 'expense', confidence: 0.9 }),
  findMatchingTransactions: mocks.matching,
} }));
vi.mock('@/lib/firebase/transactions-server', () => ({
  createTransactionServer: mocks.createTransaction,
  getTransactionServer: mocks.getTransaction,
  getTransactionsServer: mocks.getTransactions,
  updateTransactionServerWithUserId: mocks.updateTransaction,
}));
vi.mock('@/lib/firebase/admin', () => ({ adminApp: { name: 'firebase-frameworks' }, adminDb: { collection: mocks.collection, runTransaction: mocks.runTransaction } }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: mocks.profile }));
vi.mock('@/lib/ai/analyzeTransaction', () => ({ analyzeTransactionWithRetry: mocks.analyze, convertToEnhancedContext: mocks.context }));
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: mocks.bucket, app: { options: {} } }) }));
import { POST, PUT } from '../app/api/receipts/process/route';
import { MAX_RECEIPT_BYTES } from '../lib/firebase/receipt-security';

const owner = 'receipt-onboarding-owner';
const accountPath = `user_profiles/${owner}/accounts/manual`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
function reference(path: string): object {
  return {
    path,
    collection: (name: string) => reference(`${path}/${name}`),
    doc: (name: string) => reference(`${path}/${name}`),
    create: (data: unknown) => mocks.receiptCreate(path, data),
    delete: () => mocks.receiptDelete(path),
  };
}
function request(fields: Record<string, string> = {}, file = new File([PNG], 'receipt.png', { type: 'image/png' }), headers?: HeadersInit) {
  const body = new FormData();
  body.append('file', file);
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return new NextRequest('https://staging.example/api/receipts/process', { method: 'POST', body, headers });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubEnv('FIREBASE_STORAGE_BUCKET', 'demo-receipts.appspot.com');
  mocks.auth.mockResolvedValue({ user: { uid: owner }, error: null });
  mocks.processReceipt.mockResolvedValue({ success: true, data: {
    merchant: 'Synthetic Stationery', amount: 23.45, date: '2026-09-15',
    category: 'office', confidence: 0.9, rawText: 'Synthetic receipt', items: [],
  }, processingTime: 1 });
  mocks.collection.mockImplementation((name: string) => reference(name));
  mocks.bucket.mockReturnValue({ file: mocks.storageFile });
  mocks.storageFile.mockReturnValue({ save: mocks.storageSave, delete: mocks.storageDelete });
  mocks.storageSave.mockResolvedValue(undefined);
  mocks.storageDelete.mockResolvedValue(undefined);
  mocks.receiptCreate.mockResolvedValue(undefined);
  mocks.receiptDelete.mockResolvedValue(undefined);
  mocks.accountGet.mockResolvedValue({ exists: false });
  mocks.runTransaction.mockImplementation(async callback => callback({ get: mocks.accountGet, create: mocks.accountCreate }));
  mocks.createTransaction.mockImplementation(async (_uid, accountId, data) => ({ data: { ...data, userId: owner, account_id: accountId }, error: null }));
  mocks.getTransactions.mockResolvedValue({ data: [], error: null });
  mocks.matching.mockResolvedValue([]);
  mocks.profile.mockResolvedValue({ data: {}, error: null });
  mocks.analyze.mockResolvedValue({ success: false, error: 'Provider calls disabled in this test' });
  mocks.context.mockReturnValue({ profession: 'Synthetic user' });
  mocks.getTransaction.mockResolvedValue({ data: { trans_id: 'owned-bank-transaction', notes: 'Existing note' }, error: null });
  mocks.updateTransaction.mockResolvedValue({ data: [{ trans_id: 'owned-bank-transaction' }], error: null });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('receipt onboarding without a connected bank', () => {
  it('creates a user-owned manual account and receipt transaction for a new user', async () => {
    const response = await POST(request({ userId: 'untrusted-owner', accountId: 'untrusted-bank-account' }));
    expect(response.status).toBe(200);
    expect(mocks.accountGet).toHaveBeenCalledWith(expect.objectContaining({ path: accountPath }));
    expect(mocks.accountCreate).toHaveBeenCalledWith(expect.objectContaining({ path: accountPath }), expect.objectContaining({
      userId: owner, name: 'Manual Entries', type: 'manual', usageType: 'business',
    }));
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({ amount: 23.45, merchant_name: 'Synthetic Stationery', is_deductible: null }));
    expect(mocks.receiptCreate).toHaveBeenCalledWith(expect.stringMatching(/^receipts\/[0-9a-f-]{36}$/), expect.objectContaining({ userId: owner }));
    expect((await response.json()).transaction.account_id).toBe('manual');
  });

  it('uses the existing manual account without overwriting its fields', async () => {
    mocks.accountGet.mockResolvedValue({ exists: true, data: () => ({ name: 'My cash purchases', usageType: 'personal' }) });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.accountCreate).not.toHaveBeenCalled();
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.anything());
  });

  it('keeps income receipts negative under the same manual account', async () => {
    expect((await POST(request({ receiptType: 'income' }))).status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({ amount: -23.45, category: 'income' }));
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('does not create an account or receipt during OCR preview', async () => {
    expect((await POST(request({ mode: 'ocr' }))).status).toBe(200);
    expect(mocks.runTransaction).not.toHaveBeenCalled();
    expect(mocks.receiptCreate).not.toHaveBeenCalled();
    expect(mocks.storageSave).not.toHaveBeenCalled();
    expect(mocks.createTransaction).not.toHaveBeenCalled();
  });

  it('attaches to an owned existing transaction without creating a manual duplicate', async () => {
    expect((await POST(request({ attachTransactionId: 'owned-bank-transaction' }))).status).toBe(200);
    expect(mocks.getTransaction).toHaveBeenCalledWith(owner, 'owned-bank-transaction');
    expect(mocks.updateTransaction).toHaveBeenCalledWith(owner, 'owned-bank-transaction', expect.objectContaining({ receipt_filename: 'receipt.png' }));
    expect(mocks.runTransaction).not.toHaveBeenCalled();
    expect(mocks.createTransaction).not.toHaveBeenCalled();
    expect(mocks.processReceipt).not.toHaveBeenCalled();
  });

  it('rejects unowned attachment targets before storing a receipt', async () => {
    mocks.getTransaction.mockResolvedValue({ data: null, error: null });
    expect((await POST(request({ attachTransactionId: 'other-user-transaction' }))).status).toBe(404);
    expect(mocks.receiptCreate).not.toHaveBeenCalled();
    expect(mocks.storageSave).not.toHaveBeenCalled();
    expect(mocks.runTransaction).not.toHaveBeenCalled();
    expect(mocks.processReceipt).not.toHaveBeenCalled();
  });

  it('fails before receipt writes if manual-account initialization is unavailable', async () => {
    mocks.runTransaction.mockRejectedValue(new Error('database unavailable'));
    expect((await POST(request())).status).toBe(500);
    expect(mocks.receiptCreate).not.toHaveBeenCalled();
    expect(mocks.createTransaction).not.toHaveBeenCalled();
  });

  it('requires authentication before OCR or any database work', async () => {
    mocks.auth.mockResolvedValue({ user: null, error: 'Unauthorized' });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.processReceipt).not.toHaveBeenCalled();
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });

  it('stores receipt bytes privately with metadata-only Firestore and a download URL', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.bucket).toHaveBeenCalledWith('demo-receipts.appspot.com');
    expect(mocks.storageFile).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^receipts/${owner}/receipt_[^/]+/[0-9a-f-]{36}$`)));
    expect(mocks.storageSave).toHaveBeenCalledWith(PNG, expect.objectContaining({
      metadata: { contentType: 'image/png', cacheControl: 'private, no-store, max-age=0' },
    }));
    const metadata = mocks.receiptCreate.mock.calls[0][1];
    expect(metadata).toMatchObject({ userId: owner, originalName: 'receipt.png', size: PNG.length });
    expect(metadata).not.toHaveProperty('dataUrl');
    expect(metadata).not.toHaveProperty('bytes');
    expect((await response.json()).receiptUrl).toMatch(/^\/api\/receipts\/[0-9a-f-]{36}$/);
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  });

  it('accepts an image above Firestore’s document limit without embedding bytes', async () => {
    const bytes = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
    expect((await POST(request({}, new File([bytes], 'large.png', { type: 'image/png' })))).status).toBe(200);
    expect(mocks.storageSave.mock.calls[0][0].length).toBe(bytes.length);
    expect(JSON.stringify(mocks.receiptCreate.mock.calls[0][1]).length).toBeLessThan(1024);
  });

  it('cleans the Storage object when receipt metadata cannot be persisted', async () => {
    mocks.receiptCreate.mockRejectedValue(new Error('private database details'));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(mocks.storageDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
    expect(mocks.createTransaction).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('private database details');
  });

  it.each(['result', 'throw'])('cleans receipt files and metadata after a transaction save failure (%s)', async failure => {
    if (failure === 'throw') mocks.createTransaction.mockRejectedValue(new Error('unavailable'));
    else mocks.createTransaction.mockResolvedValue({ data: null, error: new Error('unavailable') });
    expect((await POST(request())).status).toBe(503);
    expect(mocks.receiptDelete).toHaveBeenCalledOnce();
    expect(mocks.storageDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it('cleans the new receipt when attachment persistence fails', async () => {
    mocks.updateTransaction.mockResolvedValue({ data: null, error: new Error('unavailable') });
    expect((await POST(request({ attachTransactionId: 'owned-bank-transaction' }))).status).toBe(503);
    expect(mocks.receiptDelete).toHaveBeenCalledOnce();
    expect(mocks.storageDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it('fails closed on attachment ownership lookup failure', async () => {
    mocks.getTransaction.mockResolvedValue({ data: null, error: new Error('private lookup error') });
    const response = await POST(request({ attachTransactionId: 'owned-bank-transaction' }));
    expect(response.status).toBe(503);
    expect(mocks.storageSave).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('private lookup error');
  });

  it.each([{ mode: 'other' }, { receiptType: 'other' }, { attachTransactionId: '../other-user' }])('rejects invalid request fields before OCR: %s', async fields => {
    expect((await POST(request(fields))).status).toBe(400);
    expect(mocks.processReceipt).not.toHaveBeenCalled();
    expect(mocks.storageSave).not.toHaveBeenCalled();
  });

  it('rejects mislabeled, empty and oversized files before OCR', async () => {
    expect((await POST(request({}, new File(['<script>bad</script>'], 'bad.png', { type: 'image/png' })))).status).toBe(400);
    expect((await POST(request({}, new File([], 'empty.png', { type: 'image/png' })))).status).toBe(400);
    expect((await POST(request({}, new File([Buffer.alloc(MAX_RECEIPT_BYTES + 1)], 'large.png', { type: 'image/png' })))).status).toBe(413);
    expect(mocks.processReceipt).not.toHaveBeenCalled();
  });

  it('rejects cross-site cookie requests before OCR or storage', async () => {
    expect((await POST(request({}, undefined, { origin: 'https://attacker.example' }))).status).toBe(403);
    expect(mocks.processReceipt).not.toHaveBeenCalled();
  });

  it('passes the typed analysis request and saves only successful model output', async () => {
    mocks.analyze.mockResolvedValue({ success: true, result: {
      is_deductible: false, category: 'OTHER', audit_risk: 'Low', confidence: 0.8,
      customized_reason: 'User should confirm business purpose', irs_refs: [],
    } });
    expect((await POST(request())).status).toBe(200);
    await vi.waitFor(() => expect(mocks.updateTransaction).toHaveBeenCalled());
    expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ merchant: 'Synthetic Stationery', amount_usd: 23.45, date_iso: '2026-09-15' }), { profession: 'Synthetic user' });
    expect(mocks.updateTransaction).toHaveBeenCalledWith(owner, expect.stringMatching(/^receipt_/), expect.objectContaining({ analyzed: true, analysis_status: 'completed' }));
    expect(mocks.updateTransaction.mock.calls[0][2]).not.toHaveProperty('is_deductible');
  });

  it('saves validated manual confirmation even when OCR is unavailable', async () => {
    mocks.processReceipt.mockRejectedValue(new Error('OCR unavailable'));
    const receiptData = JSON.stringify({ merchant: '  Corrected merchant  ', amount: 49.99, date: '2026-09-14', category: 'supplies' });
    expect((await POST(request({ receiptData }))).status).toBe(200);
    expect(mocks.processReceipt).not.toHaveBeenCalled();
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({
      merchant_name: 'Corrected merchant', amount: 49.99, date: '2026-09-14', category: 'supplies',
      notes: 'Receipt details confirmed manually.',
    }));
  });

  it.each([
    'not-json',
    JSON.stringify({ merchant: '', amount: 49.99, date: '2026-09-14' }),
    JSON.stringify({ merchant: 'Merchant', amount: 0, date: '2026-09-14' }),
    JSON.stringify({ merchant: 'Merchant', amount: -10, date: '2026-09-14' }),
    JSON.stringify({ merchant: 'Merchant', amount: '49.99', date: '2026-09-14' }),
    JSON.stringify({ merchant: 'Merchant', amount: 49.99, date: '2026-02-30' }),
    JSON.stringify({ merchant: 'Merchant', amount: 49.99, date: '2026-09-14', userId: 'other' }),
  ])('rejects invalid manual receipt details before writes: %s', async receiptData => {
    expect((await POST(request({ receiptData }))).status).toBe(400);
    expect(mocks.processReceipt).not.toHaveBeenCalled();
    expect(mocks.storageSave).not.toHaveBeenCalled();
    expect(mocks.createTransaction).not.toHaveBeenCalled();
  });

  it('ignores manual field overrides when attaching to an existing bank transaction', async () => {
    expect((await POST(request({ attachTransactionId: 'owned-bank-transaction', receiptData: '{invalid ignored override}' }))).status).toBe(200);
    const updates = mocks.updateTransaction.mock.calls[0][2];
    expect(updates).not.toHaveProperty('amount');
    expect(updates).not.toHaveProperty('merchant_name');
    expect(updates).not.toHaveProperty('date');
    expect(mocks.createTransaction).not.toHaveBeenCalled();
    expect(mocks.processReceipt).not.toHaveBeenCalled();
  });

  it('attaches a valid image even if OCR is unavailable or manual amount is invalid', async () => {
    mocks.processReceipt.mockRejectedValue(new Error('OCR worker unavailable'));
    const receiptData = JSON.stringify({ merchant: '', amount: -10, date: 'invalid' });
    const response = await POST(request({ attachTransactionId: 'owned-bank-transaction', receiptData }));
    expect(response.status).toBe(200);
    expect(mocks.processReceipt).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(mocks.storageSave).toHaveBeenCalledOnce();
  });

  it('checks transaction ownership before any attachment storage writes', async () => {
    mocks.getTransaction.mockImplementation(async () => {
      expect(mocks.storageSave).not.toHaveBeenCalled();
      expect(mocks.receiptCreate).not.toHaveBeenCalled();
      expect(mocks.processReceipt).not.toHaveBeenCalled();
      return { data: null, error: null };
    });
    expect((await POST(request({ attachTransactionId: 'unknown-owner' }))).status).toBe(404);
    expect(mocks.storageSave).not.toHaveBeenCalled();
  });

  it('returns the successful attachment update without a fallible second transaction read', async () => {
    mocks.getTransaction.mockResolvedValueOnce({ data: {
      trans_id: 'owned-bank-transaction', merchant_name: 'Bank merchant', amount: 125, notes: 'Owner note',
    }, error: null }).mockRejectedValueOnce(new Error('A second read would fail'));
    mocks.updateTransaction.mockResolvedValue({ data: [{ trans_id: 'owned-bank-transaction', amount: 125, category: 'supplies' }], error: null });
    const response = await POST(request({ attachTransactionId: 'owned-bank-transaction' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.transaction).toMatchObject({ trans_id: 'owned-bank-transaction', merchant_name: 'Bank merchant', amount: 125, category: 'supplies', receipt_url: body.receiptUrl });
    expect(mocks.getTransaction).toHaveBeenCalledOnce();
  });

  it('keeps a concrete owner transaction response when a successful update has no returned document', async () => {
    mocks.getTransaction.mockResolvedValue({ data: { trans_id: 'owned-bank-transaction', merchant_name: 'Known merchant', amount: 125 }, error: null });
    mocks.updateTransaction.mockResolvedValue({ data: [], error: null });
    const response = await POST(request({ attachTransactionId: 'owned-bank-transaction' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.transaction).toMatchObject({ trans_id: 'owned-bank-transaction', merchant_name: 'Known merchant', amount: 125, receipt_url: body.receiptUrl });
    expect(mocks.getTransaction).toHaveBeenCalledOnce();
  });

  it('logs only a fixed staging step and allowlisted error code on storage failure', async () => {
    vi.stubEnv('WRITEOFF_ENV', 'staging');
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    mocks.storageSave.mockRejectedValue(Object.assign(new Error('private receipt body and provider credentials'), { code: 403 }));
    expect((await POST(request())).status).toBe(500);
    expect(stderr).toHaveBeenCalledWith(`${JSON.stringify({ event: 'receipt-processing-failed', step: 'storage-save', code: 403 })}\n`);
    expect(stderr.mock.calls.flat().join('')).not.toContain('private receipt');
    expect(stderr.mock.calls.flat().join('')).not.toContain(owner);
  });

  it('does not emit staging diagnostics in production or echo an unknown error code', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    mocks.storageSave.mockRejectedValue({ code: 'private-token-must-not-appear' });
    vi.stubEnv('WRITEOFF_ENV', 'production');
    expect((await POST(request())).status).toBe(500);
    expect(stderr).not.toHaveBeenCalled();
    vi.stubEnv('WRITEOFF_ENV', 'staging');
    expect((await POST(request())).status).toBe(500);
    expect(stderr.mock.calls.flat().join('')).toContain('unclassified');
    expect(stderr.mock.calls.flat().join('')).not.toContain('private-token');
  });
});

describe('receipt detail update boundaries', () => {
  function update(updates: unknown, transactionId = 'owned-transaction') {
    return PUT(new NextRequest('https://staging.example/api/receipts/process', { method: 'PUT', body: JSON.stringify({ transactionId, updates }) }));
  }
  it.each([{ userId: 'other' }, { account_id: 'other' }, { amount: 1000 }, { ai_analysis: 'forged' }, {}])('rejects forged or uneditable fields %s', async updates => {
    expect((await update(updates)).status).toBe(400);
    expect(mocks.updateTransaction).not.toHaveBeenCalled();
  });
  it('keeps owner notes editable with trusted ownership', async () => {
    expect((await update({ notes: 'Owner receipt note' })).status).toBe(200);
    expect(mocks.updateTransaction).toHaveBeenCalledWith(owner, 'owned-transaction', { notes: 'Owner receipt note' });
  });
});
