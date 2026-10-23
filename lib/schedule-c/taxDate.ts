export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_INDEX: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

const WRITTEN_TIME = String.raw`(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)?`;
const MONTH_TOKEN = String.raw`([A-Za-z]+)\.?`;
const WEEKDAY = String.raw`(?:(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*\.?\s+)?`;

function realWrittenDay(yearText: string, monthToken: string, dayText: string): string | null {
  const month = MONTH_INDEX[monthToken.toLowerCase().replace(/\./g, '')];
  if (!month) return null;
  const day = Number(dayText);
  const year = Number(yearText);
  const length = MONTH_LENGTHS[month - 1] + (month === 2 && isLeapYear(year) ? 1 : 0);
  if (!Number.isInteger(day) || day < 1 || day > length) return null;
  return `${yearText}-${pad2(month)}-${pad2(day)}`;
}

/** English month and day as written. No Date parse and no UTC shift. */
function writtenMonthDay(value: string): string | null {
  const dayFirst = new RegExp(String.raw`^(\d{1,2})\s+${MONTH_TOKEN}\s+(\d{4})${WRITTEN_TIME}$`, 'i').exec(value);
  if (dayFirst) return realWrittenDay(dayFirst[3], dayFirst[2], dayFirst[1]);
  const monthFirst = new RegExp(String.raw`^${WEEKDAY}${MONTH_TOKEN}\s+(\d{1,2}),?\s+(\d{4})${WRITTEN_TIME}$`, 'i').exec(value);
  if (!monthFirst) return null;
  return realWrittenDay(monthFirst[3], monthFirst[1], monthFirst[2]);
}

/** A YYYY-MM-DD that exists on the calendar. Noon UTC only checks the day, it does not choose it. */
function realIsoDay(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
}

/**
 * NN/NN/YYYY. One part over 12 has only one valid reading. Equal parts are that day.
 * Both parts 12 or under and different can be read two ways, so the day stays unreadable.
 */
function numericSlashDay(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = match[3];
  let month: number;
  let day: number;
  if (first > 12 && second > 12) return null;
  if (first > 12) { day = first; month = second; }
  else if (second > 12) { month = first; day = second; }
  else if (first === second) { month = first; day = second; }
  else return null;
  return realIsoDay(`${year}-${pad2(month)}-${pad2(day)}`);
}

/**
 * Calendar day of a charge, using the same rules as the transaction export Tax Date.
 * Leading and trailing spaces are ignored. A real YYYY-MM-DD is kept. An ISO
 * timestamp, a trailing Z, or a space and a time (hours and minutes, seconds
 * optional) uses that same written day when the first ten characters round-trip
 * through noon UTC. A year first slash date YYYY/MM/DD is that written day.
 * A numeric slash date NN/NN/YYYY counts only when one reading is possible:
 * one part over 12, or both parts equal. Two different parts that are both
 * 12 or under stay unreadable. An impossible day stays unreadable.
 * An English month name, full or abbreviated, with the day before or after it,
 * is that written day. A weekday prefix and a clock time do not change the day.
 * Impossible days, blanks, and junk are undated. Save time, upload time, and
 * today's date are not inputs to this function.
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
  const text = value.trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}(?:$|T|Z$| \d{2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)/.test(text)) {
    return realIsoDay(text.slice(0, 10));
  }
  const slash = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(text);
  if (slash) return realIsoDay(`${slash[1]}-${slash[2]}-${slash[3]}`);
  const numeric = numericSlashDay(text);
  if (numeric) return numeric;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return null;
  return writtenMonthDay(text);
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
