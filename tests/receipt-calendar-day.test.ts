import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const worker = vi.hoisted(() => ({ recognize: vi.fn(), terminate: vi.fn() }));
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createTransaction: vi.fn(), getTransaction: vi.fn(), getTransactions: vi.fn(), updateTransaction: vi.fn(),
  collection: vi.fn(), runTransaction: vi.fn(), accountGet: vi.fn(), accountCreate: vi.fn(), receiptCreate: vi.fn(), receiptDelete: vi.fn(),
  bucket: vi.fn(), storageFile: vi.fn(), storageSave: vi.fn(), storageDelete: vi.fn(),
}));
vi.mock('tesseract.js', () => ({ default: { createWorker: vi.fn(async () => worker) } }));
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
import { receiptProcessor } from '@/lib/ocr/receipt-processor';
import { reviewedReceiptData } from '@/lib/receipts/receipt-review';
import { POST } from '../app/api/receipts/process/route';
import { resetRateLimitStore } from './fixtures/rate-limit-store';

const owner = 'receipt-calendar-day-owner';
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
function request() {
  const body = new FormData();
  body.append('file', new File([PNG], 'receipt.png', { type: 'image/png' }));
  return new NextRequest('https://staging.example/api/receipts/process', { method: 'POST', body });
}
function recognize(text: string) {
  worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
}
function usd(date: string) {
  return `SYNTHETIC OFFICE STORE\n${date}\nTotal 25.00 USD`;
}

beforeEach(() => {
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
afterEach(async () => {
  await receiptProcessor.terminate();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('ambiguous numeric receipt dates', () => {
  it('reads 05/01/2026 on a USD receipt as month/day and marks the assumption', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2035-06-15T12:00:00Z'));
    recognize(usd('05/01/2026'));
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');

    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
    expect(reviewedReceiptData({ merchant: 'Cafe', amount: '25', date: '2026-05-01', category: 'other', dateOrderAssumed: 'month_day' }).dateOrderAssumed).toBe('month_day');
  });

  it('does not mark 13/01/2026 or a month name, and does not guess the day order', async () => {
    recognize(usd('13/01/2026'));
    const impossible = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(impossible.data?.date).toBe('');
    expect(impossible.data?.dateOrderAssumed).toBeUndefined();

    recognize(usd('Jan 1, 2026'));
    const named = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(named.data?.date).toBe('2026-01-01');
    expect(named.data?.dateOrderAssumed).toBeUndefined();
    const response = await POST(request());
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; dateOrderAssumed?: string };
    expect(saved.date).toBe('2026-01-01');
    expect(saved.dateOrderAssumed).toBeUndefined();
    expect(reviewedReceiptData({ merchant: 'Cafe', amount: '25', date: '2026-01-01', category: 'other' }).dateOrderAssumed).toBeUndefined();
  });

  it('leaves an ambiguous numeric date blank on a non US receipt and saves Needs more information', async () => {
    recognize('CAFE PARIS\n05/01/2026\nTotal 25.00 EUR');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('');
    expect(scanned.data?.dateOrderAssumed).toBeUndefined();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; deductionStatus?: string; dateOrderAssumed?: string; tax_review_required?: boolean };
    expect(saved.date).toBe('');
    expect(saved.amount).toBe(25);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.tax_review_required).toBe(true);
    expect(saved.dateOrderAssumed).toBeUndefined();
  });

  it('reads 05/01/2026 with no currency as month/day and marks the assumption', async () => {
    recognize('CORNER STORE\n05/01/2026\nTotal 25.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it('leaves 05/01/2026 blank on a CA$ receipt and saves Needs more information', async () => {
    recognize('MAPLE STORE\n05/01/2026\nTotal CA$25.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('');
    expect(scanned.data?.dateOrderAssumed).toBeUndefined();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; deductionStatus?: string; dateOrderAssumed?: string; tax_review_required?: boolean };
    expect(saved.date).toBe('');
    expect(saved.amount).toBe(25);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.tax_review_required).toBe(true);
    expect(saved.dateOrderAssumed).toBeUndefined();
  });

  it('leaves 05/01/2026 blank on a rupee receipt and saves Needs more information', async () => {
    recognize('DELHI STORE\n05/01/2026\nTotal 25.00\n₹');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('');
    expect(scanned.data?.dateOrderAssumed).toBeUndefined();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; deductionStatus?: string; dateOrderAssumed?: string; tax_review_required?: boolean };
    expect(saved.date).toBe('');
    expect(saved.amount).toBe(25);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.tax_review_required).toBe(true);
    expect(saved.dateOrderAssumed).toBeUndefined();
  });

  it('reads 05/05/2026 on a USD receipt as that date and does not mark it', async () => {
    recognize(usd('05/05/2026'));
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-05');
    expect(scanned.data?.dateOrderAssumed).toBeUndefined();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-05');
    expect(saved.dateOrderAssumed).toBeUndefined();
    expect(saved.deductionStatus).toBeUndefined();
  });

  it('reads 05/01/2026 as month/day when USD and C$ both appear', async () => {
    recognize('BORDER STORE\n05/01/2026\nTotal 25.00 USD\nAlso C$10');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it.each(['Try our new app!', 'DRY RUB WINGS', 'PHP SDK', 'SAR'])('keeps 05/01/2026 and the month/day flag on a dollar receipt that says %s', async phrase => {
    recognize(`SYNTHETIC OFFICE STORE\n05/01/2026\n${phrase}\nTotal $25.00`);
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it('leaves the date blank when a C$ receipt says CALL US', async () => {
    recognize('MAPLE STORE\n05/01/2026\nCALL US\nTotal C$25.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('');
    expect(scanned.data?.dateOrderAssumed).toBeUndefined();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; deductionStatus?: string; dateOrderAssumed?: string; tax_review_required?: boolean };
    expect(saved.date).toBe('');
    expect(saved.amount).toBe(25);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.tax_review_required).toBe(true);
    expect(saved.dateOrderAssumed).toBeUndefined();
  });

  it('leaves the date blank when a euro symbol receipt says CONTACT US', async () => {
    recognize('CAFE PARIS\n05/01/2026\nCONTACT US\nTotal 25.00 €');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('');
    expect(scanned.data?.dateOrderAssumed).toBeUndefined();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; deductionStatus?: string; dateOrderAssumed?: string; tax_review_required?: boolean };
    expect(saved.date).toBe('');
    expect(saved.amount).toBe(25);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.tax_review_required).toBe(true);
    expect(saved.dateOrderAssumed).toBeUndefined();
  });

  it.each(['WINGS DRY RUB 12.99', 'DRY RUB 12.99', 'TRY-ME COMBO 8.00'])('keeps 05/01/2026 and the month/day flag when a dollar receipt lists %s', async item => {
    recognize(`DINER STORE\n05/01/2026\n${item}\nTotal $25.00`);
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it('leaves the date blank when EUR 12.50 is on a euro symbol receipt', async () => {
    recognize('CAFE PARIS\n05/01/2026\nEUR 12.50\nTotal 12.50 €');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('');
    expect(scanned.data?.dateOrderAssumed).toBeUndefined();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; deductionStatus?: string; dateOrderAssumed?: string; tax_review_required?: boolean };
    expect(saved.date).toBe('');
    expect(saved.amount).toBe(12.5);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.tax_review_required).toBe(true);
    expect(saved.dateOrderAssumed).toBeUndefined();
  });

  it('leaves the date blank for TOTAL EUR 12.50 when the receipt has no dollar', async () => {
    recognize('CAFE PARIS\n05/01/2026\nTOTAL EUR 12.50\nTotal 12.50');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('');
    expect(scanned.data?.dateOrderAssumed).toBeUndefined();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; deductionStatus?: string; tax_review_required?: boolean };
    expect(saved.date).toBe('');
    expect(saved.amount).toBe(12.5);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.tax_review_required).toBe(true);
    expect(saved.dateOrderAssumed).toBeUndefined();
  });

  it('keeps the date and the flag when TOTAL TRY 45.00 shares the receipt with a bare dollar', async () => {
    recognize('BAZAAR STORE\n05/01/2026\nTOTAL TRY 45.00\nSnack $8.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(8);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it('leaves the date blank for C $25.00', async () => {
    recognize('MAPLE STORE\n05/01/2026\nC $25.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('');
    expect(scanned.data?.dateOrderAssumed).toBeUndefined();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; deductionStatus?: string; dateOrderAssumed?: string };
    expect(saved.date).toBe('');
    expect(saved.amount).toBe(25);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.dateOrderAssumed).toBeUndefined();
  });

  it('does not treat kr inside Krispy as a currency', async () => {
    recognize('Krispy STORE\n05/01/2026\nTotal 25.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });
});
