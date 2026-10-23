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
 * Written charge day. A string `date` keeps that day. A Date, a Timestamp, or a
 * datetime-only row is undated: this returns null and does not guess a day.
 * `userTimezone` does not move the day. Schedule C uses the same charge day.
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

/** Earliest and latest civil offsets checked for a stored UTC moment. */
const EARLIEST_OFFSET_MINUTES = -12 * 60;
const LATEST_OFFSET_MINUTES = 14 * 60;

/**
 * US zones for boundaryCount: UTC-11 (Pago Pago) through UTC-4 (Puerto Rico and St. Thomas).
 * Guam and Saipan are not in this list. 2025-06-15T12:00Z, 2025-06-15T15:00Z,
 * and 2025-06-15T18:00Z stay on June 15 across this set, so each has boundaryCount 0.
 */
export const BOUNDARY_ZONES = [
  'Pacific/Pago_Pago',
  'Pacific/Honolulu',
  'America/Adak',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Phoenix',
  'America/Chicago',
  'America/New_York',
  'America/Puerto_Rico',
  'America/St_Thomas',
] as const;

/** Field name of the per-row boolean on undated income the estimate still places. */
export const UNDATED_ROW_FLAG = 'placedWithoutDate' as const;
/** Same field name as UNDATED_ROW_FLAG. The row value is the boolean true. */
export const ROW_FLAG_FIELD = 'placedWithoutDate' as const;

function partsAtOffset(instant: Date, offsetMinutes: number): LocalDateParts {
  const shifted = new Date(instant.getTime() + offsetMinutes * 60_000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  return { year, month, day, ymd: `${year}-${pad2(month)}-${pad2(day)}` };
}

/** A stored UTC moment. Numbers below 1e11 are epoch seconds. No zone is applied here. */
function storedMoment(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      const date = (value as { toDate: () => Date }).toDate();
      if (date instanceof Date && !Number.isNaN(date.getTime())) return date;
    } catch {
      return null;
    }
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = Math.abs(value) < 1e11 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function isStoredMoment(value: unknown): boolean {
  if (value instanceof Date) return true;
  return Boolean(value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function');
}

/**
 * Moment used only for estimate placement. A written charge day is handled
 * first by the caller. A blank `date`, a missing `date`, or a Timestamp or
 * Date stored in `date` falls back to `datetime`. When `datetime` is absent,
 * a Timestamp or Date in `date` is the moment. A non-empty unreadable `date`
 * does not fall through. Schedule C does not use this helper.
 */
function estimateInstant(transaction: QuarterlyTransactionLike): Date | null {
  const date = transaction.date;
  const blank = date === undefined || date === null || date === '';
  const momentInDate = isStoredMoment(date);
  if (!blank && !momentInDate) return null;
  return storedMoment(transaction.datetime) ?? (momentInDate ? storedMoment(date) : null);
}

function isIncomeCategory(transaction: QuarterlyTransactionLike): boolean {
  return transaction.category === 'income'
    || transaction.category === 'revenue'
    || (transaction.account_id === 'manual' && (transaction as { type?: unknown }).type === 'income');
}

/**
 * Estimate placement for income. A written charge day wins. With no written day,
 * a datetime, or a Timestamp or Date in `date`, uses the earliest day from
 * UTC-12 through UTC+14 (never the latest). Schedule C stays undated.
 * A non-empty unreadable written `date` does not fall through.
 */
function incomeEstimateDay(transaction: QuarterlyTransactionLike, userTimezone: string): LocalDateParts | null {
  const written = getLocalTransactionDate(transaction, userTimezone);
  if (written) return written;
  const instant = estimateInstant(transaction);
  if (!instant) return null;
  const earliest = partsAtOffset(instant, EARLIEST_OFFSET_MINUTES);
  const latest = partsAtOffset(instant, LATEST_OFFSET_MINUTES);
  return earliest.ymd <= latest.ymd ? earliest : latest;
}

function calendarDayInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** True when BOUNDARY_ZONES do not all show the same calendar day. */
function crossesUsZoneBoundary(instant: Date): boolean {
  const days = new Set(BOUNDARY_ZONES.map(zone => calendarDayInZone(instant, zone)));
  return days.size > 1;
}

export type UndatedIncomeEstimate = {
  count: number;
  total: number;
  boundaryCount: number;
};

export type UndatedExpenseEstimate = {
  count: number;
  total: number;
};

export type EstimateDateReview = {
  expenseNeedsDateCount: number;
  expenseNeedsDateAmount: number;
  incomeNeedsDateCount: number;
  incomeNeedsDateAmount: number;
  needsDateCopy: string;
  undatedIncome: UndatedIncomeEstimate;
  undatedExpenses: UndatedExpenseEstimate;
};

/**
 * Undated expenses stay out of every quarter and the year total, with a count
 * and amount kept. Undated income is flagged and is not dropped. A datetime-only
 * income row is placed by incomeEstimateDay. The estimate is not blocked.
 */
/** Earliest estimate day for income, or the written day. Null when the row is not income or cannot be placed. */
export function estimateIncomeDate(transaction: QuarterlyTransactionLike, userTimezone: string): string | null {
  if (!isIncomeCategory(transaction) || !(typeof transaction.amount === 'number' && transaction.amount < 0)) return null;
  return incomeEstimateDay(transaction, userTimezone)?.ymd ?? null;
}

/**
 * Income row for the estimate. A written charge day is unchanged.
 * Undated income placed in `taxYear` is copied with `date` set to that day
 * and `placedWithoutDate` set to true. The field name is ROW_FLAG_FIELD
 * and UNDATED_ROW_FLAG. The caller's row is not changed.
 */
export function incomeRowForEstimate<T extends QuarterlyTransactionLike>(
  transaction: T,
  userTimezone: string,
  taxYear: number,
): T | (T & { date: string; placedWithoutDate: true }) {
  if (chargeDay(transaction)) return transaction;
  const placed = estimateIncomeDate(transaction, userTimezone);
  if (!placed || !placed.startsWith(`${taxYear}-`)) return transaction;
  return { ...transaction, date: placed, [ROW_FLAG_FIELD]: true };
}

export function reviewEstimateDates(
  transactions: QuarterlyTransactionLike[],
  userTimezone: string,
  year?: number,
): EstimateDateReview {
  let expenseCents = 0;
  let expenseNeedsDateCount = 0;
  let incomeCents = 0;
  let incomeNeedsDateCount = 0;
  let boundaryCount = 0;
  for (const transaction of dedupeQuarterlyTransactions(transactions)) {
    if (!isPosted(transaction) || !Number.isFinite(transaction.amount)) continue;
    if (getLocalTransactionDate(transaction, userTimezone)) continue;
    if (isIncomeCategory(transaction) && transaction.amount < 0) {
      const placed = incomeEstimateDay(transaction, userTimezone);
      if (year !== undefined && placed && placed.year !== year) continue;
      incomeNeedsDateCount += 1;
      incomeCents += toCents(-transaction.amount);
      const instant = estimateInstant(transaction);
      if (instant && crossesUsZoneBoundary(instant)) boundaryCount += 1;
      continue;
    }
    if (!BUSINESS_CATEGORIES.has(transaction.category)) continue;
    expenseNeedsDateCount += 1;
    expenseCents += toCents(transaction.amount);
  }
  const expenseNeedsDateAmount = expenseCents / 100;
  const incomeNeedsDateAmount = incomeCents / 100;
  const money = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  // DRAFT pending approval. This sentence is customer copy.
  const needsDateCopy = `${expenseNeedsDateCount} expense rows need a date. Amount kept: ${money(expenseNeedsDateAmount)}. These expenses are left out of every estimate quarter and the year total. ${incomeNeedsDateCount} income rows need a date. Amount kept: ${money(incomeNeedsDateAmount)}. Undated income stays in the estimate year total and is flagged.`;
  return {
    expenseNeedsDateCount,
    expenseNeedsDateAmount,
    incomeNeedsDateCount,
    incomeNeedsDateAmount,
    needsDateCopy,
    undatedIncome: { count: incomeNeedsDateCount, total: incomeNeedsDateAmount, boundaryCount },
    undatedExpenses: { count: expenseNeedsDateCount, total: expenseNeedsDateAmount },
  };
}

/** Year income for the estimate, in dollars. Undated income with a moment is in grossIncome and in undatedIncome. Income with no moment stays out of grossIncome and is still counted in undatedIncome. */
export function sumIncomeForYear(
  transactions: QuarterlyTransactionLike[],
  year: number,
  userTimezone: string,
): { grossIncome: number; undatedIncome: UndatedIncomeEstimate; undatedExpenses: UndatedExpenseEstimate } {
  let grossIncomeCents = 0;
  for (const quarter of [1, 2, 3, 4] as const) {
    grossIncomeCents += sumIncomeForQuarter(transactions, year, quarter, userTimezone).grossIncomeCents;
  }
  const review = reviewEstimateDates(transactions, userTimezone, year);
  return {
    grossIncome: grossIncomeCents / 100,
    undatedIncome: review.undatedIncome,
    undatedExpenses: review.undatedExpenses,
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
 * - `undatedIncome` counts rows placed in this quarter with no written charge day.
 *   Each of those rows carries `placedWithoutDate: true` (`ROW_FLAG_FIELD`).
 *   `boundaryCount` is how many of them fall on different days across `BOUNDARY_ZONES`.
 */
export function sumIncomeForQuarter(
  transactions: QuarterlyTransactionLike[],
  year: number,
  quarter: 1 | 2 | 3 | 4,
  userTimezone: string
): { grossIncome: number; grossIncomeCents: number; undatedIncome: UndatedIncomeEstimate } {
  const deduped = dedupeQuarterlyTransactions(transactions);

  let grossIncomeCents = 0;
  let undatedCount = 0;
  let undatedCents = 0;
  let boundaryCount = 0;
  for (const tx of deduped) {
    if (!isPosted(tx)) continue;
    if (!tx.category) continue;

    const localDate = incomeEstimateDay(tx, userTimezone);
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
    if (!getLocalTransactionDate(tx, userTimezone)) {
      Object.assign(tx, { [ROW_FLAG_FIELD]: true });
      undatedCount += 1;
      undatedCents += cents;
      const instant = estimateInstant(tx);
      if (instant && crossesUsZoneBoundary(instant)) boundaryCount += 1;
    }
    grossIncomeCents += cents;
  }

  return {
    grossIncomeCents,
    grossIncome: grossIncomeCents / 100,
    undatedIncome: { count: undatedCount, total: undatedCents / 100, boundaryCount },
  };
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
