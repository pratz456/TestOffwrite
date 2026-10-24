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
function request(uploadTimeZone?: string, fields: Record<string, string> = {}) {
  const body = new FormData();
  body.append('file', new File([PNG], 'receipt.png', { type: 'image/png' }));
  if (uploadTimeZone !== undefined) body.append('uploadTimeZone', uploadTimeZone);
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
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

  it('stores america/los_angeles as America/Los_Angeles', async () => {
    ocrDate('2026-09-15');
    const response = await POST(request('america/los_angeles'));
    expect(response.status).toBe(200);
    expect(mocks.processReceipt).toHaveBeenCalledWith(expect.any(Buffer), 'America/Los_Angeles');
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({
      date: '2026-09-15', uploadTimeZone: 'America/Los_Angeles',
    }));
  });

  it('stores UTC and still stores America/Los_Angeles', async () => {
    ocrDate('2026-09-15');
    const utc = await POST(request('UTC'));
    expect(utc.status).toBe(200);
    expect(mocks.processReceipt).toHaveBeenCalledWith(expect.any(Buffer), 'UTC');
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({
      uploadTimeZone: 'UTC',
    }));
    const losAngeles = await POST(request('America/Los_Angeles'));
    expect(losAngeles.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenLastCalledWith(owner, 'manual', expect.objectContaining({
      uploadTimeZone: 'America/Los_Angeles',
    }));
  });

  it.each(['Etc/UTC', 'Etc/GMT', 'GMT', 'utc', 'Etc/Universal', 'Universal', 'Etc/Zulu', 'Zulu', 'GMT0', 'Etc/GMT0', 'Etc/GMT+0', 'GMT+0', 'GMT-0', 'Etc/GMT-0', 'UCT', 'Etc/UCT', 'Greenwich', 'Etc/Greenwich'])('stores %s as UTC', async zone => {
    ocrDate('2026-09-15');
    const response = await POST(request(zone));
    expect(response.status).toBe(200);
    expect(mocks.processReceipt).toHaveBeenCalledWith(expect.any(Buffer), 'UTC');
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({
      uploadTimeZone: 'UTC',
    }));
  });

  it.each(['Etc/UTC', 'Etc/GMT', 'GMT', 'utc'])('stores %s as UTC on an attached receipt', async zone => {
    mocks.getTransaction.mockResolvedValue({ data: {
      trans_id: 'owned-bank-transaction', notes: 'Existing note', merchant_name: 'Bank merchant', amount: 10, date: '2026-01-01',
    }, error: null });
    mocks.updateTransaction.mockResolvedValue({ data: [{ trans_id: 'owned-bank-transaction' }], error: null });
    const response = await POST(request(zone, { attachTransactionId: 'owned-bank-transaction' }));
    expect(response.status).toBe(200);
    expect(mocks.processReceipt).not.toHaveBeenCalled();
    const updates = mocks.updateTransaction.mock.calls.at(-1)?.[2] as Record<string, unknown>;
    expect(updates.uploadTimeZone).toBe('UTC');
  });

  // GMT+5 cannot fail a revert of region-time-zone.ts to 1f147a89. Intl throws
  // "Invalid time zone specified: GMT+5" before the alias check, and that revision
  // already returns undefined when Intl throws. The upload stays 200 and the zone stays unset.
  it.each(['est', 'EST', 'pst', 'PST', 'EST5EDT', 'CST6CDT', 'GMT+5', 'Etc/GMT+1', 'UTC+0', 'Etc/GMT+5', 'Etc/GMT-3', '+05:00', 'Z'])('rejects %s and still returns 200', async zone => {
    ocrDate('2026-09-15');
    const response = await POST(request(zone));
    expect(response.status).toBe(200);
    expect(mocks.processReceipt).toHaveBeenCalledWith(expect.any(Buffer), undefined);
    expect((mocks.createTransaction.mock.calls.at(-1)?.[2] as { uploadTimeZone?: string }).uploadTimeZone).toBeUndefined();
  });

  it('stores the canonical zone on an attached transaction and leaves its other fields alone', async () => {
    mocks.getTransaction.mockResolvedValue({ data: {
      trans_id: 'owned-bank-transaction', notes: 'Existing note', merchant_name: 'Bank merchant', amount: 10, date: '2026-01-01',
    }, error: null });
    mocks.updateTransaction.mockResolvedValue({ data: [{ trans_id: 'owned-bank-transaction' }], error: null });
    const response = await POST(request('america/los_angeles', { attachTransactionId: 'owned-bank-transaction' }));
    expect(response.status).toBe(200);
    expect(mocks.processReceipt).not.toHaveBeenCalled();
    expect(mocks.createTransaction).not.toHaveBeenCalled();
    const updates = mocks.updateTransaction.mock.calls.at(-1)?.[2] as Record<string, unknown>;
    expect(mocks.updateTransaction).toHaveBeenCalledWith(owner, 'owned-bank-transaction', updates);
    expect(updates).toEqual({
      receipt_url: expect.stringMatching(/^\/api\/receipts\//),
      receipt_filename: 'receipt.png',
      notes: 'Existing note\nReceipt attached: receipt.png.',
      uploadTimeZone: 'America/Los_Angeles',
    });
    const missing = await POST(request(undefined, { attachTransactionId: 'owned-bank-transaction' }));
    expect(missing.status).toBe(200);
    expect(mocks.updateTransaction.mock.calls.at(-1)?.[2]).not.toHaveProperty('uploadTimeZone');
    const est = await POST(request('est', { attachTransactionId: 'owned-bank-transaction' }));
    expect(est.status).toBe(200);
    expect(mocks.updateTransaction.mock.calls.at(-1)?.[2]).not.toHaveProperty('uploadTimeZone');
    const offset = await POST(request('Etc/GMT+5', { attachTransactionId: 'owned-bank-transaction' }));
    expect(offset.status).toBe(200);
    expect(mocks.updateTransaction.mock.calls.at(-1)?.[2]).not.toHaveProperty('uploadTimeZone');
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
