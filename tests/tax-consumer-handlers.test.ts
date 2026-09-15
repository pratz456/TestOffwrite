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
function form(tree: Element) { return walk(tree).find(node => node.type === 'form')!; }
function changeYear(tree: Element, year: number) { walk(tree).find(node => typeof node.props?.onValueChange === 'function')!.props.onValueChange(String(year)); }
function fill(tree: Element) {
  walk(tree).find(node => node.props?.placeholder === 'As it appears on your Social Security card')!.props.onChange({ target: { value: 'Synthetic Taxpayer' } });
  walk(tree).find(node => node.props?.placeholder === 'Choose any 5 digits (not 00000)')!.props.onChange({ target: { value: '12345' } });
  walk(tree).filter(node => node.props?.type === 'checkbox').forEach(node => node.props.onChange({ target: { checked: true } }));
}
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

describe('authorization requires the current successful tax calculation', () => {
  it('blocks the submit handler after the calculation fails even with valid signature inputs', async () => {
    harness.request.mockImplementation((url: string) => Promise.resolve(url.includes('compute-1040') ? response({ error: 'unavailable' }, 503) : response({ authorization: null })));
    render(); await flush(); fill(render());
    await form(render()).props.onSubmit({ preventDefault() {} });
    expect(posts()).toHaveLength(0);
  });

  it.each([taxResult(year - 1), taxResult(year, { totalTax: undefined })])('blocks a mismatched-year or incomplete result instead of sending fallback zeros', async computedTax => {
    harness.request.mockImplementation((url: string) => Promise.resolve(url.includes('compute-1040') ? response(computedTax) : response({ authorization: null })));
    render(); await flush(); fill(render());
    await form(render()).props.onSubmit({ preventDefault() {} });
    expect(posts()).toHaveLength(0);
  });

  it('posts the reviewed amounts once and preserves an explicitly calculated zero refund', async () => {
    let finishPost!: (value: Response) => void;
    harness.request.mockImplementation((url: string, options?: RequestInit) => options?.method === 'POST'
      ? new Promise<Response>(resolve => { finishPost = resolve; }) : defaultRequests(url, options));
    render(); await flush(); fill(render()); const currentForm = form(render());
    const firstSubmit = currentForm.props.onSubmit({ preventDefault() {} });
    await currentForm.props.onSubmit({ preventDefault() {} });
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0][1].body)).toMatchObject({ taxYear: year, adjustedGrossIncome: 70000, totalTax: 8100, federalIncomeTaxWithheld: 5000, amountOwed: 3100, refundAmount: 0 });
    finishPost(response({ status: 'signed' })); await firstSubmit;
  });

  it('rejects an old submit handler immediately after year change and ignores a late prior-year response', async () => {
    render(); await flush(); fill(render()); const oldTree = render(); const oldSubmit = form(oldTree).props.onSubmit;
    let finishOldYear!: (value: Response) => void;
    harness.request.mockImplementation((url: string) => url.includes('compute-1040') && url.includes(`year=${year - 1}`)
      ? new Promise<Response>(resolve => { finishOldYear = resolve; }) : defaultRequests(url));
    changeYear(oldTree, year - 1);
    await oldSubmit({ preventDefault() {} });
    expect(posts()).toHaveLength(0);
    const pendingTree = render();
    changeYear(pendingTree, year - 2); render(); await flush();
    finishOldYear(response(taxResult(year - 1))); await flush();
    const current = render();
    await form(current).props.onSubmit({ preventDefault() {} });
    expect(JSON.parse(posts()[0][1].body).taxYear).toBe(year - 2);
  });

  it('does not accept a completed save as the newly signed year after the active user changes', async () => {
    let finishPost!: (value: Response) => void;
    harness.request.mockImplementation((url: string, options?: RequestInit) => options?.method === 'POST'
      ? new Promise<Response>(resolve => { finishPost = resolve; }) : defaultRequests(url, options));
    render(); await flush(); fill(render());
    const saving = form(render()).props.onSubmit({ preventDefault() {} });
    userId = 'different-synthetic-user'; render(); await flush();
    finishPost(response({ status: 'signed' })); await saving;
    const tree = render();
    const textContent = (node: any): string => Array.isArray(node) ? node.map(textContent).join('') : typeof node === 'object' && node ? textContent(node.props?.children) : String(node ?? '');
    expect(textContent(tree).replace(/\s+/g, ' ')).not.toContain(`Form 8879 signed for ${year}`);
    expect(walk(tree).find(node => node.props?.placeholder === 'As it appears on your Social Security card')!.props.value).toBe('');
    expect(posts()).toHaveLength(1);
  });
});

describe('filing hub income summary', () => {
  it('shows federal total income once when Schedule SE already includes W-2 wages', async () => {
    harness.request.mockImplementation((url: string) => {
      if (url.includes('compute-1040')) return Promise.resolve(response(taxResult(year)));
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
