import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), processReceipt: vi.fn(), matching: vi.fn(),
  createTransaction: vi.fn(), getTransaction: vi.fn(), getTransactions: vi.fn(), updateTransaction: vi.fn(),
  collection: vi.fn(), runTransaction: vi.fn(), accountGet: vi.fn(), accountCreate: vi.fn(), receiptCreate: vi.fn(), receiptDelete: vi.fn(),
  bucket: vi.fn(), storageFile: vi.fn(), storageSave: vi.fn(), storageDelete: vi.fn(),
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
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: mocks.bucket, app: { options: {} } }) }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
import { POST } from '../app/api/receipts/process/route';
import { resetRateLimitStore } from './fixtures/rate-limit-store';

const owner = 'receipt-date-owner';
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
function request(uploadTimeZone?: string) {
  const body = new FormData();
  body.append('file', new File([PNG], 'receipt.png', { type: 'image/png' }));
  if (uploadTimeZone !== undefined) body.append('uploadTimeZone', uploadTimeZone);
  return new NextRequest('https://staging.example/api/receipts/process', { method: 'POST', body });
}
function ocrDate(date: string) {
  mocks.processReceipt.mockResolvedValue({ success: true, data: {
    merchant: 'Synthetic Stationery', amount: 23.45, date,
    category: 'office', confidence: 0.9, rawText: 'Synthetic receipt', items: [],
  }, processingTime: 1 });
}

beforeEach(() => {
  vi.resetAllMocks();
  resetRateLimitStore();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubEnv('FIREBASE_STORAGE_BUCKET', 'demo-receipts.appspot.com');
  mocks.auth.mockResolvedValue({ user: { uid: owner }, error: null });
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
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('OCR receipt save requires a real calendar day', () => {
  it.each(['2026-13-01', '2026-02-30', '2025-12-32'])('refuses %s before saving', async date => {
    ocrDate(date);
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'Enter a real receipt date before saving' });
    expect(mocks.createTransaction).not.toHaveBeenCalled();
    expect(mocks.storageSave).not.toHaveBeenCalled();
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });

  it.each(['2026-02-28', '2024-02-29', '2026-09-15'])('saves %s unchanged', async date => {
    ocrDate(date);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({
      merchant_name: 'Synthetic Stationery', amount: 23.45, date,
    }));
    expect((await response.json()).transaction.date).toBe(date);
  });

  it('stores a valid upload zone and passes it into OCR', async () => {
    ocrDate('2026-09-15');
    const response = await POST(request('America/Los_Angeles'));
    expect(response.status).toBe(200);
    expect(mocks.processReceipt).toHaveBeenCalledWith(expect.any(Buffer), 'America/Los_Angeles');
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({
      date: '2026-09-15', uploadTimeZone: 'America/Los_Angeles',
    }));
  });

  it('drops a missing or invalid upload zone', async () => {
    ocrDate('2026-09-15');
    const missing = await POST(request());
    expect(missing.status).toBe(200);
    expect(mocks.processReceipt).toHaveBeenCalledWith(expect.any(Buffer), undefined);
    expect((mocks.createTransaction.mock.calls.at(-1)?.[2] as { uploadTimeZone?: string }).uploadTimeZone).toBeUndefined();
    const invalid = await POST(request('Not/AZone'));
    expect(invalid.status).toBe(200);
    expect(mocks.processReceipt).toHaveBeenLastCalledWith(expect.any(Buffer), undefined);
    expect((mocks.createTransaction.mock.calls.at(-1)?.[2] as { uploadTimeZone?: string }).uploadTimeZone).toBeUndefined();
  });
});
