/** Rows flagged possibleDuplicate stay saved. Totals omit them and report this one line. */

export const HELD_OUT_REVIEW_HREF = '/protected?screen=review-transactions';

/** User-visible copy. These stay placeholders and never include a stored reason code. */
export const HELD_OUT_REVIEW_LINK_TEXT = 'PLACEHOLDER: Review possible duplicates';
export const HELD_OUT_REVIEW_ARIA_LABEL = 'PLACEHOLDER: Possible duplicates held out of tax totals';
export const HELD_OUT_REASON_TEXT = 'PLACEHOLDER: This row is a possible duplicate and is held out of tax totals until you review it. Resolving it is not available yet. The saved row is not changed or deleted.';

export interface HeldOutDuplicates {
  count: number;
  creditCount: number;
  debitCount: number;
  /** Absolute dollars of flagged credits (money in). */
  credits: number;
  /** Absolute dollars of flagged debits (money out). */
  debits: number;
  /** Sum of the credit and debit totals. */
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

/** Absolute credit and debit dollars of every flagged row in the year, including rows that would not otherwise count. */
export function summarizeHeldOutDuplicates(records: ReadonlyArray<{ possibleDuplicate?: unknown; date?: unknown; amount?: unknown }>, taxYear?: number): HeldOutDuplicates {
  let count = 0;
  let creditCount = 0;
  let debitCount = 0;
  let creditCents = 0;
  let debitCents = 0;
  for (const record of records) {
    if (record.possibleDuplicate !== true) continue;
    if (taxYear !== undefined && recordYear(record.date) !== taxYear) continue;
    count += 1;
    const amount = typeof record.amount === 'number' && Number.isFinite(record.amount) ? record.amount : 0;
    const cents = Math.round(Math.abs(amount) * 100);
    if (amount < 0) {
      creditCount += 1;
      creditCents += cents;
    } else if (amount > 0) {
      debitCount += 1;
      debitCents += cents;
    }
  }
  const credits = creditCents / 100;
  const debits = debitCents / 100;
  const amount = (creditCents + debitCents) / 100;
  const noun = count === 1 ? 'row' : 'rows';
  const verb = count === 1 ? 'is' : 'are';
  const pronoun = count === 1 ? 'it' : 'them';
  const message = `PLACEHOLDER: ${count} possible duplicate ${noun} ${verb} held out of this total until you review ${pronoun}. Held out credits ${heldOutMoney(credits)}. Held out debits ${heldOutMoney(debits)}.`;
  return {
    count, creditCount, debitCount, credits, debits, amount,
    reviewHref: HELD_OUT_REVIEW_HREF, message,
  };
}

export function heldOutCsvCells(summary: HeldOutDuplicates): string[] {
  return [
    'PLACEHOLDER', 'Held out possible duplicates', String(summary.count),
    summary.credits.toFixed(2), summary.debits.toFixed(2), summary.reviewHref, summary.message,
  ];
}

/** One paragraph for a planning PDF. Empty when this year held nothing out. */
export function heldOutReviewParagraph(summary?: HeldOutDuplicates | null): string | null {
  if (!summary || summary.count <= 0) return null;
  return `${summary.message} ${summary.reviewHref}`;
}

/** Year-scoped line for worksheet payloads that carry raw transaction rows. */
export function summarizeTransactionHeldOut(transactions: readonly unknown[], taxYear: number): HeldOutDuplicates {
  const records = transactions.filter((row): row is { possibleDuplicate?: unknown; date?: unknown; amount?: unknown } => !!row && typeof row === 'object');
  return summarizeHeldOutDuplicates(records, taxYear);
}
