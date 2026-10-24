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
import { transactionTaxYear } from '@/lib/ai/transaction-tax-policy';
import type { TransactionInput } from '@/lib/ai/analyzeTransaction';
import { receiptProcessor } from '@/lib/ocr/receipt-processor';
import { POST } from '../app/api/receipts/process/route';
import { resetRateLimitStore } from './fixtures/rate-limit-store';

const owner = 'receipt-day-month-name-owner';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const READ: Array<[string, string]> = [
  ['01-May-2026', '2026-05-01'],
  ['1-May-2026', '2026-05-01'],
  ['01-MAY-26', '2026-05-01'],
  ['01-Sept-2026', '2026-09-01'],
];
const YEAR_END: Array<[string, string, string]> = [
  ['28-Dec-2026', '2027-01-03T18:00:00Z', 'America/Los_Angeles'],
  ['28-Dec-2026', '2027-01-03T18:00:00Z', 'Asia/Tokyo'],
  ['28-Dec-2026', '2027-01-03T14:00:00Z', 'America/Los_Angeles'],
  ['28-Dec-2026', '2027-01-03T14:00:00Z', 'Asia/Tokyo'],
  ['28-DEC-26', '2027-01-03T18:00:00Z', 'America/Los_Angeles'],
  ['28-DEC-26', '2027-01-03T18:00:00Z', 'Asia/Tokyo'],
  ['28-DEC-26', '2027-01-03T14:00:00Z', 'America/Los_Angeles'],
  ['28-DEC-26', '2027-01-03T14:00:00Z', 'Asia/Tokyo'],
];

function reference(path: string): object {
  return {
    path,
    collection: (name: string) => reference(`${path}/${name}`),
    doc: (name: string) => reference(`${path}/${name}`),
    create: (data: unknown) => mocks.receiptCreate(path, data),
    delete: () => mocks.receiptDelete(path),
  };
}

function request(text: string, uploadTimeZone = 'Pacific/Kiritimati') {
  worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
  const body = new FormData();
  body.append('file', new File([PNG], 'receipt.png', { type: 'image/png' }));
  body.append('uploadTimeZone', uploadTimeZone);
  return new NextRequest('https://staging.example/api/receipts/process', { method: 'POST', body });
}

async function save(text: string, uploadTimeZone?: string) {
  const response = await POST(request(text, uploadTimeZone));
  const body = await response.json();
  const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as {
    amount: number;
    date: string;
    deductionStatus?: string;
    tax_review_required?: boolean;
    dateOrderAssumed?: string;
    uploadTimeZone?: string;
    year?: unknown;
    taxYear?: unknown;
    tax_year?: unknown;
  };
  return { response, body, saved };
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

describe('day month name year receipts', () => {
  it.each(READ)('saves %s as %s', async (printed, iso) => {
    const { response, body, saved } = await save(`CORNER STORE\n${printed}\nTOTAL $12.50`);
    expect(response.status).toBe(200);
    expect(saved.date).toBe(iso);
    expect(saved.amount).toBe(12.5);
    expect(saved.deductionStatus).toBeUndefined();
    expect(saved.tax_review_required).toBeUndefined();
    expect(saved.dateOrderAssumed).toBeUndefined();
    expect(saved.uploadTimeZone).toBe('Pacific/Kiritimati');
    expect(body.transaction.date).toBe(iso);
    expect(body.transaction.deductionStatus).toBeUndefined();
  });

  it('leaves 31-Apr-2026 blank and asks for more information', async () => {
    const { response, body, saved } = await save('CORNER STORE\n31-Apr-2026\nTOTAL $12.50');
    expect(response.status).toBe(200);
    expect(saved.date).toBe('');
    expect(saved.date).not.toBe('2026-05-01');
    expect(saved.amount).toBe(12.5);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.tax_review_required).toBe(true);
    expect(saved.dateOrderAssumed).toBeUndefined();
    expect(saved.year).toBeUndefined();
    expect(saved.taxYear).toBeUndefined();
    expect(saved.tax_year).toBeUndefined();
    expect(saved.uploadTimeZone).toBe('Pacific/Kiritimati');
    expect(JSON.stringify(saved)).not.toContain('2026-05-01');
    expect(body.transaction.date).toBe('');
    expect(body.transaction.deductionStatus).toBe('Needs more information');
    expect(body.transaction.tax_review_required).toBe(true);
  });

  it('leaves 01-Mai-2026 blank and asks for more information', async () => {
    const { response, body, saved } = await save('CORNER STORE\n01-Mai-2026\nTOTAL $12.50');
    expect(response.status).toBe(200);
    expect(saved.date).toBe('');
    expect(saved.amount).toBe(12.5);
    expect(saved.deductionStatus).toBe('Needs more information');
    expect(saved.tax_review_required).toBe(true);
    expect(saved.dateOrderAssumed).toBeUndefined();
    expect(saved.year).toBeUndefined();
    expect(saved.taxYear).toBeUndefined();
    expect(saved.tax_year).toBeUndefined();
    expect(saved.uploadTimeZone).toBe('Pacific/Kiritimati');
    expect(body.transaction.date).toBe('');
    expect(body.transaction.deductionStatus).toBe('Needs more information');
    expect(body.transaction.tax_review_required).toBe(true);
  });

  it('saves an ISO date 2026-05-01 without a month day flag', async () => {
    const { response, saved } = await save('CORNER STORE\n2026-05-01\nTOTAL $12.50');
    expect(response.status).toBe(200);
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(12.5);
    expect(saved.dateOrderAssumed).toBeUndefined();
    expect(saved.deductionStatus).toBeUndefined();
    expect(saved.tax_review_required).toBeUndefined();
    expect(saved.uploadTimeZone).toBe('Pacific/Kiritimati');
  });

  it('saves May 1, 2026 without a month day flag', async () => {
    const { response, saved } = await save('CORNER STORE\nMay 1, 2026\nTOTAL $12.50');
    expect(response.status).toBe(200);
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(12.5);
    expect(saved.dateOrderAssumed).toBeUndefined();
    expect(saved.deductionStatus).toBeUndefined();
    expect(saved.tax_review_required).toBeUndefined();
    expect(saved.uploadTimeZone).toBe('Pacific/Kiritimati');
  });

  it('saves 05/01/2026 as month then day', async () => {
    const { response, saved } = await save('CORNER STORE\n05/01/2026\nTOTAL $12.50');
    expect(response.status).toBe(200);
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(12.5);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
    expect(saved.tax_review_required).toBeUndefined();
    expect(saved.uploadTimeZone).toBe('Pacific/Kiritimati');
  });

  it('keeps 05/01/2026 when the line is TAX A $0.33', async () => {
    const { response, saved } = await save('GROCERY\n05/01/2026\nTAX A $0.33');
    expect(response.status).toBe(200);
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(0.33);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
    expect(saved.tax_review_required).toBeUndefined();
    expect(saved.uploadTimeZone).toBe('Pacific/Kiritimati');
  });

  it('keeps 05/01/2026 when the line is BANANAS A $0.59', async () => {
    const { response, saved } = await save('GROCERY\n05/01/2026\nBANANAS A $0.59');
    expect(response.status).toBe(200);
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(0.59);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
    expect(saved.tax_review_required).toBeUndefined();
    expect(saved.uploadTimeZone).toBe('Pacific/Kiritimati');
  });

  it('keeps 05/01/2026 when the receipt says DRY RUB', async () => {
    const { response, saved } = await save('SYNTHETIC OFFICE STORE\n05/01/2026\nDRY RUB\nTotal $25.00');
    expect(response.status).toBe(200);
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(25);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
    expect(saved.tax_review_required).toBeUndefined();
    expect(saved.uploadTimeZone).toBe('Pacific/Kiritimati');
  });

  it.each(YEAR_END)('saves %s uploaded at %s in %s as 2026-12-28 in tax year 2026', async (printed, instant, zone) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instant));
    expect(new Date().toISOString()).toBe(new Date(instant).toISOString());
    const { response, body, saved } = await save(`CORNER STORE\n${printed}\nTOTAL $12.50`, zone);
    const taxed = transactionTaxYear({ date: saved.date } as TransactionInput);
    expect(response.status).toBe(200);
    expect(saved.date).toBe('2026-12-28');
    expect(saved.date).not.toBe('2027-01-03');
    expect(saved.amount).toBe(12.5);
    expect(taxed).toBe(2026);
    expect(saved.deductionStatus).toBeUndefined();
    expect(saved.tax_review_required).toBeUndefined();
    expect(saved.dateOrderAssumed).toBeUndefined();
    expect(saved.uploadTimeZone).toBe(zone);
    expect(body.transaction.date).toBe('2026-12-28');
    expect(transactionTaxYear({ date: body.transaction.date } as TransactionInput)).toBe(2026);
  });

  it('keeps 05/01/2026 when the receipt says CALL US', async () => {
    const { response, saved } = await save('MAPLE STORE\n05/01/2026\nCALL US\nTotal C$25.00');
    expect(response.status).toBe(200);
    expect(saved.date).toBe('2026-05-01');
    expect(saved.amount).toBe(25);
    expect(saved.dateOrderAssumed).toBe('month_day');
    expect(saved.deductionStatus).toBeUndefined();
    expect(saved.tax_review_required).toBeUndefined();
    expect(saved.uploadTimeZone).toBe('Pacific/Kiritimati');
  });
});
