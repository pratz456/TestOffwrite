import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const previousTz = process.env.TZ;
process.env.TZ = 'America/Los_Angeles';
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, request: vi.fn() }));
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
    useEffect(effect: () => void | (() => void)) {
      effect();
    },
    useCallback<T extends (...args: never[]) => unknown>(fn: T) {
      return fn;
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});

import { QuarterlyPaymentTrackingScreen } from '../components/quarterly-payment-tracking-screen';

function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: unknown } }).props.children);
  return '';
}

function renderScreen() {
  harness.cursor = 0;
  return QuarterlyPaymentTrackingScreen({ user: { id: 'synthetic-owner' }, onBack() {} });
}

describe('quarterly paid date in America/Los_Angeles', () => {
  beforeEach(() => {
    harness.slots = [];
    harness.cursor = 0;
    harness.request.mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({
        payments: [{
          quarter: 1,
          year: 2026,
          deadline: '2026-04-15T12:00:00.000Z',
          estimatedAmount: 100,
          paidAmount: 100,
          paidDate: '2026-04-15',
          confirmationNumber: null,
          paymentMethod: null,
          status: 'recorded',
          notes: '',
        }],
        summary: { totalEstimated: 100, totalPaid: 100, totalRemaining: 0, totalPenalty: null },
      }),
    });
  });

  it('confirms the process time zone is America/Los_Angeles', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Los_Angeles');
    expect(new Date('2026-04-15').getDate()).toBe(14);
  });

  it('shows Paid Apr 15, 2026 for paidDate 2026-04-15', async () => {
    renderScreen();
    await vi.waitFor(() => {
      expect(Array.isArray(harness.slots[0]) && (harness.slots[0] as unknown[]).length).toBe(1);
      expect(harness.slots[2]).toBe(false);
    });
    const text = textOf(renderScreen());
    expect(text).toContain('Paid Apr 15, 2026');
    expect(text).not.toContain('Paid Apr 14, 2026');
  });
});
