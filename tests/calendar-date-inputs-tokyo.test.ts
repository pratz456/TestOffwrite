import { afterAll, describe, expect, it } from 'vitest';
import { readCalendarInput, type CalendarInputKind } from './calendar-date-input-cases';

const previousTz = process.env.TZ;
process.env.TZ = 'Asia/Tokyo';
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

const cases: Array<[CalendarInputKind, number, number, number, string, string | null]> = [
  ['Date', 2026, 12, 31, '12/30/2026', '2026-12-30'],
  ['Timestamp', 2026, 12, 31, '-', null],
  ['{seconds, nanoseconds}', 2026, 12, 31, '-', null],
  ['Date', 2027, 1, 1, '12/31/2026', '2026-12-31'],
  ['Timestamp', 2027, 1, 1, '-', null],
  ['{seconds, nanoseconds}', 2027, 1, 1, '-', null],
];

describe('formatTransactionDate inputs in Asia/Tokyo', () => {
  it('confirms the process time zone is Asia/Tokyo', () => {
    expect(process.env.TZ).toBe('Asia/Tokyo');
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Tokyo');
    expect(new Date('2026-04-15T00:00:00Z').getHours()).toBe(9);
  });

  // Known gap: a Date at Tokyo local midnight on Jan 1 2027 formats as Dec 31
  // because safeYMD uses UTC getters. Timestamp and {seconds, nanoseconds}
  // format as '-' because new Date(obj) is NaN. safeYMD is unchanged.
  it.each(cases)('%s at local midnight %s-%s-%s formats as %s', (kind, year, month, day, formatted, ymd) => {
    const actual = readCalendarInput(kind, new Date(year, month - 1, day, 0, 0, 0));
    expect(actual).toEqual({ formatted, ymd });
  });
});
