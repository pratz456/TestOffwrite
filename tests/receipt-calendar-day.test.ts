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

  it('keeps 05/01/2026 and the saved month/day flag when a rupee symbol is not on the total line', async () => {
    recognize('DELHI STORE\n05/01/2026\nTotal 25.00\n₹');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(25);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
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

  it('keeps 05/01/2026 and the saved month/day flag when C$ touches the dollar and CALL US is the only other text', async () => {
    recognize('MAPLE STORE\n05/01/2026\nCALL US\nTotal C$25.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; deductionStatus?: string; dateOrderAssumed?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(25);
    expect(saved.deductionStatus).toBeUndefined();
    expect(saved.dateOrderAssumed).toBe('month_day');
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

  it('leaves an all caps lira receipt with TOTAL TRY 45.00 and no dollar in Needs more information', async () => {
    recognize('ISTANBUL MARKET\n05/01/2026\nEKMEK 12.00\nCAY 8.00\nAMOUNT 45.00\nTOTAL TRY 45.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('');
    expect(scanned.data?.dateOrderAssumed).toBeUndefined();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; deductionStatus?: string; dateOrderAssumed?: string; tax_review_required?: boolean };
    expect(saved.date).toBe('');
    expect(saved.amount).toBe(45);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.tax_review_required).toBe(true);
    expect(saved.dateOrderAssumed).toBeUndefined();
  });

  it('leaves a ruble receipt totaled as ИТОГО 1200 RUB in Needs more information', async () => {
    recognize('MOSCOW MARKET\n05/01/2026\nХЛЕБ 15.00\nSUBTOTAL 15.00\nИТОГО 1200 RUB');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('');
    expect(scanned.data?.dateOrderAssumed).toBeUndefined();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; deductionStatus?: string; dateOrderAssumed?: string; tax_review_required?: boolean };
    expect(saved.date).toBe('');
    expect(saved.amount).toBe(15);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.tax_review_required).toBe(true);
    expect(saved.dateOrderAssumed).toBeUndefined();
  });

  it.each([
    ['PEN 2.99', 'MAIN STREET DRUG\n05/01/2026\nPEN 2.99\nTOTAL 2.99', 2.99],
    ['GEL 6.99', 'BEAUTY COUNTER\n05/01/2026\nGEL 6.99\nTOTAL 6.99', 6.99],
    ['CUP 3.50', 'CORNER CAFE\n05/01/2026\nCUP 3.50\nTOTAL 3.50', 3.5],
    ['WINGS DRY RUB 12.99', 'WING HOUSE\n05/01/2026\nWINGS DRY RUB 12.99\nTOTAL 12.99', 12.99],
    ['TRY-ME COMBO 8.00', 'DINER COUNTER\n05/01/2026\nTRY-ME COMBO 8.00\nTOTAL 8.00', 8],
    ['GEL PEN 3.00', 'ART STORE\n05/01/2026\nGEL PEN 3.00\nTOTAL 3.00', 3],
  ])('keeps 05/01/2026 and the month/day flag when a receipt with no dollar lists %s', async (_item, text, amount) => {
    recognize(text);
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(amount);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it('keeps 05/01/2026 and the saved month/day flag when DRY RUB is repeated and the total has no code', async () => {
    recognize('WING HOUSE\n05/01/2026\nWINGS DRY RUB 12.99\nRIBS DRY RUB 18.99\nTOTAL 31.98');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(31.98);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it('keeps 05/01/2026 and the saved month/day flag when the total is 1,250.00', async () => {
    recognize('MARKET STORE\n05/01/2026\nFLOUR 400.00\nSUGAR 850.00\nTOTAL 1,250.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(1250);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it('keeps 05/01/2026 and the saved month/day flag when the same code is repeated on item lines', async () => {
    recognize('MOSCOW CAFE\n05/01/2026\nCOFFEE 120.00 RUB\nBREAD 80.00 RUB\nTOTAL 200.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(200);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it('leaves the date blank when 120,00 RUB pairs a code with a comma decimal', async () => {
    recognize('MOSCOW CAFE\n05/01/2026\nCOFFEE 120,00 RUB\nTOTAL 120.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('');
    expect(scanned.data?.dateOrderAssumed).toBeUndefined();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; deductionStatus?: string; dateOrderAssumed?: string; tax_review_required?: boolean };
    expect(saved.date).toBe('');
    expect(saved.amount).toBe(120);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.tax_review_required).toBe(true);
    expect(saved.dateOrderAssumed).toBeUndefined();
  });

  it('leaves the date blank when a ruble symbol and RUB are both present', async () => {
    recognize('MOSCOW CAFE\n05/01/2026\nCOFFEE 120 ₽\nBREAD 80 RUB\nTOTAL 200.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('');
    expect(scanned.data?.dateOrderAssumed).toBeUndefined();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; deductionStatus?: string; dateOrderAssumed?: string; tax_review_required?: boolean };
    expect(saved.date).toBe('');
    expect(saved.amount).toBe(200);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.tax_review_required).toBe(true);
    expect(saved.dateOrderAssumed).toBeUndefined();
  });

  it('keeps 05/01/2026 and the saved month/day flag for C $25.00', async () => {
    recognize('MAPLE STORE\n05/01/2026\nC $25.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(25);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it('keeps 05/01/2026 and the saved month/day flag for a lone euro item', async () => {
    recognize('WINE BAR\n05/01/2026\nWINE € 8.00\nTOTAL 8.00');
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

  it('keeps 05/01/2026 and the saved month/day flag for a lone kr item', async () => {
    recognize('CAFE NORD\n05/01/2026\nKAFFE 30.00 kr\nTOTAL 30.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(30);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it('leaves the date blank when a euro item agrees with TOTAL 12,50', async () => {
    recognize('CAFE PARIS\n05/01/2026\nWINE € 8.00\nTOTAL 12,50');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('');
    expect(scanned.data?.dateOrderAssumed).toBeUndefined();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; deductionStatus?: string; dateOrderAssumed?: string; tax_review_required?: boolean };
    expect(saved.date).toBe('');
    expect(saved.amount).toBe(12);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.tax_review_required).toBe(true);
    expect(saved.dateOrderAssumed).toBeUndefined();
  });

  it('leaves the date blank when the euro symbol is on the total line', async () => {
    recognize('CAFE PARIS\n05/01/2026\nWINE 8.00\nTOTAL 12.50 €');
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

  it('keeps 05/01/2026 and the saved month/day flag for TOTAL DUE ALL 12.50', async () => {
    recognize('OFFICE STORE\n05/01/2026\nTOTAL DUE ALL 12.50\nAMOUNT 12.50');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(12.5);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it('keeps 05/01/2026 and the saved month/day flag for TAX TOP 1.04', async () => {
    recognize('OFFICE STORE\n05/01/2026\nTAX TOP 1.04\nTOTAL 10.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(10);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it('keeps 05/01/2026 and the saved month/day flag when ALL 1.200 is the only text on its line', async () => {
    recognize('OFFICE STORE\n05/01/2026\nALL 1.200\nTOTAL 10.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(10);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it('keeps 05/01/2026 and the saved month/day flag when ALL 1.200 does not equal the total read from TOTAL 12,50', async () => {
    recognize('OFFICE STORE\n05/01/2026\nALL 1.200\nTOTAL 12,50');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(12);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it.each(['TRY', 'ALL', 'TOP'])('keeps 05/01/2026 and the saved month/day flag when %s 4.50 is not the total and a euro is on an item line', async code => {
    recognize(`US MARKET\n05/01/2026\n${code} 4.50\nSNACK € 2.00\nTOTAL 20.00`);
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(20);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it.each(['TRY', 'ALL', 'TOP'])('leaves the date blank when %s 4.50 equals the total and a euro is on an item line', async code => {
    recognize(`US MARKET\n05/01/2026\n${code} 4.50\nSNACK € 2.00\nTOTAL 4.50`);
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('');
    expect(scanned.data?.dateOrderAssumed).toBeUndefined();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; deductionStatus?: string; dateOrderAssumed?: string; tax_review_required?: boolean };
    expect(saved.date).toBe('');
    expect(saved.amount).toBe(4.5);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.tax_review_required).toBe(true);
    expect(saved.dateOrderAssumed).toBeUndefined();
  });

  it.each([
    ['TAX A $0.33', 'GROCERY\n05/01/2026\nTAX A $0.33', 0.33],
    ['BANANAS A $0.59', 'GROCERY\n05/01/2026\nBANANAS A $0.59', 0.59],
    ['2 C $1.50', 'GROCERY\n05/01/2026\n2 C $1.50', 1.5],
    ['ITEM R $2.00', 'GROCERY\n05/01/2026\nITEM R $2.00', 2],
    ['SUBTOTAL A $5.00', 'GROCERY\n05/01/2026\nSUBTOTAL A $5.00', 5],
    ['a flag letter followed by $ and then the total', 'GROCERY\n05/01/2026\nA $12.00', 12],
    ['A$ 12.00 alone', 'GROCERY\n05/01/2026\nA$ 12.00\nTOTAL 12.00', 12],
  ])('keeps 05/01/2026 and the saved month/day flag for %s', async (_label, text, amount) => {
    recognize(text);
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(amount);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it('leaves the date blank when A$12.00 TOTAL agrees with a second signal kind', async () => {
    recognize('GROCERY\n05/01/2026\nA$12.00\nAPPLES € 1.00\nTOTAL 12.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('');
    expect(scanned.data?.dateOrderAssumed).toBeUndefined();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; deductionStatus?: string; dateOrderAssumed?: string; tax_review_required?: boolean };
    expect(saved.date).toBe('');
    expect(saved.amount).toBe(12);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.tax_review_required).toBe(true);
    expect(saved.dateOrderAssumed).toBeUndefined();
  });

  it('keeps 05/01/2026 and the saved month/day flag for TRY OUR NEW', async () => {
    recognize('US MARKET\n05/01/2026\nTRY OUR NEW\nTOTAL 10.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(10);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
  });

  it('keeps 05/01/2026 and the saved month/day flag when TRY 4.50 is the only foreign signal', async () => {
    recognize('US MARKET\n05/01/2026\nTRY 4.50\nTOTAL 10.00');
    const scanned = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(scanned.data?.date).toBe('2026-05-01');
    expect(scanned.data?.dateOrderAssumed).toBe('month_day');
    const response = await POST(request());
    expect(response.status).toBe(200);
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string; amount: number; dateOrderAssumed?: string; deductionStatus?: string };
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(10);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
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
