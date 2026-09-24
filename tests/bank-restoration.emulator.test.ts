/**
 * Isolated proof of bank restoration -> durable AI job -> saved review state.
 * Requires an explicitly selected demo-project Firestore emulator; never uses
 * Plaid/OpenAI credentials or production data. Disabled during ordinary tests.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

const h = vi.hoisted(() => ({ db: null as Firestore | null, analyze: vi.fn(), sync: vi.fn(), connection: null as any }));
vi.mock('@/lib/firebase/admin', () => ({ get adminDb() { if (!h.db) throw new Error('Demo emulator not initialized'); return h.db; } }));
vi.mock('@/lib/plaid/client', () => ({ plaidClient: { transactionsSync: h.sync } }));
vi.mock('@/lib/plaid/connections', () => ({
  listPlaidConnections: async () => [h.connection], updatePlaidConnection: vi.fn(), findPlaidConnectionByItemId: vi.fn(),
  withPlaidConnection: async (_uid: string, _item: string, work: any) => work(h.connection, 'emulator-lease'),
}));
vi.mock('@/lib/subscriptions/history-window', () => ({
  getTransactionHistoryWindow: async () => ({ startDate: '2026-01-01', endDate: '2026-12-31' }),
  isWithinHistoryWindow: () => true,
}));
vi.mock('@/lib/ai/provider-status', () => ({ getAIProviderStatus: () => ({ configured: true }) }));
vi.mock('@/lib/ai/analyzeTransaction', () => ({ analyzeTransactionWithRetry: h.analyze,
  convertToEnhancedContext: () => ({ profession: ['Designer'], filing_state: 'CA' }), findMissingUserFields: () => [],
}));
import { syncUserTransactionsIncremental } from '@/lib/plaid/sync-helper';
import { analysisTaskId, enqueueBankTransactionAnalysis, processAnalysisTask } from '@/lib/ai/analysis-jobs';
import { shouldQueueBankWrite } from '../functions-analysis/src/bridge';
import { isCountableRecord } from '@/lib/transactions/record-scope';

const enabled = process.env.WRITEOFF_BANK_EMULATOR_TESTS === '1';
const project = process.env.WRITEOFF_BANK_EMULATOR_PROJECT || 'demo-writeoff-bank-readiness';
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (enabled && (!/^demo-[a-z0-9-]+$/.test(project) || !/^127\.0\.0\.1:\d{4,5}$/.test(host))) throw new Error('Explicit loopback emulator and demo project required');
const address = { userId: `bank_restore_${randomUUID()}`, accountId: 'synthetic-account', transactionId: 'synthetic-transaction' };
const profile = `user_profiles/${address.userId}`;
const account = `${profile}/accounts/${address.accountId}`;
const record = `${account}/transactions/${address.transactionId}`;
const taskId = analysisTaskId(address);
const task = `analysis_tasks/${taskId}`;
const job = `analysis_jobs/${address.userId}_${address.accountId}`;
const bankRow = { transaction_id: address.transactionId, account_id: address.accountId, date: '2026-09-20', amount: 25,
  merchant_name: 'Synthetic office purchase', name: 'Synthetic office purchase', category: ['Shops'],
  iso_currency_code: 'USD', unofficial_currency_code: null, pending: false };
const suggestion = { status: 'ok', is_deductible: true, expense_type: 'business', deductible_percent: 100,
  category: 'supplies_small_tools', confidence: 0.9, customized_reason: 'Synthetic suggestion requiring review', irs_refs: [] };
let close: () => Promise<void>;
const saved = async () => (await h.db!.doc(record).get()).data()!;
const generation = async () => (await h.db!.doc(task).get()).data()!.generation;

(enabled ? describe : describe.skip)('bank restoration on real Firestore transactions', () => {
  beforeAll(async () => {
    const [{ initializeApp, deleteApp }, { getFirestore }] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/firestore')]);
    const app = initializeApp({ projectId: project }, address.userId); h.db = getFirestore(app); close = () => deleteApp(app);
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await Promise.all([h.db!.doc(task).delete(), h.db!.doc(job).delete()]);
    await h.db!.doc(profile).set({ profession: 'Designer', state: 'CA' });
    await h.db!.doc(account).set({ user_id: address.userId, type: 'depository', plaid_item_id: 'synthetic-item' });
    await h.db!.doc(record).set({ userId: address.userId, account_id: address.accountId, trans_id: address.transactionId,
      date: bankRow.date, amount: 25, merchant_name: bankRow.name, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES',
      iso_currency_code: 'USD', bank_removed: true, bank_removed_at: new Date(), pending: true,
      review_status: 'confirmed', is_deductible: true, notes: 'Preserve owner note', receipt_url: 'synthetic-private-receipt',
      analyzed: false, analysisStatus: 'pending' });
    h.connection = { uid: address.userId, itemId: 'synthetic-item', accessToken: 'synthetic-not-a-provider-token', accountIds: [address.accountId], cursor: 'before' };
    h.analyze.mockResolvedValue({ success: true, result: suggestion });
  });
  afterAll(async () => {
    await h.db!.recursiveDelete(h.db!.doc(profile));
    await Promise.all([h.db!.doc(task).delete(), h.db!.doc(job).delete()]);
    await close(); h.db = null;
  });
  it.each(['added', 'modified'])('restores %s bank activity into one durable AI job without losing confirmed fields', async event => {
    const before = await saved();
    h.sync.mockResolvedValue({ data: { added: event === 'added' ? [bankRow] : [], modified: event === 'modified' ? [bankRow] : [],
      removed: [], has_more: false, next_cursor: 'after' } });
    expect(await syncUserTransactionsIncremental(address.userId, 'synthetic-item')).toMatchObject({ success: true, transactionsSaved: 0 });
    const restored = await saved();
    expect(restored).toMatchObject({ bank_removed: false, bank_removed_at: null, pending: false,
      review_status: 'confirmed', is_deductible: true, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES',
      notes: 'Preserve owner note', receipt_url: 'synthetic-private-receipt' });
    expect(isCountableRecord(restored)).toBe(true); expect(shouldQueueBankWrite(before, restored)).toBe(true);
    const queued = await Promise.all(Array.from({ length: 4 }, () => enqueueBankTransactionAnalysis(address)));
    expect(queued.filter(value => 'enqueued' in value && value.enqueued)).toHaveLength(1);
    expect(await processAnalysisTask(taskId, await generation())).toMatchObject({ status: 'completed', retry: false });
    expect(h.analyze).toHaveBeenCalledOnce();
    expect(await saved()).toMatchObject({ analysisStatus: 'completed', ai_suggestion: { category: 'supplies_small_tools' },
      review_status: 'confirmed', is_deductible: true, notes: 'Preserve owner note', receipt_url: 'synthetic-private-receipt' });
    expect((await h.db!.doc(job).get()).data()).toMatchObject({ total: 1, processed: 1, succeeded: 1, failed: 0, status: 'done' });
  });
  it('never publishes an in-flight suggestion after withdrawal, even without a pending marker', async () => {
    await h.db!.doc(record).update({ bank_removed: false, pending: false });
    await enqueueBankTransactionAnalysis(address);
    h.analyze.mockImplementationOnce(async () => {
      await h.db!.doc(record).update({ bank_removed: true });
      return { success: true, result: suggestion };
    });
    expect(await processAnalysisTask(taskId, await generation())).toMatchObject({ status: 'failed', code: 'AI_INPUT_CHANGED' });
    expect((await saved()).ai_suggestion).toBeUndefined(); expect(isCountableRecord(await saved())).toBe(false);
    expect((await h.db!.doc(job).get()).data()).toMatchObject({ succeeded: 0, failed: 1 });
  });
});
