export function pad2(n: number): string {
  return String(n).padStart(2, '0');
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
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
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

