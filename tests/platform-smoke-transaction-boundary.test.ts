import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn(), correction: vi.fn() }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'owner' }, error: null }) }));
vi.mock('@/lib/firebase/transactions-server', () => ({
  updateTransactionServerWithUserId: state.update, createTransactionServer: state.create,
  getTransactionsServer: vi.fn(), getTransactionServer: async () => ({ data: { is_deductible: false, deduction_score: 0 }, error: null }),
}));
vi.mock('@/lib/ai/learning-engine', () => ({ aiLearningEngine: { recordCorrection: state.correction } }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));
import { PUT as updateId } from '../app/api/transactions/[id]/route';
import { PUT as updateDatabase, POST as createDatabase } from '../app/api/database/transactions/route';
const wrappers = [
  (updates: unknown) => updateId(new NextRequest('http://localhost/api/transactions/fixture', { method: 'PUT', body: JSON.stringify(updates) }), { params: Promise.resolve({ id: 'fixture' }) }),
  (updates: unknown) => updateDatabase(new NextRequest('http://localhost/api/database/transactions', { method: 'PUT', body: JSON.stringify({ transactionId: 'fixture', updates }) })),
];
beforeEach(() => { vi.clearAllMocks(); state.update.mockImplementation(async (_uid, _id, updates) => ({ data: [{ userId: 'owner', trans_id: 'fixture', ...updates }], error: null })); state.create.mockResolvedValue({ data: {}, error: null }); });
describe('transaction API ownership and update boundaries', () => {
  for (const [index, update] of wrappers.entries()) {
    describe(`route ${index + 1}`, () => {
      it.each([{ userId: 'other' }, { user_id: 'other' }, { account_id: 'other' }, { trans_id: 'other' }, { amount: 1000000 }, { ai_analysis: 'Forged analysis' }, { notes: { userId: 'other' } }, { is_deductible: 'yes' }, { deduction_score: 2 }, { mileage_details: { miles: -1 } }, null, []])('rejects uneditable or malformed fields %s before Admin writes', async updates => {
        expect((await update(updates)).status).toBe(400); expect(state.update).not.toHaveBeenCalled();
      });
      it.each([true, false, null])('keeps supported classification %s and trusted ownership', async isDeductible => {
        expect((await update({ is_deductible: isDeductible, notes: 'Owner note' })).status).toBe(200);
        expect(state.update).toHaveBeenCalledWith('owner', 'fixture', { is_deductible: isDeductible, notes: 'Owner note' });
      });
      it('supports receipt unlinking and structured user context without unknown fields', async () => {
        expect((await update({ receipt_url: null, receipt_filename: '', business_purpose: 'Client work', attendees: ['Client'], equipment_details: { business_use_percentage: 80 } })).status).toBe(200);
        expect(state.update).toHaveBeenCalledWith('owner', 'fixture', expect.objectContaining({ receipt_url: '', receipt_filename: '', attendees: ['Client'] }));
      });
    });
  }
  it('single-transaction update normalizes the returned record and learning input', async () => {
    const result = await wrappers[0]({ is_deductible: true, deduction_score: 0 });
    expect((await result.json()).transaction).toMatchObject({ trans_id: 'fixture', deduction_score: 0 });
    expect(state.correction.mock.calls[0][2]).toMatchObject({ trans_id: 'fixture', deduction_score: 0 });
  });
  it.each(['userId', 'user_id'])('legacy create rejects injected %s ownership aliases', async field => {
    const response = await createDatabase(new NextRequest('http://localhost/api/database/transactions', { method: 'POST', body: JSON.stringify({ trans_id: 'fixture', account_id: 'manual', merchant_name: 'Synthetic', amount: 10, date: '2026-09-15', [field]: 'other' }) }));
    expect(response.status).toBe(400); expect(state.create).not.toHaveBeenCalled();
  });
  it('legacy creation retains a valid owner-scoped transaction', async () => {
    const body = { trans_id: 'fixture', account_id: 'manual', merchant_name: 'Synthetic', amount: 10, date: '2026-09-15' };
    expect((await createDatabase(new NextRequest('http://localhost/api/database/transactions', { method: 'POST', body: JSON.stringify(body) }))).status).toBe(200);
    expect(state.create).toHaveBeenCalledWith('owner', 'manual', body);
  });
});
