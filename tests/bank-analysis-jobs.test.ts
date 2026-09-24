import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ docs: new Map<string, Record<string, any>>(), analyze: vi.fn(), context: vi.fn(), missing: vi.fn(), configured: true, lock: Promise.resolve() }));
vi.mock('@/lib/firebase/admin', () => {
  function ref(path: string): any {
    return { path, id: path.split('/').at(-1), get: async () => snap(path),
      collection: (name: string) => ({ get: async () => ({ docs: [...mocks.docs.keys()].filter(key => key.startsWith(`${path}/${name}/`) && key.split('/').length === path.split('/').length + 2).map(snap) }) }) };
  }
  function snap(path: string): any { return { exists: mocks.docs.has(path), id: path.split('/').at(-1), ref: ref(path), data: () => mocks.docs.has(path) ? structuredClone(mocks.docs.get(path)) : undefined }; }
  return { adminDb: { doc: ref, runTransaction: async (fn: (tx: any) => Promise<any>) => {
    const before = mocks.lock;
    let release!: () => void;
    mocks.lock = new Promise<void>(resolve => { release = resolve; });
    await before;
    const writes: Array<() => void> = [];
    try {
      const result = await fn({ get: async (r: any) => snap(r.path),
        set: (r: any, data: any) => writes.push(() => mocks.docs.set(r.path, structuredClone(data))),
        update: (r: any, data: any) => writes.push(() => { if (!mocks.docs.has(r.path)) throw new Error('missing document'); mocks.docs.set(r.path, { ...mocks.docs.get(r.path), ...structuredClone(data) }); }),
      });
      writes.forEach(write => write());
      return result;
    } finally { release(); }
  } } };
});
vi.mock('@/lib/ai/provider-status', () => ({ getAIProviderStatus: () => ({ configured: mocks.configured }) }));
vi.mock('@/lib/ai/analyzeTransaction', () => ({ analyzeTransactionWithRetry: mocks.analyze, convertToEnhancedContext: mocks.context, findMissingUserFields: mocks.missing }));
import { adminDb } from '@/lib/firebase/admin';
import { analysisTaskId, enqueueBankTransactionAnalysis, enqueueAccountAnalysis, processAnalysisTask, updateImportedTransactionForAnalysis } from '@/lib/ai/analysis-jobs';
import { claimAnalysisLease, persistAnalysisSuggestion, releaseAnalysisLease, analysisSuggestionUpdate } from '@/lib/ai/analysis-persistence';
import { analysisProfileHash } from '@/lib/ai/profile-context';
import { saveTransactionChanges } from '@/lib/transactions/save-changes';
import { shouldQueueBankWrite } from '../functions-analysis/src/bridge';

const address = { userId: 'synthetic-user', accountId: 'bank-account', transactionId: 'posted-transaction' };
const profilePath = `user_profiles/${address.userId}`;
const accountPath = `${profilePath}/accounts/${address.accountId}`;
const path = `${accountPath}/transactions/${address.transactionId}`;
const taskPath = `analysis_tasks/${analysisTaskId(address)}`;
const jobPath = `analysis_jobs/${address.userId}_${address.accountId}`;
const suggestion = { status: 'ok' as const, is_deductible: true, expense_type: 'business' as const, deductible_percent: 100, category: 'supplies_small_tools' as const, confidence: 0.9, customized_reason: 'A suggestion requiring confirmation', irs_refs: ['Synthetic reference'] };
function generation() { return mocks.docs.get(taskPath)!.generation; }
function currentProfileHash() { return analysisProfileHash(mocks.docs.get(profilePath)!, mocks.docs.get(path)!.date); }
function change(p: string, values: Record<string, unknown>) { mocks.docs.set(p, { ...mocks.docs.get(p), ...values }); }
async function run() { return processAnalysisTask(analysisTaskId(address), generation()); }
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
  mocks.docs.clear(); mocks.lock = Promise.resolve(); mocks.configured = true;
  mocks.docs.set(profilePath, { profession: 'Designer', subscriptionStatus: 'none' });
  mocks.docs.set(accountPath, { user_id: address.userId, type: 'depository', usageType: 'mixed' });
  mocks.docs.set(path, { userId: address.userId, account_id: address.accountId, amount: 75,
    merchant_name: 'Synthetic office store', category: 'supplies', date: '2026-09-15',
    iso_currency_code: 'USD', pending: false, analysisStatus: 'pending', analyzed: false,
    is_deductible: null, expense_type: null, notes: 'Original context' });
  mocks.context.mockImplementation(profile => ({ user_id: address.userId, profession: [profile.profession],
    annual_gross_income_usd: profile.income, filing_state: profile.state }));
  mocks.missing.mockReturnValue([]);
  mocks.analyze.mockResolvedValue({ success: true, result: suggestion });
});
afterEach(() => { vi.useRealTimers(); });

describe('saved facts automatically refresh durable AI review', () => {
  it('atomically queues changed facts, deduplicates replayed events, and preserves confirmed decisions/receipts', async () => {
    await enqueueBankTransactionAnalysis(address); await run();
    change(path, { is_deductible: false, review_status: 'confirmed', review_source: 'user_corrected',
      category: 'PERSONAL', receipt_url: 'private-receipt-reference', receipt_filename: 'receipt.pdf' });
    const before = structuredClone(mocks.docs.get(path)!);
    const saved = await saveTransactionChanges(adminDb.doc(path), address.userId, { business_purpose: 'Used for the paid design project' });
    expect(saved).toMatchObject({ analysisStatus: 'pending', analysisRefreshReason: 'transaction_changed', ai_suggestion: null,
      is_deductible: false, review_status: 'confirmed', review_source: 'user_corrected', category: 'PERSONAL', receipt_url: 'private-receipt-reference', receipt_filename: 'receipt.pdf' });
    expect(shouldQueueBankWrite(before, saved)).toBe(true);
    const queued = await Promise.all(Array.from({ length: 4 }, () => enqueueBankTransactionAnalysis(address)));
    expect(queued.filter(result => 'enqueued' in result && result.enqueued).length).toBe(1);
    await run();
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    expect(mocks.analyze.mock.calls.at(-1)![0]).toMatchObject({ business_purpose: 'Used for the paid design project' });
    expect(mocks.docs.get(path)).toMatchObject({ analysisStatus: 'completed', analysisRefreshReason: null, is_deductible: false, category: 'PERSONAL' });
    expect(shouldQueueBankWrite(saved, mocks.docs.get(path)!)).toBe(false);
  });

  it('does not requeue unchanged facts or decision-only edits, including harmless whitespace', async () => {
    await enqueueBankTransactionAnalysis(address); await run();
    const before = structuredClone(mocks.docs.get(path)!);
    const saved = await saveTransactionChanges(adminDb.doc(path), address.userId, { notes: '  Original   context  ', is_deductible: false });
    expect(saved.notes).toBe('Original context');
    expect(saved.analysisStatus).toBe('completed');
    expect(saved.ai_suggestion).toEqual(before.ai_suggestion);
    expect(shouldQueueBankWrite(before, saved)).toBe(false);
  });

  it('retains newly saved facts and existing decisions when AI is unavailable, with retryable pipeline state', async () => {
    change(path, { is_deductible: true, review_status: 'confirmed', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' });
    const saved = await saveTransactionChanges(adminDb.doc(path), address.userId, { attendees: ['Client A', 'Owner'] });
    expect(shouldQueueBankWrite({ amount: 75 }, saved)).toBe(true);
    mocks.configured = false;
    await enqueueBankTransactionAnalysis(address); await run();
    expect(mocks.docs.get(path)).toMatchObject({ attendees: ['Client A', 'Owner'], is_deductible: true,
      review_status: 'confirmed', analysisStatus: 'failed', analysisErrorCode: 'AI_UNAVAILABLE' });
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('defers pending bank records and rejects a foreign document path', async () => {
    change(path, { pending: true });
    const saved = await saveTransactionChanges(adminDb.doc(path), address.userId, { meeting_notes: 'Discussed the client project' });
    expect(shouldQueueBankWrite(mocks.docs.get(path), saved)).toBe(false);
    expect((await enqueueBankTransactionAnalysis(address)).status).toBe('skipped');
    await expect(saveTransactionChanges(adminDb.doc(path), 'different-user', { notes: 'forged' })).rejects.toThrow('Transaction not found');
  });
});

describe('durable bank transaction analysis', () => {
  it('catches up legacy analyzed rows missing structured suggestions while preserving the recorded decision', async () => {
    change(path, { analyzed: true, analysisStatus: 'completed', is_deductible: false, expense_type: 'personal' });
    expect((await enqueueAccountAnalysis(address.userId, address.accountId)).queued).toBe(1);
    await run();
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(mocks.docs.get(path)).toMatchObject({ is_deductible: false, expense_type: 'personal', ai_suggestion: { category: 'supplies_small_tools' } });
  });
  it('shows a paused legacy catch-up as failed rather than retaining a completed flag', async () => {
    change(path, { analyzed: true, analysisStatus: 'completed' }); mocks.configured = false;
    await enqueueAccountAnalysis(address.userId, address.accountId); await run();
    expect(mocks.docs.get(path)).toMatchObject({ analysisStatus: 'failed', analysisErrorCode: 'AI_UNAVAILABLE' });
    expect(mocks.docs.get(taskPath)?.status).toBe('paused');
  });
  it('deduplicates concurrent enqueue requests and permits the existing free-plan AI policy', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => enqueueBankTransactionAnalysis(address)));
    expect(results.every(result => result.status === 'queued')).toBe(true);
    expect(mocks.docs.get(jobPath)).toMatchObject({ total: 1, processed: 0, status: 'running', phase: 'queued' });
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(await run()).toMatchObject({ status: 'completed', retry: false });
    expect(mocks.docs.get(jobPath)).toMatchObject({ total: 1, processed: 1, succeeded: 1, failed: 0, status: 'done' });
    expect(mocks.docs.get(path)?.ai_suggestion.profileHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ['pending bank record', path, { pending: true }],
    ['manual account', accountPath, { type: 'manual' }],
    ['foreign transaction owner', path, { user_id: 'different-user' }],
    ['foreign account owner', accountPath, { userId: 'different-user' }],
    ['foreign account reference', path, { account_id: 'other-account' }],
  ])('does not queue %s', async (_name, recordPath, value) => {
    change(recordPath as string, value as Record<string, unknown>);
    expect((await enqueueBankTransactionAnalysis(address)).status).toBe('skipped');
    expect(mocks.docs.has(taskPath)).toBe(false);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it('catch-up includes credits, income and zero entries for kind review but skips pending records', async () => {
    change(path, { amount: -20 });
    for (const [index, values] of [{ amount: 0 }, { amount: 100, type: 'income' }, { amount: 100, pending: true }].entries()) {
      mocks.docs.set(`${accountPath}/transactions/ineligible-${index}`, { ...mocks.docs.get(path), ...values });
    }
    expect((await enqueueAccountAnalysis(address.userId, address.accountId)).queued).toBe(3);
    expect(mocks.docs.has(taskPath)).toBe(true);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it.each([{ amount: -25 }, { amount: 0 }, { amount: -100, type: 'income' }, { amount: 250, category: 'TRANSFER' }])('queues all posted transaction kinds while preventing unsafe expense suggestions %j', async values => {
    change(path, values);
    expect((await enqueueBankTransactionAnalysis(address)).status).toBe('queued');
    await run();
    expect(mocks.docs.get(path)?.is_deductible).toBeNull();
    expect(mocks.docs.get(path)?.category).toBe(values.category || 'supplies');
    if (values.amount <= 0) expect(mocks.docs.get(path)?.ai_suggestion).toMatchObject({ status: 'needs_more_info', isDeductible: null });
  });

  it.each(['manual', 'receipt'])('queues a server-saved %s expense through the same durable worker', async source => {
    change(accountPath, { type: 'manual' });
    change(path, { source, is_deductible: true, user_classification_reason: 'Confirmed business supplies' });
    expect((await enqueueBankTransactionAnalysis(address)).status).toBe('queued');
    expect(await run()).toMatchObject({ status: 'completed', retry: false });
    expect(mocks.docs.get(path)).toMatchObject({ is_deductible: true, user_classification_reason: 'Confirmed business supplies' });
  });

  it('deduplicates event redelivery and preserves classifications entered during analysis', async () => {
    await enqueueBankTransactionAnalysis(address);
    let complete!: (value: any) => void;
    let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    mocks.analyze.mockImplementation(() => { started(); return new Promise(resolve => { complete = resolve; }); });
    const running = run(); await began;
    expect(await run()).toMatchObject({ status: 'busy', retry: true });
    change(path, { is_deductible: false, expense_type: 'personal', user_classification_reason: 'Personal purchase', deductible_reason: 'My saved reason', deduction_score: 0 });
    complete({ success: true, result: suggestion }); await running;
    expect(mocks.docs.get(path)).toMatchObject({ is_deductible: false, expense_type: 'personal', user_classification_reason: 'Personal purchase',
      deductible_reason: 'My saved reason', deduction_score: 0, ai_status: 'ok', analysisStatus: 'completed' });
    expect(await run()).toMatchObject({ status: 'finished', retry: false });
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(mocks.docs.get(jobPath)?.processed).toBe(1);
  });

  it('shares a lease with manual analysis and does not spend an attempt while manual work is active', async () => {
    await enqueueBankTransactionAnalysis(address);
    const claim = await claimAnalysisLease(adminDb.doc(path));
    expect(claim.status).toBe('claimed');
    expect(await run()).toMatchObject({ retry: true });
    expect(mocks.docs.get(taskPath)?.attempts).toBe(0);
    if (claim.status !== 'claimed') throw new Error('Expected claim');
    await persistAnalysisSuggestion(adminDb.doc(path), suggestion, claim.lease, currentProfileHash());
    expect(await run()).toMatchObject({ status: 'finished', retry: false });
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(mocks.docs.get(jobPath)).toMatchObject({ succeeded: 1, failed: 0, status: 'done' });
  });

  it('rejects stale input and never recreates a deleted transaction', async () => {
    for (const mutation of [() => change(path, { notes: 'Changed while model ran' }), () => mocks.docs.delete(path)]) {
      mocks.docs.delete(taskPath); mocks.docs.delete(jobPath);
      await enqueueBankTransactionAnalysis(address);
      mocks.analyze.mockImplementationOnce(async () => { mutation(); return { success: true, result: suggestion }; });
      expect(await run()).toMatchObject({ status: 'failed', retry: false, code: 'AI_INPUT_CHANGED' });
      expect(mocks.docs.get(path)?.ai_status).toBeUndefined();
    }
    expect(mocks.docs.has(path)).toBe(false);
  });

  it('bounds transient retry attempts and respects backoff without additional provider calls', async () => {
    await enqueueBankTransactionAnalysis(address);
    mocks.analyze.mockResolvedValue({ success: false, error: 'Try again later', code: 'AI_RATE_LIMITED', retryable: true });
    expect(await run()).toMatchObject({ status: 'retry_wait', retry: true });
    expect(await run()).toMatchObject({ status: 'busy', retry: true });
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    expect(await run()).toMatchObject({ status: 'retry_wait', retry: true });
    vi.advanceTimersByTime(120_001);
    expect(await run()).toMatchObject({ status: 'failed', retry: false });
    expect(await run()).toMatchObject({ status: 'finished', retry: false });
    expect(mocks.analyze).toHaveBeenCalledTimes(3);
    expect(mocks.docs.get(jobPath)).toMatchObject({ processed: 1, failed: 1, status: 'failed' });
  });

  it('pauses quota/config failures and requires an explicit later catch-up to generate new work', async () => {
    await enqueueBankTransactionAnalysis(address);
    mocks.analyze.mockResolvedValue({ success: false, error: 'AI unavailable', code: 'AI_UNAVAILABLE', retryable: false });
    const originalGeneration = generation();
    expect(await run()).toMatchObject({ status: 'paused', retry: false });
    await run();
    await enqueueBankTransactionAnalysis(address);
    expect(generation()).toBe(originalGeneration);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    expect((await enqueueAccountAnalysis(address.userId, address.accountId)).queued).toBe(1);
    expect(generation()).not.toBe(originalGeneration);
    expect(await processAnalysisTask(analysisTaskId(address), originalGeneration)).toMatchObject({ status: 'obsolete', retry: false });
  });

  it.each(['configuration', 'profile', 'currency'])('pauses missing %s before calling the provider', async reason => {
    await enqueueBankTransactionAnalysis(address);
    if (reason === 'configuration') mocks.configured = false;
    if (reason === 'profile') mocks.missing.mockReturnValue(['profession']);
    if (reason === 'currency') change(path, { iso_currency_code: 'EUR' });
    expect(await run()).toMatchObject({ status: 'finished', retry: false });
    expect(mocks.docs.get(taskPath)?.status).toBe('paused');
    expect(mocks.docs.get(taskPath)?.attempts).toBe(0);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('reclaims expired leases after interruption and rejects older completions', async () => {
    const first = await claimAnalysisLease(adminDb.doc(path));
    if (first.status !== 'claimed') throw new Error('Expected claim');
    vi.advanceTimersByTime(240_001);
    const replacement = await claimAnalysisLease(adminDb.doc(path));
    expect(replacement.status).toBe('claimed');
    expect(await persistAnalysisSuggestion(adminDb.doc(path), suggestion, first.lease)).toEqual({ status: 'stale' });
    await releaseAnalysisLease(adminDb.doc(path), first.lease);
    expect(mocks.docs.get(path)?.analysisStatus).toBe('running');
  });

  it('recovers an aged-out delivery with a new generation and reuses its unfinished progress slot', async () => {
    await enqueueBankTransactionAnalysis(address);
    const oldGeneration = generation();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    const claim = await claimAnalysisLease(adminDb.doc(path));
    if (claim.status !== 'claimed') throw new Error('Expected claim');
    await enqueueAccountAnalysis(address.userId, address.accountId);
    expect(generation()).toBe(oldGeneration);
    await releaseAnalysisLease(adminDb.doc(path), claim.lease);
    await enqueueAccountAnalysis(address.userId, address.accountId);
    expect(generation()).not.toBe(oldGeneration);
    expect(mocks.docs.get(jobPath)?.total).toBe(1);
    expect(await run()).toMatchObject({ status: 'completed' });
    expect(mocks.docs.get(jobPath)).toMatchObject({ total: 1, processed: 1, succeeded: 1, status: 'done' });
  });

  it('writes actionable information states and replaces stale flat AI display fields without writing tax decisions', () => {
    const update = analysisSuggestionUpdate({ status: 'needs_more_info', questions: ['What was the business purpose?'] });
    expect(update).toMatchObject({ deductionStatus: 'Needs more information', confidence: null, reasoning: null, irsPublication: null,
      ai: { status_label: 'Needs more information', questions: ['What was the business purpose?'] } });
    for (const field of ['is_deductible', 'expense_type', 'deduction_score', 'deductible_reason', 'category', 'user_classification_reason']) expect(update).not.toHaveProperty(field);
  });
  it('invalidates outdated bank suggestions on financial changes and leaves confirmed classification intact', async () => {
    await enqueueBankTransactionAnalysis(address); await run();
    const previousGeneration = generation();
    change(path, { is_deductible: true, user_classification_reason: 'Confirmed supplies' });
    const fields = { date: '2026-09-15', amount: 125, merchant_name: 'Corrected merchant', category: 'supplies',
      description: 'Bank correction', iso_currency_code: 'USD', unofficial_currency_code: null, pending: false };
    expect(await updateImportedTransactionForAnalysis(address, fields)).toEqual({ updated: true, invalidated: true });
    expect(mocks.docs.get(path)).toMatchObject({ amount: 125, ai: null, ai_status: null, analyzed: false,
      deductionStatus: 'Analysis pending', is_deductible: true, user_classification_reason: 'Confirmed supplies' });
    const revision = mocks.docs.get(path)!.analysisInputRevision;
    await enqueueBankTransactionAnalysis(address);
    expect(generation()).not.toBe(previousGeneration);
    await run();
    expect(mocks.analyze.mock.calls.at(-1)?.[0]).toMatchObject({ amount_usd: 125, merchant: 'Corrected merchant' });
    expect(await updateImportedTransactionForAnalysis(address, fields)).toEqual({ updated: true, invalidated: false });
    expect(mocks.docs.get(path)!.analysisInputRevision).toBe(revision);
    expect(mocks.docs.get(path)!.analyzed).toBe(true);
  });
  it('preserves user-confirmed categories when Plaid refreshes its source category', async () => {
    change(path, { category: 'SERVICE_SUBSCRIPTION', review_status: 'confirmed', is_deductible: true });
    const fields = { date: '2026-09-15', amount: 75, merchant_name: 'Synthetic office store', category: 'GENERAL_MERCHANDISE',
      description: 'Bank description', iso_currency_code: 'USD', unofficial_currency_code: null, pending: false };
    await updateImportedTransactionForAnalysis(address, fields);
    expect(mocks.docs.get(path)).toMatchObject({ category: 'SERVICE_SUBSCRIPTION', bank_category: 'GENERAL_MERCHANDISE', is_deductible: true });
    expect(await updateImportedTransactionForAnalysis(address, fields)).toEqual({ updated: true, invalidated: false });
  });
  it('requeues a restored bank row whose invalidated suggestion had the same original financial input', async () => {
    const fields = { date: '2026-09-15', amount: 75, merchant_name: 'Synthetic office store', category: 'supplies',
      description: 'Bank description', iso_currency_code: 'USD', unofficial_currency_code: null, pending: false };
    change(path, { ...fields, bank_category: fields.category, review_status: 'confirmed', is_deductible: true,
      user_classification_reason: 'Confirmed supplies', receipt_url: '/receipt' });
    await enqueueBankTransactionAnalysis(address); await run();
    const originalGeneration = generation();
    const originalInputHash = mocks.docs.get(taskPath)!.inputHash;
    change(path, { bank_removed: true, pending: true });
    expect(await updateImportedTransactionForAnalysis(address, fields)).toEqual({ updated: true, invalidated: true });
    change(path, { bank_removed: false });
    expect(mocks.docs.get(path)).toMatchObject({ ai_suggestion: null, analysisStatus: 'pending', review_status: 'confirmed',
      is_deductible: true, user_classification_reason: 'Confirmed supplies', receipt_url: '/receipt' });
    expect((await enqueueBankTransactionAnalysis(address)).status).toBe('queued');
    expect(mocks.docs.get(taskPath)!.inputHash).toBe(originalInputHash);
    expect(generation()).not.toBe(originalGeneration);
    const restoredGeneration = generation();
    expect((await enqueueBankTransactionAnalysis(address)).status).toBe('queued');
    expect(generation()).toBe(restoredGeneration);
    expect(mocks.docs.get(jobPath)).toMatchObject({ total: 1, processed: 0 });
    await run();
    expect((await enqueueBankTransactionAnalysis(address)).status).toBe('completed');
    expect(generation()).toBe(restoredGeneration);
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    expect(mocks.docs.get(path)).toMatchObject({ analyzed: true, analysisStatus: 'completed', review_status: 'confirmed',
      is_deductible: true, user_classification_reason: 'Confirmed supplies', receipt_url: '/receipt' });
  });
});

describe('profile-aware analysis refresh', () => {
  const refresh = () => enqueueBankTransactionAnalysis(address, false, { refreshProfile: true });

  it('refreshes completed suggestions using the current profile and preserves every recorded decision', async () => {
    await enqueueBankTransactionAnalysis(address); await run();
    const oldGeneration = generation();
    const oldSuggestion = mocks.docs.get(path)!.ai_suggestion;
    const decision = { category: 'OFFICE_EXPENSE', is_deductible: true, expense_type: 'business',
      review_status: 'confirmed', review_source: 'user', review_action: 'confirm', reviewed_at: 123,
      reviewed_suggestion_id: oldSuggestion.id, business_use_percentage: 100, deductible_reason: 'My reason',
      user_classification_reason: 'Confirmed by me', receipt_url: '/receipt' };
    change(path, decision);
    change(profilePath, { profession: 'Architect', income: 85_000 });
    expect(await refresh()).toMatchObject({ status: 'queued', enqueued: true });
    expect(generation()).not.toBe(oldGeneration);
    expect(mocks.docs.get(taskPath)?.profileHash).toBe(currentProfileHash());
    expect(mocks.docs.get(path)).toMatchObject({ ...decision, ai_suggestion: null, ai_explanation: null, ai: null,
      confidence: null, reasoning: null, analyzed: false, analysisStatus: 'pending', analysisRefreshReason: 'profile_changed' });
    await run();
    expect(mocks.analyze.mock.calls.at(-1)?.[1]).toMatchObject({ profession: ['Architect'], annual_gross_income_usd: 85_000 });
    expect(mocks.docs.get(path)).toMatchObject({ ...decision, analyzed: true, analysisRefreshReason: null,
      ai_suggestion: { profileHash: currentProfileHash() } });
  });

  it('does not reanalyze a cosmetic profile edit or duplicate same-profile refresh', async () => {
    await enqueueBankTransactionAnalysis(address); await run();
    const originalGeneration = generation();
    const originalSuggestion = mocks.docs.get(path)!.ai_suggestion.id;
    change(profilePath, { name: 'New display name', photoURL: '/avatar', updated_at: new Date(), subscriptionStatus: 'active' });
    expect(await refresh()).toMatchObject({ status: 'completed' });
    expect(generation()).toBe(originalGeneration);
    expect(mocks.docs.get(path)!.ai_suggestion.id).toBe(originalSuggestion);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);

    change(profilePath, { state: 'NY' });
    const requests = await Promise.all(Array.from({ length: 8 }, refresh));
    expect(requests.filter(result => 'enqueued' in result && result.enqueued)).toHaveLength(1);
    expect(mocks.docs.get(jobPath)).toMatchObject({ total: 1, processed: 0 });
    const freshGeneration = generation();
    await refresh();
    expect(generation()).toBe(freshGeneration);
  });

  it.each([undefined, ''])('replaces a legacy completed suggestion without a profile fingerprint (%s)', async profileHash => {
    await enqueueBankTransactionAnalysis(address); await run();
    const previousGeneration = generation();
    change(path, { ai_suggestion: { ...mocks.docs.get(path)!.ai_suggestion, profileHash } });
    expect(await refresh()).toMatchObject({ status: 'queued', enqueued: true });
    expect(generation()).not.toBe(previousGeneration);
    await run();
    expect(mocks.docs.get(path)!.ai_suggestion.profileHash).toBe(currentProfileHash());
  });

  it('coalesces active work for the latest profile and prevents superseded model completions from publishing', async () => {
    await enqueueBankTransactionAnalysis(address);
    let complete!: (value: any) => void;
    let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    mocks.analyze.mockImplementationOnce(() => { started(); return new Promise(resolve => { complete = resolve; }); });
    const oldGeneration = generation();
    const running = run(); await began;
    change(profilePath, { profession: 'Attorney' });
    expect(await refresh()).toMatchObject({ status: 'queued', enqueued: true });
    const replacementGeneration = generation();
    expect(replacementGeneration).not.toBe(oldGeneration);
    expect(await refresh()).toMatchObject({ status: 'queued', enqueued: false });
    expect(generation()).toBe(replacementGeneration);
    expect(mocks.docs.get(jobPath)).toMatchObject({ total: 1, processed: 0 });
    complete({ success: true, result: suggestion });
    expect(await running).toMatchObject({ status: 'obsolete', retry: false });
    expect(mocks.docs.get(path)?.ai_suggestion).toBeUndefined();
    expect(await run()).toMatchObject({ status: 'completed' });
    expect(mocks.docs.get(path)!.ai_suggestion.profileHash).toBe(currentProfileHash());
    expect(mocks.docs.get(jobPath)).toMatchObject({ total: 1, processed: 1, succeeded: 1, failed: 0 });
  });

  it.each(['change', 'delete'])('rejects a profile %s during a provider request before the fanout catches up', async mutation => {
    await enqueueBankTransactionAnalysis(address);
    mocks.analyze.mockImplementationOnce(async () => {
      if (mutation === 'delete') mocks.docs.delete(profilePath);
      else change(profilePath, { income: 150_000 });
      return { success: true, result: suggestion };
    });
    expect(await run()).toMatchObject({ status: 'failed', retry: false, code: 'AI_INPUT_CHANGED' });
    expect(mocks.docs.get(path)?.ai_suggestion).toBeUndefined();
    expect(mocks.docs.get(path)).toMatchObject({ analysisStatus: 'failed', analysisLeaseToken: null });
  });

  it('does not skip a stale structured result that arrives before a queued worker starts', async () => {
    await enqueueBankTransactionAnalysis(address); await run();
    const oldResult = mocks.docs.get(path)!;
    change(profilePath, { income: 40_000 });
    await refresh();
    change(path, { ai_suggestion: oldResult.ai_suggestion, analyzed: true, analysisStatus: 'completed', analysis_status: 'completed' });
    expect(await run()).toMatchObject({ status: 'completed' });
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    expect(mocks.docs.get(path)!.ai_suggestion.profileHash).toBe(currentProfileHash());
  });

  it('rejects stale manual results after relevant profile edits but allows cosmetic changes', async () => {
    const first = await claimAnalysisLease(adminDb.doc(path));
    if (first.status !== 'claimed') throw new Error('Expected claim');
    const oldHash = currentProfileHash();
    change(profilePath, { income: 70_000 });
    expect(await persistAnalysisSuggestion(adminDb.doc(path), suggestion, first.lease, oldHash)).toEqual({ status: 'stale' });
    expect(mocks.docs.get(path)?.ai_suggestion).toBeUndefined();
    await releaseAnalysisLease(adminDb.doc(path), first.lease);
    const second = await claimAnalysisLease(adminDb.doc(path));
    if (second.status !== 'claimed') throw new Error('Expected claim');
    const hash = currentProfileHash();
    change(profilePath, { name: 'Display name', updatedAt: new Date() });
    expect(await persistAnalysisSuggestion(adminDb.doc(path), suggestion, second.lease, hash)).toMatchObject({ status: 'saved' });
    expect(mocks.docs.get(path)!.ai_suggestion.profileHash).toBe(hash);
  });

  it('will not save an unverifiable manual result without the analyzed profile fingerprint', async () => {
    const claim = await claimAnalysisLease(adminDb.doc(path));
    if (claim.status !== 'claimed') throw new Error('Expected claim');
    expect(await persistAnalysisSuggestion(adminDb.doc(path), suggestion, claim.lease)).toEqual({ status: 'stale' });
    expect(mocks.docs.get(path)?.ai_suggestion).toBeUndefined();
  });
});
