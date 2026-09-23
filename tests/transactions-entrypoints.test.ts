import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import type { Transaction } from '../lib/firebase/transactions';

// Run the real page/form handlers with controlled hook state and network calls.
const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], effectCleanups: new Map<number, () => void>(), runEffects: false, push: vi.fn(), back: vi.fn(), routerBack: vi.fn(), request: vi.fn(), transactions: [] as Transaction[], mutate: vi.fn(), save: vi.fn(), success: vi.fn(), error: vi.fn(), fetch: vi.fn(), localPreview: false,
  availability: 'configured' as 'configured' | 'checking' | 'unavailable', refreshAi: vi.fn() }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const hooks = {
    useState(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [harness.slots[index], (next: unknown) => { harness.slots[index] = typeof next === 'function' ? next(harness.slots[index]) : next; }];
    },
    useMemo<T>(factory: () => T) { return factory(); },
    useRef(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = { current: initial };
      return harness.slots[index];
    },
    useEffect(effect: () => void | (() => void), dependencies: unknown[]) {
      if (!harness.runEffects) return; // Most assertions exercise handlers without mount lifecycle.
      const index = harness.cursor++;
      const previous = harness.slots[index] as unknown[] | undefined;
      if (previous?.length === dependencies.length && previous.every((value, position) => Object.is(value, dependencies[position]))) return;
      harness.slots[index] = dependencies;
      harness.effects.push(() => {
        harness.effectCleanups.get(index)?.();
        harness.effectCleanups.delete(index);
        const cleanup = effect();
        if (typeof cleanup === 'function') harness.effectCleanups.set(index, cleanup);
      });
    },
    useCallback<T>(callback: T, dependencies: unknown[]) {
      const index = harness.cursor++;
      const previous = harness.slots[index] as { callback: T; dependencies: unknown[] } | undefined;
      if (previous?.dependencies.length === dependencies.length && previous.dependencies.every((value, position) => Object.is(value, dependencies[position]))) return previous.callback;
      harness.slots[index] = { callback, dependencies };
      return callback;
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: harness.push, back: harness.routerBack }) }));
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: { id: 'new-accountless-user' } }) }));
vi.mock('@/lib/firebase/hooks', () => ({ useTransactions: () => ({ transactions: harness.transactions, isLoading: false, error: null }) }));
vi.mock('@/components/sync-status-indicator', () => ({ SyncStatusIndicator: () => null }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.request }));
vi.mock('@/lib/firebase/client', () => ({ auth: { currentUser: { uid: 'new-accountless-user', getIdToken: async () => 'synthetic-token' } }, get localEmulatorConfig() { return harness.localPreview ? {} : null; } }));
vi.mock('@/lib/hooks/use-ai-availability', () => ({ useAiAvailability: () => ({ status: harness.availability,
  model: 'synthetic-model', message: harness.availability === 'configured' ? 'AI is configured. Each analysis still depends on provider availability and usage limits.' : 'AI analysis is not configured for this environment.', refresh: harness.refreshAi }) }));
vi.mock('@/lib/firebase/mutations', () => ({ useUpdateTransaction: () => ({ mutateAsync: harness.mutate, isPending: false }) }));
vi.mock('@/components/ui/toast', () => ({ useToasts: () => ({ showSuccess: harness.success, showError: harness.error }) }));
import TransactionsPage from '../app/protected/transactions/page';
import { AddManualTransactionScreen } from '../components/add-manual-transaction-screen';
import { SyncStatusIndicator } from '../components/sync-status-indicator';
import { TransactionDetailScreen } from '../components/transaction-detail-screen';
import { ExplanationCard } from '../components/ai/explanation-card';
import { AddExpenseScreen } from '../components/add-expense-screen';
import { requestAppNavigation } from '../lib/navigation/navigation-guard';

type Props = {
  children?: unknown; type?: string; id?: string; title?: string; open?: boolean; placeholder?: string; value?: unknown; 'aria-label'?: string; disabled?: boolean;
  onClick?: () => void | Promise<void>;
  onConfirm?: () => void;
  onCancel?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
  onValueChange?: (value: string) => void;
  onSubmit?: (event: { preventDefault(): void }) => Promise<void>;
};
type Element = ReactElement<Props>;
function render(component: () => ReactElement) { harness.cursor = 0; return component(); }
function walk(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  return isValidElement<Props>(node) ? [node, ...walk(node.props.children)] : [];
}
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (isValidElement<Props>(node)) return text(node.props.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}
function manualForm() { return AddManualTransactionScreen({ user: { id: 'new-accountless-user' }, onBack() {} }); }
function enterExpense() {
  walk(render(manualForm)).find(node => node.props?.placeholder === 'e.g. Adobe, Staples, AWS')!.props.onChange!({ target: { value: 'Synthetic office supplies' } });
  walk(render(manualForm)).find(node => node.props?.type === 'number')!.props.onChange!({ target: { value: '42.50' } });
  return walk(render(manualForm)).find(node => node.type === 'form')!;
}
function unmountDetail() {
  harness.effectCleanups.forEach(cleanup => cleanup());
  harness.effectCleanups.clear();
  harness.effects = [];
}
beforeEach(() => { harness.slots = []; harness.cursor = 0; harness.effects = []; harness.effectCleanups.clear(); harness.runEffects = false; harness.transactions = []; harness.localPreview = false; harness.availability = 'configured'; vi.resetAllMocks(); vi.useFakeTimers(); harness.mutate.mockResolvedValue({}); harness.refreshAi.mockResolvedValue(true); vi.stubGlobal('fetch', harness.fetch); vi.stubGlobal('window', new EventTarget()); });
afterEach(() => { unmountDetail(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('transaction page actions reach working accountless flows', () => {
  it('routes the legacy editor through saved-record detail and unsaved entry through the real manual form', () => {
    const transaction = { id: 'saved-expense', merchant_name: 'Synthetic saved expense', amount: 20, date: '2026-09-16', category: 'other' };
    const existing = AddExpenseScreen({ user: { id: 'new-accountless-user' }, onBack() {}, onSave: harness.save, editingExpense: transaction });
    expect(existing.type).toBe(TransactionDetailScreen);
    expect(existing.props.transaction).toBe(transaction);
    const newEntry = AddExpenseScreen({ user: { id: 'new-accountless-user' }, onBack() {}, onSave: harness.save });
    expect(walk(newEntry).some(node => node.type === AddManualTransactionScreen)).toBe(true);
    expect(harness.request).not.toHaveBeenCalled(); expect(harness.fetch).not.toHaveBeenCalled();
  });
  it.each([
    ['Upload receipt', '/protected?screen=receipt-upload'],
    ['Add transaction', '/protected?screen=add-manual-transaction'],
  ])('%s navigates to its real form', (label, url) => {
    const page = render(TransactionsPage);
    const action = walk(page).find(node => node.props?.['aria-label'] === label);
    expect(action).toBeDefined();
    action!.props.onClick!();
    expect(harness.push).toHaveBeenCalledExactlyOnceWith(url);
    expect(walk(page).some(node => node.type === 'input' && node.props.type === 'file')).toBe(false);
  });

  it('the destination expense form saves through the authenticated API without a linked bank', async () => {
    harness.request.mockResolvedValue(Response.json({ success: true }, { status: 201 }));
    await enterExpense().props.onSubmit!({ preventDefault() {} });
    expect(harness.request).toHaveBeenCalledOnce();
    const [url, options] = harness.request.mock.calls[0];
    expect(url).toBe('/api/transactions/manual');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toMatchObject({ merchant_name: 'Synthetic office supplies', amount: 42.5, type: 'expense', iso_currency_code: 'USD' });
    expect(JSON.parse(options.body)).not.toHaveProperty('account_id');
    expect(text(render(manualForm))).toContain('Expense saved');
  });

  it('the destination preserves entered details and shows a failed save instead of success', async () => {
    harness.request.mockResolvedValue(Response.json({ error: 'Unable to save this expense. Please retry.' }, { status: 503 }));
    await enterExpense().props.onSubmit!({ preventDefault() {} });
    const form = render(manualForm);
    expect(text(form)).toContain('Unable to save this expense. Please retry.');
    expect(text(form)).not.toContain('Expense saved');
    expect(walk(form).find(node => node.props?.placeholder === 'e.g. Adobe, Staples, AWS')!.props.value).toBe('Synthetic office supplies');
  });
});

describe('transaction list shows record status without inventing tax savings', () => {
  const fixture = (id: string, amount: number, changes: Partial<Transaction> = {}): Transaction => ({
    id, trans_id: id, merchant_name: id, amount, date: '2026-09-16', category: 'Office expenses', ...changes,
  });
  const rows = (page: ReactElement) => walk(page).filter(node => node.type === 'tr' && walk(node).some(child => child.type === 'td'));
  const clickTab = (label: string) => {
    const node = walk(render(TransactionsPage)).find(node => node.type === 'button' && typeof (node.props as { 'aria-pressed'?: boolean })['aria-pressed'] === 'boolean' && text(node).startsWith(label));
    expect(node).toBeDefined(); node!.props.onClick!(); return render(TransactionsPage);
  };

  beforeEach(() => {
    harness.transactions = [
      fixture('Business income', -1000, { category: 'income', type: 'income', is_deductible: false }),
      fixture('Pending purchase', 25, { pending: true, is_deductible: true }),
      fixture('Pending income', -20, { pending: true, category: 'revenue', type: 'income', is_deductible: false }),
      fixture('Posted expense', 100, { is_deductible: true }),
      fixture('Expense refund', -20, { type: 'income', is_deductible: true }),
      fixture('Personal purchase', 42.5, { is_deductible: false }),
      fixture('Unreviewed purchase', 300, { is_deductible: null }),
      // A relinked bank's re-import of an already reviewed purchase; reconciliation marked it superseded.
      fixture('Superseded re-import', 300, { is_deductible: null, superseded_by: 'user_profiles/new-accountless-user/accounts/old/transactions/original' }),
    ];
  });

  it('hides a superseded bank re-import from every tab and count instead of asking for review again', () => {
    const page = render(TransactionsPage);
    expect(text(page)).not.toContain('Superseded re-import');
    expect(walk(page).some(node => node.props['aria-label'] === 'Pending or needs review: 3')).toBe(true);
    for (const tab of ['Review', 'Deductible', 'Personal']) expect(rows(clickTab(tab)).map(text).join(' ')).not.toContain('Superseded re-import');
    expect(rows(clickTab('All')).map(text).join(' ')).not.toContain('Superseded re-import');
  });

  it('uses record counts and opens the authoritative Tax Preview instead of calculating tax dollars', () => {
    const page = render(TransactionsPage);
    expect(walk(page).some(node => node.props['aria-label'] === 'Posted records marked deductible: 2')).toBe(true);
    expect(walk(page).some(node => node.props['aria-label'] === 'Pending or needs review: 3')).toBe(true);
    expect(text(page)).not.toContain('Potential savings');
    const action = walk(page).find(node => node.type === 'button' && text(node).startsWith('Tax Preview'))!;
    action.props.onClick!();
    expect(harness.push).toHaveBeenCalledExactlyOnceWith('/protected?screen=tax-preview');
  });

  it('labels pending expense and income as pending on desktop and mobile, preserving incoming signs', () => {
    const page = render(TransactionsPage);
    for (const merchant of ['Pending purchase', 'Pending income']) {
      const desktop = rows(page).find(node => text(node).includes(merchant))!;
      const mobile = walk(page).find(node => node.type === 'div' && (node.props as { role?: string }).role === 'button' && text(node).includes(merchant))!;
      for (const node of [desktop, mobile]) {
        expect(text(node)).toContain('Pending');
        expect(text(node)).not.toMatch(/Paid|Received|Personal|Marked deductible/);
      }
      expect(text(mobile)).toContain(merchant === 'Pending income' ? '+$20.00' : '-$25.00');
    }
  });

  it.each(['income', 'revenue', 'INCOME'])('classifies explicit %s as Income but never promotes an expense refund to business income', category => {
    harness.transactions[0].category = category;
    const page = render(TransactionsPage);
    const income = rows(page).find(node => text(node).includes('Business income'))!;
    expect(text(income)).toContain('Income'); expect(text(income)).not.toContain('Personal');
    const refund = rows(page).find(node => text(node).includes('Expense refund'))!;
    expect(text(refund)).toContain('Marked deductible'); expect(text(refund)).not.toContain('Income');
    expect(text(refund)).toContain('Received');
  });

  it('keeps personal, posted-classification and pending/review filters aligned with the displayed status', () => {
    expect(rows(clickTab('Personal')).map(text)).toEqual([expect.stringContaining('Personal purchase')]);
    expect(rows(clickTab('Deductible')).map(text)).toEqual(expect.arrayContaining([
      expect.stringContaining('Posted expense'), expect.stringContaining('Expense refund'),
    ]));
    expect(rows(render(TransactionsPage))).toHaveLength(2);
    const review = rows(clickTab('Review'));
    expect(review).toHaveLength(3);
    expect(review.map(text)).toEqual(expect.arrayContaining([
      expect.stringContaining('Pending purchase'), expect.stringContaining('Pending income'), expect.stringContaining('Unreviewed purchase'),
    ]));
  });

  it('does not mount a bank-sync poller on entry and leaves source records intact when sorting', () => {
    harness.transactions[0].date = '2026-01-01';
    const originalIds = harness.transactions.map(t => t.id);
    const page = render(TransactionsPage);
    expect(walk(page).some(node => node.type === SyncStatusIndicator)).toBe(false);
    expect(harness.request).not.toHaveBeenCalled();
    expect(harness.transactions.map(t => t.id)).toEqual(originalIds);
  });
});

describe('transaction detail preserves manual work without guessed tax impact or automatic AI', () => {
  const base = { id: 'detail-id', trans_id: 'detail-id', merchant_name: 'Synthetic meal', amount: 100,
    date: '2026-09-16', category: 'FOOD_AND_DRINK_RESTAURANT', is_deductible: true, notes: '' };
  type DetailTransaction = Parameters<typeof TransactionDetailScreen>[0]['transaction'];
  const categorySuggestion: NonNullable<DetailTransaction['ai_suggestion']> = {
    id: 'synthetic-category-suggestion', inputHash: 'synthetic-input', status: 'needs_more_info',
    transactionKind: 'expense', category: 'meals_50', isDeductible: null, deductiblePercent: null,
    reasoning: 'Confirm the business purpose.', questions: ['Who attended?'], documentationRequired: [],
    irsReferences: [], sources: [], taxYear: 2026, policyVersion: 'synthetic-policy', model: 'synthetic-model', analyzedAt: 1,
  };
  function detail(changes: Partial<DetailTransaction> = {}, initialSection?: 'summary' | 'details') {
    harness.cursor = 0;
    const page = TransactionDetailScreen({ transaction: { ...base, ...changes }, initialSection, onBack: harness.back, onSave: harness.save }) as Element;
    harness.effects.splice(0).forEach(effect => effect());
    return page;
  }
  const action = (page: Element, label: string) => walk(page).find(node => typeof node.props.onClick === 'function' && text(node).trim() === label)!;
  const analyzed = () => Response.json({ success: true, analysis: { deductionStatus: 'Possibly Deductible', reasoning: 'Review the saved business purpose.', confidence: 0.7, updatedAt: '2026-09-16T12:00:00Z' } });

  it.each(['pending', 'running'] as const)('hides earlier AI amounts and confirmation while a profile refresh is %s', status => {
    const stale = { headline: 'Old profile estimate', why: 'Earlier business facts', yourFacts: [], scheduleCLine: null,
      estimatedTaxEffect: { low: 35, high: 35, basis: 'Old profile' }, strengthen: [], nextQuestion: null };
    const view = detail({ analysisStatus: status, analysisJobId: 'profile-refresh-job', analysisRefreshReason: 'profile_changed',
      ai_suggestion: categorySuggestion, ai_explanation: stale, is_deductible: true, review_status: 'confirmed' });
    expect(text(view)).toContain('Updating AI review using your new profile. Confirmed categories stay saved.');
    expect(text(view)).toContain('Deduction recorded');
    expect(walk(view).some(node => node.type === ExplanationCard)).toBe(false);
    expect(text(view)).not.toContain('Confirm or change category');
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('refreshes a pending background result through the saved-record API and stops polling on completion', async () => {
    harness.runEffects = true;
    const fresh = { headline: 'Updated review', why: 'Current profile facts', yourFacts: [], scheduleCLine: null,
      estimatedTaxEffect: null, strengthen: [], nextQuestion: null };
    const completed = { ...base, analysisStatus: 'completed' as const, analysisRefreshReason: null,
      ai_suggestion: categorySuggestion, ai_explanation: fresh, business_purpose: 'Original purpose' };
    harness.request.mockResolvedValue(Response.json({ transaction: completed }));
    detail({ analysisStatus: 'pending', analysisJobId: 'profile-refresh-job', analysisRefreshReason: 'profile_changed' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(harness.request).toHaveBeenCalledExactlyOnceWith('/api/transactions/detail-id', expect.objectContaining({ cache: 'no-store' }));
    expect(harness.save).toHaveBeenCalledWith(completed);
    const view = detail(completed);
    expect(walk(view).find(node => node.type === ExplanationCard)?.props).toMatchObject({ explanation: fresh });
    expect(text(view)).not.toContain('Updating AI review');
    await vi.advanceTimersByTimeAsync(15000);
    expect(harness.request).toHaveBeenCalledOnce();
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('does not apply a late background result after leaving the transaction', async () => {
    harness.runEffects = true;
    let complete!: (response: Response) => void;
    harness.request.mockReturnValueOnce(new Promise<Response>(resolve => { complete = resolve; }));
    detail({ analysisStatus: 'running', analysisJobId: 'profile-refresh-job' });
    await vi.advanceTimersByTimeAsync(5000);
    detail({ id: 'next-record', trans_id: 'next-record', analysisStatus: 'completed' });
    complete(Response.json({ transaction: { ...base, analysisStatus: 'completed' } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.save).not.toHaveBeenCalled();
  });

  it('replaces the displayed explanation after saving purpose and rerunning AI, without confirming the deduction', async () => {
    const stale: NonNullable<DetailTransaction['ai_explanation']> = { headline: 'Confirm the business purpose', why: 'The bank record alone does not establish a business use.', yourFacts: [], scheduleCLine: null, estimatedTaxEffect: null, strengthen: ['Save the purpose'], nextQuestion: 'What was this for?' };
    const fresh = { ...stale, headline: 'Client design supplies', why: 'These supplies support the documented client design work.', yourFacts: ['Purpose: Client design supplies'], scheduleCLine: 'Schedule C line 22 (Supplies)', strengthen: ['Keep the itemized receipt'], nextQuestion: null };
    const freshSuggestion = { ...categorySuggestion, id: 'fresh-suggestion', status: 'ok' as const, category: 'supplies_small_tools' as const, isDeductible: true, deductiblePercent: 100, questions: [] };
    const changes = { is_deductible: null, ai_explanation: stale, ai_suggestion: categorySuggestion };
    harness.fetch.mockResolvedValueOnce(Response.json({ ...await analyzed().json(), ai_suggestion: freshSuggestion, explanation: fresh }));
    walk(detail(changes)).find(node => node.props.id === 'business-purpose')!.props.onChange!({ target: { value: 'Client design supplies' } });
    await action(detail(changes), 'Run AI Analysis').props.onClick!();
    expect(harness.mutate).toHaveBeenCalledWith(expect.objectContaining({ updates: expect.objectContaining({ business_purpose: 'Client design supplies' }) }));
    expect(harness.save).toHaveBeenLastCalledWith(expect.objectContaining({ ai_explanation: fresh, ai_suggestion: freshSuggestion, is_deductible: null }));
    const saved: DetailTransaction = harness.save.mock.lastCall![0];
    const card = walk(detail(saved)).find(node => node.type === ExplanationCard) as ReactElement<Parameters<typeof ExplanationCard>[0]>;
    expect(card.props.explanation).toEqual(fresh);
    expect(card.props.explanation?.nextQuestion).toBeNull();
    expect(card.props.compact).toBe(true);
    expect(harness.error).not.toHaveBeenCalled();
  });

  it.each([null, undefined, { headline: 'Incomplete payload' }])('clears an old explanation when a successful rerun returns %j', async explanation => {
    const stale: NonNullable<DetailTransaction['ai_explanation']> = { headline: 'Old question', why: 'Older reasoning', yourFacts: [], scheduleCLine: null, estimatedTaxEffect: null, strengthen: [], nextQuestion: 'Old unresolved question?' };
    harness.fetch.mockResolvedValueOnce(Response.json({ ...await analyzed().json(), ai_suggestion: categorySuggestion, explanation }));
    await action(detail({ ai_explanation: stale, is_deductible: null }), 'Run AI Analysis').props.onClick!();
    expect(harness.save).toHaveBeenLastCalledWith(expect.objectContaining({ ai_explanation: null, is_deductible: null }));
    const saved: DetailTransaction = harness.save.mock.lastCall![0];
    expect(walk(detail(saved)).some(node => node.type === ExplanationCard)).toBe(false);
    expect(harness.error).not.toHaveBeenCalled();
  });

  it('explains a superseded duplicate opened by direct link and shows nothing extra otherwise', () => {
    const notice = 'This bank record duplicates an earlier one you already reviewed; it is excluded from totals.';
    const superseded = detail({ superseded_by: 'user_profiles/new-accountless-user/accounts/old/transactions/original' });
    const note = walk(superseded).find(node => (node.props as { role?: string }).role === 'note')!;
    expect(text(note)).toBe(notice);
    expect(text(superseded)).not.toContain('user_profiles/');
    expect(text(detail())).not.toContain(notice);
    expect(harness.fetch).not.toHaveBeenCalled(); expect(harness.mutate).not.toHaveBeenCalled();
  });

  it('opens requested tax details immediately without a provider or persistence request', () => {
    const page = detail({}, 'details');
    expect(walk(page).find(node => node.props.onValueChange)!.props.value).toBe('details');
    expect(harness.fetch).not.toHaveBeenCalled();
    expect(harness.mutate).not.toHaveBeenCalled();
    expect(harness.save).not.toHaveBeenCalled();
  });

  it('changing only the requested tab preserves active analysis and returns to Summary when it completes', async () => {
    harness.runEffects = true;
    let complete!: (response: Response) => void;
    harness.fetch.mockReturnValueOnce(new Promise<Response>(resolve => { complete = resolve; }));
    const analysis = action(detail(), 'Run AI Analysis').props.onClick!();
    await vi.advanceTimersByTimeAsync(0);
    detail({}, 'details');
    const redirected = detail({}, 'details');
    expect(walk(redirected).find(node => node.props.onValueChange)!.props.value).toBe('details');
    expect(action(redirected, 'Analyzing…').props.disabled).toBe(true);
    expect(harness.fetch).toHaveBeenCalledOnce();
    complete(analyzed());
    await analysis;
    expect(walk(detail({}, 'details')).find(node => node.props.onValueChange)!.props.value).toBe('summary');
    expect(harness.save).toHaveBeenCalledOnce();
    expect(harness.save.mock.calls[0][0]).not.toHaveProperty('initialSection');
    expect(harness.save.mock.calls[0][0]).not.toHaveProperty('section');
  });

  it('opens shared Tax Preview and leaves a recorded business classification without a rate, savings calculation or CPA submission', async () => {
    const page = detail();
    expect(text(page)).toContain('Deduction recorded');
    expect(text(page)).not.toMatch(/Estimated Tax Rate|Estimated Tax Savings|100% deductible|25%|our CPA team|within 24 hours/);
    expect(action(page, 'Ask a CPA')).toBeUndefined();
    await action(page, 'Open Tax Preview').props.onClick!();
    expect(harness.push).toHaveBeenCalledExactlyOnceWith('/protected?screen=tax-preview');
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('uses server configuration to disable AI in a local preview while manual notes still save', async () => {
    harness.localPreview = true;
    harness.availability = 'unavailable';
    const page = detail();
    expect(text(page)).toContain('AI analysis is not configured for this environment');
    const buttons = walk(page).filter(node => typeof node.props.onClick === 'function' && text(node).trim() === 'AI unavailable');
    expect(buttons).toHaveLength(1);
    expect(buttons.every(node => node.props.disabled)).toBe(true);
    await buttons[0].props.onClick!();
    walk(page).find(node => node.props.placeholder === 'Tell us more about this purchase...')!.props.onChange!({ target: { value: 'Manual review remains available' } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.mutate).toHaveBeenCalledWith(expect.objectContaining({ updates: { notes: 'Manual review remains available' } }));
    expect(harness.fetch).not.toHaveBeenCalled();
    expect(harness.error).not.toHaveBeenCalled();
  });

  it('blocks analysis while the authenticated configuration check is pending', async () => {
    harness.availability = 'checking';
    const buttons = walk(detail()).filter(node => typeof node.props.onClick === 'function' && text(node).trim() === 'Checking AI…');
    expect(buttons).toHaveLength(1); expect(buttons.every(node => node.props.disabled)).toBe(true);
    await buttons[0].props.onClick!();
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [503, { error: 'Temporary unavailable' }],
    [503, null],
    [500, { error: 'Analysis failed', details: 'OpenAI is not configured (missing OPENAI_API_KEY)' }],
    [500, { error: 'Analysis failed', details: { code: 'insufficient_quota' } }],
    [500, { code: 'AI_SERVICE_UNAVAILABLE' }],
  ])('handles unavailable status %s with manual review guidance and no repeated request in this view', async (status, body) => {
    harness.fetch.mockResolvedValue(Response.json(body, { status }));
    await action(detail(), 'Run AI Analysis').props.onClick!();
    const page = detail();
    expect(text(page)).toContain('AI analysis is unavailable');
    expect(text(page)).toContain('edit notes, attach receipts and record your classification manually');
    const buttons = walk(page).filter(node => typeof node.props.onClick === 'function' && text(node).trim() === 'AI unavailable');
    expect(buttons).toHaveLength(1); expect(buttons.every(node => node.props.disabled)).toBe(true);
    await buttons[0].props.onClick!();
    expect(harness.fetch).toHaveBeenCalledOnce(); expect(harness.save).not.toHaveBeenCalled();
    expect(harness.success).not.toHaveBeenCalled(); expect(harness.error).toHaveBeenCalledWith('AI unavailable', expect.any(String));
  });

  it('lets a later configuration recheck enable explicit retry without treating it as a funded-provider probe', async () => {
    harness.fetch.mockResolvedValueOnce(Response.json({ code: 'AI_SERVICE_UNAVAILABLE' }, { status: 503 }));
    await action(detail(), 'Run AI Analysis').props.onClick!();
    harness.refreshAi.mockResolvedValueOnce(false);
    await action(detail(), 'Check AI availability').props.onClick!();
    expect(action(detail(), 'AI unavailable').props.disabled).toBe(true);
    harness.refreshAi.mockResolvedValueOnce(true);
    await action(detail(), 'Check AI availability').props.onClick!();
    expect(harness.fetch).toHaveBeenCalledOnce();
    expect(action(detail(), 'Run AI Analysis').props.disabled).toBe(false);
    expect(text(detail())).toContain('No new AI assessment was saved.');
    expect(text(detail())).not.toContain('Try again when AI is available.');
  });

  it('notes and business classification save without scheduling an AI/provider request', async () => {
    const notes = walk(detail({ is_deductible: false })).find(node => node.props.placeholder === 'Tell us more about this purchase...')!;
    notes.props.onChange!({ target: { value: 'Client meeting; itemized receipt retained' } });
    await vi.advanceTimersByTimeAsync(1500);
    expect(harness.mutate).toHaveBeenCalledWith(expect.objectContaining({ updates: { notes: 'Client meeting; itemized receipt retained' } }));
    const business = walk(detail({ is_deductible: false })).find(node => node.props['aria-label'] === 'Mark as business expense')!;
    await business.props.onClick!();
    await action(detail({ is_deductible: false }), 'Save Changes').props.onClick!();
    await vi.advanceTimersByTimeAsync(2000);
    expect(harness.mutate).toHaveBeenLastCalledWith(expect.objectContaining({
      transactionId: 'detail-id', userId: 'new-accountless-user',
      updates: expect.objectContaining({ is_deductible: true, expense_type: 'business', notes: 'Client meeting; itemized receipt retained' }),
    }));
    expect(harness.save).toHaveBeenCalledWith(expect.objectContaining({ is_deductible: true, notes: 'Client meeting; itemized receipt retained' }));
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('uses canonical saved tax-review metadata when a detail classification resolves missing facts', async () => {
    harness.mutate.mockResolvedValueOnce({ ...base, is_deductible: true, tax_review_required: false, expense_type: 'business' });
    const business = walk(detail({ is_deductible: false })).find(node => node.props['aria-label'] === 'Mark as business expense')!;
    await business.props.onClick!();
    await action(detail({ is_deductible: false }), 'Save Changes').props.onClick!();
    expect(harness.save).toHaveBeenCalledWith(expect.objectContaining({ is_deductible: true, tax_review_required: false }));
  });

  it('merges edits to different context fields made within the same autosave window', async () => {
    walk(detail()).find(node => node.props.id === 'business-purpose')!.props.onChange!({ target: { value: 'Design project research' } });
    walk(detail()).find(node => node.props.id === 'client-project')!.props.onChange!({ target: { value: 'Client A' } });
    await vi.advanceTimersByTimeAsync(500);
    expect(harness.mutate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ updates: {
      business_purpose: 'Design project research', client_project: 'Client A',
    } }));
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('saves every draft field without approving an unresolved business-category deduction', async () => {
    const changes = { is_deductible: null, expense_type: 'business' as const };
    walk(detail(changes)).find(node => node.props.id === 'business-purpose')!.props.onChange!({ target: { value: 'Client meeting' } });
    walk(detail(changes)).find(node => node.props.id === 'client-project')!.props.onChange!({ target: { value: 'Project One' } });
    walk(detail(changes)).find(node => node.props.id === 'documentation-status')!.props.onChange!({ target: { value: 'partial' } });
    walk(detail(changes)).find(node => node.props.id === 'meeting-notes')!.props.onChange!({ target: { value: 'Discussed upcoming design work' } });
    await action(detail(changes), 'Save Changes').props.onClick!();
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.mutate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ updates: {
      notes: '', business_purpose: 'Client meeting', client_project: 'Project One',
      documentation_status: 'partial', meeting_notes: 'Discussed upcoming design work',
    } }));
    expect(harness.save).toHaveBeenCalledWith(expect.objectContaining({ is_deductible: null, expense_type: 'business' }));
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('excludes a business expense from deductions without reclassifying it as personal', async () => {
    const changes = { is_deductible: null, expense_type: 'business' as const };
    await walk(detail(changes)).find(node => node.props['aria-label'] === 'Exclude from deductions')!.props.onClick!();
    await action(detail(changes), 'Save Changes').props.onClick!();
    expect(harness.mutate).toHaveBeenCalledWith(expect.objectContaining({ updates: expect.objectContaining({ is_deductible: false }) }));
    expect(harness.mutate.mock.calls[0][0].updates).not.toHaveProperty('expense_type');
    expect(harness.save).toHaveBeenCalledWith(expect.objectContaining({ is_deductible: false, expense_type: 'business' }));
  });

  it('waits for an older autosave before explicitly saving the latest draft', async () => {
    let finishOldSave!: () => void;
    harness.mutate.mockReturnValueOnce(new Promise<void>(resolve => { finishOldSave = resolve; }));
    walk(detail()).find(node => node.props.id === 'business-purpose')!.props.onChange!({ target: { value: 'Older purpose' } });
    await vi.advanceTimersByTimeAsync(500);
    walk(detail()).find(node => node.props.id === 'business-purpose')!.props.onChange!({ target: { value: 'Latest purpose' } });
    const saving = action(detail(), 'Save Changes').props.onClick!();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.mutate).toHaveBeenCalledOnce();
    finishOldSave(); await saving;
    expect(harness.mutate).toHaveBeenCalledTimes(2);
    expect(harness.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ updates: expect.objectContaining({ business_purpose: 'Latest purpose' }) }));
    expect(harness.mutate.mock.calls[1][0].updates).not.toHaveProperty('is_deductible');
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.mutate).toHaveBeenCalledTimes(2);
  });

  it('clears saved notes with an empty string rather than dropping the field', async () => {
    walk(detail({ notes: 'Old notes' })).find(node => node.props.placeholder === 'Tell us more about this purchase...')!.props.onChange!({ target: { value: '' } });
    await action(detail({ notes: 'Old notes' }), 'Save Changes').props.onClick!();
    expect(harness.mutate).toHaveBeenCalledWith(expect.objectContaining({ updates: expect.objectContaining({ notes: '' }) }));
    expect(harness.save).toHaveBeenCalledWith(expect.objectContaining({ notes: '' }));
  });

  it('delegates back navigation once without moving browser history a second time', async () => {
    const back = walk(detail()).find(node => node.props['aria-label'] === 'Back to transactions')!;
    await back.props.onClick!();
    await vi.advanceTimersByTimeAsync(100);
    expect(harness.back).toHaveBeenCalledOnce();
    expect(harness.routerBack).not.toHaveBeenCalled();
  });

  it('guards unsaved supporting details and cancels their debounce when the user leaves', async () => {
    walk(detail()).find(node => node.props.id === 'business-purpose')!.props.onChange!({ target: { value: 'Unsaved client visit' } });
    const back = walk(detail()).find(node => node.props['aria-label'] === 'Back to transactions')!;
    await back.props.onClick!();
    expect(harness.back).not.toHaveBeenCalled();
    const confirmation = walk(detail()).find(node => node.props.title === 'Unsaved Changes')!;
    expect(confirmation.props.open).toBe(true);
    confirmation.props.onConfirm!();
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.back).toHaveBeenCalledOnce();
    expect(harness.mutate).not.toHaveBeenCalled();
  });

  it.each([
    ['Confirm or change category', '/protected?screen=review-transactions&transactionId=plaid%26review%3Done'],
    ['Open Tax Preview', '/protected?screen=tax-preview'],
  ])('guards dirty notes before %s and discards the pending autosave only after leaving', async (label, expectedDestination) => {
    const changes = { id: 'internal-id', trans_id: 'plaid&review=one', ai_suggestion: categorySuggestion };
    walk(detail(changes)).find(node => node.props.id === 'transaction-notes')!.props.onChange!({ target: { value: 'Unfinished context' } });
    await action(detail(changes), label).props.onClick!();
    expect(harness.push).not.toHaveBeenCalled();
    expect(harness.back).not.toHaveBeenCalled();
    expect(harness.mutate).not.toHaveBeenCalled();
    const confirmation = walk(detail(changes)).find(node => node.props.title === 'Unsaved Changes')!;
    expect(confirmation.props.open).toBe(true);
    confirmation.props.onConfirm!();
    expect(harness.push).toHaveBeenCalledExactlyOnceWith(expectedDestination);
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.mutate).not.toHaveBeenCalled();
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('clears a canceled category destination when the user chooses Back instead', async () => {
    const changes = { ai_suggestion: categorySuggestion };
    walk(detail(changes)).find(node => node.props.id === 'transaction-notes')!.props.onChange!({ target: { value: 'Unfinished context' } });
    await action(detail(changes), 'Confirm or change category').props.onClick!();
    walk(detail(changes)).find(node => node.props.title === 'Unsaved Changes')!.props.onCancel!();
    expect(harness.push).not.toHaveBeenCalled();
    expect(walk(detail(changes)).find(node => node.props.title === 'Unsaved Changes')!.props.open).toBe(false);
    await walk(detail(changes)).find(node => node.props['aria-label'] === 'Back to transactions')!.props.onClick!();
    const confirmation = walk(detail(changes)).find(node => node.props.title === 'Unsaved Changes')!;
    expect(confirmation.props.open).toBe(true);
    confirmation.props.onConfirm!();
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.back).toHaveBeenCalledOnce();
    expect(harness.push).not.toHaveBeenCalled();
    expect(harness.routerBack).not.toHaveBeenCalled();
    expect(harness.mutate).not.toHaveBeenCalled();
  });

  it('blocks shared navigation for a dirty detail until the user confirms leaving', async () => {
    harness.runEffects = true;
    walk(detail()).find(node => node.props.id === 'transaction-notes')!.props.onChange!({ target: { value: 'Unfinished details' } });
    detail();
    const destination = '/protected/transactions';
    const allowed = requestAppNavigation(destination);
    if (allowed) harness.push(destination); // Same contract used by the persistent navigation.
    expect(allowed).toBe(false);
    expect(harness.push).not.toHaveBeenCalled();
    const confirmation = walk(detail()).find(node => node.props.title === 'Unsaved Changes')!;
    expect(confirmation.props.open).toBe(true);
    confirmation.props.onConfirm!();
    expect(harness.push).toHaveBeenCalledExactlyOnceWith(destination);
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.mutate).not.toHaveBeenCalled();
    expect(harness.back).not.toHaveBeenCalled();
  });

  it('allows shared navigation immediately when the detail has no local changes', () => {
    harness.runEffects = true;
    detail();
    const destination = '/protected?screen=tax-preview';
    expect(requestAppNavigation(destination)).toBe(true);
    expect(walk(detail()).find(node => node.props.title === 'Unsaved Changes')!.props.open).toBe(false);
    expect(harness.mutate).not.toHaveBeenCalled();
  });

  it('uses the latest shared navigation destination after canceling an earlier request', async () => {
    harness.runEffects = true;
    walk(detail()).find(node => node.props.id === 'transaction-notes')!.props.onChange!({ target: { value: 'Keep while choosing' } });
    detail();
    expect(requestAppNavigation('/protected')).toBe(false);
    walk(detail()).find(node => node.props.title === 'Unsaved Changes')!.props.onCancel!();
    expect(harness.push).not.toHaveBeenCalled();
    const destination = '/protected?screen=tax-preview';
    expect(requestAppNavigation(destination)).toBe(false);
    walk(detail()).find(node => node.props.title === 'Unsaved Changes')!.props.onConfirm!();
    expect(harness.push).toHaveBeenCalledExactlyOnceWith(destination);
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.mutate).not.toHaveBeenCalled();
  });

  it('removes the previous dirty listener when changes are reverted', () => {
    harness.runEffects = true;
    walk(detail()).find(node => node.props.id === 'transaction-notes')!.props.onChange!({ target: { value: 'Temporary edit' } });
    detail();
    walk(detail()).find(node => node.props.id === 'transaction-notes')!.props.onChange!({ target: { value: '' } });
    detail();
    expect(requestAppNavigation('/protected')).toBe(true);
    expect(walk(detail()).find(node => node.props.title === 'Unsaved Changes')!.props.open).toBe(false);
  });

  it('removes a dirty detail navigation listener and pending autosave on unmount', async () => {
    harness.runEffects = true;
    walk(detail()).find(node => node.props.id === 'transaction-notes')!.props.onChange!({ target: { value: 'Leaving editor' } });
    detail();
    unmountDetail();
    expect(requestAppNavigation('/protected')).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.mutate).not.toHaveBeenCalled();
  });

  it('preserves a newer local draft when the same record refreshes from an older save', () => {
    harness.runEffects = true;
    walk(detail({ business_purpose: 'Original saved purpose' })).find(node => node.props.id === 'business-purpose')!.props.onChange!({ target: { value: 'New unsaved purpose' } });
    detail({ business_purpose: 'Older in-flight purpose' });
    const field = walk(detail({ business_purpose: 'Older in-flight purpose' })).find(node => node.props.id === 'business-purpose')!;
    expect(field.props.value).toBe('New unsaved purpose');
  });

  it('retains local context when an optimistic update is rolled back after a failed save', async () => {
    harness.runEffects = true;
    harness.mutate.mockRejectedValueOnce(new Error('Synthetic storage failure'));
    walk(detail({ business_purpose: 'Saved purpose' })).find(node => node.props.id === 'business-purpose')!.props.onChange!({ target: { value: 'Keep my draft' } });
    detail({ business_purpose: 'Keep my draft' }); // Optimistic cache notification.
    await vi.advanceTimersByTimeAsync(500);
    detail({ business_purpose: 'Saved purpose' }); // Failed-save rollback.
    expect(walk(detail({ business_purpose: 'Saved purpose' })).find(node => node.props.id === 'business-purpose')!.props.value).toBe('Keep my draft');
    expect(harness.error).toHaveBeenCalledWith('Context not saved', expect.any(String));
  });

  it('waits for edited context to be saved before explicit analysis reads the canonical record', async () => {
    let saved!: () => void;
    harness.mutate.mockReturnValueOnce(new Promise<void>(resolve => { saved = resolve; }));
    harness.fetch.mockImplementation(async () => analyzed());
    walk(detail()).find(node => node.props.placeholder === 'Tell us more about this purchase...')!.props.onChange!({ target: { value: 'New client meeting context' } });
    const pending = action(detail(), 'Run AI Analysis').props.onClick!();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.mutate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ updates: expect.objectContaining({ notes: 'New client meeting context' }) }));
    expect(harness.fetch).not.toHaveBeenCalled();
    saved(); await pending;
    expect(harness.fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.mutate).toHaveBeenCalledOnce(); // Canceled the pending debounce, rather than writing twice.
  });

  it('does not request analysis or discard edited notes when the prerequisite save fails', async () => {
    harness.mutate.mockRejectedValueOnce(new Error('Synthetic unavailable storage'));
    walk(detail()).find(node => node.props.placeholder === 'Tell us more about this purchase...')!.props.onChange!({ target: { value: 'Keep this unsaved context' } });
    await action(detail(), 'Run AI Analysis').props.onClick!();
    const page = detail();
    expect(harness.fetch).not.toHaveBeenCalled(); expect(harness.save).not.toHaveBeenCalled();
    expect(text(page)).toContain('latest context could not be saved');
    expect(walk(page).find(node => node.props.placeholder === 'Tell us more about this purchase...')!.props.value).toBe('Keep this unsaved context');
    expect(action(page, 'Run AI Analysis').props.disabled).toBe(false);
  });

  it('orders an older in-flight autosave before the latest context and never analyzes on autosave alone', async () => {
    let oldSave!: () => void;
    harness.mutate.mockReturnValueOnce(new Promise<void>(resolve => { oldSave = resolve; }));
    harness.fetch.mockImplementation(async () => analyzed());
    walk(detail()).find(node => node.props.placeholder === 'Tell us more about this purchase...')!.props.onChange!({ target: { value: 'Older notes' } });
    await vi.advanceTimersByTimeAsync(500);
    expect(harness.mutate).toHaveBeenCalledOnce(); expect(harness.fetch).not.toHaveBeenCalled();
    walk(detail()).find(node => node.props.placeholder === 'Tell us more about this purchase...')!.props.onChange!({ target: { value: 'Latest notes' } });
    const pending = action(detail(), 'Run AI Analysis').props.onClick!();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.mutate).toHaveBeenCalledOnce(); expect(harness.fetch).not.toHaveBeenCalled();
    oldSave(); await pending;
    expect(harness.mutate).toHaveBeenCalledTimes(2);
    expect(harness.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ updates: expect.objectContaining({ notes: 'Latest notes' }) }));
    expect(harness.fetch).toHaveBeenCalledOnce();
  });

  it('ignores an analysis response after navigating to another transaction', async () => {
    let complete!: (response: Response) => void;
    harness.fetch.mockReturnValueOnce(new Promise<Response>(resolve => { complete = resolve; }));
    const pending = action(detail(), 'Run AI Analysis').props.onClick!();
    await vi.advanceTimersByTimeAsync(0);
    detail({ id: 'another-transaction', trans_id: 'another-transaction' });
    complete(analyzed()); await pending;
    expect(harness.save).not.toHaveBeenCalled(); expect(harness.success).not.toHaveBeenCalled();
  });

  it.each(['summary', 'details'])('cancels a pending camera permission request when leaving Receipt for %s', async destination => {
    harness.runEffects = true;
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    let allowCamera!: (stream: MediaStream) => void;
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(() => new Promise<MediaStream>(resolve => { allowCamera = resolve; })) } });
    const tabs = () => walk(detail()).find(node => node.props.onValueChange)!;
    tabs().props.onValueChange!('receipt');
    const permission = action(detail(), 'Photo').props.onClick!();
    tabs().props.onValueChange!(destination);
    allowCamera(stream);
    await permission;
    expect(stop).toHaveBeenCalledOnce();
    expect(tabs().props.value).toBe(destination);
    expect(walk(detail()).some(node => node.type === 'video')).toBe(false);
    expect(harness.error).not.toHaveBeenCalled();
  });

  it('stops the camera when analysis completion returns Receipt to Summary programmatically', async () => {
    harness.runEffects = true;
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
    let complete!: (response: Response) => void;
    harness.fetch.mockReturnValueOnce(new Promise<Response>(resolve => { complete = resolve; }));
    const analysis = action(detail(), 'Run AI Analysis').props.onClick!();
    await vi.advanceTimersByTimeAsync(0);
    walk(detail()).find(node => node.props.onValueChange)!.props.onValueChange!('receipt');
    await action(detail(), 'Photo').props.onClick!();
    expect(walk(detail()).some(node => node.type === 'video')).toBe(true);
    expect(stop).not.toHaveBeenCalled();
    complete(analyzed());
    await analysis;
    expect(stop).toHaveBeenCalledOnce();
    expect(walk(detail()).find(node => node.props.onValueChange)!.props.value).toBe('summary');
    expect(walk(detail()).some(node => node.type === 'video')).toBe(false);
    expect(harness.save).toHaveBeenCalledOnce();
  });

  it.each(['summary', 'details'] as const)('stops the receipt camera and opens %s when transaction identity changes', async initialSection => {
    harness.runEffects = true;
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
    walk(detail()).find(node => node.props.onValueChange)!.props.onValueChange!('receipt');
    await action(detail(), 'Photo').props.onClick!();
    expect(stop).not.toHaveBeenCalled();
    detail({ id: 'next-record', trans_id: 'next-record' }, initialSection);
    const next = detail({ id: 'next-record', trans_id: 'next-record' }, initialSection);
    expect(stop).toHaveBeenCalledOnce();
    expect(walk(next).find(node => node.props.onValueChange)!.props.value).toBe(initialSection);
    expect(walk(next).some(node => node.type === 'video')).toBe(false);
  });

  it('preserves receipt unlink through the authenticated mutation', async () => {
    await action(detail({ receipt_url: '/api/receipts/synthetic', receipt_filename: 'receipt.png' }), 'Delete').props.onClick!();
    expect(harness.mutate).toHaveBeenCalledExactlyOnceWith({ transactionId: 'detail-id', userId: 'new-accountless-user', updates: { receipt_url: '', receipt_filename: '' } });
    expect(harness.save).toHaveBeenCalledWith(expect.objectContaining({ receipt_url: undefined, receipt_filename: undefined }));
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('allows configured AI in a local demo and suppresses duplicate in-flight clicks', async () => {
    harness.localPreview = true;
    let complete!: (response: Response) => void;
    harness.fetch.mockReturnValue(new Promise<Response>(resolve => { complete = resolve; }));
    const button = action(detail(), 'Run AI Analysis');
    const pending = button.props.onClick!();
    await button.props.onClick!(); await Promise.resolve();
    expect(harness.fetch).toHaveBeenCalledOnce();
    expect(harness.mutate).not.toHaveBeenCalled(); // Unchanged context adds no write.
    complete(Response.json({ success: true, analysis: { deductionStatus: 'Possibly Deductible', reasoning: 'Review the meal business purpose.', confidence: 0.7, irsReference: { publication: '463' }, updatedAt: '2026-09-16T12:00:00Z' } }));
    await pending;
    expect(harness.save).toHaveBeenCalledWith(expect.objectContaining({ reasoning: 'Review the meal business purpose.', is_deductible: true }));
    expect(harness.error).not.toHaveBeenCalled();
    expect(action(detail(), 'Run AI Analysis').props.disabled).toBe(false);
  });
});
