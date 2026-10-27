import { afterAll, describe, expect, it } from 'vitest';
import { readCalendarInput, type CalendarInputKind } from './calendar-date-input-cases';

const previousTz = process.env.TZ;
process.env.TZ = 'UTC';
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

const cases: Array<[CalendarInputKind, number, number, number, string, string | null]> = [
  ['Date', 2026, 12, 31, '12/31/2026', '2026-12-31'],
  ['Timestamp', 2026, 12, 31, '-', null],
  ['{seconds, nanoseconds}', 2026, 12, 31, '-', null],
  ['Date', 2027, 1, 1, '1/1/2027', '2027-01-01'],
  ['Timestamp', 2027, 1, 1, '-', null],
  ['{seconds, nanoseconds}', 2027, 1, 1, '-', null],
];

describe('formatTransactionDate inputs in UTC', () => {
  it('confirms the process time zone is UTC', () => {
    expect(process.env.TZ).toBe('UTC');
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
    expect(new Date('2026-04-15T00:00:00Z').getHours()).toBe(0);
  });

  // Known gap: see calendar-date-input-cases.ts. In UTC, local midnight matches
  // the UTC day, so a Date stays on Dec 31 or Jan 1. Timestamp and
  // {seconds, nanoseconds} still format as '-'.
  it.each(cases)('%s at local midnight %s-%s-%s formats as %s', (kind, year, month, day, formatted, ymd) => {
    const actual = readCalendarInput(kind, new Date(year, month - 1, day, 0, 0, 0));
    expect(actual).toEqual({ formatted, ymd });
  });
});
