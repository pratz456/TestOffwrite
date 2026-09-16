import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// Actual handlers and state effects; transport/SDK are mocked, not a live browser test.
const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], request: vi.fn(), loader: vi.fn(), open: vi.fn() }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.request }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial: unknown) { const index = harness.cursor++; if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial; return [harness.slots[index], (next: unknown) => { harness.slots[index] = typeof next === 'function' ? next(harness.slots[index]) : next; }]; },
    useRef(initial: unknown) { const index = harness.cursor++; if (!(index in harness.slots)) harness.slots[index] = { current: initial }; return harness.slots[index]; },
    useCallback(callback: unknown, deps: unknown[]) { const index = harness.cursor++; if (!same(harness.slots[index]?.deps, deps)) harness.slots[index] = { deps, callback }; return harness.slots[index].callback; },
    useEffect(effect: () => void | (() => void), deps: unknown[]) { const index = harness.cursor++; const previous = harness.slots[index]; if (!same(previous?.deps, deps)) { const next: any = { deps }; harness.slots[index] = next; harness.effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); }); } },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
import { ProfitLossReportScreen } from '../components/profit-loss-report-screen';
type Element = ReactElement<Record<string, any>>;
let userId = 'cash-owner';
const year = new Date().getFullYear();
function render(): Element { harness.cursor = 0; const tree = ProfitLossReportScreen({ user: { id: userId }, onBack() {} }) as Element; harness.effects.splice(0).forEach(effect => effect()); return tree; }
function walk(node: any): Element[] { return Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : []; }
function text(node: any): string { return Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : String(node ?? ''); }
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const payload = (taxYear = year, total = 1000) => ({ reportType: 'recorded_cash_flow', year: taxYear, month: null, periodLabel: String(taxYear), scope: 'Recorded USD movements including personal and unreviewed records. Not taxable profit.', excludedPendingCount: 2, transactionCount: 3, income: [{ source: 'Synthetic', amount: total }], operatingExpenses: [], totalIncome: total, totalExpenses: 0, netProfit: total, effectiveTaxRate: null, priorPeriod: null });
const response = (body: unknown, status = 200) => Response.json(body, { status });
beforeEach(() => { userId = 'cash-owner'; harness.slots = []; harness.cursor = 0; harness.effects = []; harness.request.mockReset().mockImplementation((_url: string, init: RequestInit) => Promise.resolve(response(payload(JSON.parse(String(init.body)).year)))); });

describe('recorded cash-flow UI scope and request lifecycle', () => {
  it('labels literal cash movement and removes the fabricated tax-rate/profit presentation', async () => {
    render(); await flush(); const content = text(render());
    expect(content).toContain('Recorded Cash Flow'); expect(content).toContain('Net Cash Movement'); expect(content).toContain('Total Inflows');
    expect(content).toContain('Posted Records'); expect(content).toContain('Pending records excluded: 2');
    expect(content).not.toContain('Effective Tax Rate'); expect(content).not.toContain('Net Profit/Loss');
  });
  it('does not let a slow old-year request replace the newly selected period', async () => {
    let complete!: (value: Response) => void;
    harness.request.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const tree = render(); walk(tree).find(node => node.props?.onValueChange)!.props.onValueChange(String(year - 1));
    render(); await flush(); complete(response(payload(year, 999999))); await flush();
    expect(text(render())).not.toContain('999,999'); expect(text(render())).toContain('1,000.00');
  });
  it('rejects a stale account response even after switching A to B to A', async () => {
    let complete!: (value: Response) => void;
    harness.request.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    render(); userId = 'second-owner'; render(); await flush(); userId = 'cash-owner'; render(); await flush();
    complete(response(payload(year, 999999))); await flush(); expect(text(render())).not.toContain('999,999'); expect(text(render())).toContain('1,000.00');
  });
  it('hides prior-account ready data before the next effect/load finishes', async () => {
    harness.request.mockResolvedValueOnce(response(payload(year, 999999))); render(); await flush(); expect(text(render())).toContain('999,999');
    harness.request.mockImplementationOnce(() => new Promise(() => {})); userId = 'second-owner';
    expect(text(render())).not.toContain('999,999');
  });
  it('wrong-year response and422 review show no zero or stale cash totals', async () => {
    harness.request.mockResolvedValueOnce(response(payload(year - 1))); render(); await flush(); expect(text(render())).toContain('report period could not be verified');
    harness.request.mockResolvedValueOnce(response({ error: 'Review missing currency before creating this summary.' }, 422));
    await walk(render()).find(node => node.props?.onClick && text(node) === 'Retry')!.props.onClick();
    const content = text(render()); expect(content).toContain('Review missing currency'); expect(content).not.toContain('Total Inflows'); expect(content).not.toContain('$0.00');
  });
});
