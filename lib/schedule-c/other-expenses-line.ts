/**
 * Schedule C other expenses (Part V, carried from line 48).
 * 2024 and earlier: other expenses is line 27a, and line 27b is Form 7205.
 * 2025 and later: those lines swap. Form 7205 never receives a user amount.
 * https://www.irs.gov/pub/irs-prior/f1040sc--2024.pdf
 * https://www.irs.gov/pub/irs-prior/f1040sc--2025.pdf
 *
 * Saved analyses may store either code. Readers do not write them back.
 * Both codes mean other expenses, and the shown line comes from the tax year.
 */
import { safeTaxYear } from './taxDate';

/** Placeholder in static sentences. Display sites replace it with otherExpensesLine. */
export const OTHER_EXPENSES_LINE_TOKEN = 'OTHER_EXPENSES_LINE';

/**
 * First tax year on which Schedule C other expenses is line 27b.
 * 2024 and earlier stay on 27a. This is a published form fact. The line does not follow the clock.
 */
export const OTHER_EXPENSES_27B_FIRST_YEAR = 2025;

/** Other expenses line for a tax year. Years before OTHER_EXPENSES_27B_FIRST_YEAR are 27a. */
export function otherExpensesLine(taxYear: number): '27a' | '27b' {
  return taxYear >= OTHER_EXPENSES_27B_FIRST_YEAR ? '27b' : '27a';
}

export function withOtherExpensesLine(text: string, taxYear: number | null | undefined): string {
  const line = typeof taxYear === 'number' && Number.isFinite(taxYear)
    ? otherExpensesLine(taxYear)
    : `27a for ${OTHER_EXPENSES_27B_FIRST_YEAR - 1} and earlier, or 27b for ${OTHER_EXPENSES_27B_FIRST_YEAR} and later`;
  return text.replaceAll(OTHER_EXPENSES_LINE_TOKEN, line);
}

function isOtherExpensesCode(line: string): boolean {
  const code = line.trim();
  return code === '27a' || code === '27b';
}

/** A stored 27a or 27b is other expenses. The returned code is the year's line. */
export function readStoredScheduleCLine<T extends string | null | undefined>(line: T, taxYear: number): T {
  if (typeof line === 'string' && isOtherExpensesCode(line)) return otherExpensesLine(taxYear) as T;
  return line;
}

/** A saved line code, or the composed "Schedule C line …" label on ai_explanation. */
export function readStoredScheduleCLineText<T extends string | null | undefined>(value: T, taxYear: number): T {
  if (typeof value !== 'string') return value;
  const code = readStoredScheduleCLine(value, taxYear);
  if (code !== value) return code;
  const shown = `Schedule C line ${otherExpensesLine(taxYear)}`;
  const next = value.replaceAll('Schedule C line 27a', shown).replaceAll('Schedule C line 27b', shown);
  return (next === value ? value : next) as T;
}

function recordTaxYear(record: Record<string, any>): number | null {
  const fromDate = safeTaxYear(record.date ?? record.datetime);
  if (fromDate != null) return fromDate;
  const suggestion = record.ai_suggestion;
  const candidates = [
    record.taxYear,
    record.tax_year,
    record.ai_tax_year,
    suggestion && typeof suggestion === 'object' ? suggestion.taxYear : undefined,
  ];
  for (const value of candidates) {
    const year = typeof value === 'number' ? value : typeof value === 'string' && /^\d{4}$/.test(value.trim()) ? Number(value) : NaN;
    if (Number.isInteger(year) && year >= 1900 && year <= 2200) return year;
  }
  return null;
}

/**
 * Read-time view of ai_* line fields. Returns the same object when the stored
 * codes already match the record's tax year, and never mutates the saved record.
 * Without a tax year the stored codes are left as they are.
 */
export function readStoredAiScheduleCLines<T extends Record<string, any>>(record: T): T {
  const taxYear = recordTaxYear(record);
  if (taxYear == null) return record;
  const patch: Record<string, unknown> = {};
  if (typeof record.ai_schedule_c_line === 'string') {
    const line = readStoredScheduleCLine(record.ai_schedule_c_line, taxYear);
    if (line !== record.ai_schedule_c_line) patch.ai_schedule_c_line = line;
  }
  const suggestion = record.ai_suggestion;
  if (suggestion && typeof suggestion === 'object') {
    const suggestionPatch: Record<string, unknown> = {};
    for (const key of ['scheduleCLine', 'schedule_c_line'] as const) {
      if (typeof suggestion[key] === 'string') {
        const line = readStoredScheduleCLine(suggestion[key] as string, taxYear);
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
        const line = readStoredScheduleCLine(ai[key] as string, taxYear);
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
