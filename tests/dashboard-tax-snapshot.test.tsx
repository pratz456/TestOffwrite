import { dashboardTaxFactsFromReads } from '../lib/tax/dashboard-tax-input';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { reviewedBusinessLossFacts } from './fixtures/tier1-facts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { ReactElement } from 'react';

// Actual dashboard effect/request handlers -> actual 1040 route/snapshot -> cards.
// Firebase reads and HTTP transport are synthetic; this is not a browser test.
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[],
  uid: 'dashboard-owner', profile: {} as Record<string, unknown>, tx: [] as Record<string, unknown>[],
  records: {} as Record<string, Record<string, unknown>[]>, paid: 0, apiError: null as string | null,
  request: vi.fn(), lastJson: null as any,
  taxFacts: undefined as {
    amountOtherIncome: string | number | null;
    dependents: string | number | null;
    payments: { quarter: number; paidAmount: number }[];
    notes?: string;
  } | undefined,
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
vi.mock('@/lib/firebase/settings-server', () => ({ getAssetsSettings: async () => ({ data: [], error: null }), getScheduleCSettings: async () => ({ data: { assets: [], homeOffice: null, depreciationElections: { deMinimisSafeHarborYears: [] } }, error: null }) }));
vi.mock('@/lib/firebase/quarterly-payments-server', () => ({ getRecordedQuarterlyPayments: async () => [], totalRecordedPayments: () => h.paid }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => ({
  where() { return this; }, limit() { return this; },
  get: async () => ({ empty: !h.records[name]?.length, docs: (h.records[name] || []).map((data, i) => ({ id: String(i), data: () => data })) }),
}) } }));
import DashboardScreen from '../components/dashboard-screen';
import { KpiGrid } from '../components/dashboard/KpiGrid';
import { OptimizationCard } from '../components/dashboard/OptimizationCard';
import { TopCategoriesCard } from '../components/dashboard/TopCategoriesCard';
import { RecentActivityCard } from '../components/dashboard/RecentActivityCard';
import { summarizeDashboardRecords } from '../lib/dashboard/record-summary';
import { GET } from '../app/api/tax/compute-1040/route';
import { loadDashboardTaxSnapshot } from '../lib/tax/dashboard-snapshot';
import { notifyDashboardTaxInputsUpdated } from '../lib/tax/dashboard-tax-input';

type Element = ReactElement<Record<string, any>>;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function walk(node: any): Element[] { return Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : []; }
function text(node: any): string { return Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function render() {
  h.cursor = 0;
  const tree = DashboardScreen({ profile: h.profile, transactions: h.tx, onNavigate() {}, onTransactionClick() {}, ...(h.taxFacts ? { taxFacts: h.taxFacts } : {}) });
  const props = walk(tree).find(n => n.type === ('KpiGrid' as any))!.props;
  h.effects.splice(0).forEach(effect => effect());
  return { ...props, header: walk(tree).find(n => n.type === ('DashboardHeader' as any))!.props,
    quickActions: walk(tree).find(n => n.type === ('QuickActionsBar' as any))!.props,
    advisory: walk(tree).find(n => n.type === ('AiAdvisoryCard' as any))?.props,
    recordStatus: walk(tree).find(n => n.type === ('OptimizationCard' as any))!.props,
    categories: walk(tree).find(n => n.type === ('TopCategoriesCard' as any))!.props };
}
function cards(props: Record<string, any>) {
  return walk(KpiGrid(props as any)).flatMap(node => {
    const children = Array.isArray(node.props?.children) ? node.props.children : [];
    const term = children.find(child => child?.type === 'dt');
    const value = children.find(child => child?.type === 'dd');
    return term && value && /^-?\$[\d,.]+$/.test(text(value)) ? [{ title: text(term), value: text(value) }] : [];
  });
}
function valueFor(props: Record<string, any>, title: string) { return cards(props).find(card => card.title === title)?.value; }
async function transport(url: string) {
  if (!url.includes('compute-1040')) return Response.json({ data: {} });
  const response = await GET(new NextRequest(`http://localhost${url}`));
  h.lastJson = await response.clone().json();
  return response;
}
function expense(amount: number, extra = {}) { return { amount, date: '2026-09-02', iso_currency_code: 'USD', category: 'office_expense', is_deductible: true, ...extra }; }
beforeEach(() => {
  h.slots = []; h.cursor = 0; h.effects = []; h.uid = 'dashboard-owner';
  h.profile = { id: h.uid, filing_status: 'Single', income: 0 }; h.tx = []; h.records = { tax_organizers: [reviewedPersonalDeductionOrganizer()] }; h.paid = 0; h.apiError = null; h.lastJson = null; h.taxFacts = undefined;
  h.request.mockReset().mockImplementation(transport);
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
});
afterEach(() => { for (const slot of h.slots) slot?.cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('dashboard tax cards share the federal server calculation', () => {
  it('secondary cards count posted marked records and net expense refunds, without an analysis-based verification percentage', async () => {
    h.tx = [
      expense(100), expense(-20, { type: 'income' }), expense(200, { category: 'FOOD_AND_DRINK_RESTAURANT' }),
      expense(30, { category: 'travel', date: '2025-12-31' }), expense(500, { pending: true }),
      expense(-100000, { category: 'income', is_deductible: false }),
      expense(42.5, { is_deductible: false }), expense(25, { is_deductible: null }),
    ].map((record, index) => ({ ...record, id: String(index), iso_currency_code: 'USD' }));
    const props = render(); await flush();
    expect(props.recordStatus).toMatchObject({ totalTransactions: 8, deductibleCount: 4, pendingCount: 1, needsReviewCount: 1 });
    expect(props.categories.categories).toContainEqual(['OFFICE_AND_EQUIPMENT', 80]);
    expect(props.categories.categories).toContainEqual(['TRAVEL', 30]); // Clearly all-date record summary, separate from current-year tax.
    expect(props.categories.categories.some(([name]: [string, number]) => name === 'INCOME')).toBe(false);
    const status = text(OptimizationCard(props.recordStatus as any));
    expect(status).toContain('Posted records marked deductible4');
    expect(status).toContain('Pending transactions1');
    expect(status).not.toMatch(/Expenses verified|Confirmed deductions|88%/);
    const categories = text(TopCategoriesCard(props.categories as any));
    expect(categories).toContain('$80.00'); expect(categories).not.toContain('$120.00');
    expect(categories).toContain('Refunds reduce totals; tax limits are not applied');
  });

  it('recent activity keeps refund category/direction, explicit income, pending and skipped statuses distinct', () => {
    const tx = [
      expense(-20, { id: 'refund', merchant_name: 'Office refund', type: 'income' }),
      expense(-1000, { id: 'income', merchant_name: 'Client receipt', category: 'revenue', is_deductible: false }),
      expense(500, { id: 'pending', merchant_name: 'Pending equipment', pending: true }),
      expense(25, { id: 'review', merchant_name: 'Review expense', is_deductible: null }),
      expense(10, { id: 'skipped', merchant_name: 'Skipped expense', is_deductible: null, user_classification_reason: 'Skipped by user' }),
    ];
    const click = vi.fn();
    const row = (merchant: string) => {
      const tree = RecentActivityCard({ transactions: tx.filter(record => record.merchant_name === merchant), onTransactionClick: click, onViewAll() {} });
      return walk(tree).find(n => n.props?.role === 'button' && text(n).includes(merchant))!;
    };
    expect(text(row('Office refund'))).toContain('Credit / refund · Office & Equipment');
    expect(text(row('Office refund'))).toContain('+$20.00');
    expect(text(row('Office refund'))).not.toContain('Income');
    expect(text(row('Client receipt'))).toContain('Income'); expect(text(row('Client receipt'))).not.toContain('Personal');
    expect(text(row('Pending equipment'))).toContain('Pending'); expect(text(row('Pending equipment'))).not.toContain('Marked deductible');
    expect(text(row('Review expense'))).toContain('Needs review');
    expect(text(row('Skipped expense'))).toContain('Skipped'); expect(text(row('Skipped expense'))).not.toContain('Personal');
    row('Office refund').props.onClick(); expect(click).toHaveBeenCalledWith({ ...tx[0], _source: 'dashboard' });
  });

  it.each([{ iso_currency_code: undefined }, { iso_currency_code: 'CAD' }, { iso_currency_code: 'USD', amount: NaN }, { iso_currency_code: 'USD', amount: Infinity }])('withholds category money totals for ambiguous currency/amount %j while retaining record counts', bad => {
    const summary = summarizeDashboardRecords([expense(100, { iso_currency_code: 'USD' }), expense(-20, bad)]);
    expect(summary.deductibleCount).toBe(2);
    expect(summary.categoryEntries).toEqual([]); expect(summary.categoryIssue).toBeTruthy();
    const tree = TopCategoriesCard({ categories: summary.categoryEntries, totalMagnitude: summary.categoryMagnitude, reviewMessage: summary.categoryIssue, onViewAll() {} });
    expect(text(tree)).toContain(summary.categoryIssue!); expect(text(tree)).not.toContain('$');
  });

  it('keeps a net-credit category signed and its chart width nonnegative', () => {
    const summary = summarizeDashboardRecords([expense(10, { iso_currency_code: 'USD' }), expense(-30, { iso_currency_code: 'USD' })]);
    expect(summary.categoryEntries).toEqual([['OFFICE_AND_EQUIPMENT', -20]]);
    const tree = TopCategoriesCard({ categories: summary.categoryEntries, totalMagnitude: summary.categoryMagnitude, onViewAll() {} });
    expect(text(tree)).toContain('-$20.00');
    expect(walk(tree).filter(n => typeof n.props?.style?.width === 'string').map(n => n.props.style.width)).not.toContain('-100%');
  });

  it('removes confirmed records while keeping skipped records unresolved', async () => {
    h.profile.income = 100000;
    h.tx = [expense(20), expense(30, { is_deductible: false }),
      expense(40, { is_deductible: null, user_classification_reason: 'Skipped by user' })];
    const reviewed = render(); await flush();
    expect(reviewed.quickActions).toMatchObject({ needsReviewCount: 1, needsAnalysisCount: 1 });
    expect(reviewed.advisory).toMatchObject({ needsReviewCount: 1, needsAnalysisCount: 1 });
    h.tx = [...h.tx, expense(50, { is_deductible: null })];
    const pending = render(); await flush();
    expect(pending.quickActions).toMatchObject({ needsReviewCount: 2, needsAnalysisCount: 2 });
    expect(pending.advisory).toMatchObject({ needsReviewCount: 2, needsAnalysisCount: 2 });
  });
  it('excludes the reported personal/unreviewed debits instead of showing a -$68 tax profit', async () => {
    h.tx = [expense(42.5, { is_deductible: false }), expense(25, { is_deductible: null })];
    const pending = render(); expect(pending.state).toEqual({ status: 'loading' }); expect(cards(pending)).toEqual([]);
    await flush(); const ready = render();
    expect(ready.state.snapshot.income).toEqual({ grossReceipts: 0, scheduleCNetProfit: 0, totalDeductible: 0 });
    expect(valueFor(ready, 'Schedule C profit')).toBe('$0.00');
    expect(h.request).toHaveBeenCalledWith('/api/tax/compute-1040?year=2026', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
  });
  it('uses actual route year/confirmation/pending/category/refund rules and exact JSON totals', async () => {
    h.tx = [
      { amount: -100000, date: '2026-02-01', iso_currency_code: 'USD', category: 'income' },
      expense(20), expense(42.5, { is_deductible: false }), expense(25, { is_deductible: null }),
      expense(75, { pending: true }), expense(90, { date: '2025-12-31' }),
      expense(100, { category: 'FOOD_AND_DRINK_RESTAURANT' }), expense(-5),
      { amount: -500, date: '2026-02-01', iso_currency_code: 'USD', category: 'transfer', is_deductible: false },
    ];
    render(); await flush(); const props = render(), income = props.state.snapshot.income;
    expect(income).toEqual({ grossReceipts: 100000, totalDeductible: 65, scheduleCNetProfit: 99935 });
    expect(h.lastJson.income).toMatchObject(income);
    expect(props.state.snapshot.form1040.totalTax).toBe(h.lastJson.form1040.totalTax);
    expect(cards(props).map(c => c.title)).toEqual(['Estimated federal balance', 'Schedule C profit', 'Confirmed expenses', 'Annual federal tax estimate']);
    expect(valueFor(props, 'Annual federal tax estimate')).toBe(h.lastJson.form1040.totalTax.toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
    expect(valueFor(props, 'Estimated federal balance')).toBe(h.lastJson.form1040.balanceDue.toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
    expect(props.state.snapshot.form1040.calculationWarnings.some((s: string) => s.includes('inflow'))).toBe(true);
  });
  it('includes recorded withholding/payments in the exact federal refund card', async () => {
    h.records.w2_income = [{ wages: 30000, federalWithheld: 5000, socialSecurityWages: 30000, medicareWages: 30000 }];
    h.paid = 100;
    render(); await flush(); const props = render();
    expect(cards(props).some(card => card.title === 'Estimated federal balance')).toBe(false);
    expect(valueFor(props, 'Estimated federal refund')).toBe(h.lastJson.form1040.refund.toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
  });
  it.each(['income', 'status', 'personal', 'dependent', 'loss'])('422 %s review cannot become zero tax or stale previous totals', async kind => {
    render(); await flush(); render();
    if (kind === 'income') { h.tx = [{ amount: -100, category: 'income', date: '2026-01-01', iso_currency_code: 'USD' }]; h.records.gross_receipts = [{ amount: 100 }]; }
    else if (kind === 'loss') h.tx = [expense(20)]; // A Schedule C loss without at-risk/participation/profit-motive facts is review-blocked, not clamped to $0.
    else if (kind === 'personal' || kind === 'dependent') {
      h.records.tax_organizers = kind === 'personal' ? [] : [reviewedPersonalDeductionOrganizer(2026, {}, { dependents: '1' })];
      h.profile = { ...h.profile, updated_at: 'synthetic-review-refresh' }; // A saved-data refresh invalidates the cached snapshot.
    }
    else h.profile = { ...h.profile, filing_status: 'Qualifying Widower' };
    expect(render().state.status).toBe('loading'); await flush(); const props = render();
    expect(props.state.status).toBe('review'); expect(props.state).not.toHaveProperty('snapshot'); expect(cards(props)).toEqual([{ title: '2026 confirmed expenses', value: kind === 'loss' ? '$20.00' : '$0.00' }]);
    if (kind === 'loss') expect(h.lastJson).toMatchObject({ code: 'BUSINESS_LOSS_REVIEW_REQUIRED' });
    const nav = vi.fn(); const tree = KpiGrid({ ...props, onReview: nav } as any);
    expect(text(tree)).toContain('needs review');
    walk(tree).find(n => n.type === 'button' && text(n).startsWith('Review'))!.props.onClick();
    expect(nav).toHaveBeenCalledWith(kind === 'income' ? 'income-tracking' : kind === 'status' ? 'settings' : 'tax-organizer');
  });
  it('clears prior values while transaction changes refresh and preserves an actionable 503', async () => {
    // The refreshed records show a $20 Schedule C loss, which needs the saved loss-year declarations.
    h.records.tax_organizers = [reviewedPersonalDeductionOrganizer(2026, {}, { businessLossFacts: reviewedBusinessLossFacts() })];
    render(); await flush(); const ready = render(); expect(ready.state.status).toBe('ready');
    h.tx = [expense(20)]; h.apiError = 'synthetic unavailable';
    expect(render().state.status).toBe('loading'); await flush(); const error = render();
    expect(error.state.status).toBe('error'); expect(cards(error)).toEqual([{ title: '2026 confirmed expenses', value: '$20.00' }]);
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
  it('keeps ready tax cards stable across AI-only progress updates', async () => {
    h.records.tax_organizers = [reviewedPersonalDeductionOrganizer(2026, {}, { businessLossFacts: reviewedBusinessLossFacts() })];
    h.tx = [expense(20, { id: 'expense', trans_id: 'expense', updated_at: 1 })];
    render(); await flush(); const ready = render();
    expect(ready.state.status).toBe('ready');
    const taxCalls = h.request.mock.calls.filter(([url]) => String(url).includes('/api/tax/compute-1040')).length;
    h.tx = [{ ...h.tx[0], analysisStatus: 'running', ai_status: 'needs_more_info', analysisUpdatedAt: 'later' }];
    expect(render().state.status).toBe('ready');
    await flush();
    expect(h.request.mock.calls.filter(([url]) => String(url).includes('/api/tax/compute-1040'))).toHaveLength(taxCalls);
  });
  it.each([
    'income',
    'business_income',
    'w2_income',
    'w2_social_security_wages',
    'w2_medicare_wages',
    'health_insurance_premium',
    'simple_ira_contribution',
    'retirement_contribution',
  ])('invalidates ready tax cards when the legacy profile field %s changes without a revision timestamp', async field => {
    h.records.tax_organizers = [reviewedPersonalDeductionOrganizer(2026, {}, { businessLossFacts: reviewedBusinessLossFacts() })];
    h.tx = [expense(20, { id: 'expense', trans_id: 'expense', updated_at: 1 })];
    render(); await flush(); expect(render().state.status).toBe('ready');
    const taxCalls = h.request.mock.calls.filter(([url]) => String(url).includes('/api/tax/compute-1040')).length;
    h.profile = { ...h.profile, [field]: 1 };
    expect(render().state.status).toBe('loading');
    await flush();
    expect(h.request.mock.calls.filter(([url]) => String(url).includes('/api/tax/compute-1040'))).toHaveLength(taxCalls + 1);
  });
  it('ignores an old user request after a new user calculation is ready', async () => {
    let finish!: (value: Response) => void;
    h.request.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    render(); h.uid = 'next-owner'; h.profile = { ...h.profile, id: h.uid };
    render(); await flush(); expect(render().state.snapshot.income.grossReceipts).toBe(0);
    finish(Response.json({ taxYear: 2026, income: { grossReceipts: 999, totalDeductible: 0, scheduleCNetProfit: 999 }, form1040: { totalTax: 999, balanceDue: 999, refund: 0 } }));
    await flush(); expect(render().state.snapshot.income.grossReceipts).toBe(0);
  });
  it('recomputes when other income, a quarterly payment, or dependents change, and skips an unrelated field', async () => {
    const payments = [1, 2, 3, 4].map(quarter => ({ quarter, paidAmount: 0 }));
    h.taxFacts = { amountOtherIncome: null, dependents: null, payments, notes: 'first' };
    render(); await flush();
    expect(render().state.status).toBe('ready');
    const taxCalls = () => h.request.mock.calls.filter(([url]) => String(url).includes('/api/tax/compute-1040')).length;
    const before = taxCalls();
    h.taxFacts = { ...h.taxFacts, notes: 'unrelated organizer note' };
    h.profile = { ...h.profile, name: 'Synthetic' };
    expect(render().state.status).toBe('ready');
    await flush();
    expect(taxCalls()).toBe(before);
    h.taxFacts = { ...h.taxFacts, amountOtherIncome: '1500' };
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 1);
    h.taxFacts = { ...h.taxFacts, dependents: '1' };
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 2);
    h.taxFacts = { ...h.taxFacts, payments: payments.map(row => row.quarter === 2 ? { ...row, paidAmount: 400 } : row) };
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 3);
  });
  it('reloads the production tax-input reads on focus, and a note does not recompute', async () => {
    vi.stubGlobal('window', new EventTarget());
    const source = {
      organizer: { amountOtherIncome: null as string | null, dependents: null as string | null, notes: 'first' },
      payments: [1, 2, 3, 4].map(quarter => ({ quarter, paidAmount: 0, notes: 'blank' })),
    };
    h.request.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.includes('view=tax-input')) return Response.json(source.organizer);
      if (path.includes('/api/tax/quarterly-payments')) return Response.json({ payments: source.payments });
      return transport(path);
    });
    render(); await flush();
    expect(render().state.status).toBe('ready');
    const taxCalls = () => h.request.mock.calls.filter(([url]) => String(url).includes('/api/tax/compute-1040')).length;
    const before = taxCalls();
    expect(before).toBe(1);
    source.organizer = { ...source.organizer, amountOtherIncome: '1500' };
    window.dispatchEvent(new Event('focus'));
    expect(render().state.status).toBe('ready');
    await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 1);
    expect(render().state.status).toBe('ready');
    source.organizer = { ...source.organizer, notes: 'only a note' };
    const afterIncome = taxCalls();
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('ready');
    expect(taxCalls()).toBe(afterIncome);
  });
  it('recomputes once when an organizer or quarterly save reports new other income, dependents, or a payment, and ignores a note', async () => {
    vi.stubGlobal('window', new EventTarget());
    const source = {
      organizer: { amountOtherIncome: null as string | null, dependents: null as string | null, notes: 'first' },
      payments: [1, 2, 3, 4].map(quarter => ({ quarter, paidAmount: 0, notes: 'blank' })),
    };
    h.request.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.includes('view=tax-input')) return Response.json(source.organizer);
      if (path.includes('/api/tax/quarterly-payments')) return Response.json({ payments: source.payments });
      return transport(path);
    });
    render(); await flush();
    expect(render().state.status).toBe('ready');
    const taxCalls = () => h.request.mock.calls.filter(([url]) => String(url).includes('/api/tax/compute-1040')).length;
    const before = taxCalls();
    source.organizer = { ...source.organizer, notes: 'saved note only' };
    notifyDashboardTaxInputsUpdated();
    render(); await flush();
    expect(render().state.status).toBe('ready');
    expect(taxCalls()).toBe(before);
    source.organizer = { ...source.organizer, amountOtherIncome: '1500' };
    notifyDashboardTaxInputsUpdated();
    render(); await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 1);
    source.organizer = { ...source.organizer, dependents: '1' };
    notifyDashboardTaxInputsUpdated();
    render(); await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 2);
    source.payments = source.payments.map(row => row.quarter === 2 ? { ...row, paidAmount: 400 } : row);
    notifyDashboardTaxInputsUpdated();
    render(); await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 3);
  });
  it.each([
    ['IRA distributions', 'amountIRADistributions', '500'],
    ['rental income', 'amountRentalIncome', '800'],
    ['an HSA amount', 'hsaAmount', '1000'],
    ['a retirement amount', 'retirementAmount', '2000'],
    ['a Social Security answer', 'hasSocialSecurity', 'yes'],
    ['organizer filing status', 'filingStatus', 'single'],
  ] as const)('recomputes once when %s changes on the production tax-input read, and a note does not', async (group, field, value) => {
    expect(group.length).toBeGreaterThan(0);
    vi.stubGlobal('window', new EventTarget());
    const source = {
      organizer: { notes: 'first' } as Record<string, string | null>,
      payments: [1, 2, 3, 4].map(quarter => ({ quarter, paidAmount: 0, notes: 'blank' })),
    };
    h.request.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.includes('view=tax-input')) return Response.json(source.organizer);
      if (path.includes('/api/tax/quarterly-payments')) return Response.json({ payments: source.payments });
      return transport(path);
    });
    render(); await flush();
    expect(render().state.status).toBe('ready');
    const taxCalls = () => h.request.mock.calls.filter(([url]) => String(url).includes('/api/tax/compute-1040')).length;
    const before = taxCalls();
    expect(before).toBe(1);
    source.organizer = { ...source.organizer, notes: 'only a note' };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('ready');
    expect(taxCalls()).toBe(before);
    source.organizer = { ...source.organizer, [field]: value };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 1);
    expect(render().state.status).toBe('ready');
  });
  async function productionOrganizer() {
    vi.stubGlobal('window', new EventTarget());
    const source = {
      organizer: { notes: 'first' } as Record<string, unknown>,
      payments: [1, 2, 3, 4].map(quarter => ({ quarter, paidAmount: 0, notes: 'blank' })),
    };
    h.request.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.includes('view=tax-input')) return Response.json(source.organizer);
      if (path.includes('/api/tax/quarterly-payments')) return Response.json({ payments: source.payments });
      return transport(path);
    });
    render(); await flush();
    expect(render().state.status).toBe('ready');
    const taxCalls = () => h.request.mock.calls.filter(([url]) => String(url).includes('/api/tax/compute-1040')).length;
    const before = taxCalls();
    expect(before).toBe(1);
    source.organizer = { ...source.organizer, notes: 'only a note' };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('ready');
    expect(taxCalls()).toBe(before);
    return { source, taxCalls, before };
  }
  it('recomputes once when a dependent record is added on the production tax-input read, and a note does not', async () => {
    const { source, taxCalls, before } = await productionOrganizer();
    source.organizer = { ...source.organizer, dependents: [{ name: 'Child' }] };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 1);
  });
  it('recomputes once when business loss facts change on the production tax-input read, and a note does not', async () => {
    const { source, taxCalls, before } = await productionOrganizer();
    source.organizer = { ...source.organizer, businessLossFacts: { allInvestmentAtRisk: 'yes', materialParticipation: 'yes' } };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 1);
  });
  it('recomputes once when personal deduction facts change on the production tax-input read, and a note does not', async () => {
    const { source, taxCalls, before } = await productionOrganizer();
    source.organizer = { ...source.organizer, personalDeductionFacts: { version: 1, taxYear: 2026, ordinaryScope: 'yes' } };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 1);
  });
  it('does not recompute when object keys are reordered on the production tax-input read, and a note does not', async () => {
    const { source, taxCalls, before } = await productionOrganizer();
    source.organizer = { ...source.organizer, obbbaDeductionFacts: { b: 1, a: 2 } };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 1);
    source.organizer = { ...source.organizer, obbbaDeductionFacts: { a: 2, b: 1 } };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('ready');
    expect(taxCalls()).toBe(before + 1);
  });
  const creditChild = { name: 'Child', relationship: 'daughter', dateOfBirth: '2018-03-15', monthsLived: 12 };
  it('recomputes once when a dependent goes from no identifier to an ITIN on the production tax-input read', async () => {
    const { source, taxCalls, before } = await productionOrganizer();
    source.organizer = { ...source.organizer, dependents: [creditChild] };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 1);
    source.organizer = { ...source.organizer, dependents: [{ ...creditChild, dependentITIN: '900700111' }] };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 2);
    expect(JSON.stringify(dashboardTaxFactsFromReads(source.organizer, { payments: source.payments }))).not.toContain('900700111');
  });
  it('recomputes once when a dependent goes from an ITIN to an SSN on the production tax-input read', async () => {
    const { source, taxCalls, before } = await productionOrganizer();
    source.organizer = { ...source.organizer, dependents: [{ ...creditChild, dependentITIN: '900700111' }] };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 1);
    source.organizer = { ...source.organizer, dependents: [{ ...creditChild, dependentSSN: '900700111' }] };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 2);
  });
  it('does not recompute when only SSN digits change on the production tax-input read', async () => {
    const { source, taxCalls, before } = await productionOrganizer();
    source.organizer = { ...source.organizer, dependents: [{ ...creditChild, dependentSSN: '900700111' }] };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 1);
    const read = dashboardTaxFactsFromReads(source.organizer, { payments: source.payments });
    expect(String(read.dependents)).toContain('"identifierKind":"ssn"');
    expect(JSON.stringify(read)).not.toContain('900700111');
    source.organizer = { ...source.organizer, dependents: [{ dependentSSN: '900700222', monthsLived: 12, dateOfBirth: '2018-03-15', relationship: 'daughter', name: 'Child' }] };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('ready');
    expect(taxCalls()).toBe(before + 1);
    expect(JSON.stringify(dashboardTaxFactsFromReads(source.organizer, { payments: source.payments }))).not.toContain('900700222');
  });
  it('recomputes once when a dependent date of birth, relationship, or months lived changes on the production tax-input read', async () => {
    const { source, taxCalls, before } = await productionOrganizer();
    source.organizer = { ...source.organizer, dependents: [{ ...creditChild, dependentSSN: '900700111' }] };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 1);
    source.organizer = { ...source.organizer, dependents: [{ ...creditChild, dependentSSN: '900700111', dateOfBirth: '2019-01-02' }] };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 2);
    source.organizer = { ...source.organizer, dependents: [{ ...creditChild, dependentSSN: '900700111', dateOfBirth: '2019-01-02', relationship: 'son' }] };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 3);
    source.organizer = { ...source.organizer, dependents: [{ ...creditChild, dependentSSN: '900700111', dateOfBirth: '2019-01-02', relationship: 'son', monthsLived: 6 }] };
    window.dispatchEvent(new Event('focus'));
    render(); await flush();
    expect(render().state.status).toBe('loading');
    await flush();
    expect(taxCalls()).toBe(before + 4);
  });
  it.each([{ taxYear: 2025 }, { income: { grossReceipts: '0' } }, { form1040: { totalTax: null } }])('rejects mismatched/malformed snapshots %j', async override => {
    const real = await (await GET(new NextRequest('http://localhost/api/tax/compute-1040?year=2026'))).json();
    h.request.mockResolvedValue(Response.json({ ...real, ...override }));
    const result = await loadDashboardTaxSnapshot(2026); expect(result.status).toBe('error'); expect(result).not.toHaveProperty('snapshot');
  });
});
