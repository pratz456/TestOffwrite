/**
 * Calendar dates as plain YYYY-MM-DD strings.
 * Compare and shift these strings directly. A date-only string parsed by the
 * Date constructor is UTC midnight and can shift the civil day.
 */

export interface CalendarDay {
  year: number;
  month: number;
  day: number;
  ymd: string;
}

const YEAR_MONTH_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  if (month >= 1 && month <= 12) return 31;
  return 0;
}

export function formatCalendarDay(parts: { year: number; month: number; day: number }): string {
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${String(parts.year).padStart(4, '0')}-${month}-${day}`;
}

/** Accept only a civil YYYY-MM-DD day. ISO datetimes and impossible days return null. */
export function parseCalendarDay(value: unknown): CalendarDay | null {
  if (typeof value !== 'string') return null;
  const match = YEAR_MONTH_DAY.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day, ymd: `${match[1]}-${match[2]}-${match[3]}` };
}

export function compareCalendarDays(left: string, right: string): -1 | 0 | 1 | null {
  const a = parseCalendarDay(left);
  const b = parseCalendarDay(right);
  if (!a || !b) return null;
  if (a.ymd === b.ymd) return 0;
  return a.ymd < b.ymd ? -1 : 1;
}

export function addCalendarDays(ymd: string, delta: number): string | null {
  const parsed = parseCalendarDay(ymd);
  if (!parsed || !Number.isInteger(delta)) return null;
  let { year, month, day } = parsed;
  let remaining = delta;

  while (remaining > 0) {
    const room = daysInMonth(year, month) - day;
    if (remaining <= room) {
      day += remaining;
      remaining = 0;
    } else {
      remaining -= room + 1;
      day = 1;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
  }

  while (remaining < 0) {
    if (day - 1 >= -remaining) {
      day += remaining;
      remaining = 0;
    } else {
      remaining += day;
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      day = daysInMonth(year, month);
    }
  }

  return formatCalendarDay({ year, month, day });
}
