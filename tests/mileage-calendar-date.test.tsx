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

import { MileageTrackerScreen } from '../components/mileage-tracker-screen';

function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: unknown } }).props.children);
  return '';
}

function renderMileage() {
  harness.cursor = 0;
  return MileageTrackerScreen({ user: { id: 'synthetic-owner' }, onBack() {} });
}

describe('mileage calendar date display in America/Los_Angeles', () => {
  beforeEach(() => {
    harness.slots = [];
    harness.cursor = 0;
    harness.request.mockReset().mockResolvedValue({
      ok: true,
      json: async () => [{
        id: 'trip-1',
        userId: 'synthetic-owner',
        date: '2026-04-15',
        startLocation: 'Office',
        endLocation: 'Client',
        miles: 12,
        businessPurpose: 'Client meeting',
        roundTrip: false,
      }],
    });
  });

  it('confirms the process time zone is America/Los_Angeles', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Los_Angeles');
    expect(new Date('2026-04-15').toLocaleDateString()).toBe('4/14/2026');
  });

  it('formats a mileage trip date as the stored calendar day', async () => {
    renderMileage();
    await vi.waitFor(() => {
      expect(Array.isArray(harness.slots[0]) && (harness.slots[0] as unknown[]).length).toBe(1);
      expect(harness.slots[1]).toBe(false);
    });
    const text = textOf(renderMileage());
    expect(text).toContain('4/15/2026');
    expect(text).not.toContain('4/14/2026');
  });
});
