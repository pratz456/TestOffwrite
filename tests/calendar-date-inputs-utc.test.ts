import { afterAll, describe, expect, it } from 'vitest';
import { readCalendarInput, type CalendarInputKind } from './calendar-date-input-cases';

const previousTz = process.env.TZ;
process.env.TZ = 'UTC';
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

function reading(kind: CalendarInputKind, year: number, month: number, day: number) {
  return readCalendarInput(kind, new Date(year, month - 1, day, 0, 0, 0));
}

const dateCases: Array<[CalendarInputKind, number, number, number, string, string]> = [
  ['Date', 2026, 12, 31, '12/31/2026', '2026-12-31'],
  ['Date', 2027, 1, 1, '1/1/2027', '2027-01-01'],
];

describe('formatTransactionDate inputs in UTC', () => {
  it('confirms the process time zone is UTC', () => {
    expect(process.env.TZ).toBe('UTC');
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
    expect(new Date('2026-04-15T00:00:00Z').getHours()).toBe(0);
  });

  // Local midnight in UTC is that calendar day, so a Date formats as the stored day.
  it.each(dateCases)('%s at local midnight %s-%s-%s formats as %s', (kind, year, month, day, formatted, ymd) => {
    expect(reading(kind, year, month, day)).toEqual({ formatted, ymd });
  });

  // item 217. A Timestamp or {seconds, nanoseconds} value at local midnight is that calendar day. Today both render '-' and safeYMD returns null.
  it.fails('item 217 formats a Timestamp at UTC local midnight on 2026-12-31 as 12/31/2026', () => {
    expect(reading('Timestamp', 2026, 12, 31)).toEqual({ formatted: '12/31/2026', ymd: '2026-12-31' });
  });

  it.fails('item 217 formats a Timestamp at UTC local midnight on 2027-01-01 as 1/1/2027', () => {
    expect(reading('Timestamp', 2027, 1, 1)).toEqual({ formatted: '1/1/2027', ymd: '2027-01-01' });
  });

  it.fails('item 217 formats a seconds object at UTC local midnight on 2026-12-31 as 12/31/2026', () => {
    expect(reading('{seconds, nanoseconds}', 2026, 12, 31)).toEqual({ formatted: '12/31/2026', ymd: '2026-12-31' });
  });

  it.fails('item 217 formats a seconds object at UTC local midnight on 2027-01-01 as 1/1/2027', () => {
    expect(reading('{seconds, nanoseconds}', 2027, 1, 1)).toEqual({ formatted: '1/1/2027', ymd: '2027-01-01' });
  });
});
