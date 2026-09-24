import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// Real component functions with a hook scheduler; transport and child presentation
// are mocked. This checks rendering/state contracts, not browser layout.
const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[],
  profile: { id: 'synthetic', income: 100000, filing_status: 'Qualifying Widower', name: 'Synthetic' },
  transactions: [{ id: 'income', amount: -100000, date: '2026-03-01', category: 'income' }], navigate: vi.fn() }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (left: unknown[] | undefined, right: unknown[] | undefined) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = {
    useState(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [harness.slots[index], (next: unknown) => { harness.slots[index] = typeof next === 'function' ? next(harness.slots[index]) : next; }];
    },
    useMemo(callback: () => unknown, deps: unknown[]) {
      const index = harness.cursor++;
      if (!same(harness.slots[index]?.deps, deps)) harness.slots[index] = { deps, value: callback() };
      return harness.slots[index].value;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = harness.cursor++; const previous = harness.slots[index];
      if (!same(previous?.deps, deps)) {
        const next: any = { deps }; harness.slots[index] = next;
        harness.effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
      }
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: harness.navigate }) }));
vi.mock('@/lib/firebase/client', () => ({ auth: { currentUser: { uid: 'synthetic', getIdToken: async () => 'synthetic-token' } } }));
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: { id: 'synthetic' }, loading: false }) }));
vi.mock('@/lib/firebase/profiles', () => ({ getUserProfile: async () => ({ data: harness.profile, error: null }) }));
vi.mock('@/lib/firebase/hooks', () => ({ useTransactions: () => ({ transactions: harness.transactions, isLoading: false }), useUserStats: () => ({ stats: {}, isLoading: false }) }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: async () => Response.json({ error: 'Review filing status' }, { status: 422 }) }));
vi.mock('@/lib/hooks/use-subscription', () => ({ useSubscription: () => ({ hasAccess: true, canAccess: () => true, isLoading: false }) }));
vi.mock('@/lib/react-query/hooks', () => ({ useTransactions: () => ({ data: { transactions: harness.transactions } }), useMonthlyDeductions: () => ({ data: undefined, isLoading: false, error: null, refetch() {} }) }));
vi.mock('@/components/ui/toast', () => ({ ToastContainer: 'ToastContainer', useToasts: () => ({ toasts: [], removeToast() {} }) }));
vi.mock('@/components/historical-access-upgrade-card', () => ({ HistoricalAccessUpgradeCard: 'HistoricalAccessUpgradeCard' }));
vi.mock('@/components/dashboard/index', () => Object.fromEntries(['DashboardHeader', 'KpiGrid', 'AnalyticsPanel', 'OptimizationCard', 'TopCategoriesCard', 'RecentActivityCard', 'AiAdvisoryCard', 'QuickActionsBar', 'ActionItemsBanner'].map(name => [name, name])));
import DashboardScreen from '../components/dashboard-screen';
import { Dashboard } from '../components/dashboard';
import { AIInsightsPage } from '../components/ai-insights-page';
import ReportsPage from '../app/protected/reports/page';

type Element = ReactElement<Record<string, any>>;
function render(component: () => Element) {
  harness.cursor = 0;
  const tree = component();
  harness.effects.splice(0).forEach(effect => effect());
  return tree;
}
function walk(node: any): Element[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  return node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
}
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return typeof node === 'string' ? node : '';
}
async function flush() { await new Promise<void>(resolve => setImmediate(resolve)); }
const dashboard = () => DashboardScreen({ profile: harness.profile, transactions: harness.transactions, onNavigate: harness.navigate, onTransactionClick() {} }) as Element;
beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.effects = []; harness.profile.filing_status = 'Qualifying Widower'; harness.navigate.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ transactions: harness.transactions })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('dashboard filing-status review display', () => {
  it('shows server review state without presenting a fallback KPI or savings estimate', async () => {
    render(dashboard); await flush();
    const tree = render(dashboard);
    const kpi = walk(tree).find(node => node.type === ('KpiGrid' as any))!;
    expect(kpi.props.state).toMatchObject({ status: 'review', message: 'Review filing status' });
    expect(kpi.props.state).not.toHaveProperty('snapshot');
    expect(walk(tree).some(node => node.type === ('AiAdvisoryCard' as any))).toBe(false);
  });
  it('waits for server tax results when the filing-status label changes', async () => {
    harness.profile.filing_status = 'Married Filing Jointly';
    expect(walk(render(dashboard)).find(node => node.type === ('KpiGrid' as any))!.props.state.status).toBe('loading');
    await flush(); render(dashboard);
    harness.profile.filing_status = 'Single';
    const kpi = walk(render(dashboard)).find(node => node.type === ('KpiGrid' as any))!;
    expect(kpi.props.state).toEqual({ status: 'loading' });
    expect(kpi.props).not.toHaveProperty('estimatedTaxRate');
    expect(kpi.props).not.toHaveProperty('quarterlyTaxes');
  });
  it('keeps record-only insights usable without inventing a filing-status tax rate', async () => {
    const component = () => AIInsightsPage({ user: { id: 'synthetic' }, onBack() {} }) as Element;
    render(component); await flush();
    const content = text(render(component));
    expect(content).toContain('Spending to Review (not tax savings)');
    expect(content).toContain('Confirmed Transaction Deductions');
    expect(content).not.toContain('Estimated Tax Effect of Unreviewed Items');
    expect(content).not.toContain('NaN');
  });
  it.each([
    ['legacy dashboard', () => Dashboard({ user: { id: 'synthetic' }, onNavigate: harness.navigate }) as Element],
    ['reports', () => ReportsPage() as Element],
  ] as const)('%s remains usable and displays the actionable status problem', async (_label, component) => {
    render(component); await flush();
    let tree = render(component); await flush(); tree = render(component);
    expect(text(tree)).toContain('filing status in Profile');
    expect(text(tree)).toContain('Review profile');
    expect(text(tree)).not.toContain('NaN');
    if (_label === 'legacy dashboard') expect(text(tree)).toContain('Review needed');
  });
});
