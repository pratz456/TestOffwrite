import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ update: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'owner' }, error: null }) }));
vi.mock('@/lib/firebase/transactions-server', () => ({
  updateTransactionServerWithUserId: state.update,
  getTransactionServer: state.get,
  createTransactionServer: vi.fn(),
  getTransactionsServer: vi.fn(),
}));
vi.mock('@/lib/firebase/admin', () => ({ adminApp: { name: 'firebase-frameworks' }, adminDb: { collection: vi.fn(), runTransaction: vi.fn() } }));
vi.mock('@/lib/ocr/receipt-processor', () => ({ receiptProcessor: { processReceipt: vi.fn(), inferReceiptDirectionFromText: () => ({ direction: 'expense', confidence: 0.9 }), findMatchingTransactions: vi.fn() } }));
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: vi.fn(), app: { options: {} } }) }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('@/lib/ai/learning-engine', () => ({ aiLearningEngine: { recordCorrection: vi.fn() } }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: vi.fn() }));
vi.mock('@/lib/ai/analyzeTransaction', () => ({ analyzeTransactionWithRetry: vi.fn(), convertToEnhancedContext: vi.fn() }));

import { PUT as receiptPut } from '../app/api/receipts/process/route';
import { PUT as transactionPut } from '../app/api/transactions/[id]/route';
import { PUT as databasePut } from '../app/api/database/transactions/route';
import { filledAmountUpdate, transactionUpdatesInput } from '../lib/transactions/client-updates';
import { NULL_AMOUNT_DEDUCTION_MESSAGE } from '../lib/transactions/tax-decision';

const routes = [
  (updates: unknown) => receiptPut(new NextRequest('https://staging.example/api/receipts/process', { method: 'PUT', body: JSON.stringify({ transactionId: 'tx', updates }) })),
  (updates: unknown) => transactionPut(new NextRequest('http://localhost/api/transactions/tx', { method: 'PUT', body: JSON.stringify(updates) }), { params: Promise.resolve({ id: 'tx' }) }),
  (updates: unknown) => databasePut(new NextRequest('http://localhost/api/database/transactions', { method: 'PUT', body: JSON.stringify({ transactionId: 'tx', updates }) })),
];

beforeEach(() => {
  vi.clearAllMocks();
  state.get.mockResolvedValue({ data: { trans_id: 'tx', amount: 40 }, error: null });
  state.update.mockResolvedValue({ data: [{ trans_id: 'tx', amount: 12.5, amountNeedsReview: false }], error: null });
});

describe('filling a blank saved amount', () => {
  it('accepts a positive amount in the editable field schema and still rejects ownership fields', () => {
    expect(transactionUpdatesInput.safeParse({ amount: 12.5 }).success).toBe(true);
    expect(transactionUpdatesInput.safeParse({ amount: 0 }).success).toBe(false);
    expect(transactionUpdatesInput.safeParse({ amount: -12.5 }).success).toBe(false);
    expect(transactionUpdatesInput.safeParse({ userId: 'other' }).success).toBe(false);
    expect(filledAmountUpdate(null, { amount: 12.5 })).toEqual({ amount: 12.5, amountNeedsReview: false });
    expect(filledAmountUpdate(40, { amount: 12.5 })).toBeNull();
    expect(filledAmountUpdate(undefined, { notes: 'kept' })).toEqual({ notes: 'kept' });
  });

  it.each(routes.map((update, index) => [index + 1, update] as const))('route %s saves a positive amount only while the saved amount is null and clears review', async (_index, update) => {
    state.get.mockResolvedValue({ data: { trans_id: 'tx', amount: null, amountNeedsReview: true }, error: null });
    const saved = await update({ amount: 12.5 });
    expect(saved.status).toBe(200);
    expect(state.update).toHaveBeenCalledWith('owner', 'tx', { amount: 12.5, amountNeedsReview: false });

    state.update.mockClear();
    state.get.mockResolvedValue({ data: { trans_id: 'tx', amount: 40 }, error: null });
    expect((await update({ amount: 1000 })).status).toBe(400);
    expect(state.update).not.toHaveBeenCalled();
  });

  it.each(routes.map((update, index) => [index + 1, update] as const))('route %s returns the blank amount message instead of confirming', async (_index, update) => {
    state.update.mockResolvedValue({ data: null, error: new Error(NULL_AMOUNT_DEDUCTION_MESSAGE) });
    const response = await update({ is_deductible: true });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: NULL_AMOUNT_DEDUCTION_MESSAGE });
  });
});
