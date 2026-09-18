import { safeYMD } from '@/lib/schedule-c/taxDate';

/** Today's date for a new entry follows the user's local calendar, not UTC. */
export function localCalendarYMD(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Transaction.date is a calendar date; datetime/created_at remain timestamps. */
export function transactionDateParts(value: unknown): { year: number; month: number; day: number } | null {
  const ymd = safeYMD(value);
  if (!ymd) return null;
  const date = new Date(`${ymd}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== ymd) return null;
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** Render the stored calendar day without applying the viewer's UTC offset. */
export function formatTransactionDate(value: unknown, locales: Intl.LocalesArgument = 'en-US', options?: Omit<Intl.DateTimeFormatOptions, 'timeZone'>): string {
  const parts = transactionDateParts(value);
  if (!parts) return '-';
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(0, 0, 0, 0);
  return date.toLocaleDateString(locales, { ...options, timeZone: 'UTC' });
}

/** Local-midnight boundary for comparing calendar date filters, never timestamp events. */
export function transactionCalendarDate(value: unknown): Date | null {
  const parts = transactionDateParts(value);
  if (!parts) return null;
  const date = new Date(0);
  date.setFullYear(parts.year, parts.month - 1, parts.day);
  date.setHours(0, 0, 0, 0);
  return date;
}
