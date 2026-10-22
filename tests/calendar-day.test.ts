import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { businessMileageRateForDate } from '../lib/tax-rules/mileage-rates';
import { calendarDayYear, formatCalendarDay, localCalendarDay, localCalendarYear } from '../lib/dates/calendar-day';

const previousTz = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'America/Los_Angeles';
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

describe('mileage calendar days in America/Los_Angeles', () => {
  it('default date at 2026-06-30 23:00 PDT returns 2026-06-30', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T06:00:00.000Z'));
    expect(new Date().getHours()).toBe(23);
    expect(localCalendarDay()).toBe('2026-06-30');
    expect(localCalendarDay(new Date())).toBe('2026-06-30');
  });

  it('default date at 2026-12-31 23:30 PST returns 2026-12-31', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T07:30:00.000Z'));
    expect(new Date().getHours()).toBe(23);
    expect(new Date().getMinutes()).toBe(30);
    expect(localCalendarDay()).toBe('2026-12-31');
  });

  it('display of 2026-06-30 renders June 30', () => {
    const display = formatCalendarDay('2026-06-30', 'en-US', { month: 'long', day: 'numeric' });
    expect(display).toBe('June 30');
    expect(display).not.toContain('29');
    expect(new Date('2026-06-30').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })).toBe('June 29');
  });

  it('year filter keeps 2027-01-01 in 2027 and 2026-12-31 in 2026', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T07:30:00.000Z'));
    const dates = ['2027-01-01', '2026-12-31'];
    const inYear = (year: number) => dates.filter(date => calendarDayYear(date) === year);
    expect(localCalendarYear()).toBe(2026);
    expect(inYear(localCalendarYear())).toEqual(['2026-12-31']);
    expect(inYear(2027)).toEqual(['2027-01-01']);
    expect(inYear(2026)).toEqual(['2026-12-31']);
    expect(calendarDayYear('2027-01-01')).toBe(2027);
    expect(calendarDayYear('2026-12-31')).toBe(2026);
    expect(new Date('2027-01-01').getFullYear()).toBe(2026);
  });

  it('rate for a trip defaulted at 2026-06-30 23:00 PDT is 0.725', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T06:00:00.000Z'));
    const day = localCalendarDay();
    expect(day).toBe('2026-06-30');
    expect(businessMileageRateForDate(day)?.ratePerMile).toBe(0.725);
  });
});
