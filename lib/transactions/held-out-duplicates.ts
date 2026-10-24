/** Rows flagged possibleDuplicate stay saved. Totals omit them and report this one line. */

export const HELD_OUT_REVIEW_HREF = '/protected?screen=review-transactions';

export interface HeldOutDuplicates {
  count: number;
  amount: number;
  reviewHref: string;
  message: string;
}

export function isPossibleDuplicateRecord(record: { possibleDuplicate?: unknown }): boolean {
  return record.possibleDuplicate === true;
}

function heldOutMoney(value: number): string {
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function recordYear(date: unknown): number | null {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date) ? Number(date.slice(0, 4)) : null;
}

/** Absolute dollars of every flagged row in the year, including rows that would not otherwise count. */
export function summarizeHeldOutDuplicates(records: ReadonlyArray<{ possibleDuplicate?: unknown; date?: unknown; amount?: unknown }>, taxYear?: number): HeldOutDuplicates {
  let count = 0;
  let cents = 0;
  for (const record of records) {
    if (record.possibleDuplicate !== true) continue;
    if (taxYear !== undefined && recordYear(record.date) !== taxYear) continue;
    count += 1;
    const amount = typeof record.amount === 'number' && Number.isFinite(record.amount) ? record.amount : 0;
    cents += Math.round(Math.abs(amount) * 100);
  }
  const amount = cents / 100;
  const noun = count === 1 ? 'row' : 'rows';
  const verb = count === 1 ? 'is' : 'are';
  const message = `PLACEHOLDER: ${count} possible duplicate ${noun} totaling ${heldOutMoney(amount)} ${verb} held out of this total until you review them.`;
  return { count, amount, reviewHref: HELD_OUT_REVIEW_HREF, message };
}

export function heldOutCsvCells(summary: HeldOutDuplicates): string[] {
  return ['PLACEHOLDER', 'Held out possible duplicates', String(summary.count), summary.amount.toFixed(2), summary.reviewHref, summary.message];
}
