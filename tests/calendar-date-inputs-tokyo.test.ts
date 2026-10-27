import { afterAll, describe, expect, it } from 'vitest';
import { readCalendarInput, type CalendarInputKind } from './calendar-date-input-cases';

const previousTz = process.env.TZ;
process.env.TZ = 'Asia/Tokyo';
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

function reading(kind: CalendarInputKind, year: number, month: number, day: number) {
  return readCalendarInput(kind, new Date(year, month - 1, day, 0, 0, 0));
}

describe('formatTransactionDate inputs in Asia/Tokyo', () => {
  it('confirms the process time zone is Asia/Tokyo', () => {
    expect(process.env.TZ).toBe('Asia/Tokyo');
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Tokyo');
    expect(new Date('2026-04-15T00:00:00Z').getHours()).toBe(9);
  });

  // item 212. A Date at Tokyo local midnight is that calendar day. Today safeYMD reads UTC getters, so December 31 renders 12/30/2026 and January 1 renders 12/31/2026.
  it.fails('item 212 formats a Date at Asia/Tokyo local midnight on 2026-12-31 as 12/31/2026', () => {
    expect(reading('Date', 2026, 12, 31)).toEqual({ formatted: '12/31/2026', ymd: '2026-12-31' });
  });

  it.fails('item 212 formats a Date at Asia/Tokyo local midnight on 2027-01-01 as 1/1/2027', () => {
    expect(reading('Date', 2027, 1, 1)).toEqual({ formatted: '1/1/2027', ymd: '2027-01-01' });
  });

  // item 217. A Timestamp or {seconds, nanoseconds} value at local midnight is that calendar day. Today both render '-' and safeYMD returns null.
  it.fails('item 217 formats a Timestamp at Asia/Tokyo local midnight on 2026-12-31 as 12/31/2026', () => {
    expect(reading('Timestamp', 2026, 12, 31)).toEqual({ formatted: '12/31/2026', ymd: '2026-12-31' });
  });

  it.fails('item 217 formats a Timestamp at Asia/Tokyo local midnight on 2027-01-01 as 1/1/2027', () => {
    expect(reading('Timestamp', 2027, 1, 1)).toEqual({ formatted: '1/1/2027', ymd: '2027-01-01' });
  });

  it.fails('item 217 formats a seconds object at Asia/Tokyo local midnight on 2026-12-31 as 12/31/2026', () => {
    expect(reading('{seconds, nanoseconds}', 2026, 12, 31)).toEqual({ formatted: '12/31/2026', ymd: '2026-12-31' });
  });

  it.fails('item 217 formats a seconds object at Asia/Tokyo local midnight on 2027-01-01 as 1/1/2027', () => {
    expect(reading('{seconds, nanoseconds}', 2027, 1, 1)).toEqual({ formatted: '1/1/2027', ymd: '2027-01-01' });
  });
});
