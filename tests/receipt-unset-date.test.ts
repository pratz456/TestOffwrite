import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const worker = vi.hoisted(() => ({ recognize: vi.fn(), terminate: vi.fn() }));
vi.mock('tesseract.js', () => ({ default: { createWorker: vi.fn(async () => worker) } }));

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createTransaction: vi.fn(), getTransaction: vi.fn(), getTransactions: vi.fn(), updateTransaction: vi.fn(),
  collection: vi.fn(), runTransaction: vi.fn(), accountGet: vi.fn(), accountCreate: vi.fn(), receiptCreate: vi.fn(), receiptDelete: vi.fn(),
  bucket: vi.fn(), storageFile: vi.fn(), storageSave: vi.fn(), storageDelete: vi.fn(),
}));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: mocks.auth }));
vi.mock('@/lib/firebase/transactions-server', () => ({
  createTransactionServer: mocks.createTransaction,
  getTransactionServer: mocks.getTransaction,
  getTransactionsServer: mocks.getTransactions,
  updateTransactionServerWithUserId: mocks.updateTransaction,
}));
vi.mock('@/lib/firebase/admin', () => ({ adminApp: { name: 'firebase-frameworks' }, adminDb: { collection: mocks.collection, runTransaction: mocks.runTransaction } }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: vi.fn() }));
vi.mock('@/lib/ai/analyzeTransaction', () => ({ analyzeTransactionWithRetry: vi.fn(), convertToEnhancedContext: vi.fn() }));
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: mocks.bucket, app: { options: {} } }) }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));

import { POST, PUT } from '../app/api/receipts/process/route';
import { placeReceiptDate, summarizeReceiptYears } from '@/lib/receipts/receipt-date';
import { safeYMD } from '@/lib/schedule-c/taxDate';
import { resetRateLimitStore } from './fixtures/rate-limit-store';

const owner = 'receipt-unset-date-owner';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const SCAN = `SYNTHETIC OFFICE STORE\n12/1/2025\nOffice supplies $25.00\nTOTAL $25.00\nTEST RECEIPT - NO PURCHASE`;

function reference(path: string): object {
  return {
    path,
    collection: (name: string) => reference(`${path}/${name}`),
    doc: (name: string) => reference(`${path}/${name}`),
    create: (data: unknown) => mocks.receiptCreate(path, data),
    delete: () => mocks.receiptDelete(path),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimitStore();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubEnv('FIREBASE_STORAGE_BUCKET', 'demo-receipts.appspot.com');
  worker.recognize.mockResolvedValue({ data: { text: SCAN, confidence: 95 } });
  mocks.auth.mockResolvedValue({ user: { uid: owner }, error: null });
  mocks.collection.mockImplementation((name: string) => reference(name));
  mocks.bucket.mockReturnValue({ file: mocks.storageFile });
  mocks.storageFile.mockReturnValue({ save: mocks.storageSave, delete: mocks.storageDelete });
  mocks.storageSave.mockResolvedValue(undefined);
  mocks.storageDelete.mockResolvedValue(undefined);
  mocks.receiptCreate.mockResolvedValue(undefined);
  mocks.accountGet.mockResolvedValue({ exists: true });
  mocks.runTransaction.mockImplementation(async callback => callback({ get: mocks.accountGet, create: mocks.accountCreate }));
  mocks.createTransaction.mockImplementation(async (_uid, accountId, data) => ({ data: { ...data, userId: owner, account_id: accountId }, error: null }));
  mocks.getTransactions.mockResolvedValue({ data: [], error: null });
  mocks.updateTransaction.mockImplementation(async (_uid, id, updates) => ({ data: [{ trans_id: id, ...updates }], error: null }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('an ambiguous receipt date is saved unset', () => {
  it('keeps the amount, counts Needs more information, then uses the day the user sets', async () => {
    const file = new File([PNG], 'receipt.png', { type: 'image/png' });
    const fileDay = new Date(file.lastModified).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const body = new FormData();
    body.append('file', file);
    body.append('mode', 'commit');
    const response = await POST(new NextRequest('https://staging.example/api/receipts/process', { method: 'POST', body }));

    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledTimes(1);
    const written = mocks.createTransaction.mock.calls[0][2] as { amount: number; date: string; deductionStatus?: string; trans_id: string };
    expect(written.amount).toBe(25);
    expect(written.date).toBe('');
    expect(written.date).not.toBe(today);
    expect(written.date).not.toBe(fileDay);
    expect(written).not.toHaveProperty('tax_year');
    expect(written).not.toHaveProperty('taxYear');
    expect(placeReceiptDate(written.date)).toEqual({ date: '', taxYear: null, status: 'Needs more information' });
    expect(written.deductionStatus).toBe('Needs more information');

    const before = summarizeReceiptYears([
      { amount: written.amount, date: written.date },
      { amount: 8, date: '2025-03-03' },
      { amount: 10, date: '2026-06-01' },
    ]);
    expect(before.needsMoreInformation).toEqual({ label: 'Needs more information', count: 1, amount: 25 });
    expect(before.years.get(2025)).toEqual({ count: 1, amount: 8 });
    expect(before.years.get(2026)).toEqual({ count: 1, amount: 10 });
    expect(before.years.get(2025)!.amount + before.years.get(2026)!.amount + before.needsMoreInformation.amount).toBe(43);

    const update = await PUT(new NextRequest('https://staging.example/api/receipts/process', {
      method: 'PUT',
      body: JSON.stringify({ transactionId: written.trans_id, updates: { date: '2025-12-01' } }),
    }));
    expect(update.status).toBe(200);
    expect(mocks.updateTransaction).toHaveBeenCalledWith(owner, written.trans_id, { date: '2025-12-01' });
    const after = summarizeReceiptYears([{ amount: written.amount, date: '2025-12-01' }]);
    expect(after.needsMoreInformation).toEqual({ label: 'Needs more information', count: 0, amount: 0 });
    expect(after.years.get(2025)).toEqual({ count: 1, amount: 25 });
    expect(placeReceiptDate('2025-12-01')).toEqual({ date: '2025-12-01', taxYear: 2025, status: null });
    expect(safeYMD('2025/13/01')).toBeNull();
  });
});
