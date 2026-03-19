import { CATEGORY_MAP } from '@/lib/schedule-c/aggregate';

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
  is_deductible?: boolean | null; // confirmed true, or null/undefined for needs review, false for non-deductible
};

const BUSINESS_CATEGORIES = new Set(Object.keys(CATEGORY_MAP));

const pad2 = (n: number): string => String(n).padStart(2, '0');

function toCents(value: number): number {
  return Math.round((value ?? 0) * 100);
}

function roundDiv(numerator: number, denominator: number): number {
  // Deterministic integer rounding.
  return Math.round(numerator / denominator);
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
      (tx as any).type === 'income';

    if (!isIncome) continue;

    const cents = toCents(Math.abs(tx.amount ?? 0));
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

    const isConfirmed = tx.is_deductible === true;
    const isPotential = tx.is_deductible === null || tx.is_deductible === undefined;

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

// --------------------
// Tax estimation helpers (cents-stable)
// --------------------

type FilingStatus = 'single' | 'married_filing_jointly' | string;

// 2024 rates/limits used by existing code paths.
const SOCIAL_SECURITY_WAGE_BASE_CENTS = 168600 * 100;
const ADDITIONAL_MEDICARE_THRESHOLD_SINGLE_CENTS = 200000 * 100;
const ADDITIONAL_MEDICARE_THRESHOLD_MARRIED_CENTS = 250000 * 100;

function calcScheduleSEQuarterFromAnnualizedNetProfitCents(netProfitAnnualizedCents: number, filingStatus: FilingStatus) {
  // Negative net profit => no SE tax (planning estimate should not be negative).
  const netEarningsCents = Math.max(0, netProfitAnnualizedCents);

  // seBase = netEarnings * 0.9235
  const seBaseCents = roundDiv(netEarningsCents * 9235, 10000);

  const socialSecurityTaxableCents = Math.min(seBaseCents, SOCIAL_SECURITY_WAGE_BASE_CENTS);
  const socialSecurityTaxCents = roundDiv(socialSecurityTaxableCents * 124, 1000); // 12.4%

  const medicareTaxCents = roundDiv(seBaseCents * 29, 1000); // 2.9%

  const thresholdCents =
    filingStatus === 'married_filing_jointly' ? ADDITIONAL_MEDICARE_THRESHOLD_MARRIED_CENTS : ADDITIONAL_MEDICARE_THRESHOLD_SINGLE_CENTS;

  const additionalTaxableCents = Math.max(0, seBaseCents - thresholdCents);
  const additionalMedicareTaxCents = roundDiv(additionalTaxableCents * 9, 1000); // 0.9%

  const totalSETaxCents = socialSecurityTaxCents + medicareTaxCents + additionalMedicareTaxCents;

  return {
    totalSETaxCents,
  };
}

function calculateIncomeTaxCents(incomeCents: number, filingStatus: FilingStatus): number {
  const brackets =
    filingStatus === 'married_filing_jointly'
      ? [
          { min: 0, max: 22000, rate: 10 },
          { min: 22000, max: 89450, rate: 12 },
          { min: 89450, max: 190750, rate: 22 },
          { min: 190750, max: 364200, rate: 24 },
          { min: 364200, max: 462500, rate: 32 },
          { min: 462500, max: 693750, rate: 35 },
          { min: 693750, max: Infinity, rate: 37 },
        ]
      : [
          { min: 0, max: 11000, rate: 10 },
          { min: 11000, max: 44725, rate: 12 },
          { min: 44725, max: 95375, rate: 22 },
          { min: 95375, max: 182050, rate: 24 },
          { min: 182050, max: 231250, rate: 32 },
          { min: 231250, max: 578125, rate: 35 },
          { min: 578125, max: Infinity, rate: 37 },
        ];

  if (!Number.isFinite(incomeCents) || incomeCents <= 0) return 0;

  let taxCents = 0;
  for (const bracket of brackets) {
    const minCents = bracket.min * 100;
    const maxCents = bracket.max === Infinity ? Infinity : bracket.max * 100;

    if (incomeCents <= minCents) continue;
    const taxableCents = Math.min(incomeCents, maxCents) - minCents;

    // bracket.rate is a whole percent (e.g., 12 => 12%).
    taxCents += roundDiv(taxableCents * bracket.rate, 100);
  }

  return taxCents;
}

/**
 * Aggregate quarterly estimates for a given tax year, using user-local quarter assignment.
 */
export function aggregateQuarterlyEstimatesForYear(
  transactions: QuarterlyTransactionLike[],
  taxYear: number,
  userTimezone: string,
  options: {
    filingStatus: FilingStatus;
    w2Income?: number;
    otherIncome?: number;
  }
): {
  quarters: Array<{
    quarter: 1 | 2 | 3 | 4;
    gross_income: number;
    confirmed_deductible_expenses: number;
    potential_deductions_needing_review: number;
    net_profit: number;
    estimated_self_employment_tax: number;
    estimated_total_tax: number;
    suggested_quarterly_payment: number;
    reconciliation: {
      gross_income_cents_raw: number;
      confirmed_deductible_expenses_cents_raw: number;
      net_profit_cents_raw: number;
    };
  }>;
} {
  const w2IncomeCents = toCents(options.w2Income ?? 0);
  const otherIncomeCents = toCents(options.otherIncome ?? 0);

  const quarters: Array<{
    quarter: 1 | 2 | 3 | 4;
    gross_income: number;
    confirmed_deductible_expenses: number;
    potential_deductions_needing_review: number;
    net_profit: number;
    estimated_self_employment_tax: number;
    estimated_total_tax: number;
    suggested_quarterly_payment: number;
    reconciliation: {
      gross_income_cents_raw: number;
      confirmed_deductible_expenses_cents_raw: number;
      net_profit_cents_raw: number;
    };
  }> = [];

  const deduped = dedupeQuarterlyTransactions(transactions);

  for (const quarter of [1, 2, 3, 4] as const) {
    const { grossIncomeCents, grossIncome } = sumIncomeForQuarter(deduped, taxYear, quarter, userTimezone);
    const { confirmed_deductible_expenses_cents: expenseCents, confirmed_deductible_expenses } = sumExpensesForQuarter(
      deduped,
      taxYear,
      quarter,
      userTimezone
    );
    const { potential_deductions_needing_review: potentialDollars } = sumPotentialExpensesForQuarter(deduped, taxYear, quarter, userTimezone);

    const netProfitCents = grossIncomeCents - expenseCents;
    const netProfit = netProfitCents / 100;

    // Annualize this quarter's net profit for tax estimation.
    const netProfitAnnualizedCents = netProfitCents * 4;

    const { totalSETaxCents: seTaxAnnualCents } = calcScheduleSEQuarterFromAnnualizedNetProfitCents(
      netProfitAnnualizedCents,
      options.filingStatus
    );

    const incomeTaxAnnualCents = calculateIncomeTaxCents(netProfitAnnualizedCents + w2IncomeCents + otherIncomeCents, options.filingStatus);

    const estimatedTotalTaxAnnualCents = seTaxAnnualCents + incomeTaxAnnualCents;
    const estimatedSelfEmploymentTaxQuarterCents = roundDiv(seTaxAnnualCents, 4);
    const estimatedTotalTaxQuarterCents = roundDiv(estimatedTotalTaxAnnualCents, 4);

    quarters.push({
      quarter,
      gross_income: grossIncome,
      confirmed_deductible_expenses,
      potential_deductions_needing_review: potentialDollars,
      net_profit: netProfit,
      estimated_self_employment_tax: estimatedSelfEmploymentTaxQuarterCents / 100,
      estimated_total_tax: estimatedTotalTaxQuarterCents / 100,
      suggested_quarterly_payment: estimatedTotalTaxQuarterCents / 100,
      reconciliation: {
        gross_income_cents_raw: grossIncomeCents,
        confirmed_deductible_expenses_cents_raw: expenseCents,
        net_profit_cents_raw: netProfitCents,
      },
    });
  }

  // Annual reconciliation (income/expense/net) for expectations.
  const totalGrossCents = quarters.reduce((s, q) => s + q.reconciliation.gross_income_cents_raw, 0);
  const totalExpensesCents = quarters.reduce((s, q) => s + q.reconciliation.confirmed_deductible_expenses_cents_raw, 0);
  const totalNetCents = quarters.reduce((s, q) => s + q.reconciliation.net_profit_cents_raw, 0);
  // These are sanity checks; do not throw in production.
  if (totalGrossCents - totalExpensesCents !== totalNetCents) {
    // eslint-disable-next-line no-console
    console.warn('[QuarterlyEstimates] Annual reconciliation mismatch', { totalGrossCents, totalExpensesCents, totalNetCents });
  }

  return { quarters };
}

