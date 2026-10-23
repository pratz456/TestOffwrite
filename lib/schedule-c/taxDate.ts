export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Calendar day of a charge, using the same rules as the transaction export Tax Date.
 * A real YYYY-MM-DD (or an ISO/Date/Timestamp whose first calendar day round-trips
 * through noon UTC) is kept. Impossible days, blanks, and junk are undated.
 * Save time, upload time, and today's date are not inputs to this function.
 */
export function calendarChargeDay(value: unknown): string | null {
  try {
    if (value instanceof Date) value = value.toISOString();
    else if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
      value = (value as { toDate: () => Date }).toDate().toISOString();
    }
  } catch {
    return null;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return null;
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
}

/**
 * Cash-method charge day (Treas. Reg. 1.461-1(a)(1)): `date` when it is present
 * (including an empty or invalid string), otherwise `datetime`. No valid day
 * means the charge is undated. created_at, updated_at, and today are never read.
 */
export function chargeDateSource(record: { date?: unknown; datetime?: unknown } | null | undefined): unknown {
  if (record == null || typeof record !== 'object') return undefined;
  return record.date !== undefined && record.date !== null ? record.date : record.datetime;
}

/** Date text as received. A blank is `missing`. This is not a parsed charge day. */
export function receivedChargeDateText(record: { date?: unknown; datetime?: unknown } | null | undefined): string {
  const source = chargeDateSource(record);
  if (source === undefined || source === null) return 'missing';
  if (typeof source === 'string') return source.trim() === '' ? 'missing' : source;
  if (typeof source === 'number') return Number.isFinite(source) ? String(source) : 'missing';
  if (source instanceof Date) return Number.isFinite(source.getTime()) ? source.toISOString() : 'missing';
  if (typeof source === 'object' && 'toDate' in source && typeof (source as { toDate?: unknown }).toDate === 'function') {
    try {
      const date = (source as { toDate: () => Date }).toDate();
      if (date instanceof Date && Number.isFinite(date.getTime())) return date.toISOString();
    } catch { /* unreadable timestamp */ }
  }
  return 'missing';
}

export function chargeDay(record: { date?: unknown; datetime?: unknown } | null | undefined): string | null {
  return calendarChargeDay(chargeDateSource(record));
}

/** Year of the charge day, or null when the charge is undated. Never the current year. */
export function chargeYear(record: { date?: unknown; datetime?: unknown } | null | undefined): number | null {
  const day = chargeDay(record);
  if (!day) return null;
  const year = Number(day.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

/** YYYY-MM-DD tax date. Impossible calendar days are null. */
export function safeYMD(dateLike: unknown): string | null {
  return calendarChargeDay(dateLike);
}

/**
 * Tax year of one date value. Returns null when the value is not a real calendar day.
 */
export function safeTaxYear(dateLike: unknown): number | null {
  const ymd = safeYMD(dateLike);
  if (!ymd) return null;
  const year = Number(ymd.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}
