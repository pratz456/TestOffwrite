/**
 * Schedule C other expenses (Part V, carried from line 48).
 * 2023 and 2024: other expenses is line 27a, and line 27b is Form 7205.
 * On the 2022 form, line 27b was reserved, so a pre-2023 record stays 27a and needs review.
 * 2025 and later: those lines swap. Form 7205 never receives a user amount.
 * https://www.irs.gov/pub/irs-prior/f1040sc--2024.pdf
 * https://www.irs.gov/pub/irs-prior/f1040sc--2025.pdf
 *
 * Saved analyses may store either code. Readers do not write them back.
 * Both codes mean other expenses, and the shown line comes from the transaction date.
 */

/**
 * First tax year on which Schedule C other expenses is line 27b.
 * 2024 and earlier stay on 27a. This is a published form fact. The line does not follow the clock.
 */
export const OTHER_EXPENSES_27B_FIRST_YEAR = 2025;

/**
 * First tax year whose other-expenses line is confirmed.
 * Earlier years keep 27a and need review. 2025 is confirmed 27b.
 * 2026 and later assume 27b.
 */
export const OTHER_EXPENSES_CONFIRMED_FIRST_YEAR = 2023;

/** Other expenses line for a tax year. Years before OTHER_EXPENSES_27B_FIRST_YEAR are 27a. */
export function otherExpensesLine(taxYear: number): '27a' | '27b' {
  return taxYear >= OTHER_EXPENSES_27B_FIRST_YEAR ? '27b' : '27a';
}

/** Placeholder in static sentences. Display sites replace it with the year's line. */
export const OTHER_EXPENSES_LINE_TOKEN = 'OTHER_EXPENSES_LINE';

export function withOtherExpensesLine(text: string, taxYear: number | null | undefined): string {
  const line = typeof taxYear === 'number' && Number.isFinite(taxYear)
    ? otherExpensesLine(taxYear)
    : `27a for ${OTHER_EXPENSES_27B_FIRST_YEAR - 1} and earlier, or 27b for ${OTHER_EXPENSES_27B_FIRST_YEAR} and later`;
  return text.replaceAll(OTHER_EXPENSES_LINE_TOKEN, line);
}

/**
 * Line to print for a stored other-expenses code.
 * No usable year prints nothing and needs review, so a raw 27a is not Form 7205.
 * Years before OTHER_EXPENSES_CONFIRMED_FIRST_YEAR print 27a and still need review.
 */
export function publishedOtherExpensesLine(line: string, taxYear: number | null): { line: string | null; needsReview: boolean } {
  if (!isOtherExpensesCode(line)) return { line, needsReview: false };
  if (taxYear == null || !Number.isFinite(taxYear)) return { line: null, needsReview: true };
  if (taxYear < OTHER_EXPENSES_CONFIRMED_FIRST_YEAR) return { line: otherExpensesLine(taxYear), needsReview: true };
  return { line: otherExpensesLine(taxYear), needsReview: false };
}

function isOtherExpensesCode(line: string): boolean {
  const code = line.trim();
  return code === '27a' || code === '27b';
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isCalendarDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= lengths[month - 1];
}

/**
 * Calendar year for the other expenses line and for Schedule C grouping.
 * A JS Date, or an object with toDate(), is converted to an ISO string first,
 * the same way the export date reader does. A string that is not ISO is not a year.
 * The month and day must be a real calendar day. An impossible day is not rolled forward.
 */
export function strictOtherExpensesDateYear(value: unknown): number | null {
  try {
    if (value instanceof Date) value = value.toISOString();
    if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') value = value.toDate().toISOString();
  } catch { return null; }
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return isCalendarDay(year, month, day) ? year : null;
}

/** Year for the other-expenses line. The first present transaction date only. A missing or invalid date is no year. */
export function resolveOtherExpensesYear(record: object | null | undefined): number | null {
  if (record == null || typeof record !== 'object') return null;
  const source = record as Record<string, unknown>;
  for (const key of ['date', 'datetime', 'date_iso'] as const) {
    const value = source[key];
    if (value == null || value === '') continue;
    return strictOtherExpensesDateYear(value);
  }
  return null;
}

/** A stored 27a or 27b is other expenses. The returned code is the year's line. */
export function readStoredScheduleCLine<T extends string | null | undefined>(line: T, taxYear: number): T {
  if (typeof line === 'string' && isOtherExpensesCode(line)) return otherExpensesLine(taxYear) as T;
  return line;
}

function lineForResolvedYear<T extends string | null | undefined>(line: T, taxYear: number | null): T | null {
  if (typeof line !== 'string') return line;
  if (taxYear == null || !Number.isFinite(taxYear)) return isOtherExpensesCode(line) ? null : line;
  return readStoredScheduleCLine(line, taxYear);
}

/** A saved line code, or the composed "Schedule C line …" label on ai_explanation. No year blanks 27a and 27b. */
export function readStoredScheduleCLineText<T extends string | null | undefined>(value: T, taxYear: number | null): T | null {
  if (typeof value !== 'string') return value;
  if (taxYear == null || !Number.isFinite(taxYear)) {
    if (isOtherExpensesCode(value) || value.includes('Schedule C line 27a') || value.includes('Schedule C line 27b')) return null;
    return value;
  }
  const code = readStoredScheduleCLine(value, taxYear);
  if (code !== value) return code;
  const shown = `Schedule C line ${otherExpensesLine(taxYear)}`;
  const next = value.replaceAll('Schedule C line 27a', shown).replaceAll('Schedule C line 27b', shown);
  return (next === value ? value : next) as T;
}

/**
 * Read-time view of ai_* line fields. Returns the same object when the stored
 * codes already match the record's date year, and never mutates the saved record.
 * Without a transaction date, stored 27a and 27b are blank.
 */
export function readStoredAiScheduleCLines<T extends Record<string, any>>(record: T): T {
  const taxYear = resolveOtherExpensesYear(record);
  const patch: Record<string, unknown> = {};
  if (typeof record.ai_schedule_c_line === 'string') {
    const line = lineForResolvedYear(record.ai_schedule_c_line, taxYear);
    if (line !== record.ai_schedule_c_line) patch.ai_schedule_c_line = line;
  }
  const suggestion = record.ai_suggestion;
  if (suggestion && typeof suggestion === 'object') {
    const suggestionPatch: Record<string, unknown> = {};
    for (const key of ['scheduleCLine', 'schedule_c_line'] as const) {
      if (typeof suggestion[key] === 'string') {
        const line = lineForResolvedYear(suggestion[key] as string, taxYear);
        if (line !== suggestion[key]) suggestionPatch[key] = line;
      }
    }
    if (Object.keys(suggestionPatch).length) patch.ai_suggestion = { ...suggestion, ...suggestionPatch };
  }
  const ai = record.ai;
  if (ai && typeof ai === 'object') {
    const aiPatch: Record<string, unknown> = {};
    for (const key of ['scheduleCLine', 'schedule_c_line'] as const) {
      if (typeof ai[key] === 'string') {
        const line = lineForResolvedYear(ai[key] as string, taxYear);
        if (line !== ai[key]) aiPatch[key] = line;
      }
    }
    if (Object.keys(aiPatch).length) patch.ai = { ...ai, ...aiPatch };
  }
  const explanation = record.ai_explanation;
  if (explanation && typeof explanation === 'object' && typeof explanation.scheduleCLine === 'string') {
    const scheduleCLine = readStoredScheduleCLineText(explanation.scheduleCLine as string, taxYear);
    if (scheduleCLine !== explanation.scheduleCLine) patch.ai_explanation = { ...explanation, scheduleCLine };
  }
  return Object.keys(patch).length ? { ...record, ...patch } : record;
}
