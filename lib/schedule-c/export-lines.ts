/**
 * Other expenses year boundaries. One function decides every printed line.
 * 2018 through 2024 print 27a. The 2018 and 2021 Schedule C forms both show
 * "27a Other expenses" and "27b Reserved for future use".
 * 2025 and later print 27b.
 * 1900 through 2017 stay in that year's totals and print no line number.
 * A missing year, a year before 1900, or a year after the current tax year prints no line.
 */
export const OTHER_EXPENSES_EARLIEST_CHARGE_YEAR = 1900;
export const OTHER_EXPENSES_FIRST_NUMBERED_YEAR = 2018;
export const OTHER_EXPENSES_27B_YEAR = 2025;
export const OTHER_EXPENSES_UNNUMBERED_LABEL = 'Schedule C other expenses';

/** Printed by older copy. A missing charge date does not use this sentence. */
export const OTHER_EXPENSES_YEAR_FREE_LINE =
  'Schedule C line 27b (other expenses; line 27a on 2024 returns)';

export type OtherExpensesYearPrint =
  | { status: 'line'; code: '27a' | '27b' }
  | { status: 'unnumbered'; text: typeof OTHER_EXPENSES_UNNUMBERED_LABEL }
  | { status: 'withhold' };

/** Local calendar year of `now`. Charge dates themselves are calendar dates, not local timestamps. */
export function currentTaxYear(now: Date = new Date()): number {
  return now.getFullYear();
}

export function otherExpensesYearPrint(taxYear: number | null, now: Date = new Date()): OtherExpensesYearPrint {
  if (taxYear === null || !Number.isInteger(taxYear)) return { status: 'withhold' };
  if (taxYear < OTHER_EXPENSES_EARLIEST_CHARGE_YEAR || taxYear > currentTaxYear(now)) return { status: 'withhold' };
  if (taxYear < OTHER_EXPENSES_FIRST_NUMBERED_YEAR) return { status: 'unnumbered', text: OTHER_EXPENSES_UNNUMBERED_LABEL };
  if (taxYear < OTHER_EXPENSES_27B_YEAR) return { status: 'line', code: '27a' };
  return { status: 'line', code: '27b' };
}

/** Internal 27a stays the category-map code. The printed code follows otherExpensesYearPrint. */
export function scheduleCExportLine(internalLine: string, taxYear: number): string {
  if (internalLine !== '27a' && internalLine !== '27b') return internalLine;
  const print = otherExpensesYearPrint(taxYear);
  if (print.status === 'line') return print.code;
  if (print.status === 'unnumbered') return print.text;
  return '';
}

/**
 * Printed Schedule C line for a stored code.
 * 2018 to 2024 print 27a. 2025 and later print 27b.
 * 2017 and earlier print no line number.
 * A null year is Needs more information: no line, and the charge is not counted in a total.
 */
export function printedScheduleCLine(internalLine: string | null | undefined, taxYear: number | null): string | null {
  if (internalLine == null) return null;
  if (internalLine === '') return '';
  if (internalLine !== '27a' && internalLine !== '27b') return internalLine;
  if (taxYear === null) return '';
  return scheduleCExportLine(internalLine, taxYear);
}
