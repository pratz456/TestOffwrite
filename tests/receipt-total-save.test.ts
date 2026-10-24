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
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: mocks.bucket, app: { options: {} } }) }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
import { POST } from '../app/api/receipts/process/route';
import { receiptProcessor } from '@/lib/ocr/receipt-processor';
import { resetRateLimitStore } from './fixtures/rate-limit-store';

const owner = 'receipt-total-owner';
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
function request(fields: Record<string, string> = {}) {
  const body = new FormData();
  body.append('file', new File([PNG], 'receipt.png', { type: 'image/png' }));
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return new NextRequest('https://staging.example/api/receipts/process', { method: 'POST', body });
}
function market(lines: string[]) {
  return ['SYNTHETIC MARKET LLC', '100 MAIN STREET', '2026-09-02', ...lines].join('\n');
}
function recognize(text: string) {
  worker.recognize.mockResolvedValue({ data: { text, confidence: 96 } });
}

beforeEach(() => {
  vi.clearAllMocks();
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
});
afterEach(async () => { await receiptProcessor.terminate(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('saved receipt totals', () => {
  it.each([
    ['TOTAL DUE 12.50', market(['COFFEE 4.00', 'SUBTOTAL 20.00', 'TAX 1.25', 'TIP 5.00', 'TOTAL DUE 12.50']), 12.5],
    ['TOTAL 12,50', market(['ESPRESSO 4,00', 'SUBTOTAL 20,00', 'TAX 1,25', 'TIP 3,00', 'TOTAL 12,50']), 12.5],
    ['TOTAL 1,250.00', market(['COFFEE 4.00', 'SUBTOTAL 20.00', 'TOTAL 1,250.00']), 1250],
  ])('saves %s', async (_label, text, amount) => {
    recognize(text);
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls[0][2];
    expect(saved.amount).toBeCloseTo(amount, 2);
    expect(saved.amount).not.toBe(0);
    expect(saved.amount).not.toBe(12);
    expect(saved.amount).not.toBe(1);
    expect(saved.deductionStatus).toBeUndefined();
    expect(saved.tax_review_required).toBeUndefined();
    expect(saved.date).toBe('2026-09-02');
    expect((await response.json()).transaction.amount).toBeCloseTo(amount, 2);
  });

  it.each([
    ['ambiguous TOTAL 1,234', market(['WIDGET 2', 'GADGET 3', 'TOTAL 1,234']), [0, 1, 1234, 1.234]],
    ['cut off TOTAL 12,5', market(['TOTAL 12,5']), [0, 12, 12.5, 125]],
    ['unreadable TOTAL', market(['COFFEE 4.50', 'TOTAL']), [0, 4.5]],
    ['items without a total', market(['COFFEE 4.50', 'MUFFIN 3.25']), [0, 4.5, 3.25, 7.75]],
  ])('saves %s blank for review', async (_label, text, forbidden) => {
    recognize(text);
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls[0][2];
    expect(saved.amount).toBeNull();
    expect(forbidden).not.toContain(saved.amount);
    expect(saved.amountNeedsReview).toBe(true);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.tax_review_required).toBe(true);
    const body = await response.json();
    expect(body.transaction.amount).toBeNull();
    expect(body.transaction.amount).not.toBe(0);
    expect(body.transaction.deductionStatus).toBe('Needs more information');
    expect(body.transaction.tax_review_required).toBe(true);
  });

  it.each([80.25, 12.5])('keeps a user typed amount %s', async amount => {
    worker.recognize.mockRejectedValue(new Error('OCR must not run'));
    const receiptData = JSON.stringify({
      merchant: 'Typed merchant', amount, date: '2026-09-14', category: 'supplies', iso_currency_code: 'USD',
    });
    const response = await POST(request({ receiptData }));
    expect(response.status).toBe(200);
    expect(worker.recognize).not.toHaveBeenCalled();
    const saved = mocks.createTransaction.mock.calls[0][2];
    expect(saved.amount).toBe(amount);
    expect(saved.merchant_name).toBe('Typed merchant');
    expect(saved.amountNeedsReview).toBeUndefined();
    expect(saved.deductionStatus).toBeUndefined();
    expect(saved.tax_review_required).toBeUndefined();
    expect((await response.json()).transaction.amount).toBe(amount);
  });
});
