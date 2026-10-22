import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], request: vi.fn() }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.request }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const hooks = {
    useState(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [harness.slots[index], (next: unknown) => {
        harness.slots[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(harness.slots[index]) : next;
      }];
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = harness.cursor++;
      const previous = harness.slots[index] as { deps: unknown[]; callback: unknown } | undefined;
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) harness.slots[index] = { deps, callback };
      return (harness.slots[index] as { callback: unknown }).callback;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = harness.cursor++;
      const previous = harness.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined;
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        const next: { deps: unknown[]; cleanup?: () => void } = { deps };
        harness.slots[index] = next;
        harness.effects.push(() => { previous?.cleanup?.(); const cleanup = effect(); if (cleanup) next.cleanup = cleanup; });
      }
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
import { QuarterlyPaymentTrackingScreen } from '../components/quarterly-payment-tracking-screen';
import { DASHBOARD_TAX_INPUTS_UPDATED } from '../lib/tax/dashboard-tax-input';
import { LATEST_PUBLISHED_TAX_YEAR } from '../lib/tax-rules/federal-year-rules';

type Node = ReactElement<{ children?: ReactNode; onClick?: () => void | Promise<void>; onChange?: (event: { target: { value: string } }) => void; onBlur?: (event: { target: { value: string } }) => void; placeholder?: string }>;
const isNode = (node: unknown): node is Node => !!node && typeof node === 'object' && 'props' in node;
const walk = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(walk) : isNode(node) ? [node, ...walk(node.props.children)] : [];
const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join(' ')
  : isNode(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
function render() {
  harness.cursor = 0;
  const tree = QuarterlyPaymentTrackingScreen({ user: { id: 'payer' }, onBack() {} }) as Node;
  harness.effects.splice(0).forEach(effect => effect());
  return tree;
}
const button = (tree: Node, label: string) => {
  const found = walk(tree).find(node => node.props.onClick && text(node).trim() === label);
  if (!found?.props.onClick) throw new Error(`missing ${label}`);
  return found.props.onClick;
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tick = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const payment = {
  quarter: 1, year: LATEST_PUBLISHED_TAX_YEAR, deadline: '2026-04-15T00:00:00.000Z',
  estimatedAmount: 100, paidAmount: 0, paidDate: null, confirmationNumber: null,
  paymentMethod: null, status: 'no_record' as const, notes: '',
};
const summary = { totalEstimated: 100, totalPaid: 0, totalRemaining: 100, totalPenalty: null };

beforeEach(() => {
  harness.slots = []; harness.effects = []; harness.cursor = 0; vi.clearAllMocks();
  harness.request.mockImplementation(async (_url: string, init?: RequestInit) => (
    init?.method === 'POST' || init?.method === 'PUT' ? response({ success: true }) : response({ payments: [payment], summary })
  ));
});
afterEach(() => {
  for (const slot of harness.slots) {
    if (slot && typeof slot === 'object' && 'cleanup' in slot && typeof slot.cleanup === 'function') slot.cleanup();
  }
});

describe('quarterly payment saves refresh a mounted dashboard', () => {
  it('asks the dashboard to reread tax inputs after a recorded payment, and not after a rejected one', async () => {
    const host = new EventTarget();
    vi.stubGlobal('window', host);
    let updates = 0;
    host.addEventListener(DASHBOARD_TAX_INPUTS_UPDATED, () => { updates += 1; });
    try {
      render(); await tick();
      button(render(), 'Record Payment')();
      const amount = walk(render()).find(node => node.props.placeholder === '0.00');
      if (!amount?.props.onChange) throw new Error('missing amount');
      amount.props.onChange({ target: { value: '400' } });
      harness.request.mockResolvedValueOnce(response({ error: 'Failed to record payment' }, 400));
      await button(render(), 'Save Payment')();
      expect(updates).toBe(0);
      expect(text(render())).toContain('Failed to record payment');
      await button(render(), 'Save Payment')();
      expect(updates).toBe(1);
      const posted = harness.request.mock.calls.find(call => call[1]?.method === 'POST');
      expect(JSON.parse(posted?.[1].body as string)).toMatchObject({ quarter: 1, year: LATEST_PUBLISHED_TAX_YEAR, paidAmount: 400 });
      harness.request.mockResolvedValueOnce(response({ error: 'Failed to update estimated amount' }, 400));
      const target = walk(render()).find(node => node.props.onBlur);
      if (!target?.props.onBlur) throw new Error('missing payment target');
      await target.props.onBlur({ target: { value: '250' } });
      expect(updates).toBe(1);
      await target.props.onBlur({ target: { value: '250' } });
      expect(updates).toBe(2);
      const updated = harness.request.mock.calls.filter(call => call[1]?.method === 'PUT');
      expect(JSON.parse(updated.at(-1)?.[1].body as string)).toMatchObject({ quarter: 1, year: LATEST_PUBLISHED_TAX_YEAR, estimatedAmount: 250 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
