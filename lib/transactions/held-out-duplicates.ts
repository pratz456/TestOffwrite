/** Rows flagged possibleDuplicate stay saved. Totals omit them and report two lines that are never netted. */

export const HELD_OUT_REVIEW_HREF = '/protected?screen=review-transactions';

/** User-visible copy. These stay placeholders and never include a stored reason code. */
export const HELD_OUT_REVIEW_LINK_TEXT = 'PLACEHOLDER: Review possible duplicates';
export const HELD_OUT_REVIEW_ARIA_LABEL = 'PLACEHOLDER: Possible duplicates held out of tax totals';
export const HELD_OUT_REASON_TEXT = 'PLACEHOLDER: This row is a possible duplicate and is held out of tax totals until you review it. Resolving it is not available yet. The saved row is not changed or deleted.';

export interface HeldOutSide {
  count: number;
  /** Income is absolute dollars. Expense charges are positive. Expense refunds are absolute dollars. */
  amount: number;
}

export interface HeldOutDuplicates {
  count: number;
  /** Negative income or revenue amounts. Shown beside gross receipts and left out of line 1. */
  income: HeldOutSide;
  /** Expense charges and expense-account refunds. Shown beside line 28 and left out of that subtotal. */
  expenses: HeldOutSide;
  expenseCharges: HeldOutSide;
  /** Absolute dollars. Display them as a negative expense amount, never as income. */
  expenseRefunds: HeldOutSide;
  reviewHref: string;
  incomeMessage: string;
  expenseMessage: string;
  message: string;
}

export class DuplicateReviewRequiredError extends Error {
  readonly code = 'DUPLICATE_REVIEW_REQUIRED';
  readonly reviewHref = HELD_OUT_REVIEW_HREF;
  readonly heldOutDuplicates: HeldOutDuplicates;
  constructor(summary: HeldOutDuplicates) {
    super(duplicateReviewBlockMessage(summary));
    this.name = 'DuplicateReviewRequiredError';
    this.heldOutDuplicates = summary;
  }
}

export function duplicateReviewResponseBody(error: DuplicateReviewRequiredError) {
  return {
    error: error.message,
    code: error.code,
    reviewHref: error.reviewHref,
    heldOutDuplicates: error.heldOutDuplicates,
  };
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

function isIncomeCategory(category: unknown): boolean {
  if (typeof category !== 'string') return false;
  const text = category.trim().toLowerCase();
  return text === 'income' || text === 'revenue';
}

function countSentence(count: number): string {
  const noun = count === 1 ? 'row' : 'rows';
  const verb = count === 1 ? 'is' : 'are';
  const pronoun = count === 1 ? 'it' : 'them';
  return `PLACEHOLDER: ${count} possible duplicate ${noun} ${verb} held out of tax totals until you review ${pronoun}.`;
}

function incomeLine(count: number, amount: number): string {
  const noun = count === 1 ? 'row' : 'rows';
  const verb = count === 1 ? 'is' : 'are';
  const pronoun = count === 1 ? 'it' : 'them';
  return `PLACEHOLDER: ${count} held out income ${noun} ${verb} shown beside gross receipts (line 1) and ${verb} not included in that line until you review ${pronoun}. Held out income ${heldOutMoney(amount)}.`;
}

function expenseLine(charges: HeldOutSide, refunds: HeldOutSide): string {
  const count = charges.count + refunds.count;
  const noun = count === 1 ? 'row' : 'rows';
  const verb = count === 1 ? 'is' : 'are';
  const pronoun = count === 1 ? 'it' : 'them';
  const parts = [`PLACEHOLDER: ${count} held out expense ${noun} ${verb} shown beside line 28 and outside the line 28 subtotal until you review ${pronoun}.`];
  if (charges.count > 0) parts.push(`Held out expenses ${heldOutMoney(charges.amount)}.`);
  if (refunds.count > 0) parts.push(`Held out expense refunds ${heldOutMoney(-refunds.amount)}, on the expense line and not as income.`);
  return parts.join(' ');
}

/** Income and expense lines for one year. Expense-account refunds stay on the expense line. */
export function summarizeHeldOutDuplicates(records: ReadonlyArray<{ possibleDuplicate?: unknown; date?: unknown; amount?: unknown; category?: unknown }>, taxYear?: number): HeldOutDuplicates {
  let count = 0;
  let incomeCount = 0;
  let incomeCents = 0;
  let chargeCount = 0;
  let chargeCents = 0;
  let refundCount = 0;
  let refundCents = 0;
  for (const record of records) {
    if (record.possibleDuplicate !== true) continue;
    if (taxYear !== undefined && recordYear(record.date) !== taxYear) continue;
    count += 1;
    const amount = typeof record.amount === 'number' && Number.isFinite(record.amount) ? record.amount : 0;
    const cents = Math.round(Math.abs(amount) * 100);
    if (isIncomeCategory(record.category) && amount < 0) {
      incomeCount += 1;
      incomeCents += cents;
    } else if (amount < 0) {
      refundCount += 1;
      refundCents += cents;
    } else {
      chargeCount += 1;
      chargeCents += cents;
    }
  }
  const income = { count: incomeCount, amount: incomeCents / 100 };
  const expenseCharges = { count: chargeCount, amount: chargeCents / 100 };
  const expenseRefunds = { count: refundCount, amount: refundCents / 100 };
  const expenses = { count: chargeCount + refundCount, amount: (chargeCents - refundCents) / 100 };
  const incomeMessage = incomeCount > 0 ? incomeLine(incomeCount, income.amount) : '';
  const expenseMessage = expenses.count > 0 ? expenseLine(expenseCharges, expenseRefunds) : '';
  const message = [countSentence(count), incomeMessage, expenseMessage].filter(Boolean).join(' ');
  return {
    count, income, expenses, expenseCharges, expenseRefunds,
    reviewHref: HELD_OUT_REVIEW_HREF, incomeMessage, expenseMessage, message,
  };
}

export function duplicateReviewBlockMessage(summary: HeldOutDuplicates): string {
  return `PLACEHOLDER: Review possible duplicates before downloading this package or opening a filing session. ${summary.message}`;
}

/** Two CSV rows. Empty when this year held nothing out. Downloads that must be blocked should not call this. */
export function heldOutCsvCells(summary: HeldOutDuplicates): string[][] {
  const rows: string[][] = [];
  if (summary.income.count > 0) {
    rows.push(['PLACEHOLDER', 'Held out income beside line 1', String(summary.income.count), summary.income.amount.toFixed(2), summary.reviewHref, summary.incomeMessage]);
  }
  if (summary.expenseCharges.count > 0) {
    rows.push(['PLACEHOLDER', 'Held out expenses beside line 28', String(summary.expenseCharges.count), summary.expenseCharges.amount.toFixed(2), summary.reviewHref, summary.expenseMessage]);
  }
  if (summary.expenseRefunds.count > 0) {
    rows.push(['PLACEHOLDER', 'Held out expense refunds beside line 28', String(summary.expenseRefunds.count), (-summary.expenseRefunds.amount).toFixed(2), summary.reviewHref, summary.expenseMessage]);
  }
  return rows;
}

/** Separate paragraphs for a planning PDF. Empty when this year held nothing out. */
export function heldOutReviewLines(summary?: HeldOutDuplicates | null): string[] {
  if (!summary || summary.count <= 0) return [];
  const lines: string[] = [];
  if (summary.income.count > 0) lines.push(`${summary.incomeMessage} ${summary.reviewHref}`);
  if (summary.expenses.count > 0) lines.push(`${summary.expenseMessage} ${summary.reviewHref}`);
  return lines;
}

export function heldOutReviewParagraph(summary?: HeldOutDuplicates | null): string | null {
  const lines = heldOutReviewLines(summary);
  return lines.length ? lines.join('\n') : null;
}

/** Year-scoped lines for worksheet payloads that carry raw transaction rows. */
export function summarizeTransactionHeldOut(transactions: readonly unknown[], taxYear: number): HeldOutDuplicates {
  const records = transactions.filter((row): row is { possibleDuplicate?: unknown; date?: unknown; amount?: unknown; category?: unknown } => !!row && typeof row === 'object');
  return summarizeHeldOutDuplicates(records, taxYear);
}
