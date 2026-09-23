import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { buildMonthlySavings } from '@/lib/tax/savings-summary';

const state = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[],
  profile: { income: 100000, filing_status: 'single' }, transactions: { transactions: [] as Record<string, unknown>[] },
  reports: {} as any, fetching: false, refetch: vi.fn(), toast: vi.fn() }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[] | undefined) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const hooks = {
    useState(initial: unknown) { const index = state.cursor++; if (!(index in state.slots)) state.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [state.slots[index], (next: unknown) => { state.slots[index] = typeof next === 'function' ? next(state.slots[index]) : next; }]; },
    useMemo(callback: () => unknown, deps: unknown[]) { const index = state.cursor++;
      if (!same(state.slots[index]?.deps, deps)) state.slots[index] = { deps, value: callback() }; return state.slots[index].value; },
    useEffect(callback: () => unknown, deps: unknown[]) { const index = state.cursor++;
      if (!same(state.slots[index]?.deps, deps)) { state.slots[index] = { deps }; state.effects.push(callback); } },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {} }) }));
vi.mock('sonner', () => ({ toast: { error: state.toast, warning: state.toast } }));
vi.mock('@/lib/firebase/client', () => ({ auth: { currentUser: { getIdToken: async () => 'synthetic' } } }));
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: { id: 'reports-owner' }, loading: false }) }));
vi.mock('@/lib/firebase/profiles', () => ({ getUserProfile: async () => ({ data: state.profile }) }));
vi.mock('@/lib/hooks/use-subscription', () => ({ useSubscription: () => ({ canAccess: () => true, isLoading: false }) }));
vi.mock('@/lib/react-query/hooks', () => ({
  useMonthlyDeductions: () => ({ data: state.reports, isLoading: false, isFetching: state.fetching, error: null, refetch: state.refetch }),
  useTransactions: () => ({ data: state.transactions, isLoading: false, isFetching: false, error: null }),
}));
vi.mock('@/components/ui/toast', () => ({ ToastContainer: 'ToastContainer', useToasts: () => ({ toasts: [], removeToast() {} }) }));
import ReportsPage from '@/app/protected/reports/page';

type Element = ReactElement<Record<string, any>>;
function render() { state.cursor = 0; const tree = ReportsPage() as Element; state.effects.splice(0).forEach(effect => effect()); return tree; }
function walk(node: any): Element[] { return Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : []; }
function text(node: any): string { return Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
async function ready() { render(); await new Promise<void>(resolve => setImmediate(resolve)); return render(); }
const expense = (facts: Record<string, unknown> = {}) => ({ id: 'charge', date: '2026-09-01', amount: 100,
  iso_currency_code: 'USD', is_deductible: true, review_status: 'confirmed', category: 'office_expense', merchant_name: 'Supplier', ...facts });
function records(rows: Record<string, unknown>[], rate = .2, year = 2026) {
  state.transactions = { transactions: rows };
  state.reports = { data: buildMonthlySavings(rows, year, rate, new Date('2026-09-23T12:00:00Z')) };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
  state.slots = []; state.cursor = 0; state.effects = []; state.fetching = false;
  state.profile = { income: 100000, filing_status: 'single' }; state.refetch.mockReset(); state.toast.mockReset();
  records([expense()]);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Reports planning labels and confirmed month drilldown', () => {
  it('shows the endpoint approximation notice and keeps zero-rate deductions visible and clickable', async () => {
    state.profile.income = 0;
    records([expense()], 0);
    const tree = await ready();
    const content = text(tree);
    expect(content).toContain(state.reports.data.estimateNotice);
    expect(content).toContain('$100.00 confirmed deduction basis');
    expect(content).toContain('Confirmed deductions; $0 income-tax approximation');
    expect(content).not.toContain('No deductible expenses');
    expect(content).not.toContain('YTD Tax Savings');
    const month = walk(tree).find(node => node.props?.['aria-label']?.startsWith('Review Sep'))!;
    month.props.onClick();
    expect(text(render())).toContain('Confirmed deduction basis: $100.00');
  });

  it('drills into signed, confirmed meal contributions instead of absolute charge amounts', async () => {
    records([expense({ id: 'meal', category: 'FOOD_AND_DRINK_RESTAURANT', amount: 100 }),
      expense({ id: 'refund', category: 'FOOD_AND_DRINK_RESTAURANT', amount: -20 }),
      expense({ id: 'pending', amount: 9000, pending: true }), expense({ id: 'unreviewed', amount: 8000, review_status: 'pending_review' })]);
    const tree = await ready();
    walk(tree).find(node => node.props?.['aria-label']?.startsWith('Review Sep'))!.props.onClick();
    const content = text(render());
    expect(content).toContain('Confirmed deduction basis: $40.00');
    expect(content).toContain('Deduction basis · recorded -$20.00');
    expect(content).toContain('-$10.00');
    expect(content).not.toContain('Score:');
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/transactions?'))).toBe(false);
  });

  it('withholds mixed-currency cash amounts while keeping a valid confirmed USD estimate', async () => {
    records([expense(), expense({ id: 'foreign', amount: 1234, is_deductible: false, iso_currency_code: 'EUR' })]);
    const content = text(await ready());
    expect(content).toContain('Paid/Received amounts need review');
    expect(content).toContain('Paid: Review needed');
    expect(content).not.toContain('$1,334.00');
  });

  it('uses December for a historical year and rejects mismatched cached drilldown amounts', async () => {
    records([expense({ date: '2025-12-10' })], .2, 2025);
    const tree = await ready();
    expect(text(tree)).toContain('December Approx.');
    state.transactions.transactions[0].amount = 999;
    walk(tree).find(node => node.props?.['aria-label']?.startsWith('Review Dec'))!.props.onClick();
    expect(state.refetch).toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('Report and transaction records changed'));
    expect(text(render())).not.toContain('Detailed Breakdown');
  });

  it('hides prior totals while the monthly estimate refreshes', async () => {
    expect(text(await ready())).toContain('$100.00 confirmed deduction basis');
    state.fetching = true;
    expect(text(render())).not.toContain('$100.00 confirmed deduction basis');
  });
});
