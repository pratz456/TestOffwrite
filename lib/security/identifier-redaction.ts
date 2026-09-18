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

export const REDACTED_NAME = '[redacted-name]';
export const REDACTED_ADDRESS = '[redacted-address]';

export interface PersonalDetailRedaction { text: string; count: number }

// Postal addresses as printed on W-2/1099 forms: a numbered street line (with an optional unit), a
// PO box, or a city/state/ZIP line. Amounts never carry a street suffix or a two-letter state code
// followed by five digits, so wages and withholding survive untouched.
const STREET_SUFFIX = '(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Terrace|Ter|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Trail|Trl|Loop|Square|Sq)';
const STREET_ADDRESS = new RegExp(String.raw`(?<![\d$,.-])\d{1,6}[A-Za-z]?\s+(?:[NSEW]\.?\s+)?(?:[A-Za-z0-9'.-]+\s+){1,4}${STREET_SUFFIX}\b\.?(?:,?\s*(?:Apt|Apartment|Suite|Ste|Unit|Bldg|Floor|Fl|#)\.?\s*[A-Za-z0-9-]+)?`, 'gi');
const PO_BOX = /\bP\.?\s?O\.?\s+Box\s+\d+/gi;
const CITY_STATE_ZIP = /\b[A-Za-z][A-Za-z .'-]{1,40},?\s+[A-Z]{2}\.?\s+\d{5}(?:-\d{4})?\b/g;

/**
 * Remove the account holder's name and postal addresses from document text before it leaves the
 * server on the no-consent path. Names are matched as whole words, first-last or last-first, with
 * an optional middle initial; a single-word name is left alone rather than redacting ordinary words.
 */
export function redactPersonalDetails(text: string, names: readonly (string | null | undefined)[]): PersonalDetailRedaction {
  let count = 0;
  let output = text;
  for (const pattern of [STREET_ADDRESS, PO_BOX, CITY_STATE_ZIP]) {
    output = output.replace(pattern, () => { count += 1; return REDACTED_ADDRESS; });
  }
  for (const name of names) {
    const tokens = (name ?? '').trim().split(/\s+/).filter(token => token.replace(/[^A-Za-z]/g, '').length >= 2);
    if (tokens.length < 2) continue;
    const escaped = tokens.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const gap = String.raw`[\s,.]+(?:[A-Za-z]\.?[\s,.]+)?`;
    for (const variant of [escaped.join(gap), [...escaped].reverse().join(gap)]) {
      output = output.replace(new RegExp(String.raw`(?<![A-Za-z])${variant}(?![A-Za-z])`, 'gi'), () => { count += 1; return REDACTED_NAME; });
    }
  }
  return { text: output, count };
}
