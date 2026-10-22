import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addCalendarDays, compareCalendarDays, daysInMonth, parseCalendarDay } from '../lib/dates/calendar-day';

describe('calendar-day', () => {
  it('parses a plain YYYY-MM-DD day and rejects datetimes and impossible days', () => {
    expect(parseCalendarDay('2026-06-30')).toEqual({ year: 2026, month: 6, day: 30, ymd: '2026-06-30' });
    expect(parseCalendarDay(' 2026-07-01 ')).toMatchObject({ ymd: '2026-07-01' });
    expect(parseCalendarDay('2026-06-30T00:00:00')).toBeNull();
    expect(parseCalendarDay('2026-02-31')).toBeNull();
    expect(parseCalendarDay('2026-13-01')).toBeNull();
    expect(parseCalendarDay('2025-02-29')).toBeNull();
    expect(parseCalendarDay('2024-02-29')?.ymd).toBe('2024-02-29');
    expect(parseCalendarDay('2000-02-29')?.ymd).toBe('2000-02-29');
    expect(parseCalendarDay('1900-02-29')).toBeNull();
    expect(parseCalendarDay('')).toBeNull();
    expect(parseCalendarDay(null)).toBeNull();
  });

  it('adds days across month and year boundaries without Date parsing', () => {
    expect(addCalendarDays('2026-06-30', 1)).toBe('2026-07-01');
    expect(addCalendarDays('2026-07-01', -1)).toBe('2026-06-30');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addCalendarDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addCalendarDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addCalendarDays('2026-06-15', 40)).toBe('2026-07-25');
    expect(addCalendarDays('not-a-day', 1)).toBeNull();
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
  });

  it('compares calendar days as text', () => {
    expect(compareCalendarDays('2026-06-30', '2026-07-01')).toBe(-1);
    expect(compareCalendarDays('2026-07-01', '2026-07-01')).toBe(0);
    expect(compareCalendarDays('2027-01-01', '2026-12-31')).toBe(1);
    expect(compareCalendarDays('2026-02-31', '2026-03-01')).toBeNull();
  });

  it('does not parse dates with the Date constructor', () => {
    const source = readFileSync(new URL('../lib/dates/calendar-day.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/new Date\s*\(/);
    expect(source).not.toContain('Date.parse');
  });
});
