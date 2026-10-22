/**
 * Calendar dates stored as YYYY-MM-DD, separate from instants.
 * `new Date('YYYY-MM-DD')` is UTC midnight and shifts the day in US time zones.
 */

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

/** User's local calendar day as YYYY-MM-DD. */
export function localCalendarDay(now: Date = new Date()): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

/** Local calendar year, taken from the same YYYY-MM-DD string as localCalendarDay. */
export function localCalendarYear(now: Date = new Date()): number {
  return Number(localCalendarDay(now).slice(0, 4));
}

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a stored YYYY-MM-DD day. Invalid calendar days return null. */
export function calendarDayParts(value: string): { year: number; month: number; day: number } | null {
  const match = CALENDAR_DAY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const localNoon = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (localNoon.getFullYear() !== year || localNoon.getMonth() !== month - 1 || localNoon.getDate() !== day) return null;
  return { year, month, day };
}

/** Year from the first four characters of a validated YYYY-MM-DD string. */
export function calendarDayYear(value: string): number | null {
  if (!calendarDayParts(value)) return null;
  return Number(value.slice(0, 4));
}

/**
 * Format a stored calendar day in local time.
 * Builds a local Date at noon so the day does not shift across midnight UTC.
 */
export function formatCalendarDay(value: string, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions): string {
  const parts = calendarDayParts(value);
  if (!parts) return value;
  const localNoon = new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0);
  return localNoon.toLocaleDateString(locales, options);
}
