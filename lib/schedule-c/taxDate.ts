export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH_NAME = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MONTH_FIRST = new RegExp(`^(${MONTH_NAME})\\s+(\\d{1,2}),?\\s*(\\d{4})$`, 'i');
const DAY_FIRST = new RegExp(`^(\\d{1,2})\\s+(${MONTH_NAME}),?\\s*(\\d{4})$`, 'i');

/** A real civil day, or null when the parts overflow (for example February 30). */
function realYMD(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Date.UTC rolls an impossible day forward. Keep the date only when it lands
  // on the same civil day. UTC fields do not depend on the process time zone.
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

function writtenYMD(value: string): string | null {
  const monthFirst = MONTH_FIRST.exec(value);
  if (monthFirst) {
    const month = MONTH_INDEX[monthFirst[1].toLowerCase()];
    return month ? realYMD(Number(monthFirst[3]), month, Number(monthFirst[2])) : null;
  }
  const dayFirst = DAY_FIRST.exec(value);
  if (dayFirst) {
    const month = MONTH_INDEX[dayFirst[2].toLowerCase()];
    return month ? realYMD(Number(dayFirst[3]), month, Number(dayFirst[1])) : null;
  }
  return null;
}

/**
 * Year last, slash or hyphen. One part over 12 has only one valid order.
 * Equal parts are that day. Different parts that are both 12 or under are
 * ambiguous when written with the same number of digits (01/05/2025, 1/5/2025)
 * and stay unset. A single digit beside a two digit number is month first,
 * so 12/1/2025 is December 1 and 1/31/2025 is January 31.
 */
function yearLastYMD(value: string): string | null {
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (!match) return null;
  const [, aText, bText, yearText] = match;
  const year = Number(yearText);
  const a = Number(aText);
  const b = Number(bText);
  if (a > 12 && b > 12) return null;
  if (b > 12) return realYMD(year, a, b);
  if (a > 12) return realYMD(year, b, a);
  if (a === b) return realYMD(year, a, b);
  if (aText.length !== bText.length) return realYMD(year, a, b);
  return null;
}

/** Civil day as written. Never parses the string with `new Date`. */
function civilYMD(value: string): string | null {
  const s = value.trim();
  if (!s) return null;

  // YYYY-MM-DD, with or without a time after it. The first 10 characters are
  // the civil day when that day exists, including an offset such as +14:00.
  const padded = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (padded && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    return realYMD(Number(padded[1]), Number(padded[2]), Number(padded[3]));
  }

  const flexible = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]\d.*)?$/.exec(s);
  if (flexible) return realYMD(Number(flexible[1]), Number(flexible[2]), Number(flexible[3]));

  // Year first is year, month, day only. 2025/13/01 is not read as a day of 13.
  const yearFirstSlash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (yearFirstSlash) {
    return realYMD(Number(yearFirstSlash[1]), Number(yearFirstSlash[2]), Number(yearFirstSlash[3]));
  }

  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(s)) return yearLastYMD(s);
  return writtenYMD(s);
}

/**
 * Extract a YYYY-MM-DD tax date without moving a printed calendar day across
 * a time zone.
 *
 * A Date or a number is an instant: a number is milliseconds since the Unix
 * epoch, and a Date is that same instant. The calendar day is the UTC day,
 * the same value `toISOString().slice(0, 10)` already returned. Local getters
 * would place that instant on a different civil day. Strings are printed or
 * stored civil days and are not converted.
 */
export function safeYMD(dateLike: unknown): string | null {
  if (dateLike === null || dateLike === undefined) return null;
  if (typeof dateLike !== 'string') {
    const d = new Date(dateLike as any);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  return civilYMD(dateLike);
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

