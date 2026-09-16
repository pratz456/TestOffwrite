import { transactionNeedsTaxReview } from '@/lib/utils/transaction-tax-review';
import { CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
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
  date?: string; // date-only or ISO
  datetime?: string; // ISO with time (preferred)
  pending?: boolean | null; // pending/unsettled
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
  return tx.pending !== true;
}

function getLocalDatePartsFromDate(date: Date, userTimezone: string): LocalDateParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: userTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = dtf.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;

  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    // Fall back to UTC in worst case; better than returning wrong data.
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      ymd: `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`,
    };
  }

  return {
    year,
    month,
    day,
    ymd: `${year}-${pad2(month)}-${pad2(day)}`,
  };
}

/**
 * Convert a transaction's date/datetime into a *user-local* local date (YYYY-MM-DD)
 * based on `userTimezone`.
 *
 * Important: if the transaction date is a `YYYY-MM-DD` *date-only* string, treat it as
 * already-local (do not round-trip through `new Date('YYYY-MM-DD')`, which can drift).
 */
export function getLocalTransactionDate(
  transaction: QuarterlyTransactionLike,
  userTimezone: string
): LocalDateParts | null {
  const dateLike = transaction.datetime ?? transaction.date;
  if (!dateLike) return null;

  if (typeof dateLike === 'string') {
    const s = dateLike.trim();
    if (!s) return null;

    // Date-only: treat as local date.
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const year = Number(s.slice(0, 4));
      const month = Number(s.slice(5, 7));
      const day = Number(s.slice(8, 10));
      if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
      return { year, month, day, ymd: s };
    }

    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return getLocalDatePartsFromDate(d, userTimezone);
  }

  // Last-resort: if not a string, try to parse via Date.
  const d = new Date(dateLike as any);
  if (Number.isNaN(d.getTime())) return null;
  return getLocalDatePartsFromDate(d, userTimezone);
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
 * - Posted only (`pending !== true`)
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
