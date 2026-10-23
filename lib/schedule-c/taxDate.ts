export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_INDEX: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** English month, day, and four-digit year. The day is the numbers as written, not a UTC conversion. */
function writtenMonthDay(value: string): string | null {
  const match = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(value);
  if (!match) return null;
  const month = MONTH_INDEX[match[1].toLowerCase()];
  if (!month) return null;
  const day = Number(match[2]);
  const year = Number(match[3]);
  const length = MONTH_LENGTHS[month - 1] + (month === 2 && isLeapYear(year) ? 1 : 0);
  if (!Number.isInteger(day) || day < 1 || day > length) return null;
  return `${match[3]}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Calendar day of a charge, using the same rules as the transaction export Tax Date.
 * A real YYYY-MM-DD is kept. An ISO timestamp, a trailing Z, or a space and a
 * time uses that same written day when the first ten characters round-trip
 * through noon UTC. An English month name, full or three letters, followed by
 * the day and a four-digit year is that written day. Impossible days, blanks,
 * and junk are undated.
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
  if (typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}(?:$|T|Z$| \d{2}:\d{2}:\d{2})/.test(value)) {
    const day = value.slice(0, 10);
    const parsed = new Date(`${day}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
  }
  return writtenMonthDay(value);
}

/**
 * Cash-method charge day (Treas. Reg. 1.461-1(a)(1)): `date` when it is present
 * (including an empty or invalid string), otherwise `datetime`. No valid day
 * means the charge is undated. created_at, updated_at, and today are never read.
 */
export function chargeDay(record: { date?: unknown; datetime?: unknown } | null | undefined): string | null {
  if (record == null || typeof record !== 'object') return null;
  const source = record.date !== undefined && record.date !== null ? record.date : record.datetime;
  return calendarChargeDay(source);
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
