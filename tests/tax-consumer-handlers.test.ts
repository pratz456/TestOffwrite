import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// Exercise the real component handlers with a small hook scheduler. Network writes
// are mocked; this is not a browser or live-signature integration test.
const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], request: vi.fn() }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.request }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (left: unknown[] | undefined, right: unknown[] | undefined) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = {
    useState(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [harness.slots[index], (next: unknown) => { harness.slots[index] = typeof next === 'function' ? next(harness.slots[index]) : next; }];
    },
    useRef(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = { current: initial };
      return harness.slots[index];
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = harness.cursor++;
      if (!same(harness.slots[index]?.deps, deps)) harness.slots[index] = { deps, callback };
      return harness.slots[index].callback;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = harness.cursor++;
      const previous = harness.slots[index];
      if (!same(previous?.deps, deps)) {
        const next: any = { deps };
        harness.slots[index] = next;
        harness.effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
      }
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
import { Form8879Screen } from '../components/form-8879-screen';
import { TaxFilingHubScreen } from '../components/tax-filing-hub-screen';

type Element = ReactElement<Record<string, any>>;
let userId = 'synthetic-user';
function render(component = Form8879Screen): Element {
  harness.cursor = 0;
  const tree = component({ user: { id: userId }, onBack: () => {} }) as Element;
  harness.effects.splice(0).forEach(effect => effect());
  return tree;
}
function walk(node: any): Element[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== 'object') return [];
  return [node, ...walk(node.props?.children)];
}
function changeYear(tree: Element, year: number) { walk(tree).find(node => node.type === 'select')!.props.onChange({ target: { value: String(year) } }); }
function text(node: any): string { return Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : String(node ?? ''); }
async function flush() { await new Promise<void>(resolve => setImmediate(resolve)); }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const taxResult = (year: number, overrides = {}) => ({ taxYear: year, form1040: { taxYear: year, agi: 70000, totalIncome: 70000, totalTax: 8100, w2FederalWithheld: 5000, refund: 0, balanceDue: 3100, ...overrides } });
const year = new Date().getFullYear();
function defaultRequests(url: string, options?: RequestInit) {
  if (options?.method === 'POST') return Promise.resolve(response({ status: 'signed' }));
  if (url.includes('compute-1040')) return Promise.resolve(response(taxResult(Number(new URL(url, 'http://localhost').searchParams.get('year')))));
  return Promise.resolve(response({ authorization: null }));
}
const posts = () => harness.request.mock.calls.filter(([, options]) => options?.method === 'POST');

beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.effects = []; harness.request.mockReset();
  harness.request.mockImplementation(defaultRequests); userId = 'synthetic-user';
});

describe('legacy authorization is reference only', () => {
  it('does not collect a PIN, signature or transmit authorization', async () => {
    harness.request.mockResolvedValue(response({ taxYear: year, legacyRecordExists: true, authorization: null }));
    render(); await flush(); const tree = render();
    expect(text(tree)).toContain('An older WriteOff authorization record exists');
    expect(text(tree)).toContain('It is not confirmation that a provider signed, submitted or filed your return.');
    expect(walk(tree).some(node => node.type === 'form' || node.props?.type === 'password')).toBe(false);
    expect(walk(tree).filter(node => node.type === 'input')).toHaveLength(0);
    expect(posts()).toHaveLength(0);
    expect(harness.request.mock.calls.every(([url]) => url.includes('/form-8879?year='))).toBe(true);
  });
  it('shows a retry on read failure without implying no historical record exists', async () => {
    harness.request.mockResolvedValue(response({ error: 'unavailable' }, 503));
    render(); await flush(); const tree = render();
    expect(text(tree)).toContain('Unable to load the historical record. Please retry.');
    harness.request.mockResolvedValue(response({ legacyRecordExists: true }));
    walk(tree).find(node => node.props?.onClick && text(node) === 'Retry historical record')!.props.onClick();
    render(); await flush(); expect(text(render())).toContain('An older WriteOff authorization record exists');
  });
  it('discards an old-year response after year change', async () => {
    let finish!: (value: Response) => void;
    harness.request.mockImplementation((url: string) => url.includes(`year=${year}`) ? new Promise<Response>(resolve => { finish = resolve; }) : Promise.resolve(response({ legacyRecordExists: false })));
    const tree = render(); changeYear(tree, year - 1); render(); await flush();
    finish(response({ legacyRecordExists: true })); await flush();
    expect(text(render())).not.toContain('An older WriteOff authorization record exists');
  });
  it('discards prior-account records when the signed-in user changes', async () => {
    let finish!: (value: Response) => void;
    harness.request.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    render(); userId = 'another-synthetic-user'; render(); await flush();
    finish(response({ legacyRecordExists: true })); await flush();
    expect(text(render())).not.toContain('An older WriteOff authorization record exists');
  });
});

describe('filing hub income summary', () => {
  it('shows federal total income once when Schedule SE already includes W-2 wages', async () => {
    harness.request.mockImplementation((url: string) => {
      // The hub refuses partial snapshots; every wired figure below is part of the compute-1040 contract.
      if (url.includes('compute-1040')) return Promise.resolve(response({ ...taxResult(year), income: { grossReceipts: 20000, income1099: 0, scheduleCNetProfit: 20000, totalDeductible: 0, w2Wages: 50000 }, seCalc: { totalSETax: 2000 }, w2: { withheld: 0 }, payments: { estimatedPayments: 0 } }));
      if (url.includes('schedule-se')) return Promise.resolve(response({ totalIncome: 70000, netProfit: 20000, w2Wages: 50000 }));
      if (url.includes('gross-receipts')) return Promise.resolve(response({ totalGrossReceipts: 20000 }));
      return Promise.resolve(response({}));
    });
    render(TaxFilingHubScreen); await flush();
    const tree = render(TaxFilingHubScreen);
    const texts = walk(tree).flatMap(node => typeof node.props?.children === 'string' ? [node.props.children] : []);
    expect(texts).toContain('$70,000');
    expect(texts).not.toContain('$120,000');
  });
});
