import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// These tests run the actual form handlers with state slots, without a browser.
const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, request: vi.fn() }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.request }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const hooks = {
    useState(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [harness.slots[index], (next: unknown) => {
        harness.slots[index] = typeof next === 'function' ? next(harness.slots[index]) : next;
      }];
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});

import { AddManualEntryScreen } from '../components/add-manual-entry-screen';
import { AddManualTransactionScreen } from '../components/add-manual-transaction-screen';
import { localCalendarYMD } from '../lib/transactions/calendar-date';

type Element = ReactElement<Record<string, any>>;
function walk(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...walk(element.props.children)];
}
const screens = [
  ['entry', AddManualEntryScreen],
  ['transaction', AddManualTransactionScreen],
] as const;
function render(Screen: typeof AddManualEntryScreen | typeof AddManualTransactionScreen) {
  harness.cursor = 0;
  return Screen({ user: { id: 'synthetic-owner' }, onBack() {} }) as Element;
}
const dates = [
  { label: 'evening', year: 2026, month: 8, day: 15, hour: 19, expected: '2026-09-15', next: '2026-09-16' },
  { label: 'December 31 evening', year: 2026, month: 11, day: 31, hour: 20, expected: '2026-12-31', next: '2027-01-01' },
  { label: 'January 1 early morning', year: 2027, month: 0, day: 1, hour: 0, expected: '2027-01-01', next: '2027-01-02' },
];

beforeEach(() => {
  harness.slots = []; harness.cursor = 0;
  harness.request.mockReset().mockResolvedValue({ ok: true });
  vi.useFakeTimers();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

// Run in separate processes with TZ=America/Los_Angeles and TZ=Pacific/Kiritimati
// to cover UTC-7/-8 evenings and UTC+14 mornings, including tax-year boundaries.
describe('manual entries use the local calendar date', () => {
  it.each(dates)('formats $label without shifting the local day or timestamp', date => {
    const now = new Date(date.year, date.month, date.day, date.hour, 30);
    const timestamp = now.getTime();
    vi.setSystemTime(now);
    expect(localCalendarYMD()).toBe(date.expected);
    expect(localCalendarYMD(now)).toBe(date.expected);
    expect(now.getTime()).toBe(timestamp);
  });

  for (const [name, Screen] of screens) {
    for (const mode of ['expense', 'income']) {
      it.each(dates)(`${name} ${mode}: initializes and resets $label locally, preserving the entered save date`, async date => {
        vi.setSystemTime(new Date(date.year, date.month, date.day, date.hour, 30));
        let tree = render(Screen);
        if (mode === 'income') {
          walk(tree).find(node => node.props.value === 'expense' && node.props.onValueChange)!.props.onValueChange('income');
          tree = render(Screen);
        }
        const inputs = walk(tree);
        const dateInput = inputs.find(node => node.props.type === 'date')!;
        expect(dateInput.props.value).toBe(date.expected);
        inputs.find(node => node.props.placeholder?.startsWith('e.g.'))!.props.onChange({ target: { value: 'Synthetic entry' } });
        inputs.find(node => node.props.type === 'number')!.props.onChange({ target: { value: '25' } });
        dateInput.props.onChange({ target: { value: '2025-04-09' } });
        const form = walk(render(Screen)).find(node => node.type === 'form')!;

        // Midnight may pass while the form is open. Save the user's date and
        // obtain a fresh local "today" only when preparing the next entry.
        vi.setSystemTime(new Date(date.year, date.month, date.day + 1, 0, 5));
        await form.props.onSubmit({ preventDefault() {} });
        expect(harness.request).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(harness.request.mock.calls[0][1].body);
        expect(payload.date).toBe('2025-04-09');
        if (name === 'transaction' && mode === 'income') expect(payload.taxYear).toBe(2025);
        await vi.advanceTimersByTimeAsync(1800);
        expect(walk(render(Screen)).find(node => node.props.type === 'date')!.props.value).toBe(date.next);
      });
    }
  }
});
