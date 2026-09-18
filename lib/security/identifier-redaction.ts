/**
 * Taxpayer-identifier redaction for free text (organizer notes, document OCR output).
 *
 * Identifier-shaped digit groups are replaced with `[redacted-id]` before text is
 * stored or sent to a model. Dollar amounts and comma-grouped or decimal numbers
 * are left alone. Values captured here (the primary SSN's last four digits and
 * EIN-shaped values) are for server-side matching only and must never be logged.
 */

export const REDACTED_ID = '[redacted-id]';

export interface IdentifierRedaction {
  text: string;
  /** Identifier-shaped values replaced, including a masked primary SSN. */
  count: number;
  /** Last four digits of the first SSN/ITIN-shaped value when `keepPrimarySSNLast4` is set. */
  ssnLast4: string | null;
  /** Distinct EIN-shaped values (XX-XXXXXXX) that were removed; server-side use only. */
  eins: string[];
}

export interface IdentifierRedactionOptions {
  /** Keep the first SSN/ITIN-shaped value as ***-**-1234 so a document can be matched to its owner. */
  keepPrimarySSNLast4?: boolean;
}

// Alternatives are tried left to right at each position, so an amount token
// ($123456789, 123,456,789, 123456789.00) is consumed before the identifier rules see it.
const SEPARATOR = '[-\u2010-\u2015. ]';
// A bare run is skipped only when it is the tail of a longer number ("1,123456789",
// "1.123456789"). OCR often reads a colon as "." or ",", so "SSN.123456789" must still match.
const TOKENS = new RegExp([
  String.raw`(?<amount>\$\s?\d[\d,]*(?:\.\d+)?|(?<![\d,.])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d,])|(?<![\d,.])\d+\.\d+(?![\d.]))`,
  String.raw`(?<ssn>(?<!\d)(?<ssnArea>\d{3})${SEPARATOR}(?<ssnGroup>\d{2})${SEPARATOR}(?<ssnSerial>\d{4})(?!\d))`,
  String.raw`(?<ein>(?<!\d)(?<einPrefix>\d{2})${SEPARATOR}(?<einSerial>\d{7})(?!\d))`,
  String.raw`(?<run>(?<!\d)(?<!\d[.,])\d{9}(?!\d|[.,]\d))`,
].join('|'), 'gu');

/** Replace SSN/ITIN/EIN-shaped digit groups and bare nine-digit runs; amounts are preserved. */
export function redactIdentifierText(text: string, options: IdentifierRedactionOptions = {}): IdentifierRedaction {
  let count = 0;
  let ssnLast4: string | null = null;
  const eins = new Set<string>();
  const redacted = text.replace(TOKENS, (...args) => {
    const groups = args.at(-1) as Record<string, string | undefined>;
    if (groups.amount !== undefined) return groups.amount;
    count += 1;
    if (groups.ssn !== undefined) {
      if (options.keepPrimarySSNLast4 && ssnLast4 === null) {
        ssnLast4 = groups.ssnSerial!;
        return `***-**-${ssnLast4}`;
      }
      return REDACTED_ID;
    }
    if (groups.ein !== undefined) eins.add(`${groups.einPrefix}-${groups.einSerial}`);
    return REDACTED_ID;
  });
  return { text: redacted, count, ssnLast4, eins: [...eins] };
}

export function containsIdentifierShapedDigits(text: string): boolean {
  return redactIdentifierText(text).count > 0;
}

/**
 * Redact every string inside a JSON-like value (arrays and plain objects), so a payload built
 * from user free text needs no per-field list to stay identifier-free. Numbers, booleans and
 * class instances pass through untouched.
 */
export function redactIdentifierStrings<T>(value: T): T {
  if (typeof value === 'string') return redactIdentifierText(value).text as T;
  if (Array.isArray(value)) return value.map(redactIdentifierStrings) as T;
  if (value !== null && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, redactIdentifierStrings(entry)])) as T;
  }
  return value;
}
