/**
 * Tax year from a request's `year` query, shared by the annual estimate and the
 * quarterly fallback. When the query is omitted, both use the server calendar
 * year from `Date#getFullYear` so a year boundary cannot split them.
 */
export function resolveRequestedTaxYear(yearParam: string | null, now = new Date()): number {
  return yearParam === null ? now.getFullYear() : /^\d{4}$/.test(yearParam) ? Number(yearParam) : NaN;
}
