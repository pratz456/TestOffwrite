import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFPage } from 'pdf-lib';
import { DRAFT_LATEST_EXPORT_UNRECORDED_NOTICE, SCHEDULE_C_EXPORT_LOAD_FAILED_NOTICE, decideScheduleCExport, frozenScheduleCRules, scheduleCNow, setCurrentScheduleCRulesForTests, setScheduleCClockForTests } from '@/lib/schedule-c/filed-year';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { generateScheduleCPlanningPDF } from '@/lib/reports/schedule-c-pdf';
import { auth } from '@/lib/firebase/client';

// Real component handlers with a minimal hook scheduler; network/downloads are
// mocked. This verifies selected-year propagation, not browser PDF rendering.
const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void | Promise<void>)[], fetch: vi.fn(), api: vi.fn(), blob: null as Blob | null, error: vi.fn(), download: { href: '', download: '', click: vi.fn() }, search: '' }));
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
    useEffect(effect: () => void | Promise<void>, deps: unknown[]) {
      const index = harness.cursor++;
      if (!same(harness.slots[index]?.deps, deps)) { harness.slots[index] = { deps }; harness.effects.push(effect); }
    },
    useRef(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = { current: initial };
      return harness.slots[index];
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('@/lib/hooks/use-subscription', () => ({ useSubscription: () => ({ canAccess: () => true, isTrial: false, isPaid: true, isLoading: false, status: null }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/protected',
  useSearchParams: () => new URLSearchParams(harness.search),
}));
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: { id: 'synthetic-user', email: 'synthetic@example.com' }, loading: false }) }));
vi.mock('@/lib/react-query/hooks', () => ({ useTransactions: () => ({ data: { transactions: [] }, isLoading: false }) }));
vi.mock('@/lib/firebase/hooks', () => ({ useTransactions: () => ({ transactions: [], isLoading: false, error: null }) }));
vi.mock('@/lib/firebase/profiles', () => ({ getUserProfile: async () => ({ data: { name: 'Synthetic Taxpayer', profession: 'writer', bankConnected: false }, error: null }) }));
vi.mock('@/lib/hooks/use-transaction-polling', () => ({ useTransactionPolling: () => ({ isSyncing: false, lastSyncTime: null, syncNow: () => undefined }) }));
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
async function flushEffects() {
  const effects = harness.effects.splice(0);
  await Promise.all(effects.map(effect => Promise.resolve().then(() => effect())));
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}
beforeEach(async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  harness.api.mockReset().mockResolvedValue(new Response(JSON.stringify({ transactions: [] }))); harness.blob = null;
  harness.search = '';
  harness.slots = []; harness.cursor = 0; harness.effects = []; harness.fetch.mockReset(); harness.error.mockReset(); harness.download.download = ''; harness.download.click.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  harness.fetch.mockImplementation(async (url: string) => {
    if (String(url).startsWith('/api/tax/schedule-c/filed-year')) {
      return new Response(JSON.stringify({ prior: null }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('synthetic-pdf', { headers: { 'content-type': 'application/pdf' } });
  });
  vi.stubGlobal('fetch', harness.fetch);
  vi.stubGlobal('window', { URL: { createObjectURL: (blob: Blob) => { harness.blob = blob; return 'blob:synthetic'; }, revokeObjectURL: vi.fn() } });
  vi.stubGlobal('document', { createElement: () => harness.download, body: { appendChild: vi.fn(), removeChild: vi.fn() } });
  setScheduleCClockForTests(() => new Date('2026-07-15T15:00:00.000Z'));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setCurrentScheduleCRulesForTests(null);
  setScheduleCClockForTests(() => new Date('2026-07-15T15:00:00.000Z'));
});

describe('Schedule C supported-year selection', () => {
  const heldYearTransactions = [
    { id: 'ad', merchant_name: 'Synthetic ads', amount: 200, category: 'SERVICE_ADVERTISING', date: '2025-06-01', is_deductible: true, review_status: 'confirmed', tax_review_required: false },
    { id: 'sub', merchant_name: 'Synthetic software', amount: 40, category: 'SERVICE_SUBSCRIPTION', date: '2025-06-02', is_deductible: true, review_status: 'confirmed', tax_review_required: false },
  ];

  async function showYear(input: typeof props, year: string) {
    const frozen = frozenScheduleCRules();
    const categoryMap = { ...frozen.categoryMap, SERVICE_ADVERTISING: { line: '24b', name: 'Meals', code: '24b' }, SERVICE_SUBSCRIPTION: { line: '24b', name: 'Meals', code: '24b' } };
    setCurrentScheduleCRulesForTests({
      version: 'v1', categoryMap, readDate: frozen.readDate, readYear: frozen.readYear,
      aggregate: (txs, yearArg, map = categoryMap, options) => frozen.aggregate(txs, yearArg, map, options),
    });
    const select = walk(render(input)).find(node => node.type === 'select');
    select.props.onChange({ target: { value: year } });
    return text(await paint(input));
  }

  it('shows each lowering rule on its own line for a held year', async () => {
    const body = await showYear({ ...props, transactions: heldYearTransactions }, '2025');
    expect(body).toContain('draft, awaiting copy approval');
    expect(body).toContain('your 2025 total under the rules at the time, on your current data');
    expect(body).toContain('Line changed lowered the total by $100.00.');
    expect(body).toContain('Line changed lowered the total by $20.00.');
    expect(body).not.toContain('lowered the total by $120.00');
    expect(body.toLowerCase()).not.toContain('what you filed');
    expect(body.toLowerCase()).not.toContain('amend');
  });

  it('shows the new 2025 total and no held notice after confirmation for the current rules', async () => {
    const input = { ...props, transactions: heldYearTransactions, confirmedRulesVersion: 'v1' };
    const body = await showYear(input, '2025');
    expect(body).toContain('$120.00');
    expect(body).toContain('Meals');
    expect(body).not.toContain('draft, awaiting copy approval');
    expect(body).not.toContain('Line changed lowered the total');
    const buttons = walk(render(input)).filter(node => typeof node.props?.onClick === 'function').map(node => text(node));
    expect(buttons.join('\n').toLowerCase()).not.toContain('confirm');
    const stale = await showYear({ ...input, confirmedRulesVersion: 'v0' }, '2025');
    expect(stale).toContain('draft, awaiting copy approval');
    expect(stale).toContain('That total was $240.00.');
    expect(stale).not.toContain('Meals');
  });

  async function paint(input = props) {
    harness.cursor = 0;
    ScheduleCExportScreen(input);
    await flushEffects();
    harness.cursor = 0;
    ScheduleCExportScreen(input);
    await flushEffects();
    harness.cursor = 0;
    return ScheduleCExportScreen(input);
  }

  async function openYear(input: typeof props, year: string) {
    harness.slots = [];
    harness.effects = [];
    harness.cursor = 0;
    const first = ScheduleCExportScreen(input);
    await flushEffects();
    walk(first).find(node => node.type === 'select').props.onChange({ target: { value: year } });
    return text(await paint(input));
  }

  it('keeps a saved $100.00 total after the current total becomes $120.00, and a missing record does not mention an export', async () => {
    const edited = {
      ...props,
      transactions: [{ id: 'ad', merchant_name: 'Synthetic ads', amount: 120, category: 'SERVICE_ADVERTISING', date: '2025-06-01', is_deductible: true, review_status: 'confirmed', tax_review_required: false }],
    };
    const saved = { rulesVersion: 'v0', totalDeductible: 100, lineTotals: [{ line: '8', amount: 100 }], charges: [{ id: 'ad', line: '8', amount: 100 }] };
    harness.fetch.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/tax/schedule-c/filed-year')) {
        return new Response(JSON.stringify({ prior: saved }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response('synthetic-pdf', { headers: { 'content-type': 'application/pdf' } });
    });
    const held = await openYear(edited, '2025');
    expect(held).toContain('That total was $100.00.');
    expect(held).toContain('The total under the current rules is $120.00.');
    expect(held).toContain('This comparison uses the total saved from your last export for 2025.');
    expect(held.toLowerCase()).not.toContain('what you filed');

    harness.fetch.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/tax/schedule-c/filed-year')) {
        return new Response(JSON.stringify({ prior: null }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response('synthetic-pdf', { headers: { 'content-type': 'application/pdf' } });
    });
    const frozen = frozenScheduleCRules();
    const categoryMap = { ...frozen.categoryMap, SERVICE_ADVERTISING: { line: '24b', name: 'Meals', code: '24b' } };
    setCurrentScheduleCRulesForTests({
      version: 'v1', categoryMap, readDate: frozen.readDate, readYear: frozen.readYear,
      aggregate: (txs, yearArg, map = categoryMap, options) => frozen.aggregate(txs, yearArg, map, options),
    });
    const fallback = await openYear(edited, '2025');
    expect(fallback).toContain('your 2025 total under the rules at the time, on your current data');
    expect(fallback.toLowerCase()).not.toContain('last export');
    expect(fallback.toLowerCase()).not.toContain('since export');
    expect(fallback.toLowerCase()).not.toContain('saved from your');
  });

  it('shows the draft notice and does not compare an older export while the latest one is unrecorded', async () => {
    const edited = {
      ...props,
      transactions: [{ id: 'ad', merchant_name: 'Synthetic ads', amount: 250, category: 'SERVICE_ADVERTISING', date: '2025-06-01', is_deductible: true, review_status: 'confirmed', tax_review_required: false }],
    };
    const saved = { rulesVersion: 'v0', totalDeductible: 100, lineTotals: [{ line: '8', amount: 100 }], charges: [{ id: 'ad', line: '8', amount: 100 }] };
    harness.fetch.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/tax/schedule-c/filed-year')) {
        return new Response(JSON.stringify({ prior: saved, latestExportUnrecorded: true }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response('synthetic-pdf', { headers: { 'content-type': 'application/pdf' } });
    });
    const body = await openYear(edited, '2025');
    expect(body).toContain(DRAFT_LATEST_EXPORT_UNRECORDED_NOTICE);
    expect(body).toContain('$100.00');
    expect(body).not.toContain('$250.00');
    expect(body).not.toContain('That total was $100.00.');
    expect(body).not.toContain('last export');
    expect(body).not.toContain('since export');
  });

  it('shows the stored $100 total while a marker is open and that total matches the csv and pdf export', async () => {
    const edited = {
      ...props,
      transactions: [{ id: 'ad', merchant_name: 'Synthetic ads', amount: 250, category: 'SERVICE_ADVERTISING', date: '2025-06-01', is_deductible: true, review_status: 'confirmed', tax_review_required: false }],
    };
    const saved = { rulesVersion: 'v0', totalDeductible: 100, lineTotals: [{ line: '8', amount: 100 }], charges: [{ id: 'ad', line: '8', amount: 100 }] };
    const decision = decideScheduleCExport({
      uid: edited.user.id,
      year: 2025,
      transactions: edited.transactions.map(tx => ({
        id: tx.id, amount: tx.amount, date: tx.date, category: tx.category, is_deductible: tx.is_deductible, merchant_name: tx.merchant_name, review_status: tx.review_status, tax_review_required: tx.tax_review_required,
      })),
      prior: saved,
      confirmedRulesVersion: null,
    });
    const generatedAt = scheduleCNow();
    const csv = generateScheduleCCSV(decision.lineItems, 2025, { contribution: decision.contribution, comparison: decision.comparison, generatedAt });
    const drawn = vi.spyOn(PDFPage.prototype, 'drawText');
    await generateScheduleCPlanningPDF({
      taxYear: 2025, grossReceipts: 0, lineItems: decision.lineItems, includeAppendix: false,
      contribution: decision.contribution, comparison: null, generatedAt,
    });
    const pdf = drawn.mock.calls.map(call => String(call[0])).join('\n');
    const pdfLines = pdf.split('\n');
    const subtotalAt = pdfLines.indexOf('Confirmed expense subtotal only');
    expect(decision.totalDeductible).toBe(100);
    expect(csv).toContain('SERVICE_ADVERTISING,8,100,100');
    expect(csv).not.toContain('SERVICE_ADVERTISING,8,250,250');
    expect(pdfLines[subtotalAt + 1]).toBe('$100.00');
    harness.fetch.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/tax/schedule-c/filed-year')) {
        return new Response(JSON.stringify({ prior: saved, latestExportUnrecorded: true }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response('synthetic-pdf', { headers: { 'content-type': 'application/pdf' } });
    });
    const body = await openYear(edited, '2025');
    expect(body).toContain('$100.00');
    expect(body).toContain(DRAFT_LATEST_EXPORT_UNRECORDED_NOTICE);
    expect(body).not.toContain('$250.00');
    expect(body).toContain(pdfLines[subtotalAt + 1]);
  });

  it('shows the live $250 total while a marker is open and no record is stored', async () => {
    const edited = {
      ...props,
      transactions: [{ id: 'ad', merchant_name: 'Synthetic ads', amount: 250, category: 'SERVICE_ADVERTISING', date: '2025-06-01', is_deductible: true, review_status: 'confirmed', tax_review_required: false }],
    };
    harness.fetch.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/tax/schedule-c/filed-year')) {
        return new Response(JSON.stringify({ prior: null, latestExportUnrecorded: true }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response('synthetic-pdf', { headers: { 'content-type': 'application/pdf' } });
    });
    const body = await openYear(edited, '2025');
    expect(body).toContain('$250.00');
    expect(body).toContain(DRAFT_LATEST_EXPORT_UNRECORDED_NOTICE);
  });

  it('shows no dollar totals while the filed year fetch is still pending', async () => {
    const edited = {
      ...props,
      transactions: [{ id: 'ad', merchant_name: 'Synthetic ads', amount: 250, category: 'SERVICE_ADVERTISING', date: '2025-06-01', is_deductible: true, review_status: 'confirmed', tax_review_required: false }],
    };
    harness.fetch.mockImplementation(() => new Promise(() => {}));
    const body = await openYear(edited, '2025');
    expect(body).toContain('Loading');
    expect(body).not.toMatch(/\$\d/);
  });

  it('does not show the 2025 record total while switching to 2024', async () => {
    const edited = {
      ...props,
      transactions: [
        { id: 'ad', merchant_name: 'Synthetic ads', amount: 250, category: 'SERVICE_ADVERTISING', date: '2025-06-01', is_deductible: true, review_status: 'confirmed', tax_review_required: false },
        { id: 'old', merchant_name: 'Synthetic ads', amount: 60, category: 'SERVICE_ADVERTISING', date: '2024-06-01', is_deductible: true, review_status: 'confirmed', tax_review_required: false },
      ],
    };
    const saved2025 = { rulesVersion: 'v0', totalDeductible: 100, lineTotals: [{ line: '8', amount: 100 }], charges: [{ id: 'ad', line: '8', amount: 100 }] };
    const saved2024 = { rulesVersion: 'v0', totalDeductible: 40, lineTotals: [{ line: '8', amount: 40 }], charges: [{ id: 'old', line: '8', amount: 40 }] };
    let release2024: (response: Response) => void = () => {};
    harness.fetch.mockImplementation((url: string) => {
      const href = String(url);
      if (href.includes('year=2025')) {
        return Promise.resolve(new Response(JSON.stringify({ prior: saved2025 }), { headers: { 'content-type': 'application/json' } }));
      }
      if (href.includes('year=2024')) {
        return new Promise<Response>(resolve => { release2024 = resolve; });
      }
      return Promise.resolve(new Response('synthetic-pdf', { headers: { 'content-type': 'application/pdf' } }));
    });
    const held = await openYear(edited, '2025');
    expect(held).toContain('$100.00');
    walk(await paint(edited)).find(node => node.type === 'select').props.onChange({ target: { value: '2024' } });
    harness.cursor = 0;
    const immediate = text(ScheduleCExportScreen(edited));
    expect(immediate).not.toContain('$100.00');
    expect(immediate).not.toMatch(/\$\d/);
    await flushEffects();
    harness.cursor = 0;
    const pending = text(ScheduleCExportScreen(edited));
    expect(pending).not.toContain('$100.00');
    expect(pending).not.toMatch(/\$\d/);
    release2024(new Response(JSON.stringify({ prior: saved2024 }), { headers: { 'content-type': 'application/json' } }));
    const settled = text(await paint(edited));
    expect(settled).toContain('$40.00');
    expect(settled).not.toContain('$100.00');
  });

  it('shows the retry notice and zero totals when no auth header is available', async () => {
    const edited = {
      ...props,
      transactions: [{ id: 'ad', merchant_name: 'Synthetic ads', amount: 250, category: 'SERVICE_ADVERTISING', date: '2025-06-01', is_deductible: true, review_status: 'confirmed', tax_review_required: false }],
    };
    const previous = auth.currentUser;
    auth.currentUser = null;
    try {
      const body = await openYear(edited, '2025');
      expect(body).toContain(SCHEDULE_C_EXPORT_LOAD_FAILED_NOTICE);
      expect(body).toContain('$0.00');
      expect(body).not.toContain('$250.00');
    } finally {
      auth.currentUser = previous;
    }
  });

  it('shows the placeholder and no v0 total when the held year export cannot be loaded', async () => {
    const edited = {
      ...props,
      transactions: [{ id: 'ad', merchant_name: 'Synthetic ads', amount: 250, category: 'SERVICE_ADVERTISING', date: '2025-06-01', is_deductible: true, review_status: 'confirmed', tax_review_required: false }],
    };
    harness.fetch.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/tax/schedule-c/filed-year')) {
        return new Response(JSON.stringify({ error: 'Could not load all export records. Please retry.' }), { status: 503, headers: { 'content-type': 'application/json' } });
      }
      return new Response('synthetic-pdf', { headers: { 'content-type': 'application/pdf' } });
    });
    const body = await openYear(edited, '2025');
    expect(body).toContain(SCHEDULE_C_EXPORT_LOAD_FAILED_NOTICE);
    expect(body).toContain('$0.00');
    expect(body).not.toContain('your 2025 total under the rules at the time, on your current data');
    expect(body).not.toContain('$250.00');
  });

  async function confirmationFrom(load: () => Promise<{ default: (props?: unknown) => unknown }>) {
    const savedSlots = harness.slots;
    const savedEffects = harness.effects;
    harness.slots = [];
    harness.effects = [];
    harness.cursor = 0;
    try {
      const mod = await load();
      let tree = mod.default();
      for (let i = 0; i < 4; i += 1) {
        await flushEffects();
        harness.cursor = 0;
        tree = mod.default();
      }
      const screen = walk(tree).find(node => node?.props && Object.prototype.hasOwnProperty.call(node.props, 'confirmedRulesVersion'));
      expect(screen).toBeTruthy();
      return screen.props.confirmedRulesVersion;
    } finally {
      harness.slots = savedSlots;
      harness.effects = savedEffects;
      harness.cursor = 0;
    }
  }

  it('hides the held notice for a stored current rules version and shows it again for an older version', async () => {
    let confirmations: Record<string, string> = { '2025': 'v1' };
    harness.fetch.mockImplementation(async (url: string) => {
      const href = String(url);
      if (href === '/api/tax/schedule-c/filed-year') return new Response(JSON.stringify({ confirmations }), { headers: { 'content-type': 'application/json' } });
      if (href.startsWith('/api/tax/schedule-c/filed-year?')) return new Response(JSON.stringify({ prior: null }), { headers: { 'content-type': 'application/json' } });
      return new Response('synthetic-pdf', { headers: { 'content-type': 'application/pdf' } });
    });
    const fromScheduleCPage = await confirmationFrom(() => import('@/app/protected/schedule-c/page'));
    harness.search = 'screen=schedule-c-export';
    const fromProtectedPage = await confirmationFrom(() => import('@/app/protected/page'));
    expect(fromScheduleCPage).toEqual({ '2025': 'v1' });
    expect(fromProtectedPage).toEqual({ '2025': 'v1' });
    const input = { ...props, transactions: heldYearTransactions, confirmedRulesVersion: fromScheduleCPage };
    const current = await showYear(input, '2025');
    expect(current).toContain('$120.00');
    expect(current).toContain('Meals');
    expect(current).not.toContain('draft, awaiting copy approval');
    const buttons = walk(render(input)).filter(node => typeof node.props?.onClick === 'function').map(node => text(node));
    expect(buttons.join('\n').toLowerCase()).not.toContain('confirm');

    confirmations = { '2025': 'v0' };
    harness.slots = [];
    const older = await showYear({ ...input, confirmedRulesVersion: await confirmationFrom(() => import('@/app/protected/schedule-c/page')) }, '2025');
    expect(older).toContain('draft, awaiting copy approval');
    expect(older).toContain('That total was $240.00.');
    expect(await confirmationFrom(() => import('@/app/protected/page'))).toEqual({ '2025': 'v0' });
  });

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
    const exportCalls = harness.fetch.mock.calls.filter(call => call[0] === '/api/tax/schedule-c/export');
    expect(exportCalls).toHaveLength(1);
    if (year === '2026') expect(harness.fetch).toHaveBeenCalledOnce();
    const [url, options] = exportCalls[0];
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
