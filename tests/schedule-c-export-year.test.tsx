import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real component handlers with a minimal hook scheduler; network/downloads are
// mocked. This verifies selected-year propagation, not browser PDF rendering.
const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], fetch: vi.fn(), api: vi.fn(), blob: null as Blob | null, error: vi.fn(), download: { href: '', download: '', click: vi.fn() } }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[] | undefined) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial: any) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [harness.slots[index], (next: any) => { harness.slots[index] = typeof next === 'function' ? next(harness.slots[index]) : next; }];
    },
    useMemo(factory: () => unknown, deps: unknown[]) {
      const index = harness.cursor++;
      if (!same(harness.slots[index]?.deps, deps)) harness.slots[index] = { deps, value: factory() };
      return harness.slots[index].value;
    },
    useCallback(callback: unknown, deps: unknown[]) { return hooks.useMemo(() => callback, deps); },
    useEffect(effect: () => void, deps: unknown[]) {
      const index = harness.cursor++;
      if (!same(harness.slots[index]?.deps, deps)) { harness.slots[index] = { deps }; harness.effects.push(effect); }
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('@/lib/hooks/use-subscription', () => ({ useSubscription: () => ({ canAccess: () => true, isTrial: false, isPaid: true, isLoading: false, status: null }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { error: harness.error, warning: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.api }));
vi.mock('@/lib/firebase/client', () => ({ auth: { currentUser: { getIdToken: async () => 'synthetic-id-token' } } }));
import { ScheduleCExportScreen } from '../components/schedule-c-export-screen';

const props = {
  user: { id: 'synthetic-user' }, onBack: () => {},
  transactions: [2024, 2025, 2026].map(year => ({ id: `expense-${year}`, merchant_name: 'Synthetic supplies', amount: 100, category: 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE', date: `${year}-03-01`, is_deductible: true })),
};
function render(input = props) {
  harness.cursor = 0;
  const tree = ScheduleCExportScreen(input);
  harness.effects.splice(0).forEach(effect => effect());
  return tree;
}
function walk(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== 'object') return [];
  return [node, ...walk(node.props?.children)];
}
function text(node: any): string { return Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : String(node ?? ''); }
beforeEach(() => {
  harness.api.mockReset().mockResolvedValue(new Response(JSON.stringify({ transactions: [] }))); harness.blob = null;
  harness.slots = []; harness.cursor = 0; harness.effects = []; harness.fetch.mockReset(); harness.error.mockReset(); harness.download.download = ''; harness.download.click.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal('fetch', harness.fetch.mockResolvedValue(new Response('synthetic-pdf', { headers: { 'content-type': 'application/pdf' } })));
  vi.stubGlobal('window', { URL: { createObjectURL: (blob: Blob) => { harness.blob = blob; return 'blob:synthetic'; }, revokeObjectURL: vi.fn() } });
  vi.stubGlobal('document', { createElement: () => harness.download, body: { appendChild: vi.fn(), removeChild: vi.fn() } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Schedule C supported-year selection', () => {
  it('offers 2026, 2025 and 2024 and defaults to the latest supported year', () => {
    const select = walk(render()).find(node => node.type === 'select');
    expect(walk(select).filter(node => node.type === 'option').map(node => node.props.value)).toEqual(['2026', '2025', '2024']);
    expect(select.props.value).toBe('2026');
  });

  it.each(['2026', '2025'])('sends the selected %s year to the real PDF export handler and filename', async year => {
    const selects = walk(render()).filter(node => node.type === 'select');
    selects[0].props.onChange({ target: { value: year } });
    selects[1].props.onChange({ target: { value: 'PDF' } });
    render();
    const button = walk(render()).find(node => typeof node.props?.onClick === 'function' && text(node).includes(`Export ${year} Schedule C Data`));
    expect(button.props.disabled).toBe(false);
    await button.props.onClick();
    expect(harness.fetch).toHaveBeenCalledOnce();
    const [url, options] = harness.fetch.mock.calls[0];
    expect(url).toBe('/api/tax/schedule-c/export');
    expect(JSON.parse(options.body)).toMatchObject({ year, includeAppendix: true });
    expect(harness.download.download).toBe(`Schedule_C_${year}_WriteOff.pdf`);
    expect(harness.download.click).toHaveBeenCalledOnce();
  });

  it('shows the actionable income-review response instead of a generic PDF failure', async () => {
    const message = 'Review income sources before calculating tax: the same payment may appear in receipts and a 1099.';
    harness.fetch.mockResolvedValue(new Response(JSON.stringify({ error: message, code: 'INCOME_RECONCILIATION_REQUIRED' }), { status: 422, headers: { 'content-type': 'application/json' } }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    walk(render()).filter(node => node.type === 'select')[1].props.onChange({ target: { value: 'PDF' } });
    render();
    await walk(render()).find(node => typeof node.props?.onClick === 'function' && text(node).includes('Export 2026 Schedule C Data')).props.onClick();
    expect(harness.error).toHaveBeenCalledWith(message);
    expect(harness.download.click).not.toHaveBeenCalled();
  });
});


describe('Schedule C safe export controls', () => {
  it('allows an income-only PDF without loaded deductible expenses', async () => {
    const empty = { ...props, transactions: [] };
    walk(render(empty)).filter(node => node.type === 'select')[1].props.onChange({ target: { value: 'PDF' } });
    const button = walk(render(empty)).find(node => typeof node.props?.onClick === 'function' && text(node).includes('Export 2026 Schedule C Data'));
    expect(button.props.disabled).toBe(false);
    await button.props.onClick(); expect(harness.fetch).toHaveBeenCalledOnce();
  });
  it('requests the fresh owner-verified CSV export from the server', async () => {
    harness.fetch.mockResolvedValue(new Response('server-confirmed-records', { headers: { 'content-type': 'text/csv' } }));
    render();
    await walk(render()).find(node => typeof node.props?.onClick === 'function' && text(node).includes('Export 2026 Schedule C Data')).props.onClick();
    expect(JSON.parse(harness.fetch.mock.calls[0][1].body)).toMatchObject({ year: '2026', format: 'csv' });
    expect(harness.download.download).toBe('Schedule_C_2026_WriteOff.csv');
    expect(await harness.blob!.text()).toBe('server-confirmed-records');
  });
  it('shows a server failure and does not download stale CSV records', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    harness.fetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Could not load all export records. Please retry.' }), { status: 503, headers: { 'content-type': 'application/json' } }));
    render();
    await walk(render()).find(node => typeof node.props?.onClick === 'function' && text(node).includes('Export 2026 Schedule C Data')).props.onClick();
    expect(harness.download.click).not.toHaveBeenCalled(); expect(harness.error).toHaveBeenCalledWith('Could not load all export records. Please retry.');
  });
});
