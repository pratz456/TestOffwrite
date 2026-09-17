import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ record: {} as Record<string, any>, update: vi.fn(), queryGet: vi.fn(), accountsGet: vi.fn(), transactionsGet: vi.fn(), request: vi.fn(), cache: vi.fn(), owner: 'owner' }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: {
  collectionGroup: () => { const query = { where: () => query, limit: () => query, get: h.queryGet }; return query; },
  collection: () => ({ doc: () => ({ collection: () => ({ get: h.accountsGet, doc: () => ({ collection: () => ({ get: h.transactionsGet }) }) }) }) }),
} }));
vi.mock('@/lib/firebase/client', () => ({ db: {}, auth: { get currentUser() { return h.owner ? { uid: h.owner } : null; } } }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: h.request }));
vi.mock('@/lib/firebase/hooks', () => ({ queryKeys: { transactions: (uid: string) => ['transactions', uid], transaction: (id: string) => ['transaction', id], stats: (uid: string) => ['stats', uid] } }));
vi.mock('@tanstack/react-query', () => ({ useMutation: (options: unknown) => options, useQueryClient: () => ({ setQueryData: h.cache }) }));
import { updateTransactionServerWithUserId } from '../lib/firebase/transactions-server';
import { taxDecisionUpdate } from '../lib/transactions/tax-decision';
import { aggregateScheduleC } from '../lib/schedule-c/aggregate';
import { sumExpensesForQuarter, sumPotentialExpensesForQuarter } from '../lib/tax-provider/quarterly-estimates';
import { summarizeDashboardRecords } from '../lib/dashboard/record-summary';
import { convertTransactionsToCSV } from '../lib/reports/transaction-export';
import { transactionNeedsTaxReview } from '../lib/utils/transaction-tax-review';
import { useUpdateTransaction } from '../lib/firebase/mutations';

const docRef = { path: 'user_profiles/owner/accounts/account/transactions/tx', update: h.update, get: async () => ({ exists: true, data: () => h.record }) };
const doc = { id: 'tx', data: () => h.record, ref: docRef };
const args = { transactionId: 'tx', userId: 'owner', updates: { is_deductible: true } };
function MutationHarness() { return useUpdateTransaction() as unknown as { mutationFn: (value: typeof args) => Promise<Record<string, any>>; onSuccess: (saved: unknown, input: typeof args) => void }; }
beforeEach(() => {
  vi.clearAllMocks(); h.owner = 'owner';
  h.record = { trans_id: 'tx', userId: 'owner', account_id: 'account', amount: 100, date: '2026-09-16', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', is_deductible: null, review_status: 'confirmed', tax_review_required: true };
  h.update.mockImplementation(async patch => { h.record = { ...h.record, ...patch }; });
  h.queryGet.mockResolvedValue({ empty: false, docs: [doc] });
  h.accountsGet.mockResolvedValue({ size: 1, docs: [{ id: 'account' }] });
  h.transactionsGet.mockResolvedValue({ size: 1, docs: [doc] });
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('explicit tax decisions resolve server-owned review state', () => {
  it.each([true, false])('clears unresolved tax review only after an explicit saved %s decision', async decision => {
    const result = await updateTransactionServerWithUserId('owner', 'tx', { is_deductible: decision });
    expect(result.error).toBeNull(); expect(h.record.tax_review_required).toBe(false);
    expect(transactionNeedsTaxReview(h.record)).toBe(false);
    expect(aggregateScheduleC([h.record as any], '2026', undefined, { mode: 'confirmed-only' }).totalDeductible).toBe(decision ? 100 : 0);
  });
  it('stamps the server review decision so a post-cutoff record counts as confirmed', async () => {
    h.record = { ...h.record, review_status: undefined, created_at: new Date('2026-12-01T00:00:00Z') };
    expect(aggregateScheduleC([{ ...h.record, is_deductible: true, tax_review_required: false } as any], '2026', undefined, { mode: 'confirmed-only' }).totalDeductible).toBe(0);
    await updateTransactionServerWithUserId('owner', 'tx', { is_deductible: true });
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ review_status: 'confirmed', review_source: 'user_decision', reviewed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) }));
    expect(aggregateScheduleC([h.record as any], '2026', undefined, { mode: 'confirmed-only' }).totalDeductible).toBe(100);
  });
  it('applies the same state change through the account fallback lookup', async () => {
    h.queryGet.mockResolvedValue({ empty: true, docs: [] });
    const result = await updateTransactionServerWithUserId('owner', 'tx', { is_deductible: true });
    expect(result.error).toBeNull(); expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ is_deductible: true, tax_review_required: false, review_status: 'confirmed' }));
  });
  it('returns a deduction to review when the user clears its decision', async () => {
    h.record.is_deductible = true; h.record.tax_review_required = false;
    await updateTransactionServerWithUserId('owner', 'tx', { is_deductible: null });
    expect(h.record.tax_review_required).toBe(true); expect(transactionNeedsTaxReview(h.record)).toBe(true);
    expect(h.update.mock.calls[0][0]).not.toHaveProperty('review_status');
    expect(aggregateScheduleC([h.record as any], '2026', undefined, { mode: 'confirmed-only' }).totalDeductible).toBe(0);
  });
  it('notes-only updates preserve the existing unresolved tax flag', async () => {
    await updateTransactionServerWithUserId('owner', 'tx', { notes: 'Added the business purpose for later review.' });
    expect(h.record.tax_review_required).toBe(true); expect(h.update.mock.calls[0][0]).not.toHaveProperty('tax_review_required');
  });
  it.each([
    { category: 'EQUIPMENT_REVIEW_REQUIRED' }, { category: 'HOME_OFFICE_REVIEW_REQUIRED' },
    { category: 'VEHICLE_REVIEW_REQUIRED' }, { transaction_kind: 'refund' }, { transaction_kind: 'transfer' }, { pending: true },
  ])('does not allow the legacy detail toggle to bypass a separate tax method/reconciliation', record => {
    expect(() => taxDecisionUpdate(record, { is_deductible: true })).toThrow('requires tax-method or refund reconciliation');
    const at = new Date('2026-09-17T12:00:00.000Z');
    expect(taxDecisionUpdate(record, { is_deductible: false }, at)).toEqual({ tax_review_required: false, review_status: 'confirmed', review_source: 'user_decision', reviewed_at: at.toISOString() });
    expect(taxDecisionUpdate(record, { is_deductible: null })).toEqual({ tax_review_required: true });
    expect(taxDecisionUpdate(record, {})).toEqual({});
  });
  it('keeps quarterly, dashboard and preparer records consistent for an unresolved tax decision', () => {
    const unresolved = { ...h.record, amount: 100, iso_currency_code: 'USD', is_deductible: true, tax_review_required: true };
    expect(sumExpensesForQuarter([unresolved as any], 2026, 3, 'America/Los_Angeles').confirmed_deductible_expenses).toBe(0);
    expect(sumPotentialExpensesForQuarter([unresolved as any], 2026, 3, 'America/Los_Angeles').potential_deductions_needing_review).toBe(100);
    const dashboard = summarizeDashboardRecords([unresolved]);
    expect(dashboard.needsReviewCount).toBe(1); expect(dashboard.deductibleCount).toBe(0); expect(dashboard.categoryEntries).toEqual([]);
    expect(convertTransactionsToCSV([unresolved])).toContain('Tax treatment unresolved; exclude from confirmed deduction totals');
  });
  it('excludes stale contradictory flags and tax-method placeholders from confirmed exports', () => {
    const result = aggregateScheduleC([
      { ...h.record, is_deductible: true, tax_review_required: true },
      { ...h.record, is_deductible: true, tax_review_required: false, category: 'VEHICLE_REVIEW_REQUIRED' },
      { ...h.record, is_deductible: true, tax_review_required: false, amount: 25 },
    ] as any, '2026', undefined, { mode: 'confirmed-only' });
    expect(result.totalDeductible).toBe(25); expect(result.counts.deductible).toBe(1);
  });
});

describe('detail mutation uses authoritative server tax review state', () => {
  it('sends authenticated edits and returns/reconciles the canonical transaction', async () => {
    const saved = { ...h.record, is_deductible: true, tax_review_required: false };
    h.request.mockResolvedValue(Response.json({ success: true, transaction: saved }));
    const flow = MutationHarness(); const result = await flow.mutationFn(args);
    expect(h.request).toHaveBeenCalledExactlyOnceWith('/api/transactions/tx', expect.objectContaining({ method: 'PUT', body: JSON.stringify(args.updates) }));
    expect(result).toEqual(saved); flow.onSuccess(result, args);
    expect(h.cache).toHaveBeenCalledWith(['transaction', 'tx'], saved);
  });
  it('does not send an edit after the signed-in account changes', async () => {
    h.owner = 'other-owner'; await expect(MutationHarness().mutationFn(args)).rejects.toThrow('Sign in again'); expect(h.request).not.toHaveBeenCalled();
  });
  it('rejects failed saves instead of confirming optimistic tax state', async () => {
    h.request.mockResolvedValue(Response.json({ error: 'Tax method still needs review.' }, { status: 422 }));
    await expect(MutationHarness().mutationFn(args)).rejects.toThrow('Tax method still needs review.'); expect(h.cache).not.toHaveBeenCalled();
  });
});
