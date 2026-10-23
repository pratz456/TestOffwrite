export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Month 1-12 and a day that exists in that month, including February 29 in leap years. */
function isCalendarDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

/**
 * Extract a YYYY-MM-DD "tax date" from a transaction date string without
 * timezone-sensitive Date parsing.
 *
 * Rationale: JS `new Date('YYYY-MM-DD')` interprets as UTC midnight, then
 * `getFullYear()`/`getMonth()` use local time, which can shift the year around
 * year-boundaries for users in negative timezones.
 */
export function safeYMD(dateLike: unknown): string | null {
  if (dateLike === null || dateLike === undefined) return null;
  if (typeof dateLike !== 'string') {
    // Last-resort fallback: use UTC getters to avoid local timezone drift.
    const d = new Date(dateLike as any);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }

  const s = dateLike.trim();
  if (!s) return null;

  // Most of our tx dates come in as `YYYY-MM-DD` or an ISO string where the
  // first 10 chars encode the date intended for tax-year grouping.
  // Month and day must be a real calendar day. 2025-02-30 and 2025-13-01 are not.
  const calendar = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (calendar) {
    const year = Number(calendar[1]);
    const month = Number(calendar[2]);
    const day = Number(calendar[3]);
    if (!isCalendarDay(year, month, day)) return null;
    return `${calendar[1]}-${calendar[2]}-${calendar[3]}`;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Extract a tax year number from a transaction date string.
 * Returns null if the input can't be parsed.
 */
export function safeTaxYear(dateLike: unknown): number | null {
  const ymd = safeYMD(dateLike);
  if (!ymd) return null;
  const yearStr = ymd.slice(0, 4);
  const year = Number(yearStr);
  return Number.isFinite(year) ? year : null;
}

