import Tesseract from 'tesseract.js';

export interface ReceiptData {
  merchant: string;
  amount: number;
  date: string;
  /** Set when an ambiguous numeric date was read as month then day. Equal parts are not ambiguous. */
  dateOrderAssumed?: 'month_day';
  category?: string;
  confidence: number;
  rawText: string;
  items?: ReceiptItem[];
}

export interface ReceiptMatchCandidate {
  trans_id: string;
  merchant_name: string;
  amount: number;
  category?: string;
  date: string;
  confidence: number; // 0..1
  hasReceipt: boolean;
  matchReasons: string[];
}

export interface ReceiptItem {
  description: string;
  amount: number;
  quantity?: number;
}

export interface OCRResult {
  success: boolean;
  data?: ReceiptData;
  error?: string;
  processingTime: number;
}

const ENGLISH_MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** Accept YYYY-MM-DD only when that calendar day exists. Noon UTC does not roll the day into the next month. */
function calendarDay(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

/** A real IANA zone name. Anything else, including a missing value, is not a zone. */
function ianaTimeZone(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    return undefined;
  }
}

/** Calendar day of an instant in one IANA zone. The process clock is not used. */
function dayInZone(date: Date, timeZone: string): string | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  const day = Number(parts.find(part => part.type === 'day')?.value);
  return calendarDay(year, month, day);
}

/**
 * Calendar day of an instant.
 * A valid upload zone wins. A missing or unknown zone keeps the day only when
 * Pacific/Pago_Pago and America/St_Thomas agree. The process clock is not used.
 */
function localCalendarDay(date: Date, timeZone: string | undefined): string | null {
  if (!Number.isFinite(date.getTime())) return null;
  const zone = ianaTimeZone(timeZone);
  if (zone) return dayInZone(date, zone);
  const pagoPago = dayInZone(date, 'Pacific/Pago_Pago');
  const stThomas = dayInZone(date, 'America/St_Thomas');
  return pagoPago && pagoPago === stThomas ? pagoPago : null;
}

/** Clock time by parts. An hour such as 25 is rejected. The date is not shifted through local time. */
function clockIsReal(time: string): boolean {
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(?:Z|([+-])(\d{2}):?(\d{2}))?$/.exec(time);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (match[6] !== undefined) {
    const zoneHour = Number(match[6]);
    const zoneMinute = Number(match[7]);
    if (zoneHour > 23 || zoneMinute > 59) return false;
  }
  return true;
}

/** A two digit year is 20YY. A four digit year is used as written. */
function writtenYear(raw: string): number {
  return raw.length === 2 ? 2000 + Number(raw) : Number(raw);
}

/** English month token, including the four letter September abbreviation Sept. */
function monthFromName(token: string): number | null {
  const key = token.toLowerCase();
  if (key === 'sept') return 9;
  return ENGLISH_MONTHS[key] ?? null;
}

/**
 * A trailing period is kept for Sept and for three letter names.
 * A full name with a period is rejected in both orders.
 */
function allowsMonthPeriod(token: string, dotted: boolean): boolean {
  return !dotted || token === 'sept' || token.length === 3;
}

/**
 * A skip phrase drops a date when it sits on the same line, directly before the
 * date or directly after it. The gap may be spaces and : # , . - only. Phrases
 * in BRIDGE_SKIP_PHRASES may also have one bridge word before the date: Date,
 * on, by, until, or thru. Every other skip phrase keeps the strict gap.
 * Delivered and delivery drop a date only when another date remains. Ticket,
 * ref, and invoice # do that only when the date has a four-digit year; a short
 * year stays a hard skip. A non-bridge skip phrase followed only by the word
 * Date is also a fallback, unless a real label such as "order date" sits on it.
 */
/** Only these skip phrases may bridge across Date, on, by, until, or thru. */
const BRIDGE_SKIP_PHRASES = new Set([
  'return',
  'returns',
  'exp',
  'expire',
  'expires',
  'expired',
  'expiry',
  'expiration',
  'expiring',
  'statement',
  'arrival',
  'check-in',
  'valid',
  'until',
  'thru',
  'through',
  'shipped',
  'delivered',
  'delivery',
]);
/** These skips drop a date only when some other date is still left. A lone one stays. */
const ALWAYS_FALLBACK_SKIP_PHRASES = new Set(['delivered', 'delivery']);
/** Fallback only beside a four-digit year. Ticket 4/5/26 and Ticket 1/2 stay hard skips. Table and offer stay hard skips. */
const FOUR_DIGIT_FALLBACK_SKIP_PHRASES = new Set(['ticket', 'ref', 'invoice #']);
const SKIP_PHRASES = [
  'returns accepted until',
  'estimated delivery date',
  'expiration date',
  'delivery date',
  'exchange by',
  'member since',
  'order placed',
  'print date',
  'ship date',
  'visit by',
  'returns by',
  'return by',
  'expire on',
  'check-in',
  'due date',
  'ship by',
  'expiration',
  'delivered',
  'delivery',
  'expiring',
  'expired',
  'printed',
  'returns',
  'shipped',
  'through',
  'written',
  'arrival',
  'expires',
  'expire',
  'invoice #',
  'order #',
  'statement',
  'check #',
  'expiry',
  'offer',
  'order',
  'return',
  'table',
  'ticket',
  'until',
  'valid',
  'thru',
  'due',
  'exp',
  'inv',
  'ref',
];
/** Tier 1 outranks tier 2, which outranks tier 3. The longest phrase next to the date wins, so "date" inside "payment date" or "invoice date" is not its own label. */
const LABEL_PHRASES: Array<{ text: string; tier: number }> = [
  { text: 'payment date', tier: 1 },
  { text: 'payment', tier: 1 },
  { text: 'paid', tier: 1 },
  { text: 'purchase date', tier: 2 },
  { text: 'transaction date', tier: 2 },
  { text: 'sale date', tier: 2 },
  { text: 'order date', tier: 2 },
  { text: 'check-out', tier: 2 },
  { text: 'purchased', tier: 2 },
  { text: 'checkout', tier: 2 },
  { text: 'purchase', tier: 2 },
  { text: 'transaction', tier: 2 },
  { text: 'invoice date', tier: 3 },
  { text: 'sale', tier: 2 },
  { text: 'date', tier: 2 },
];

type ReceiptDateCandidate = { raw: string; index: number; iso: string; line: string };
type TieredDate = ReceiptDateCandidate & { tier: number };

function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const next = text.indexOf('\n', index);
  return text.slice(start, next === -1 ? text.length : next);
}

function lineStartAt(text: string, index: number): number {
  return text.lastIndexOf('\n', index - 1) + 1;
}

function phraseSource(phrase: string): string {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ #/g, '\\s*#').replace(/ /g, '\\s+');
  const start = /^\w/.test(phrase) ? '\\b' : '';
  const end = /\w$/.test(phrase) ? '\\b' : '';
  return `${start}${escaped}${end}`;
}

/** Spaces and : # , . - only. An invoice number between "invoice #" and the date keeps the date. */
function gapAllows(gap: string): boolean {
  return /^[ \t:#,\.\-]*$/.test(gap);
}

/** Bridge phrases are still next to the date when Date, on, by, until, or thru is the only word between them. */
function skipGapAllows(gap: string): boolean {
  if (gapAllows(gap)) return true;
  return /^[ \t:#,\.\-]*(?:date|on|by|until|thru)[ \t:#,\.\-]*$/i.test(gap);
}

function adjacentMatchLength(line: string, dateStart: number, dateEnd: number, phrase: string, allowSkipBridge = false): number {
  const pattern = new RegExp(phraseSource(phrase), 'gi');
  const beforeGap = allowSkipBridge ? skipGapAllows : gapAllows;
  let match: RegExpExecArray | null;
  let longest = 0;
  while ((match = pattern.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const before = end <= dateStart && beforeGap(line.slice(end, dateStart));
    const after = start >= dateEnd && gapAllows(line.slice(dateEnd, start));
    if ((before || after) && match[0].length > longest) longest = match[0].length;
    if (match[0].length === 0) break;
  }
  return longest;
}

function phraseSkipsDate(line: string, dateStart: number, dateEnd: number, phrase: string): boolean {
  return adjacentMatchLength(line, dateStart, dateEnd, phrase, BRIDGE_SKIP_PHRASES.has(phrase)) > 0;
}

/** 01/15/2026 and Jan 15, 2026 count. 4/5/26 and 1/2 do not. */
function dateHasFourDigitYear(raw: string): boolean {
  return /^\d{4}\b/.test(raw) || /\b\d{4}$/.test(raw);
}

function phraseIsFallback(phrase: string, raw: string): boolean {
  if (ALWAYS_FALLBACK_SKIP_PHRASES.has(phrase)) return true;
  return FOUR_DIGIT_FALLBACK_SKIP_PHRASES.has(phrase) && dateHasFourDigitYear(raw);
}

/** A hard skip always drops the date. Fallback phrases match only when no hard skip does. */
function dateIsHardSkipped(line: string, dateStart: number, dateEnd: number): boolean {
  const raw = line.slice(dateStart, dateEnd);
  return SKIP_PHRASES.some(phrase => !phraseIsFallback(phrase, raw) && phraseSkipsDate(line, dateStart, dateEnd, phrase));
}

function dateIsFallbackSkipped(line: string, dateStart: number, dateEnd: number): boolean {
  if (dateIsHardSkipped(line, dateStart, dateEnd)) return false;
  const raw = line.slice(dateStart, dateEnd);
  return SKIP_PHRASES.some(phrase => phraseIsFallback(phrase, raw) && phraseSkipsDate(line, dateStart, dateEnd, phrase));
}

/** The word Date sitting directly in front of the numeric date, if the gap is only allowed characters. */
function dateWordBefore(line: string, dateStart: number): number | null {
  const pattern = /\bdate\b/gi;
  let match: RegExpExecArray | null;
  let found: number | null = null;
  while ((match = pattern.exec(line)) !== null) {
    const end = match.index + match[0].length;
    if (end <= dateStart && gapAllows(line.slice(end, dateStart))) found = match.index;
    if (match[0].length === 0) break;
  }
  return found;
}

/**
 * Ticket Date, Ref Date, Table Date, and Offer Date are fallback skips.
 * Order Date is not: "order date" is a real tier-2 label, so it stays.
 */
function dateIsSkipWordDate(line: string, dateStart: number, dateEnd: number): boolean {
  const labeled = LABEL_PHRASES.some(label => label.text !== 'date' && adjacentMatchLength(line, dateStart, dateEnd, label.text) > 0);
  if (labeled) return false;
  const wordStart = dateWordBefore(line, dateStart);
  if (wordStart === null) return false;
  const before = line.slice(0, wordStart);
  return SKIP_PHRASES.some(phrase => {
    if (BRIDGE_SKIP_PHRASES.has(phrase)) return false;
    return new RegExp(`${phraseSource(phrase)}[ \\t:#,.\\-]*$`, 'i').test(before);
  });
}

function labelTier(line: string, dateStart: number, dateEnd: number): number {
  let tier = 0;
  let length = 0;
  for (const label of LABEL_PHRASES) {
    const size = adjacentMatchLength(line, dateStart, dateEnd, label.text);
    if (size > length) {
      length = size;
      tier = label.tier;
    }
  }
  return tier;
}

function spanOf(text: string, candidate: ReceiptDateCandidate): { dateStart: number; dateEnd: number } {
  const dateStart = candidate.index - lineStartAt(text, candidate.index);
  return { dateStart, dateEnd: dateStart + candidate.raw.length };
}

function withoutAdjacentSkips(text: string, candidates: ReceiptDateCandidate[]): TieredDate[] {
  const kept: TieredDate[] = [];
  const deliveryOnly: TieredDate[] = [];
  for (const candidate of candidates) {
    const { dateStart, dateEnd } = spanOf(text, candidate);
    if (dateIsHardSkipped(candidate.line, dateStart, dateEnd)) continue;
    const tiered = { ...candidate, tier: labelTier(candidate.line, dateStart, dateEnd) };
    if (dateIsFallbackSkipped(candidate.line, dateStart, dateEnd) || dateIsSkipWordDate(candidate.line, dateStart, dateEnd)) deliveryOnly.push(tiered);
    else kept.push(tiered);
  }
  return kept.length > 0 ? kept : deliveryOnly;
}

/** Keep the best tier present. Tier 1 beats tier 2, which beats tier 3. Unlabeled dates stay only when nothing is labeled. */
function highestTier(candidates: TieredDate[]): TieredDate[] {
  const labeled = candidates.filter(candidate => candidate.tier > 0);
  if (labeled.length === 0) return candidates;
  const best = Math.min(...labeled.map(candidate => candidate.tier));
  return candidates.filter(candidate => candidate.tier === best);
}

const NOT_A_PAID_LINE = /\b(?:unpaid|payment\s+due|payment\s+method|payment\s+terms|payment\s+options|pay\s+by)\b/i;
const DUE_DATE_PHRASES = ['payment due', 'due date', 'due'];

function lineStatesMoneyPaid(line: string): boolean {
  if (NOT_A_PAID_LINE.test(line)) return false;
  const amountPaid = /\bamount\s+paid\b[^0-9$]*\$?\s*(\d+(?:\.\d+)?)/i.exec(line);
  if (amountPaid) return Number(amountPaid[1]) > 0;
  if (/\b(?:paid\s+in\s+full|payment\s+received)\b/i.test(line)) return true;
  return /\bpaid\b/i.test(line);
}

function moneyWasPaid(text: string): boolean {
  return text.split('\n').some(lineStatesMoneyPaid);
}

function hasAdjacentDueDate(text: string, candidates: ReceiptDateCandidate[]): boolean {
  return candidates.some(candidate => {
    const { dateStart, dateEnd } = spanOf(text, candidate);
    return DUE_DATE_PHRASES.some(phrase => adjacentMatchLength(candidate.line, dateStart, dateEnd, phrase) > 0);
  });
}

function balanceDueAboveZero(text: string): boolean {
  const amount = /balance\s+due\b[^0-9$]*\$?\s*(\d+(?:\.\d+)?)/i.exec(text);
  return amount !== null && Number(amount[1]) > 0;
}

/** An invoice date alone is not a purchase date when a due date or a balance due above zero is present and nothing was paid. */
function dropUnpaidInvoice(text: string, candidates: TieredDate[], allCandidates: ReceiptDateCandidate[]): TieredDate[] {
  const onlyInvoiceDate = candidates.length > 0 && candidates.every(candidate => candidate.tier === 3);
  const unpaid = hasAdjacentDueDate(text, allCandidates) || balanceDueAboveZero(text);
  if (onlyInvoiceDate && unpaid && !moneyWasPaid(text)) return [];
  return candidates;
}

function datesInOneYear(candidates: TieredDate[]): TieredDate[] {
  const years = new Set(candidates.map(candidate => candidate.iso.slice(0, 4)));
  return years.size > 1 ? [] : candidates;
}

function monthToken(raw: string): string | null {
  const dayFirst = /^\d{1,2}[ \t]+([A-Za-z]+)\.?(?:[ \t]+\d{2,4})$/.exec(raw);
  if (dayFirst) return dayFirst[1];
  const monthFirst = /^([A-Za-z]+)\.?(?:[ \t]+\d{1,2},?[ \t]+\d{2,4})$/.exec(raw);
  if (monthFirst) return monthFirst[1];
  return null;
}

/** Inclusive window from 2000 through next year, read from the clock when a candidate is kept. */
function purchaseYearAllowed(iso: string): boolean {
  const year = Number(iso.slice(0, 4));
  const currentYear = new Date().getFullYear();
  return year >= 2000 && year <= currentYear + 1;
}

/** First date in the text. Two matches that start at the same place keep the longer one. */
function earliestDateText(candidates: ReceiptDateCandidate[]): string {
  if (candidates.length === 0) return '';
  let best = candidates[0];
  for (const candidate of candidates) {
    if (candidate.index < best.index || (candidate.index === best.index && candidate.raw.length > best.raw.length)) {
      best = candidate;
    }
  }
  return best.raw;
}

/**
 * Read a written date by its parts. Slash and hyphen dates are US month/day order.
 * A leading four digit year stays ISO, including a timestamp. A two digit year is 20YY.
 * The result is kept only when it is a real calendar day.
 */
function dateFromWrittenParts(value: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|T(.*))$/.exec(value);
  if (iso) {
    if (iso[4] !== undefined && !clockIsReal(iso[4])) return null;
    return calendarDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/.exec(value);
  if (slash) {
    return calendarDay(writtenYear(slash[3]), Number(slash[1]), Number(slash[2]));
  }
  // Month and day are one or two digits, so this cannot match YYYY-MM-DD.
  const hyphen = /^(\d{1,2})-(\d{1,2})-(\d{4}|\d{2})$/.exec(value);
  if (hyphen) {
    return calendarDay(writtenYear(hyphen[3]), Number(hyphen[1]), Number(hyphen[2]));
  }
  const named = /^([A-Za-z]+)(\.)?\s+(\d{1,2}),?\s+(\d{4}|\d{2})$/.exec(value);
  if (named) {
    const token = named[1].toLowerCase();
    if (!allowsMonthPeriod(token, named[2] === '.')) return null;
    const month = monthFromName(token);
    if (!month) return null;
    return calendarDay(writtenYear(named[4]), month, Number(named[3]));
  }
  const dayFirst = /^(\d{1,2})\s+([A-Za-z]+)(\.)?\s+(\d{4}|\d{2})$/.exec(value);
  if (dayFirst) {
    const token = dayFirst[2].toLowerCase();
    if (!allowsMonthPeriod(token, dayFirst[3] === '.')) return null;
    const month = monthFromName(token);
    if (!month) return null;
    return calendarDay(writtenYear(dayFirst[4]), month, Number(dayFirst[1]));
  }
  return null;
}

/** Slash or hyphen date with both parts from 1 through 12 and the parts different. Equal parts are that date. The year in the token is the receipt year. */
function ambiguousNumericDate(value: string): boolean {
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(value);
  if (!match) return false;
  const first = Number(match[1]);
  const second = Number(match[2]);
  return first >= 1 && first <= 12 && second >= 1 && second <= 12 && first !== second;
}

/** AU, NZ, and MX. A space before the $ still counts. These blank the date on their own. A bare $ is not a US signal. */
const STRONG_DOLLAR_PREFIX = /(?<![A-Za-z])(?:AU|NZ|MX) ?\$/;
/** CA$ blanks the date on its own. The letters must touch the dollar. */
const CA_TOUCHING_DOLLAR = /(?<![A-Za-z])CA\$/;
/** CA before one space and a dollar, such as CA $12.50. This counts only with a second Canadian signal. */
const CA_SPACED_DOLLAR = /(?<![A-Za-z])CA \$/;
/** A, C, and R count only when the letter touches the $. A space is a US tax or item flag, not a prefix. */
const SHORT_DOLLAR_PREFIX = /(?<![A-Za-z])[ACR]\$/;
/** GST, HST, PST, QST, and CAD. The letters CA are not in this list. */
const CANADIAN_TAX_OR_CAD = /\b(?:GST|HST|PST|QST|CAD)\b/;
/** Province and territory codes, including the longer forms PEI and NWT. CA is not a code here. */
const CANADIAN_REGION_CODE = /\b(?:NWT|PEI|AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\b/;
/** Province and territory names. Letter case does not matter. CA is not a name here. */
const CANADIAN_REGION_NAME = /\b(?:alberta|british columbia|manitoba|new brunswick|newfoundland(?: (?:and|&) labrador)?|nova scotia|ontario|prince edward island|qu[eé]bec|saskatchewan|northwest territories|nunavut|yukon|labrador)\b/iu;
/** A Canadian postal code such as K1A 0B1 or M5V 2T6. One space separates the two halves. */
const CANADIAN_POSTAL_CODE = /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] \d[ABCEGHJ-NPRSTV-Z]\d\b/;
/** Capitals-only ISO codes beside an amount. TRY, ALL, and TOP are not in this list. */
const CURRENCY_CODE = 'EUR|GBP|CAD|AUD|JPY|CHF|CNY|INR|MXN|KRW|SEK|NOK|DKK|NZD|BRL|PLN|HKD|SGD|ZAR|THB|PHP|IDR|VND|TWD|AED|SAR|ILS|BAM|BOB|COP|CUP|GEL|MAD|MOP|PEN|RUB|SOS';
/** TRY still blanks on its own when it sits on a total, tax, due, or currency line. */
const QUALIFYING_CODE = `${CURRENCY_CODE}|TRY`;
/** A line that is only ALL or TOP and an amount, such as ALL 1.200 or 12.50 TOP. */
const LONE_ALL_TOP = /^(?:(ALL|TOP)[ \t]+(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)[ \t]+(ALL|TOP))$/;
/** Non US total words. English total, tax, and subtotal are not in this list. */
const NON_US_TOTAL_WORD = /ИТОГО|ВСЕГО|К ОПЛАТЕ|итого|всего|к оплате/;
/** Euro, pound, yen, rupee, lira, and ruble. A lone symbol is one kind and does not blank by itself. */
const FOREIGN_SYMBOL = /[€£¥₹₺₽]/;
const QUALIFYING_LINE = new RegExp(`\\b(?:subtotal|total|tax)\\b|\\b(?:amount|balance)\\s+due\\b|\\bcurrency\\s*:|\\ball amounts in\\b|${NON_US_TOTAL_WORD.source}`, 'i');
/** kr counts only beside an amount, so Krispy does not match. */
const KR_BESIDE_AMOUNT = /\d+(?:[.,]\d+)? ?\bkr\b|\bkr\b ?\d/i;

function usReceiptSignals(text: string): boolean {
  return /\bUSD\b/i.test(text) || /\bUS\$/.test(text) || /\bUSA\b/.test(text) || /United States/i.test(text);
}

/** A capital code on a total, tax, due, or currency-label line. Item lines do not count. */
function qualifyingCurrencyCode(text: string): boolean {
  const code = new RegExp(`\\b(?:${QUALIFYING_CODE})\\b`);
  return text.split(/\r?\n/).some(line => code.test(line) && QUALIFYING_LINE.test(line));
}

/**
 * Same patterns as the receipt total reader.
 * Words between TOTAL and the amount, as in TOTAL DUE, hide that amount, so the reader returns 0.
 * TOTAL 12,50 is read as 12. A zero result means no positive total was read.
 */
function receiptTotal(text: string): number {
  const currencyPatterns = [
    /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g,
    /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*USD/g,
    /TOTAL[:\s]*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi,
    /AMOUNT[:\s]*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi,
    /SUBTOTAL[:\s]*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi,
  ];
  let maxAmount = 0;
  for (const pattern of currencyPatterns) {
    for (const match of text.matchAll(pattern)) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (amount > maxAmount) maxAmount = amount;
    }
  }
  return maxAmount;
}

function sameMoney(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.round(left * 100) === Math.round(right * 100);
}

function moneyToken(token: string): number {
  return parseFloat(token.replace(/,/g, ''));
}

/** TRY, ALL, and TOP count for the two kind check only when their amount equals a positive total. */
function englishWordCodeCounts(text: string): boolean {
  const total = receiptTotal(text);
  if (!(total > 0)) return false;
  const amounts: number[] = [];
  for (const pattern of [/\bTRY[ \t]+(\d+(?:[.,]\d+)?)/g, /(\d+(?:[.,]\d+)?)[ \t]+\bTRY\b/g]) {
    for (const match of text.matchAll(pattern)) amounts.push(moneyToken(match[1]));
  }
  for (const line of text.split(/\r?\n/)) {
    const match = LONE_ALL_TOP.exec(line.trim());
    if (match) amounts.push(moneyToken(match[2] || match[3]));
  }
  return amounts.some(amount => sameMoney(amount, total));
}

/** A symbol, or kr beside an amount, on a total, tax, due, or currency-label line. */
function symbolOnQualifyingLine(text: string): boolean {
  return text.split(/\r?\n/).some(line => QUALIFYING_LINE.test(line) && (FOREIGN_SYMBOL.test(line) || KR_BESIDE_AMOUNT.test(line)));
}

/** Kind: a capitals code beside an amount. Two codes, even different ones, are still this one kind. */
function codeBesideAmount(text: string): boolean {
  const before = new RegExp(`\\b(?:${CURRENCY_CODE}) ?\\d`);
  const after = new RegExp(`\\d+(?:[.,]\\d+)? ?\\b(?:${CURRENCY_CODE})\\b`);
  return before.test(text) || after.test(text) || englishWordCodeCounts(text);
}

/** Kind: one of the six symbols, or kr beside an amount. Repeated symbols stay this one kind. */
function symbolKind(text: string): boolean {
  return FOREIGN_SYMBOL.test(text) || KR_BESIDE_AMOUNT.test(text);
}

/** Kind: comma, exactly two digits, then a non digit or the end. 1,250 and 1,250.00 are thousands separators. */
function commaDecimal(text: string): boolean {
  return /,\d{2}(?!\d)/.test(text);
}

/** Kind: A$, C$, or R$ with no space. One such prefix is one kind and does not blank on its own. */
function shortDollarPrefix(text: string): boolean {
  return SHORT_DOLLAR_PREFIX.test(text);
}

/**
 * A signal other than the CA prefix: GST, HST, PST, QST, CAD, a province or territory
 * name or code, or a postal code. The letters CA are not this signal.
 */
function canadianSignalBesidesCa(text: string): boolean {
  return CANADIAN_TAX_OR_CAD.test(text)
    || CANADIAN_REGION_CODE.test(text)
    || CANADIAN_REGION_NAME.test(text)
    || CANADIAN_POSTAL_CODE.test(text);
}

/** Two signals blank only when the kinds differ. Repeating one kind does not. */
function differentKindSignals(text: string): boolean {
  const kinds = [codeBesideAmount(text), symbolKind(text), NON_US_TOTAL_WORD.test(text), commaDecimal(text), shortDollarPrefix(text)].filter(Boolean).length;
  return kinds >= 2;
}

function bareDollar(text: string): boolean {
  const withoutPrefixes = text
    .replace(/(?<![A-Za-z])(?:AU|NZ|MX) ?\$/g, '')
    .replace(/(?<![A-Za-z])CA\$/g, '')
    .replace(/(?<![A-Za-z])[ACR]\$/g, '');
  return /\$/.test(withoutPrefixes);
}

function nonUsReceiptSignals(text: string): boolean {
  if (STRONG_DOLLAR_PREFIX.test(text) || CA_TOUCHING_DOLLAR.test(text)) return true;
  // Spaced CA $ follows the short prefix idea: it counts only with a second, different signal.
  // That signal has to be Canadian. A California tax line such as TAX CA $0.33 does not.
  if (CA_SPACED_DOLLAR.test(text) && canadianSignalBesidesCa(text)) return true;
  // A symbol or kr on a total, tax, due, or currency line blanks on its own.
  if (symbolOnQualifyingLine(text)) return true;
  // A bare $ disagrees with a code, so a code alone does not blank the date.
  if (bareDollar(text)) return false;
  // A code on a total, tax, due, or currency line blanks on its own. Otherwise two different kinds are required.
  return qualifyingCurrencyCode(text) || differentKindSignals(text);
}

/** Clearly non US: a foreign signal is present, and USD, US$, USA, or United States text is not. A bare $ does not decide. */
function nonUsReceipt(text: string): boolean {
  return !usReceiptSignals(text) && nonUsReceiptSignals(text);
}

export class ReceiptProcessor {
  private static instance: ReceiptProcessor;
  private worker: Tesseract.Worker | null = null;

  private constructor() {}

  public static getInstance(): ReceiptProcessor {
    if (!ReceiptProcessor.instance) {
      ReceiptProcessor.instance = new ReceiptProcessor();
    }
    return ReceiptProcessor.instance;
  }

  async initialize(): Promise<void> {
    if (!this.worker) {
      this.worker = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      });
    }
  }

  async processReceipt(imageFile: File | Buffer, userTimeZone?: string): Promise<OCRResult> {
    const startTime = Date.now();
    
    try {
      await this.initialize();
      
      if (!this.worker) {
        throw new Error('OCR worker not initialized');
      }

      // Convert File/Blob to Buffer for Node.js Tesseract worker compatibility
      let imageInput: Buffer;
      if (Buffer.isBuffer(imageFile)) {
        imageInput = imageFile;
      } else {
        const arrayBuffer = await imageFile.arrayBuffer();
        imageInput = Buffer.from(arrayBuffer);
      }

      // Perform OCR
      const { data: { text, confidence } } = await this.worker.recognize(imageInput);
      
      // Parse the extracted text
      const receiptData = this.parseReceiptText(text);
      
      const processingTime = Date.now() - startTime;
      
      const rawPrinted = receiptData.date;
      const isoDate = this.normalizeDateToISO(rawPrinted, userTimeZone) || '';
      const dateOrderAssumed = typeof rawPrinted === 'string' && isoDate && ambiguousNumericDate(rawPrinted) && !nonUsReceipt(text)
        ? 'month_day' as const
        : undefined;
      return {
        success: true,
        data: {
          merchant: receiptData.merchant || 'Unknown Merchant',
          amount: receiptData.amount || 0,
          // An unreadable date stays blank. A Date or a timestamp uses the upload zone,
          // then the shared day in Pacific/Pago_Pago and America/St_Thomas.
          date: isoDate,
          ...(dateOrderAssumed ? { dateOrderAssumed } : {}),
          category: receiptData.category,
          items: receiptData.items,
          confidence: confidence / 100,
          rawText: text
        },
        processingTime
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime
      };
    }
  }

  async processReceiptBatch(imageFiles: (File | Buffer)[], uploadTimeZone?: string): Promise<OCRResult[]> {
    const results: OCRResult[] = [];
    
    for (const file of imageFiles) {
      const result = await this.processReceipt(file, uploadTimeZone);
      results.push(result);
    }
    
    return results;
  }

  private parseReceiptText(text: string): Partial<ReceiptData> {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    // Extract merchant name (usually first line or line with business indicators)
    const merchant = this.extractMerchant(lines);
    
    // Extract total amount (look for currency patterns)
    const amount = this.extractAmount(text);
    
    // Extract date (look for date patterns)
    const date = this.extractDate(text);
    
    // Extract category based on merchant and items
    const category = this.extractCategory(merchant, text);
    
    // Extract individual items
    const items = this.extractItems(lines);
    
    return {
      merchant,
      amount,
      date,
      category,
      items
    };
  }

  private extractMerchant(lines: string[]): string {
    // Look for common business indicators
    const businessIndicators = ['LLC', 'INC', 'CORP', 'LTD', 'CO', 'STORE', 'RESTAURANT', 'CAFE'];
    
    for (const line of lines.slice(0, 5)) { // Check first 5 lines
      if (businessIndicators.some(indicator => line.toUpperCase().includes(indicator))) {
        return line;
      }
    }
    
    // If no business indicators, use first non-empty line
    return lines[0] || 'Unknown Merchant';
  }

  private extractAmount(text: string): number {
    return receiptTotal(text);
  }

  private extractDate(text: string): string {
    const candidates = this.dateCandidates(text);
    const kept = datesInOneYear(dropUnpaidInvoice(text, highestTier(withoutAdjacentSkips(text, candidates)), candidates));
    return earliestDateText(kept);
  }

  private dateCandidates(text: string): ReceiptDateCandidate[] {
    // Whitespace stays on one line, and a day or year cannot start inside a longer number.
    // The year cannot be followed by ':' so a clock hour is not a two digit year.
    // A full ISO timestamp shares its start index with the shorter date slice, so the longer one is kept.
    const datePatterns = [
      /(?<!\d)\d{4}(?![\d:])-\d{1,2}-\d{1,2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?(?!\d)/,
      /(?<!\d)\d{4}(?![\d:])-\d{1,2}-\d{1,2}(?!\d)/,
      /(?<!\d)\d{1,2}\/\d{1,2}\/\d{2,4}(?![\d:])/,
      /(?<!\d)\d{1,2}-\d{1,2}-\d{2,4}(?![\d:])/,
      /(?<!\d)\d{1,2}[ \t]+[A-Za-z]{3,9}\.?[ \t]+\d{2,4}(?![\d:])/,
      /[A-Za-z]{3,9}\.?[ \t]+(?<!\d)\d{1,2},?[ \t]+\d{2,4}(?![\d:])/,
    ];
    const hits: Array<{ raw: string; index: number }> = [];
    for (const pattern of datePatterns) {
      for (const match of text.matchAll(new RegExp(pattern.source, 'g'))) {
        if (match.index === undefined) continue;
        hits.push({ raw: match[0], index: match.index });
      }
    }
    const longest = new Map<number, { raw: string; index: number }>();
    for (const hit of hits) {
      const current = longest.get(hit.index);
      if (!current || hit.raw.length > current.raw.length) longest.set(hit.index, hit);
    }
    const candidates: ReceiptDateCandidate[] = [];
    for (const hit of longest.values()) {
      const month = monthToken(hit.raw);
      if (month !== null && monthFromName(month) === null) continue;
      // A clearly non US receipt leaves an ambiguous numeric date unread.
      if (nonUsReceipt(text) && ambiguousNumericDate(hit.raw)) continue;
      const iso = this.normalizeDateToISO(hit.raw);
      if (!iso || !purchaseYearAllowed(iso)) continue;
      candidates.push({ raw: hit.raw, index: hit.index, iso, line: lineAt(text, hit.index) });
    }
    return candidates;
  }

  private extractCategory(merchant: string, text: string): string {
    const merchantLower = merchant.toLowerCase();
    const textLower = text.toLowerCase();
    
    // Category mapping based on keywords
    const categoryMap = {
      'meals_50': ['restaurant', 'cafe', 'coffee', 'food', 'dining', 'starbucks', 'mcdonalds', 'subway'],
      'gas': ['gas', 'fuel', 'shell', 'exxon', 'chevron', 'bp', 'mobil'],
      'office_supplies': ['office', 'staples', 'office depot', 'supplies', 'paper', 'pen'],
      'software_subscriptions': ['software', 'subscription', 'adobe', 'microsoft', 'google'],
      'travel': ['hotel', 'airline', 'flight', 'travel', 'uber', 'lyft', 'taxi'],
      'utilities_phone_internet': ['phone', 'internet', 'electric', 'gas', 'water', 'utility'],
      'vehicle_expense': ['auto', 'car', 'vehicle', 'repair', 'maintenance', 'oil change'],
      'home_office': ['home depot', 'lowes', 'furniture', 'desk', 'chair', 'monitor']
    };
    
    for (const [category, keywords] of Object.entries(categoryMap)) {
      if (keywords.some(keyword => 
        merchantLower.includes(keyword) || textLower.includes(keyword)
      )) {
        return category;
      }
    }
    
    return 'other';
  }

  private extractItems(lines: string[]): ReceiptItem[] {
    const items: ReceiptItem[] = [];
    
    // Look for lines that might be items (contain amounts but aren't totals)
    const itemPattern = /^(.+?)\s+(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)$/;
    
    for (const line of lines) {
      const match = line.match(itemPattern);
      if (match) {
        const description = match[1].trim();
        const amount = parseFloat(match[2].replace(/,/g, ''));
        
        // Skip if it looks like a total or tax line
        if (!description.toLowerCase().includes('total') && 
            !description.toLowerCase().includes('tax') &&
            !description.toLowerCase().includes('subtotal')) {
          items.push({
            description,
            amount
          });
        }
      }
    }
    
    return items;
  }

  /**
   * Finds the best transaction matches for a scanned receipt.
   * Matching is intentionally sign-agnostic (we compare absolute amounts),
   * because expenses may be stored as positive and income/refunds as negative.
   */
  async findMatchingTransactions(
    receiptData: ReceiptData,
    transactions: any[],
    limit = 5
  ): Promise<ReceiptMatchCandidate[]> {
    const receiptDateIso = this.normalizeDateToISO(receiptData.date);
    const receiptMerchantNorm = this.normalizeMerchant(receiptData.merchant);
    const receiptAmountAbs = Math.abs(Number(receiptData.amount || 0));

    const candidates: ReceiptMatchCandidate[] = [];

    for (const tx of transactions) {
      const txTransId = String(tx.trans_id ?? tx.id ?? '');
      if (!txTransId) continue;

      const txMerchantName = String(tx.merchant_name ?? '');
      const txMerchantNorm = this.normalizeMerchant(txMerchantName);
      if (!txMerchantNorm) continue;

      const txDateIso = this.normalizeDateToISO(tx.date);
      const txAmountAbs = Math.abs(Number(tx.amount || 0));

      const amountDiff = Math.abs(txAmountAbs - receiptAmountAbs);
      const amountTol = receiptAmountAbs >= 100 ? 2 : receiptAmountAbs >= 10 ? 1 : 0.25;

      const amountScore = amountDiff <= amountTol
        ? 1
        : Math.max(0, 1 - amountDiff / (amountTol * 3));

      const merchantScore = this.scoreMerchants(receiptMerchantNorm, txMerchantNorm);

      const dateScore = txDateIso && receiptDateIso && txDateIso === receiptDateIso ? 1 : 0;

      // If category is available, use it as a soft boost only.
      const categoryScore = this.scoreStringsOptional(receiptData.category, tx.category);

      // Base weights: amount dominates, then merchant, then date.
      const confidence = this.clamp01(0.45 * amountScore + 0.35 * merchantScore + 0.20 * dateScore) +
        0.05 * categoryScore;

      if (confidence < 0.35) continue;

      const matchReasons: string[] = [];
      if (amountScore >= 0.9) matchReasons.push('amount');
      if (merchantScore >= 0.8) matchReasons.push('merchant');
      if (dateScore >= 0.9) matchReasons.push('date');
      if (categoryScore >= 0.9) matchReasons.push('category');

      candidates.push({
        trans_id: txTransId,
        merchant_name: txMerchantName,
        amount: Number(tx.amount || 0),
        category: tx.category,
        date: tx.date,
        confidence: this.clamp01(confidence),
        hasReceipt: Boolean(tx.receipt_url || tx.receipt_filename),
        matchReasons,
      });
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates.slice(0, Math.max(1, limit));
  }

  /**
   * Simple OCR heuristic: detect whether the receipt looks like a refund/credit.
   * Returns 'income' because credits/refunds are stored as negative amounts in this app.
   */
  inferReceiptDirectionFromText(rawText: string): { direction: 'expense' | 'income' | 'unknown'; confidence: number } {
    const text = (rawText || '').toLowerCase();

    const refundKeywords = ['refund', 'credited', 'credit', 'returned', 'return', 'money back', 'amount credited'];
    const depositKeywords = ['deposit', 'payout', 'payment received', 'received payment', 'earned', 'interest'];

    if (refundKeywords.some((k) => text.includes(k))) {
      return { direction: 'income', confidence: 0.85 };
    }

    if (depositKeywords.some((k) => text.includes(k))) {
      return { direction: 'income', confidence: 0.65 };
    }

    // Most receipts we scan are expense receipts (default).
    return { direction: 'expense', confidence: 0.55 };
  }

  private normalizeDateToISO(dateLike: any, userTimeZone?: string): string | null {
    try {
      if (!dateLike) return null;
      if (typeof dateLike === 'string') return dateFromWrittenParts(dateLike);
      if (dateLike instanceof Date) return localCalendarDay(dateLike, userTimeZone);
      if (typeof dateLike === 'number') return localCalendarDay(new Date(dateLike), userTimeZone);
      return null;
    } catch {
      return null;
    }
  }

  private normalizeMerchant(merchant: string): string {
    return String(merchant || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private scoreStringsOptional(a?: string, b?: string): number {
    const aNorm = this.normalizeMerchant(a || '');
    const bNorm = this.normalizeMerchant(b || '');
    if (!aNorm || !bNorm) return 0.3;

    if (aNorm === bNorm) return 1;
    if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) return 0.7;
    return 0.3;
  }

  private scoreMerchants(receiptMerchantNorm: string, txMerchantNorm: string): number {
    if (!receiptMerchantNorm || !txMerchantNorm) return 0;

    // Direct substring match is a strong signal.
    if (txMerchantNorm.includes(receiptMerchantNorm) || receiptMerchantNorm.includes(txMerchantNorm)) {
      return 1;
    }

    const receiptTokens = receiptMerchantNorm.split(' ').filter((t) => t.length >= 3);
    const txTokens = txMerchantNorm.split(' ').filter((t) => t.length >= 3);
    if (!receiptTokens.length || !txTokens.length) return 0;

    const receiptSet = new Set(receiptTokens);
    const overlap = [...receiptSet].filter((t) => txTokens.includes(t)).length;
    const jaccard = overlap / Math.max(receiptTokens.length, txTokens.length);

    return this.clamp01(jaccard);
  }

  private clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

// Export singleton instance
export const receiptProcessor = ReceiptProcessor.getInstance();
