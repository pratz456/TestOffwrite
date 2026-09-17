import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatTransactionDate, transactionCalendarDate, transactionDateParts } from '../lib/transactions/calendar-date';
import { RecentActivityCard } from '../components/dashboard/RecentActivityCard';

// Run this file in separate Node processes with TZ=America/Los_Angeles and
// TZ=Pacific/Kiritimati. Date fields keep their calendar day across UTC offsets.
describe('transaction calendar dates', () => {
  it.each([
    ['2026-09-02', 'Sep 2, 2026', 9, 2],
    ['2026-09-02T00:00:00.000Z', 'Sep 2, 2026', 9, 2],
    ['2026-01-01', 'Jan 1, 2026', 1, 1],
    ['2026-01-01T00:00:00.000Z', 'Jan 1, 2026', 1, 1],
    ['2026-01-01T00:00:00+14:00', 'Jan 1, 2026', 1, 1],
  ] as const)('preserves %s for display, grouping, and local date filters', (value, display, month, day) => {
    expect(formatTransactionDate(value, 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })).toBe(display);
    expect(transactionDateParts(value)).toEqual({ year: 2026, month, day });
    const local = transactionCalendarDate(value)!;
    expect([local.getFullYear(), local.getMonth() + 1, local.getDate(), local.getHours()]).toEqual([2026, month, day, 0]);
    expect(local >= new Date(2026, 0, 1) && local < new Date(2027, 0, 1)).toBe(true);
  });

  it.each(['', 'not-a-date', '2026-02-30', '2026-13-01', null, undefined])('does not roll invalid calendar date %s into another date', value => {
    expect(formatTransactionDate(value)).toBe('-');
    expect(transactionDateParts(value)).toBeNull();
    expect(transactionCalendarDate(value)).toBeNull();
  });

  it('accepts a valid leap day without changing its calendar year', () => {
    expect(formatTransactionDate('2024-02-29T00:00:00.000Z', 'en-US')).toBe('2/29/2024');
  });

  it.each([['2026-09-02T00:00:00.000Z', 'Sep 2', 'Sep 1'], ['2026-01-01T00:00:00.000Z', 'Jan 1', 'Dec 31']])('renders %s correctly in desktop and mobile recent activity', (date, expected, previous) => {
    const html = renderToStaticMarkup(<RecentActivityCard transactions={[{ id: 'synthetic-receipt', merchant_name: 'Synthetic receipt', amount: 25, category: 'office_expense', date }]} onTransactionClick={() => {}} onViewAll={() => {}} />);
    expect(html).toContain(expected);
    expect(html).not.toContain(previous);
  });
});
