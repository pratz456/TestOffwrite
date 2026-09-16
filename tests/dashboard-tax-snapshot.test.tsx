import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { ReactElement } from 'react';

// Actual dashboard effect/request handlers -> actual 1040 route/snapshot -> cards.
// Firebase reads and HTTP transport are synthetic; this is not a browser test.
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[],
  uid: 'dashboard-owner', profile: {} as Record<string, unknown>, tx: [] as Record<string, unknown>[],
  records: {} as Record<string, Record<string, unknown>[]>, paid: 0, apiError: null as string | null,
  request: vi.fn(), lastJson: null as any,
}));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial: unknown) {
      const i = h.cursor++;
      if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial;
      return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next; }];
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const i = h.cursor++, previous = h.slots[i];
      if (!same(previous?.deps, deps)) {
        const next: any = { deps }; h.slots[i] = next;
        h.effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
      }
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {} }) }));
vi.mock('@/lib/firebase/client', () => ({ auth: { get currentUser() { return { uid: h.uid, getIdToken: async () => 'synthetic-token' }; } } }));
vi.mock('@/lib/firebase/hooks', () => ({ useTransactions: () => ({ transactions: h.tx, isLoading: false }), useUserStats: () => ({ stats: {}, isLoading: false }) }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: h.request }));
vi.mock('@/components/ui/toast', () => ({ ToastContainer: 'ToastContainer', useToasts: () => ({ toasts: [], removeToast() {} }) }));
vi.mock('@/components/historical-access-upgrade-card', () => ({ HistoricalAccessUpgradeCard: 'HistoricalAccessUpgradeCard' }));
vi.mock('@/components/dashboard/index', () => Object.fromEntries(['DashboardHeader', 'KpiGrid', 'AnalyticsPanel', 'OptimizationCard', 'TopCategoriesCard', 'RecentActivityCard', 'AiAdvisoryCard', 'QuickActionsBar', 'ActionItemsBanner'].map(n => [n, n])));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: h.uid } }) }));
vi.mock('@/lib/reports/export-records', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/reports/export-records')>(), readOwnedTransactions: async () => { if (h.apiError) throw new Error(h.apiError); return h.tx; } }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: async () => ({ data: h.tx, error: h.apiError }) }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: async () => ({ data: h.profile, error: null }) }));
vi.mock('@/lib/firebase/settings-server', () => ({ getAssetsSettings: async () => ({ data: [], error: null }) }));
vi.mock('@/lib/firebase/quarterly-payments-server', () => ({ getRecordedQuarterlyPayments: async () => [], totalRecordedPayments: () => h.paid }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => ({
  where() { return this; }, limit() { return this; },
  get: async () => ({ empty: !h.records[name]?.length, docs: (h.records[name] || []).map((data, i) => ({ id: String(i), data: () => data })) }),
}) } }));
import DashboardScreen from '../components/dashboard-screen';
import { KpiGrid } from '../components/dashboard/KpiGrid';
import { GET } from '../app/api/tax/compute-1040/route';
import { loadDashboardTaxSnapshot } from '../lib/tax/dashboard-snapshot';

type Element = ReactElement<Record<string, any>>;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function walk(node: any): Element[] { return Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : []; }
function text(node: any): string { return Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function render() {
  h.cursor = 0;
  const tree = DashboardScreen({ profile: h.profile, transactions: h.tx, onNavigate() {}, onTransactionClick() {} });
  const props = walk(tree).find(n => n.type === ('KpiGrid' as any))!.props;
  h.effects.splice(0).forEach(effect => effect());
  return { ...props, header: walk(tree).find(n => n.type === ('DashboardHeader' as any))!.props };
}
function cards(props: Record<string, any>) { return walk(KpiGrid(props as any)).filter(n => typeof n.props.title === 'string' && 'value' in n.props).map(n => n.props); }
async function transport(url: string) {
  if (!url.includes('compute-1040')) return Response.json({ data: {} });
  const response = await GET(new NextRequest(`http://localhost${url}`));
  h.lastJson = await response.clone().json();
  return response;
}
function expense(amount: number, extra = {}) { return { amount, date: '2026-09-02', category: 'office_expense', is_deductible: true, ...extra }; }
beforeEach(() => {
  h.slots = []; h.cursor = 0; h.effects = []; h.uid = 'dashboard-owner';
  h.profile = { id: h.uid, filing_status: 'Single' }; h.tx = []; h.records = { tax_organizers: [reviewedPersonalDeductionOrganizer()] }; h.paid = 0; h.apiError = null; h.lastJson = null;
  h.request.mockReset().mockImplementation(transport);
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
});
afterEach(() => { for (const slot of h.slots) slot?.cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('dashboard tax cards share the federal server calculation', () => {
  it('excludes the reported personal/unreviewed debits instead of showing a -$68 tax profit', async () => {
    h.tx = [expense(42.5, { is_deductible: false }), expense(25, { is_deductible: null })];
    const pending = render(); expect(pending.state).toEqual({ status: 'loading' }); expect(cards(pending)).toEqual([]);
    await flush(); const ready = render();
    expect(ready.state.snapshot.income).toEqual({ grossReceipts: 0, scheduleCNetProfit: 0, totalDeductible: 0 });
    expect(cards(ready)[0].value).toBe('$0.00');
    expect(h.request).toHaveBeenCalledWith('/api/tax/compute-1040?year=2026', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
  });
  it('uses actual route year/confirmation/pending/category/refund rules and exact JSON totals', async () => {
    h.tx = [
      { amount: -100000, date: '2026-02-01', category: 'income' },
      expense(20), expense(42.5, { is_deductible: false }), expense(25, { is_deductible: null }),
      expense(75, { pending: true }), expense(90, { date: '2025-12-31' }),
      expense(100, { category: 'FOOD_AND_DRINK_RESTAURANT' }), expense(-5),
      { amount: -500, date: '2026-02-01', category: 'transfer', is_deductible: false },
    ];
    render(); await flush(); const props = render(), income = props.state.snapshot.income;
    expect(income).toEqual({ grossReceipts: 100000, totalDeductible: 65, scheduleCNetProfit: 99935 });
    expect(h.lastJson.income).toMatchObject(income);
    expect(props.state.snapshot.form1040.totalTax).toBe(h.lastJson.form1040.totalTax);
    expect(cards(props).map(c => c.title)).toEqual(['Schedule C Profit', 'Confirmed Business Expenses', 'Federal Tax Estimate', 'Estimated Federal Balance']);
    expect(cards(props)[2].value).toBe(h.lastJson.form1040.totalTax.toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
    expect(cards(props)[3].value).toBe(h.lastJson.form1040.balanceDue.toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
    expect(props.state.snapshot.form1040.calculationWarnings.some((s: string) => s.includes('inflow'))).toBe(true);
  });
  it('includes recorded withholding/payments in the exact federal refund card', async () => {
    h.records.w2_income = [{ wages: 30000, federalWithheld: 5000, socialSecurityWages: 30000, medicareWages: 30000 }];
    h.paid = 100;
    render(); await flush(); const props = render();
    expect(cards(props)[3].title).toBe('Estimated Federal Refund');
    expect(cards(props)[3].value).toBe(h.lastJson.form1040.refund.toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
  });
  it.each(['income', 'status', 'personal', 'dependent'])('422 %s review cannot become zero tax or stale previous totals', async kind => {
    render(); await flush(); render();
    if (kind === 'income') { h.tx = [{ amount: -100, category: 'income', date: '2026-01-01' }]; h.records.gross_receipts = [{ amount: 100 }]; }
    else if (kind === 'personal' || kind === 'dependent') {
      h.records.tax_organizers = kind === 'personal' ? [] : [reviewedPersonalDeductionOrganizer(2026, {}, { dependents: '1' })];
      h.profile = { ...h.profile, updated_at: 'synthetic-review-refresh' }; // A saved-data refresh invalidates the cached snapshot.
    }
    else h.profile = { ...h.profile, filing_status: 'Qualifying Widower' };
    expect(render().state.status).toBe('loading'); await flush(); const props = render();
    expect(props.state.status).toBe('review'); expect(props.state).not.toHaveProperty('snapshot'); expect(cards(props)).toEqual([]);
    const nav = vi.fn(); const tree = KpiGrid({ ...props, onReview: nav } as any);
    expect(text(tree)).toContain('needs review');
    walk(tree).find(n => n.type === 'button' && text(n).startsWith('Review'))!.props.onClick();
    expect(nav).toHaveBeenCalledWith(kind === 'income' ? 'income-tracking' : kind === 'status' ? 'settings' : 'tax-organizer');
  });
  it('clears prior values while transaction changes refresh and preserves an actionable 503', async () => {
    render(); await flush(); const ready = render(); expect(ready.state.status).toBe('ready');
    h.tx = [expense(20)]; h.apiError = 'synthetic unavailable';
    expect(render().state.status).toBe('loading'); await flush(); const error = render();
    expect(error.state.status).toBe('error'); expect(cards(error)).toEqual([]);
    h.apiError = null; error.onRetry(); expect(render().state.status).toBe('loading'); await flush();
    expect(render().state.snapshot.income.scheduleCNetProfit).toBe(-20);
  });
  it('header refresh recalculates without a Plaid request for an accountless user', async () => {
    render(); await flush(); const ready = render();
    h.records.gross_receipts = [{ amount: 25000 }];
    await ready.header.onRefresh();
    expect(render().state.status).toBe('loading'); await flush();
    expect(render().state.snapshot.income.grossReceipts).toBe(25000);
    expect(h.request.mock.calls.some(([url]) => url.includes('/plaid/refresh-balances'))).toBe(false);
  });
  it('ignores an old user request after a new user calculation is ready', async () => {
    let finish!: (value: Response) => void;
    h.request.mockImplementationOnce(() => Promise.resolve(Response.json({ data: {} })))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    render(); h.uid = 'next-owner'; h.profile = { ...h.profile, id: h.uid };
    render(); await flush(); expect(render().state.snapshot.income.grossReceipts).toBe(0);
    finish(Response.json({ taxYear: 2026, income: { grossReceipts: 999, totalDeductible: 0, scheduleCNetProfit: 999 }, form1040: { totalTax: 999, balanceDue: 999, refund: 0 } }));
    await flush(); expect(render().state.snapshot.income.grossReceipts).toBe(0);
  });
  it.each([{ taxYear: 2025 }, { income: { grossReceipts: '0' } }, { form1040: { totalTax: null } }])('rejects mismatched/malformed snapshots %j', async override => {
    const real = await (await GET(new NextRequest('http://localhost/api/tax/compute-1040?year=2026'))).json();
    h.request.mockResolvedValue(Response.json({ ...real, ...override }));
    const result = await loadDashboardTaxSnapshot(2026); expect(result.status).toBe('error'); expect(result).not.toHaveProperty('snapshot');
  });
});
