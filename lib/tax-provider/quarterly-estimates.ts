import { transactionNeedsTaxReview } from '@/lib/utils/transaction-tax-review';
import { CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { chargeDay } from '@/lib/schedule-c/taxDate';
import { isSupersededRecord } from '@/lib/transactions/record-scope';
import { QuarterlyReviewRequiredError, QUARTERLY_REVIEW_MESSAGE } from './regular-estimated-payments';

export type LocalDateParts = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  ymd: string; // YYYY-MM-DD
};

export type QuarterRange = {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  startYMD: string; // local
  endYMD: string; // local
  timezone: string;
};

export type QuarterlyTransactionLike = {
  id?: string;
  trans_id?: string;
  account_id?: string;
  merchant_name?: string;
  amount: number;
  category: string;
  date?: unknown; // written charge day when it is a string
  datetime?: unknown; // Plaid UTC moment; undated when date is absent
  pending?: boolean | null; // pending/unsettled
  superseded_by?: string | null; // server-only: duplicate of an earlier reviewed bank record
  tax_review_required?: boolean;
  is_deductible?: boolean | null; // confirmed true, or null/undefined for needs review, false for non-deductible
};

const BUSINESS_CATEGORIES = new Set(Object.keys(CATEGORY_MAP));

const pad2 = (n: number): string => String(n).padStart(2, '0');

function toCents(value: number): number {
  return Math.round((value ?? 0) * 100);
}

function halfCentsAwayFromZero(cents: number): number {
  // For odd cents, round half away from zero deterministically.
  const abs = Math.abs(cents);
  const half = Math.floor(abs / 2);
  const extra = abs % 2;
  const rounded = half + extra;
  return cents < 0 ? -rounded : rounded;
}

function isPosted(tx: QuarterlyTransactionLike): boolean {
  return tx.pending !== true && !isSupersededRecord(tx);
}

/**
 * Charge day for a quarter total. A string `date` keeps the written day.
 * A Date, a Timestamp, or a datetime-only row is undated, so it is left out of
 * the quarter the same way Schedule C leaves it out of the year. The amount
 * stays on the row. `userTimezone` does not move the day: no zone is saved.
 */
export function getLocalTransactionDate(
  transaction: QuarterlyTransactionLike,
  userTimezone: string
): LocalDateParts | null {
  void userTimezone;
  const ymd = chargeDay(transaction);
  if (!ymd) return null;
  return {
    year: Number(ymd.slice(0, 4)),
    month: Number(ymd.slice(5, 7)),
    day: Number(ymd.slice(8, 10)),
    ymd,
  };
}

export function getTaxYear(localDate: LocalDateParts): number {
  return localDate.year;
}

export function getTaxQuarter(localDate: LocalDateParts): 1 | 2 | 3 | 4 {
  const q = Math.floor((localDate.month - 1) / 3) + 1;
  return q as 1 | 2 | 3 | 4;
}

export function getQuarterDateRange(
  year: number,
  quarter: 1 | 2 | 3 | 4,
  timezone: string
): QuarterRange {
  const startMonth = (quarter - 1) * 3 + 1; // 1,4,7,10
  const endMonth = startMonth + 2;
  const endDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();

  const startYMD = `${year}-${pad2(startMonth)}-01`;
  const endYMD = `${year}-${pad2(endMonth)}-${pad2(endDay)}`;

  return { year, quarter, startYMD, endYMD, timezone };
}

function dedupeQuarterlyTransactions(transactions: QuarterlyTransactionLike[]): QuarterlyTransactionLike[] {
  const map = new Map<string, QuarterlyTransactionLike>();

  for (const tx of transactions) {
    const transId = tx.trans_id ?? tx.id;
    const accountId = tx.account_id;

    const key = transId
      ? accountId
        ? `${accountId}::${transId}`
        : `${transId}`
      : tx.id ?? `${tx.category}::${tx.date}::${tx.amount}`;

    if (map.has(key)) continue;
    map.set(key, tx);
  }

  return Array.from(map.values());
}

/**
 * Gross income for a quarter.
 * - Posted only (`pending !== true`) and not a superseded duplicate bank record
 * - Business income only (category `income` or `revenue`, or tx.type === 'income' when present)
 * - Uses cents-stable math
 */
export function sumIncomeForQuarter(
  transactions: QuarterlyTransactionLike[],
  year: number,
  quarter: 1 | 2 | 3 | 4,
  userTimezone: string
): { grossIncome: number; grossIncomeCents: number } {
  const deduped = dedupeQuarterlyTransactions(transactions);

  let grossIncomeCents = 0;
  for (const tx of deduped) {
    if (!isPosted(tx)) continue;
    if (!tx.category) continue;

    const localDate = getLocalTransactionDate(tx, userTimezone);
    if (!localDate) continue;
    if (getTaxYear(localDate) !== year) continue;
    if (getTaxQuarter(localDate) !== quarter) continue;

    const isIncome =
      tx.category === 'income' ||
      tx.category === 'revenue' ||
      // Some code paths might set a type.
      (tx.account_id === 'manual' && (tx as any).type === 'income');

    if (!isIncome) continue;

    if (!Number.isFinite(tx.amount) || tx.amount >= 0) continue;
    const cents = toCents(-tx.amount);
    grossIncomeCents += cents;
  }

  return { grossIncomeCents, grossIncome: grossIncomeCents / 100 };
}

function getScheduleCLineCodeFromCategory(category: string): string | null {
  const entry = CATEGORY_MAP[category];
  return entry ? entry.line : null;
}

function sumExpensesLikeForQuarter(
  transactions: QuarterlyTransactionLike[],
  year: number,
  quarter: 1 | 2 | 3 | 4,
  userTimezone: string,
  mode: 'confirmed' | 'potential'
): { amount: number; amountCents: number } {
  const deduped = dedupeQuarterlyTransactions(transactions);

  let totalCents = 0;
  for (const tx of deduped) {
    if (!isPosted(tx)) continue;
    if (!BUSINESS_CATEGORIES.has(tx.category)) continue;

    const localDate = getLocalTransactionDate(tx, userTimezone);
    if (!localDate) continue;
    if (getTaxYear(localDate) !== year) continue;
    if (getTaxQuarter(localDate) !== quarter) continue;

    const isConfirmed = tx.is_deductible === true && !transactionNeedsTaxReview(tx);
    const isPotential = transactionNeedsTaxReview(tx);

    if (mode === 'confirmed' && !isConfirmed) continue;
    if (mode === 'potential' && !isPotential) continue;

    const lineCode = getScheduleCLineCodeFromCategory(tx.category);
    if (!lineCode) continue;

    const signedCents = toCents(tx.amount ?? 0); // keep sign for credits/refunds offsets
    const contributionCents = lineCode === '24b' ? halfCentsAwayFromZero(signedCents) : signedCents;
    totalCents += contributionCents;
  }

  return { amountCents: totalCents, amount: totalCents / 100 };
}

export function sumExpensesForQuarter(
  transactions: QuarterlyTransactionLike[],
  year: number,
  quarter: 1 | 2 | 3 | 4,
  userTimezone: string
): { confirmed_deductible_expenses: number; confirmed_deductible_expenses_cents: number } {
  const { amount, amountCents } = sumExpensesLikeForQuarter(transactions, year, quarter, userTimezone, 'confirmed');
  return { confirmed_deductible_expenses: amount, confirmed_deductible_expenses_cents: amountCents };
}

export function sumPotentialExpensesForQuarter(
  transactions: QuarterlyTransactionLike[],
  year: number,
  quarter: 1 | 2 | 3 | 4,
  userTimezone: string
): { potential_deductions_needing_review: number; potential_deductions_needing_review_cents: number } {
  const { amount, amountCents } = sumExpensesLikeForQuarter(transactions, year, quarter, userTimezone, 'potential');
  return { potential_deductions_needing_review: amount, potential_deductions_needing_review_cents: amountCents };
}

/** Calendar-quarter aggregation cannot establish IRS installment requirements.
 * Retained as a guarded legacy entrypoint; use the annual federal snapshot and
 * explicitly reviewed regular-method facts instead of quarter-profit ×4.
 */
export function aggregateQuarterlyEstimatesForYear(
  _transactions: QuarterlyTransactionLike[], _taxYear: number, _userTimezone: string,
  _options: { filingStatus: string; w2Income?: number; otherIncome?: number; healthInsurancePremiums?: number; retirementContributions?: number; manualGrossReceipts?: number }
): never {
  throw new QuarterlyReviewRequiredError(QUARTERLY_REVIEW_MESSAGE);
}
