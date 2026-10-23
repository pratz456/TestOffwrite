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
import { POST } from '../app/api/receipts/process/route';
import { resetRateLimitStore } from './fixtures/rate-limit-store';

const normalizeDateToISO = (value: unknown) =>
  (receiptProcessor as unknown as { normalizeDateToISO(dateLike: unknown): string | null }).normalizeDateToISO(value);
const extractDate = (text: string) =>
  (receiptProcessor as unknown as { extractDate(text: string): string }).extractDate(text);

const owner = 'receipt-parsed-date-owner';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const KEPT: Array<[string, string]> = [
  ['01/15/2026', '2026-01-15'],
  ['1/1/2026', '2026-01-01'],
  ['Jan 1, 2026', '2026-01-01'],
  ['January 15, 2026', '2026-01-15'],
  ['1/15/26', '2026-01-15'],
  ['2026-1-5', '2026-01-05'],
  ['Dec 31, 2026', '2026-12-31'],
  ['01/02/2026', '2026-01-02'],
  ['Sept 5, 2026', '2026-09-05'],
  ['SEPT. 5, 2026', '2026-09-05'],
  ['sept. 5, 2026', '2026-09-05'],
  ['Jan. 1, 2026', '2026-01-01'],
  ['Jan 5 2026', '2026-01-05'],
  ['JAN 5 2026', '2026-01-05'],
  ['January 5 2026', '2026-01-05'],
  ['Sep 5 2026', '2026-09-05'],
  ['Sept 5 2026', '2026-09-05'],
  ['SEPT 5 2026', '2026-09-05'],
  ['Jan 5, 26', '2026-01-05'],
  ['Sept 5, 26', '2026-09-05'],
  ['5 Jan 2026', '2026-01-05'],
  ['5 Jan. 2026', '2026-01-05'],
  ['5 Sept 2026', '2026-09-05'],
  ['5 Sept. 2026', '2026-09-05'],
  ['05 January 2026', '2026-01-05'],
  ['05 January. 2026', '2026-01-05'],
  ['01-15-2026', '2026-01-15'],
  ['01-15-26', '2026-01-15'],
  ['1-5-2026', '2026-01-05'],
  ['12-31-2026', '2026-12-31'],
];
const ISO_TIMESTAMPS: Array<[string, string, string]> = [
  ['Paid 2026-01-15T10:00:00Z', '2026-01-15T10:00:00Z', '2026-01-15'],
  ['2012-01-15T09:00:00', '2012-01-15T09:00:00', '2012-01-15'],
];
const STREET: Array<[string, string]> = [
  ['Jan. 5, 2026', '2026-01-05'],
  ['Jan. 1, 2026', '2026-01-01'],
  ['Sep. 5, 2026', '2026-09-05'],
  ['Sept. 5, 2026', '2026-09-05'],
  ['SEPT. 5, 2026', '2026-09-05'],
  ['sept. 5, 2026', '2026-09-05'],
  ['5 Jan. 2026', '2026-01-05'],
  ['5 Sept. 2026', '2026-09-05'],
  ['05 January. 2026', '2026-01-05'],
  ['5 Jan 2026', '2026-01-05'],
  ['5 Sept 2026', '2026-09-05'],
  ['05 January 2026', '2026-01-05'],
  ['Jan 5 2026', '2026-01-05'],
  ['JAN 5 2026', '2026-01-05'],
  ['January 5 2026', '2026-01-05'],
  ['Sep 5 2026', '2026-09-05'],
  ['Sept 5 2026', '2026-09-05'],
  ['SEPT 5 2026', '2026-09-05'],
  ['Sept 5, 2026', '2026-09-05'],
  ['Jan 5, 26', '2026-01-05'],
  ['Sept 5, 26', '2026-09-05'],
  ['01-15-2026', '2026-01-15'],
  ['01-15-26', '2026-01-15'],
  ['1-5-2026', '2026-01-05'],
  ['12-31-2026', '2026-12-31'],
  ['Paid 2026-01-15T10:00:00Z', '2026-01-15'],
  ['2012-01-15T09:00:00', '2012-01-15'],
];
const REFUSED = ['02/30/2026', '13/01/2026', 'garbage'];

function reference(path: string): object {
  return {
    path,
    collection: (name: string) => reference(`${path}/${name}`),
    doc: (name: string) => reference(`${path}/${name}`),
    create: (data: unknown) => mocks.receiptCreate(path, data),
    delete: () => mocks.receiptDelete(path),
  };
}
function receiptText(line: string) {
  return `SYNTHETIC OFFICE STORE\n${line}\nOffice supplies $25.00\nTOTAL $25.00\nTEST RECEIPT - NO PURCHASE`;
}
function streetReceipt(input: string) {
  return `STORE NAME\n123 Main St\nDate: ${input}\nTotal $12.34`;
}
function recognized(line: string) {
  worker.recognize.mockResolvedValue({ data: { text: receiptText(line), confidence: 95 } });
}
function request() {
  const body = new FormData();
  body.append('file', new File([PNG], 'receipt.png', { type: 'image/png' }));
  return new NextRequest('https://staging.example/api/receipts/process', { method: 'POST', body });
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
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('written receipt dates are read by parts', () => {
  it.each(KEPT)('normalizes %s to %s', (input, iso) => {
    expect(normalizeDateToISO(input)).toBe(iso);
  });

  it.each(['02/30/2026', '13/01/2026', 'garbage', '', '2026-01-15abc', '2026-01-15T25:00:00', '02-30-2026'])('normalizes %s to null', input => {
    expect(normalizeDateToISO(input)).toBeNull();
  });

  it('keeps the written day of an offset timestamp', () => {
    expect(normalizeDateToISO('2026-01-15T23:30:00-08:00')).toBe('2026-01-15');
  });

  it('reads a leading four digit year as ISO, not as a hyphen month', () => {
    expect(normalizeDateToISO('2026-01-15')).toBe('2026-01-15');
    expect(normalizeDateToISO('2012-01-15')).toBe('2012-01-15');
    expect(normalizeDateToISO('12-01-15')).toBe('2015-12-01');
  });

  it('keeps Jan 1, 2026 when a Tokyo Date parse would move it to the previous year', () => {
    expect(normalizeDateToISO('Jan 1, 2026')).toBe('2026-01-01');
    if (process.env.TZ === 'Asia/Tokyo') {
      expect(new Date('Jan 1, 2026').toISOString().slice(0, 10)).toBe('2025-12-31');
    }
  });

  it.each(ISO_TIMESTAMPS)('keeps the ISO day for %s', async (line, extracted, iso) => {
    expect(extractDate(receiptText(line))).toBe(extracted);
    expect(normalizeDateToISO(extracted)).toBe(iso);
    recognized(line);
    const result = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ merchant: 'SYNTHETIC OFFICE STORE', amount: 25, date: iso });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({
      merchant_name: 'SYNTHETIC OFFICE STORE', amount: 25, date: iso,
    }));
    expect((await response.json()).transaction.date).toBe(iso);
  });

  it.each(KEPT)('reads %s from OCR as %s', async (input, iso) => {
    recognized(input);
    const result = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ merchant: 'SYNTHETIC OFFICE STORE', amount: 25, date: iso });
  });

  it.each(REFUSED)('leaves OCR text %s without a date', async input => {
    recognized(input);
    const result = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(result.success).toBe(true);
    expect(result.data?.date).toBe('');
  });

  it('leaves a receipt with no date blank instead of using today', async () => {
    worker.recognize.mockResolvedValue({ data: {
      text: 'SYNTHETIC OFFICE STORE\nOffice supplies $25.00\nTOTAL $25.00',
      confidence: 95,
    } });
    const result = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(result.data?.date).toBe('');
  });
});

describe('OCR save uses the printed calendar day', () => {
  it.each(KEPT)('saves %s as %s', async (input, iso) => {
    recognized(input);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({
      merchant_name: 'SYNTHETIC OFFICE STORE', amount: 25, date: iso,
    }));
    expect((await response.json()).transaction.date).toBe(iso);
  });

  it.each(STREET)('saves the printed day for %s from a street receipt', async (input, iso) => {
    const text = streetReceipt(input);
    const extracted = extractDate(text);
    expect(text.includes(extracted)).toBe(true);
    expect(normalizeDateToISO(extracted)).toBe(iso);
    worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({
      merchant_name: 'STORE NAME', amount: 12.34, date: iso,
    }));
    expect((await response.json()).transaction.date).toBe(iso);
  });

  it.each(REFUSED)('refuses to save OCR text %s', async input => {
    recognized(input);
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'Enter a real receipt date before saving' });
    expect(mocks.createTransaction).not.toHaveBeenCalled();
    expect(mocks.storageSave).not.toHaveBeenCalled();
  });

  it('refuses a receipt that has no date', async () => {
    worker.recognize.mockResolvedValue({ data: {
      text: 'SYNTHETIC OFFICE STORE\nOffice supplies $25.00\nTOTAL $25.00',
      confidence: 95,
    } });
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'Enter a real receipt date before saving' });
    expect(mocks.createTransaction).not.toHaveBeenCalled();
  });
});
