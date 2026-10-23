import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';

const worker = vi.hoisted(() => ({ recognize: vi.fn(), terminate: vi.fn() }));
const rows = vi.hoisted(() => new Map<string, Record<string, unknown>>());
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
import { safeTaxYear, safeYMD } from '@/lib/schedule-c/taxDate';
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

function isFieldDelete(value: unknown): boolean {
  return value instanceof FieldValue && value.constructor.name === 'DeleteTransform';
}

beforeEach(() => {
  rows.clear();
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
  mocks.createTransaction.mockImplementation(async (_uid, accountId, data: Record<string, unknown>) => {
    const saved = { ...data, userId: owner, account_id: accountId };
    if (typeof saved.trans_id === 'string') rows.set(saved.trans_id, saved);
    return { data: saved, error: null };
  });
  mocks.getTransaction.mockImplementation(async (_uid: string, id: string) => ({ data: rows.get(id) ?? null, error: null }));
  mocks.getTransactions.mockResolvedValue({ data: [], error: null });
  mocks.updateTransaction.mockImplementation(async (_uid: string, id: string, updates: Record<string, unknown>) => {
    const current = { ...(rows.get(id) ?? { trans_id: id }) };
    for (const [key, value] of Object.entries(updates)) {
      if (isFieldDelete(value)) delete current[key];
      else current[key] = value;
    }
    rows.set(id, current);
    return { data: [current], error: null };
  });
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
    const written = mocks.createTransaction.mock.calls[0][2] as { amount: number; date: string; deductionStatus?: string; statusReason?: string; trans_id: string };
    expect(written.amount).toBe(25);
    expect(written.date).toBe('');
    expect(written.date).not.toBe(today);
    expect(written.date).not.toBe(fileDay);
    expect(written).not.toHaveProperty('tax_year');
    expect(written).not.toHaveProperty('taxYear');
    expect(placeReceiptDate(written.date)).toEqual({ date: '', taxYear: null, status: 'Needs more information', statusReason: 'unreadable_date' });
    expect(written.deductionStatus).toBe('Needs more information');
    expect(written.statusReason).toBe('unreadable_date');

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
    const payload = mocks.updateTransaction.mock.calls[0][2] as Record<string, unknown>;
    expect(payload.date).toBe('2025-12-01');
    expect(isFieldDelete(payload.deductionStatus)).toBe(true);
    expect(isFieldDelete(payload.statusReason)).toBe(true);
    expect(rows.get(written.trans_id)?.deductionStatus).toBeUndefined();
    expect(rows.get(written.trans_id)?.statusReason).toBeUndefined();
    expect(safeTaxYear(rows.get(written.trans_id)?.date)).toBe(2025);
    const after = summarizeReceiptYears([{ amount: written.amount, date: '2025-12-01' }]);
    expect(after.needsMoreInformation).toEqual({ label: 'Needs more information', count: 0, amount: 0 });
    expect(after.years.get(2025)).toEqual({ count: 1, amount: 25 });
    expect(placeReceiptDate('2025-12-01')).toEqual({ date: '2025-12-01', taxYear: 2025, status: null });
    expect(safeYMD('2025/13/01')).toBeNull();
  });

  it('saves 12/1/2025 with no date while the clock is frozen in 2026, then files the user date in 2025', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-04T15:00:00.000Z'));
    try {
      const file = new File([PNG], 'receipt.png', { type: 'image/png' });
      const frozen = new Date();
      const todayIso = frozen.toISOString().slice(0, 10);
      const todayLocal = localDay(frozen);
      const fileIso = new Date(file.lastModified).toISOString().slice(0, 10);
      const fileLocal = localDay(new Date(file.lastModified));
      expect(todayIso).toBe('2026-07-04');
      expect(todayIso.startsWith('2026-')).toBe(true);

      const body = new FormData();
      body.append('file', file);
      body.append('mode', 'commit');
      const response = await POST(new NextRequest('https://staging.example/api/receipts/process', { method: 'POST', body }));

      expect(response.status).toBe(200);
      const written = mocks.createTransaction.mock.calls[0][2] as {
        amount: number; date: string; deductionStatus?: string; statusReason?: string; trans_id: string; tax_year?: unknown; taxYear?: unknown;
      };
      const uploadedAt = mocks.receiptCreate.mock.calls.map(call => (call[1] as { uploadedAt?: Date }).uploadedAt).find(Boolean) as Date;
      const uploadIso = uploadedAt.toISOString().slice(0, 10);
      const uploadLocal = localDay(uploadedAt);
      expect(uploadIso).toBe('2026-07-04');

      expect(written.amount).toBe(25);
      expect(written.date).toBe('');
      expect(written.date).not.toBe(todayIso);
      expect(written.date).not.toBe(todayLocal);
      expect(written.date).not.toBe(fileIso);
      expect(written.date).not.toBe(fileLocal);
      expect(written.date).not.toBe(uploadIso);
      expect(written.date).not.toBe(uploadLocal);
      expect(written).not.toHaveProperty('tax_year');
      expect(written).not.toHaveProperty('taxYear');
      expect(written.deductionStatus).toBe('Needs more information');
      expect(written.statusReason).toBe('unreadable_date');

      const update = await PUT(new NextRequest('https://staging.example/api/receipts/process', {
        method: 'PUT',
        body: JSON.stringify({ transactionId: written.trans_id, updates: { date: '2025-12-01' } }),
      }));
      expect(update.status).toBe(200);
      const payload = mocks.updateTransaction.mock.calls.at(-1)?.[2] as Record<string, unknown>;
      expect(payload.date).toBe('2025-12-01');
      expect(isFieldDelete(payload.deductionStatus)).toBe(true);
      expect(isFieldDelete(payload.statusReason)).toBe(true);
      const stored = rows.get(written.trans_id);
      expect(stored?.deductionStatus).toBeUndefined();
      expect(stored?.statusReason).toBeUndefined();
      expect(stored?.date).toBe('2025-12-01');
      expect(safeTaxYear(stored?.date)).toBe(2025);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an AI Needs more information status when the reason is not the date', async () => {
    rows.set('ai-held', {
      trans_id: 'ai-held', amount: 12, date: '', deductionStatus: 'Needs more information', statusReason: 'missing_business_purpose',
    });
    const update = await PUT(new NextRequest('https://staging.example/api/receipts/process', {
      method: 'PUT',
      body: JSON.stringify({ transactionId: 'ai-held', updates: { date: '2025-12-01' } }),
    }));
    expect(update.status).toBe(200);
    const payload = mocks.updateTransaction.mock.calls.at(-1)?.[2] as Record<string, unknown>;
    expect(payload).toEqual({ date: '2025-12-01' });
    expect(rows.get('ai-held')?.deductionStatus).toBe('Needs more information');
    expect(rows.get('ai-held')?.statusReason).toBe('missing_business_purpose');
    expect(safeTaxYear(rows.get('ai-held')?.date)).toBe(2025);
  });

  it('keeps an older Needs more information row that has no statusReason', async () => {
    rows.set('older-held', { trans_id: 'older-held', amount: 9, date: '', deductionStatus: 'Needs more information' });
    const update = await PUT(new NextRequest('https://staging.example/api/receipts/process', {
      method: 'PUT',
      body: JSON.stringify({ transactionId: 'older-held', updates: { date: '2025-12-01' } }),
    }));
    expect(update.status).toBe(200);
    const payload = mocks.updateTransaction.mock.calls.at(-1)?.[2] as Record<string, unknown>;
    expect(payload).toEqual({ date: '2025-12-01' });
    expect(rows.get('older-held')?.deductionStatus).toBe('Needs more information');
    expect(rows.get('older-held')?.statusReason).toBeUndefined();
    expect(safeTaxYear(rows.get('older-held')?.date)).toBe(2025);
  });
});

function localDay(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
