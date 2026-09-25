import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import type { Transaction } from '../lib/firebase/transactions';
import type { AiReviewSuggestion } from '../lib/transactions/ai-review-contract';
import { reviewPresentation } from '../lib/transactions/review-presentation';

const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, request: vi.fn(), updated: vi.fn(), open: vi.fn(), toast: vi.fn(), availability: 'configured', refresh: vi.fn() }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const hooks = {
    useState(initial: unknown) { const index = harness.cursor++; if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial; return [harness.slots[index], (value: unknown) => { harness.slots[index] = typeof value === 'function' ? value(harness.slots[index]) : value; }]; },
    useRef(initial: unknown) { const index = harness.cursor++; if (!(index in harness.slots)) harness.slots[index] = { current: initial }; return harness.slots[index]; },
    useEffect() {},
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.request }));
vi.mock('@/lib/hooks/use-ai-availability', () => ({ useAiAvailability: () => ({ status: harness.availability, refresh: harness.refresh, message: 'AI configuration unavailable.' }) }));
vi.mock('sonner', () => ({ toast: { success: harness.toast } }));
import { AiTaxAnalysisDialog, AiTaxExplanation } from '../components/ai-tax-explanation';
import { AnalysisStatusNotice } from '../components/analysis-status-notice';
import { ExplanationCard } from '../components/ai/explanation-card';
import { ReviewTransactionsScreen } from '../components/review-transactions-screen';

type Props = { children?: unknown; id?: string; disabled?: boolean; value?: unknown; 'aria-label'?: string; onClick?: () => unknown; onChange?: (event: { target: { value: string; checked?: boolean } }) => void; onTouchStart?: (event: unknown) => void; onTouchMove?: (event: unknown) => void; onTouchEnd?: () => void };
type Element = ReactElement<Props>;
function walk(node: unknown): Element[] { if (Array.isArray(node)) return node.flatMap(walk); return isValidElement<Props>(node) ? [node, ...walk(node.props.children)] : []; }
function text(node: unknown): string { if (Array.isArray(node)) return node.map(text).join(''); if (isValidElement<Props>(node)) return text(node.props.children); return typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function action(page: unknown, label: string) { return walk(page).find(node => node.props.onClick && text(node).trim() === label)!; }
const suggestion: AiReviewSuggestion = { id: 'suggestion-1', inputHash: 'saved-input', status: 'ok', category: 'supplies_small_tools', transactionKind: 'expense', isDeductible: true, deductiblePercent: 100, reasoning: 'These supplies support the documented client project.', questions: [], documentationRequired: ['Itemized receipt and project note'], irsReferences: ['IRC 162'], sources: [{ id: '162', title: 'Business expenses', url: 'https://www.irs.gov/publications/p334', edition: '2025 publication; 2026 rule review', reviewed_at: '2026-09-16' }], taxYear: 2026, policyVersion: 'synthetic-test-policy', model: 'synthetic-model', analyzedAt: 1, };
const base = (changes: Partial<Transaction> = {}): Transaction => ({ id: 'tx-1', trans_id: 'tx-1', account_id: 'account-1', merchant_name: 'Synthetic supplies', amount: 25, iso_currency_code: 'USD', category: 'GENERAL_MERCHANDISE', date: '2026-09-16', is_deductible: null, analysisStatus: 'completed', ai_suggestion: suggestion, ...changes });
let records: Transaction[];
function page(userId = 'owner', focusedTransactionId?: string) { harness.cursor = 0; return ReviewTransactionsScreen({ user: { id: userId }, onBack() {}, transactions: records, focusedTransactionId, onTransactionUpdate: harness.updated, onTransactionClick: harness.open }); }
function serverReview(transaction = base()) { return Response.json({ success: true, transaction: { ...transaction, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', is_deductible: true, review_status: 'confirmed', review_source: 'ai_confirmed' } }); }
beforeEach(() => { harness.slots = []; harness.cursor = 0; records = [base()]; harness.availability = 'configured'; vi.clearAllMocks(); harness.refresh.mockResolvedValue(true); });

describe('AI category swipe review', () => {
  it.each([
    ['2026-09-12T00:00:00.000Z', 'Sep 12, 2026'],
    ['2026-01-01T00:00:00+14:00', 'Jan 1, 2026'],
    ['2026-09-12', 'Sep 12, 2026'],
  ])('shows the stored calendar day for %s without timestamp clutter', (date, expected) => {
    records = [base({ date })];
    const view = page();
    expect(text(view)).toContain(expected);
    expect(text(view)).not.toContain(date);
    expect(records[0].date).toBe(date);
  });

  it('shows actual reasoning, tax year, official sources and records without fabricated service promises', () => {
    const view = page();
    expect(text(view)).toContain(suggestion.reasoning);
    const evidence = walk(view).find(node => node.type === AiTaxAnalysisDialog) as ReactElement<{ suggestion: AiReviewSuggestion }>;
    expect(evidence.props.suggestion).toBe(suggestion);
    const explanation = AiTaxExplanation({ suggestion: evidence.props.suggestion });
    expect(text(explanation)).toContain('2026');
    expect(text(explanation)).toContain('Itemized receipt and project note');
    expect(text(explanation)).toContain('Business expenses');
    expect(text(explanation)).toContain('Suggested deductible portion: 100%');
    expect(text(view) + text(explanation)).not.toMatch(/Ask a CPA|within 24 hours|ready for filing|Swipe right to deduct/);
  });

  it('confirms the saved suggestion identity through the review endpoint and advances to the immediate next card', async () => {
    records.push(base({ id: 'tx-2', trans_id: 'tx-2', merchant_name: 'Immediate next transaction' }));
    harness.request.mockResolvedValue(serverReview());
    await action(page(), 'Confirm deduction').props.onClick!();
    expect(harness.request).toHaveBeenCalledExactlyOnceWith('/api/transactions/tx-1/review', expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'confirm', accountId: 'account-1', suggestionId: 'suggestion-1' }) }));
    expect(harness.updated).toHaveBeenCalledWith(expect.objectContaining({ category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' }));
    expect(text(page())).toContain('Immediate next transaction'); expect(text(page())).toContain('1 confirmed this session');
  });

  it.each([
    { category: 'supplies_small_tools', deductiblePercent: 100 },
    { category: 'meals_50', deductiblePercent: 50 },
  ] as const)('discloses that confirming $category records a deduction as well as the category', ({ category, deductiblePercent }) => {
    records = [base({ ai_suggestion: { ...suggestion, category, deductiblePercent } })];
    const view = page();
    const confirm = action(view, 'Confirm deduction');
    expect(confirm.props.disabled).toBe(false);
    expect((confirm.props as Props & { 'aria-describedby': string })['aria-describedby']).toBe('review-confirmation-hint');
    expect(text(view)).toContain('Confirm saves this category and marks it deductible.');
    expect(text(view)).toContain('Verify business use');
    if (category === 'meals_50') expect(text(view)).toContain('50% meal limit applies');
    expect(text(view)).not.toContain('category only');
    expect(harness.request).not.toHaveBeenCalled();
  });

  it.each([
    { category: 'equipment', deductiblePercent: 100 },
    { category: 'vehicle_expense', deductiblePercent: 100 },
    { category: 'home_office', deductiblePercent: 100 },
    { category: 'software_subscriptions', deductiblePercent: 25 },
    { category: 'meals_50', deductiblePercent: 100 },
  ] as const)('keeps $category at $deductiblePercent percent category-only when the server withholds its deduction', ({ category, deductiblePercent }) => {
    records = [base({ ai_suggestion: { ...suggestion, category, deductiblePercent } })];
    const view = page();
    expect(action(view, 'Save category').props.disabled).toBe(false);
    expect(text(view)).toContain('Deduction unresolved');
    expect(text(view)).toContain('Confirm saves the category only.');
    expect(text(view)).not.toContain('marks it deductible');
    expect(action(view, 'Confirm deduction')).toBeUndefined();
  });

  it('discloses a definite non-deductible decision and keeps a refund unresolved', () => {
    records = [base({ ai_suggestion: { ...suggestion, isDeductible: false, deductiblePercent: 0 } })];
    expect(text(page())).toContain('Confirm also marks this expense not deductible.');
    expect(action(page(), 'Confirm category').props.disabled).toBe(false);
    records = [base({ amount: -25, ai_suggestion: { ...suggestion, transactionKind: 'refund', isDeductible: false, deductiblePercent: 0 } })];
    expect(text(page())).toContain('Confirm saves the category only.');
    expect(text(page())).toContain('Deduction unresolved');
    expect(text(page())).not.toContain('marks this expense not deductible');
  });

  it('lets a known category be confirmed while showing that missing tax facts remain unresolved', async () => {
    records = [base({ ai_suggestion: { ...suggestion, status: 'needs_more_info', isDeductible: null, deductiblePercent: null, questions: ['What was the business purpose?'] } })];
    harness.request.mockResolvedValue(Response.json({ success: true, transaction: { ...records[0], review_status: 'confirmed', tax_review_required: true, is_deductible: null } }));
    expect(action(page(), 'Save category').props.disabled).toBe(false);
    expect(text(page())).toContain('category only');
    expect(text(page())).toContain('Deduction unresolved');
    const evidence = walk(page()).find(node => node.type === AiTaxAnalysisDialog) as ReactElement<{ suggestion: AiReviewSuggestion }>;
    expect(text(AiTaxExplanation({ suggestion: evidence.props.suggestion }))).toContain('What was the business purpose?');
    await action(page(), 'Save category').props.onClick!();
    expect(text(page())).toContain('Deductions remain unresolved');
    await action(page(), 'Resolve missing tax details').props.onClick!();
    expect(harness.open).toHaveBeenCalledWith(expect.objectContaining({ is_deductible: null }), 'details');
  });

  it('keeps unresolved tax details actionable even when the AI supplied no follow-up question', async () => {
    records = [base({ ai_suggestion: { ...suggestion, status: 'needs_more_info', isDeductible: null, deductiblePercent: null, questions: [] } })];
    const view = page();
    expect(text(view)).toContain('Deduction unresolved');
    expect(text(view)).toContain('Confirm saves the category only');
    await action(view, 'Add details').props.onClick!();
    expect(harness.open).toHaveBeenCalledWith(expect.objectContaining({ id: 'tx-1', _source: 'review-transactions' }), 'details');
    expect(harness.request).not.toHaveBeenCalled();
    expect(harness.updated).not.toHaveBeenCalled();
  });

  it('keeps receipt/detail access alongside evidence without changing the saved review', async () => {
    const view = page();
    await action(view, 'Details').props.onClick!();
    expect(harness.open).toHaveBeenCalledWith(expect.objectContaining({ id: 'tx-1', _source: 'review-transactions' }));
    expect(harness.request).not.toHaveBeenCalled();
    expect(harness.updated).not.toHaveBeenCalled();
  });

  it('opens a confirmed transaction selected from details before the ordinary review queue', () => {
    records = [base({ merchant_name: 'Ordinary queue record' }), base({ id: 'confirmed-id', trans_id: 'confirmed-bank-id', merchant_name: 'Selected confirmed record', review_status: 'confirmed', is_deductible: true })];
    const view = page('owner', 'confirmed-bank-id');
    expect(text(view)).toContain('Selected confirmed record');
    expect(text(view)).not.toContain('Ordinary queue record');
    expect(action(view, 'Change').props.disabled).toBe(false);
    expect(harness.request).not.toHaveBeenCalled();
  });

  it('saves a focused correction and returns to the regular queue without reopening the confirmed target', async () => {
    const selected = base({ id: 'confirmed-id', trans_id: 'confirmed-bank-id', merchant_name: 'Selected confirmed record', review_status: 'confirmed', is_deductible: true });
    records = [base({ merchant_name: 'Ordinary queue record' }), selected];
    await action(page('owner', 'confirmed-bank-id'), 'Change').props.onClick!();
    harness.request.mockResolvedValue(serverReview(selected));
    await action(page('owner', 'confirmed-bank-id'), 'Save correction').props.onClick!();
    expect(harness.request.mock.calls[0][0]).toBe('/api/transactions/confirmed-bank-id/review');
    expect(text(page('owner', 'confirmed-bank-id'))).toContain('Ordinary queue record');
    expect(text(page('owner', 'confirmed-bank-id'))).not.toContain('Selected confirmed record');
    // A fresh parent snapshot must not reinsert a focused record already handled this session.
    records = [base({ merchant_name: 'Ordinary queue record' }), { ...selected }];
    expect(text(page('owner', 'confirmed-bank-id'))).not.toContain('Selected confirmed record');
    harness.request.mockResolvedValue(serverReview(records[0]));
    await action(page('owner', 'confirmed-bank-id'), 'Confirm deduction').props.onClick!();
    expect(text(page('owner', 'confirmed-bank-id'))).toContain('Review complete');
    expect(text(page('owner', 'confirmed-bank-id'))).not.toContain('Selected confirmed record');
  });

  it('defers an already confirmed focused record without changing it, then continues the normal queue', async () => {
    records = [base({ merchant_name: 'Ordinary queue record' }), base({ id: 'confirmed-id', trans_id: 'confirmed-bank-id', merchant_name: 'Selected confirmed record', review_status: 'confirmed', is_deductible: true })];
    await action(page('owner', 'confirmed-bank-id'), 'Later').props.onClick!();
    expect(text(page('owner', 'confirmed-bank-id'))).toContain('Ordinary queue record');
    expect(text(page('owner', 'confirmed-bank-id'))).not.toContain('Selected confirmed record');
    expect(harness.request).not.toHaveBeenCalled();
  });

  it('falls back to the regular queue for an unknown focused transaction and does not duplicate a queued target', () => {
    expect(text(page('owner', 'missing-id'))).toContain('Synthetic supplies');
    const view = page('owner', 'tx-1');
    expect(text(view)).toContain('1 needs review');
    expect(text(view)).not.toContain('2 need review');
  });

  it('left/change opens correction and defaults to unresolved tax treatment without saving or marking personal', async () => {
    await action(page(), 'Change').props.onClick!();
    expect(harness.request).not.toHaveBeenCalled();
    expect(walk(page()).find(node => node.props.id === 'review-deduction')!.props.value).toBe('unresolved');
    harness.request.mockResolvedValue(serverReview());
    await action(page(), 'Save correction').props.onClick!();
    const payload = JSON.parse(harness.request.mock.calls[0][1].body);
    expect(payload).toMatchObject({ action: 'correct', category: 'supplies_small_tools', transactionKind: 'expense', isDeductible: null });
  });

  it('records an explicit personal correction with no business deduction', async () => {
    await action(page(), 'Change').props.onClick!();
    walk(page()).find(node => node.props.id === 'review-kind')!.props.onChange!({ target: { value: 'personal' } });
    harness.request.mockResolvedValue(serverReview());
    await action(page(), 'Save correction').props.onClick!();
    expect(JSON.parse(harness.request.mock.calls[0][1].body)).toMatchObject({ category: 'personal', transactionKind: 'personal', isDeductible: false });
  });

  it('a failed save leaves the card visible and never updates the parent or shows success', async () => {
    harness.request.mockResolvedValue(Response.json({ error: 'Saved record unavailable' }, { status: 500 }));
    await action(page(), 'Confirm deduction').props.onClick!();
    expect(text(page())).toContain('Synthetic supplies'); expect(text(page())).toContain('Saved record unavailable');
    expect(harness.updated).not.toHaveBeenCalled(); expect(harness.toast).not.toHaveBeenCalled();
  });

  it('refreshes a stale suggestion and requires the user to review the replacement', async () => {
    harness.request.mockResolvedValueOnce(Response.json({ error: 'stale' }, { status: 409 })).mockResolvedValueOnce(Response.json({ transaction: base({ ai_suggestion: { ...suggestion, id: 'replacement', analyzedAt: 2, reasoning: 'Updated details change this suggestion.' } }) }));
    await action(page(), 'Confirm deduction').props.onClick!();
    expect(text(page())).toContain('Updated details change this suggestion.'); expect(text(page())).toContain('changed. Review the latest');
    expect(harness.toast).not.toHaveBeenCalled();
  });

  it('serializes repeated confirmation clicks', async () => {
    let resolve!: (response: Response) => void;
    harness.request.mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    const confirm = action(page(), 'Confirm deduction');
    const first = confirm.props.onClick!(); await confirm.props.onClick!();
    expect(harness.request).toHaveBeenCalledOnce();
    resolve(serverReview()); await first;
  });

  it('Later defers only in this session and does not silently mark the transaction reviewed', async () => {
    await action(page(), 'Later').props.onClick!();
    expect(text(page())).toContain('1 transaction still needs review');
    expect(text(page())).toContain('Nothing was confirmed'); expect(harness.request).not.toHaveBeenCalled(); expect(harness.updated).not.toHaveBeenCalled();
    await action(page(), 'Review remaining transactions').props.onClick!(); expect(text(page())).toContain('Synthetic supplies');
  });

  it.each([
    { pending: true },
    { analysisStatus: 'running' as const },
    { ai_suggestion: null },
    { ai_suggestion: { ...suggestion, status: 'blocked' as const } },
    { ai_suggestion: { ...suggestion, transactionKind: 'unknown' as const } },
  ])('does not falsely confirm a pending, running, absent, blocked or unknown suggestion', async changes => {
    records = [base(changes)]; const confirm = action(page(), 'Confirm category');
    expect(confirm.props.disabled).toBe(true); await confirm.props.onClick!(); expect(harness.request).not.toHaveBeenCalled();
  });

  it('runs explicit AI then reloads the persisted suggestion without confirming it', async () => {
    records = [base({ ai_suggestion: null, analyzed: false, analysisStatus: 'pending' })];
    harness.request.mockResolvedValueOnce(Response.json({ success: true })).mockResolvedValueOnce(Response.json({ transaction: base() }));
    await action(page(), 'Run AI analysis').props.onClick!();
    expect(harness.request.mock.calls.map(call => call[0])).toEqual(['/api/ai/analyze-transaction', '/api/transactions/tx-1']);
    expect(text(page())).toContain(suggestion.reasoning); expect(text(page())).toContain('1 needs review'); expect(harness.toast).not.toHaveBeenCalled();
  });

  it.each(['pending', 'running'] as const)('replaces stale review guidance while profile analysis is %s, then displays the fresh snapshot', status => {
    const staleExplanation = { headline: 'Earlier profile savings', why: 'Old profile reason', yourFacts: [], scheduleCLine: null,
      estimatedTaxEffect: { low: 35, high: 35, basis: 'Old profile' }, strengthen: [], nextQuestion: null };
    records = [base({ analysisStatus: status, analysisJobId: 'refresh-job', analysisRefreshReason: 'profile_changed', ai_explanation: staleExplanation })];
    const pending = page();
    expect(text(pending)).toContain('Updating AI review using your new profile. Confirmed categories stay saved.');
    expect(text(pending)).not.toContain(suggestion.reasoning);
    expect(walk(pending).some(node => node.type === ExplanationCard || node.type === AiTaxAnalysisDialog)).toBe(false);
    expect(action(pending, 'Confirm category').props.disabled).toBe(true);
    const fresh = { ...staleExplanation, headline: 'Updated profile explanation', estimatedTaxEffect: null };
    records = [base({ ai_suggestion: { ...suggestion, id: 'updated-suggestion' }, ai_explanation: fresh, analysisRefreshReason: null })];
    const completed = page();
    expect(walk(completed).find(node => node.type === ExplanationCard)?.props).toMatchObject({ explanation: fresh });
    expect(text(completed)).not.toContain('Updating AI review');
    expect(action(completed, 'Confirm deduction').props.disabled).toBe(false);
    expect(harness.request).not.toHaveBeenCalled();
  });

  it('shows a real queued job separately from no analysis and allows an explicit analysis request', () => {
    records = [base({ ai_suggestion: null, analysisStatus: 'pending', analysisJobId: 'queued-job' })];
    expect(text(page())).toContain('Queued for automatic analysis');
    expect(text(page())).not.toContain('a first import can take a while');
    expect(action(page(), 'Confirm category').props.disabled).toBe(true);
    expect(action(page(), 'Run AI analysis').props.disabled).toBe(false);
    expect(harness.request).not.toHaveBeenCalled();
  });

  it('counts the whole queued backlog on a queued card so a first import is not mistaken for a stall', () => {
    records = ['tx-1', 'tx-2', 'tx-3'].map(id => base({ id, trans_id: id, ai_suggestion: null, analysisStatus: 'pending', analysisJobId: `job-${id}` }));
    records.push(base({ id: 'done', trans_id: 'done' }));
    expect(text(page('owner', 'tx-1'))).toContain('Queued for automatic analysis. 3 transactions are waiting; a first import can take a while. Run it now or wait for the result.');
  });

  it.each([
    ['PROFILE_REQUIRED', 'AI analysis paused'], ['AI_UNAVAILABLE', 'AI analysis paused'], ['AI_RETRY_LIMIT', 'AI analysis could not complete'],
  ])('explains a record the pipeline left with %s and keeps manual categorization open', (code, label) => {
    records = [base({ ai_suggestion: null, analysisStatus: 'failed', analysisErrorCode: code })];
    const view = page();
    expect(text(view)).toContain(label);
    expect(text(view)).not.toContain('AI analysis needs a retry');
    const notice = walk(view).find(node => node.type === AnalysisStatusNotice) as ReactElement<{ outcome: { code: string; retry: boolean }; accountIds: string[]; compact: boolean }>;
    expect(notice.props).toMatchObject({ outcome: { code }, accountIds: ['account-1'], compact: true });
    expect(action(view, 'Confirm category').props.disabled).toBe(true);
    expect(action(view, 'Change').props.disabled).toBe(false);
    expect(action(view, 'Run AI analysis').props.disabled).toBe(false);
  });

  it('handles provider unavailability without invented analysis and keeps manual categorization available', async () => {
    records = [base({ ai_suggestion: null })]; harness.request.mockResolvedValue(Response.json({ code: 'AI_UNAVAILABLE' }, { status: 503 }));
    await action(page(), 'Run AI analysis').props.onClick!();
    expect(text(page())).toContain('AI is temporarily unavailable'); expect(action(page(), 'AI unavailable').props.disabled).toBe(true);
    expect(action(page(), 'Confirm category').props.disabled).toBe(true); expect(action(page(), 'Change').props.disabled).toBe(false);
    expect(harness.updated).not.toHaveBeenCalled();
  });

  it.each(['server', 'network', 'provider'])('keeps a %s reanalysis failure visible in the open evidence dialog', async failure => {
    if (failure === 'network') harness.request.mockRejectedValueOnce(new Error('Synthetic network failure'));
    else harness.request.mockResolvedValueOnce(Response.json({ error: 'Synthetic analysis failure' }, { status: failure === 'provider' ? 503 : 500 }));
    const evidence = (view: ReturnType<typeof page>) => walk(view).find(node => node.type === AiTaxAnalysisDialog)!;
    await action(evidence(page()), 'Reanalyze').props.onClick!();
    const dialog = evidence(page());
    expect(text(dialog)).toContain(failure === 'network' ? 'Could not complete or refresh analysis' : failure === 'provider' ? 'AI is temporarily unavailable' : 'Synthetic analysis failure');
    expect(walk(dialog).some(node => (node.props as Props & { role?: string }).role === 'alert')).toBe(true);
    expect(harness.updated).not.toHaveBeenCalled();
    expect(harness.toast).not.toHaveBeenCalled();
  });

  it('does not confirm or change the transaction from a swipe on portaled analysis text', async () => {
    const card = () => walk(page()).find(node => node.type === 'article')!;
    card().props.onTouchStart!({ currentTarget: { contains: () => false }, target: { closest: () => null }, touches: [{ clientX: 0, clientY: 0 }] });
    card().props.onTouchMove!({ touches: [{ clientX: 150, clientY: 10 }] });
    card().props.onTouchEnd!();
    await Promise.resolve();
    expect(harness.request).not.toHaveBeenCalled();
    expect(harness.updated).not.toHaveBeenCalled();
    expect(text(page())).not.toContain('Correct the categorization');
    expect(text(page())).toContain('1 needs review');
  });

  it('honors a fresh bank snapshot that invalidates an earlier confirmed suggestion', async () => {
    harness.request.mockResolvedValue(serverReview());
    await action(page(), 'Confirm deduction').props.onClick!();
    expect(text(page())).toContain('Review complete');
    records = [base({ ai_suggestion: null, amount: 40, is_deductible: null, review_status: undefined, analysisStatus: 'pending' })];
    expect(text(page())).toContain('$40.00'); expect(text(page())).toContain('No AI suggestion yet');
    expect(action(page(), 'Confirm category').props.disabled).toBe(true);
  });

  it('ignores a response after the account changes', async () => {
    let resolve!: (response: Response) => void;
    harness.request.mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    const pending = action(page(), 'Confirm deduction').props.onClick!(); page('another-owner'); resolve(serverReview()); await pending;
    expect(harness.updated).not.toHaveBeenCalled(); expect(harness.toast).not.toHaveBeenCalled();
  });

  it('uses real horizontal swipe gestures for confirm and does not treat vertical scroll as review', async () => {
    const card = () => walk(page()).find(node => node.type === 'article')!;
    card().props.onTouchStart!({ currentTarget: { contains: () => true }, target: { closest: () => null }, touches: [{ clientX: 0, clientY: 0 }] });
    card().props.onTouchMove!({ touches: [{ clientX: 150, clientY: 75 }] }); card().props.onTouchEnd!();
    expect(harness.request).not.toHaveBeenCalled();
    harness.request.mockResolvedValue(serverReview());
    card().props.onTouchStart!({ currentTarget: { contains: () => true }, target: { closest: () => null }, touches: [{ clientX: 0, clientY: 0 }] });
    card().props.onTouchMove!({ touches: [{ clientX: 150, clientY: 10 }] }); card().props.onTouchEnd!();
    await Promise.resolve(); expect(harness.request).toHaveBeenCalledOnce();
  });
});

describe('review content trust and meaning', () => {
  it.each(['income', 'transfer', 'personal'] as const)('shows the %s label ahead of an incidental expense category', kind => {
    const result = reviewPresentation(base({ ai_suggestion: { ...suggestion, category: 'other', transactionKind: kind, isDeductible: false } }));
    expect(result.categoryLabel).toBe(kind === 'income' ? 'Business income' : kind === 'transfer' ? 'Transfer / card payment' : 'Personal purchase');
  });
  it('does not present legacy text or bank categorization as a current AI suggestion', () => {
    const result = reviewPresentation(base({ ai_suggestion: null, ai_analysis: 'Legacy unsupported tax claim', deductible_reason: 'User supplied text' }));
    expect(result.label).toBe('No AI suggestion yet'); expect(result.reasoning).not.toContain('Legacy'); expect(result.categoryLabel).toBe('Category needs review');
  });
  it('only links HTTPS official tax sources without credentials or lookalike hosts', () => {
    const result = reviewPresentation(base({ ai_suggestion: { ...suggestion, sources: [suggestion.sources[0], ...['https://www.irs.gov.evil.test/a', 'javascript:alert(1)', 'http://irs.gov/a', 'https://user:pass@irs.gov/a'].map(url => ({ ...suggestion.sources[0], url }))] } }));
    expect(result.sources).toEqual([suggestion.sources[0]]);
  });
});
