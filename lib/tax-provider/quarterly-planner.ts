/**
 * Quarterly estimated-tax planner: regular method on reviewed facts.
 *
 * Pure functions only. Every dollar figure here is a planning estimate built
 * from the shared federal snapshot plus explicitly saved prior-year facts;
 * nothing is inferred from year-to-date totals multiplied by four.
 *
 * Sources:
 * - IRC §6654 (required annual payment, 90%/100%/110% rules, $1,000 threshold,
 *   12-month prior-year requirement, no-prior-tax exception):
 *   https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section6654&num=0&edition=prelim
 * - IRS Publication 505, Tax Withholding and Estimated Tax, ch. 2 and ch. 4:
 *   https://www.irs.gov/publications/p505
 * - Instructions for Form 2210 (Part I required annual payment, Part III regular
 *   method, Penalty Worksheet with rate periods):
 *   https://www.irs.gov/instructions/i2210
 * - Form 1040-ES (2026) worksheet and installment due dates:
 *   https://www.irs.gov/pub/irs-pdf/f1040es.pdf
 * - IRS quarterly interest rates (§6621 underpayment rate by calendar quarter):
 *   https://www.irs.gov/payments/quarterly-interest-rates
 */
import { getFederalTaxRules } from '@/lib/tax-rules/federal-year-rules';
import { normalizeFilingStatus } from '@/lib/tax-rules/filing-status';
import type { FederalFilingStatus } from '@/lib/tax-rules/federal-year-rules';
import { getEstimatedTaxDeadline } from './payment-deadlines';
import { QuarterlyReviewRequiredError } from './regular-estimated-payments';

export type Quarter = 1 | 2 | 3 | 4;
/** Calendar date in YYYY-MM-DD form, compared on the UTC calendar. */
export type IsoDate = string;

export const QUARTERLY_PLANNER_SOURCES = {
  section6654: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section6654&num=0&edition=prelim',
  publication505: 'https://www.irs.gov/publications/p505',
  form2210Instructions: 'https://www.irs.gov/instructions/i2210',
  form1040es: 'https://www.irs.gov/pub/irs-pdf/f1040es.pdf',
  quarterlyInterestRates: 'https://www.irs.gov/payments/quarterly-interest-rates',
} as const;

export const ANNUALIZED_INCOME_METHOD_NOTE = 'The annualized income installment method (Form 2210 Schedule AI, periods ending March 31, May 31, August 31 and December 31) is not available in WriteOff. Uneven income may lower earlier installments under that method; review it with the Form 2210 instructions or a preparer.';

export const QUARTERLY_PLANNER_READY_MESSAGE = 'Planning estimate from your reviewed prior-year facts and saved records using the Pub 505 regular method. It is not a balance due and not a penalty determination; the IRS figures both when the return is filed.';

const QUARTERS: readonly Quarter[] = [1, 2, 3, 4];
const DAY_MS = 86_400_000;
const DE_MINIMIS_THRESHOLD_CENTS = 100_000; // §6654(e)(1): no penalty when tax less withholding is under $1,000.

// ── Money and date helpers ──────────────────────────────────────────────────

const toCents = (value: number): number => Math.round(value * 100);
const fromCents = (cents: number): number => cents / 100;
const money = (value: number): string => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function requireAmount(value: unknown, label: string, allowNegative = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (!allowNegative && value < 0)) {
    throw new QuarterlyReviewRequiredError(`Enter a valid ${label}.`);
  }
  return toCents(value);
}

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function isoToMs(value: IsoDate): number {
  if (!isIsoDate(value)) throw new RangeError(`Invalid date: ${String(value)}`);
  return Date.parse(`${value}T00:00:00Z`);
}

/** Whole days from `from` to `to` (Form 2210 counts the due date to the payment date). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((isoToMs(to) - isoToMs(from)) / DAY_MS);
}

export function daysInYear(year: number): 365 | 366 {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

const compareIso = (a: IsoDate, b: IsoDate): number => (a < b ? -1 : a > b ? 1 : 0);
const minIso = (a: IsoDate, b: IsoDate): IsoDate => (compareIso(a, b) <= 0 ? a : b);

/** Split `total` cents into four installments; leftover cents go to the earliest quarters. */
export function allocateQuarterly(totalCents: number): [number, number, number, number] {
  const base = Math.floor(totalCents / 4);
  const remainder = totalCents - base * 4;
  return [0, 1, 2, 3].map(index => base + (index < remainder ? 1 : 0)) as [number, number, number, number];
}

// ── Installment due dates ───────────────────────────────────────────────────

export interface InstallmentDueDate {
  quarter: Quarter;
  /** Payment deadline: the statutory date moved to the next business day when it falls on a weekend or DC/federal holiday (§7503). */
  dueDate: IsoDate;
  /**
   * §6654(c)(2) statutory due date (April 15, June 15, September 15, January 15). Form 2210
   * starts the underpayment period here even when the payment deadline moved: the 2024
   * Penalty Worksheet uses 06/15/24 (a Saturday) and 09/15/24 (a Sunday) as computation
   * starting dates while treating payments made by 06/17/24 and 09/16/24 as timely.
   */
  statutoryDueDate: IsoDate;
}

/** §6654(c)(2) due dates before any weekend/holiday shift. */
export function getStatutoryDueDate(taxYear: number, quarter: Quarter): IsoDate {
  return [`${taxYear}-04-15`, `${taxYear}-06-15`, `${taxYear}-09-15`, `${taxYear + 1}-01-15`][quarter - 1];
}

/**
 * Standard individual due dates (Apr 15, Jun 15, Sep 15, Jan 15 of the following
 * year), moved to the next business day for weekends and the DC/federal holidays
 * handled by the shared deadline helper. Disaster postponements are separate.
 */
export function getInstallmentDueDates(taxYear: number): InstallmentDueDate[] {
  return QUARTERS.map(quarter => ({
    quarter,
    dueDate: getEstimatedTaxDeadline(taxYear, quarter).toISOString().slice(0, 10),
    statutoryDueDate: getStatutoryDueDate(taxYear, quarter),
  }));
}

/** Return due date used as the end of the Form 2210 penalty period ("or April 15, whichever is earlier"). */
export const penaltyPeriodEnd = (taxYear: number): IsoDate => `${taxYear + 1}-04-15`;

// ── §6621 underpayment rates ────────────────────────────────────────────────

/**
 * Non-corporate underpayment rate by calendar quarter, as published on
 * https://www.irs.gov/payments/quarterly-interest-rates. The same rate applies to
 * §6654 estimated-tax underpayments (each Rev. Rul. says so explicitly).
 *  2024: Rev. Rul. 2023-22, 2024-6, 2024-11, 2024-18 (8% all year).
 *  2025: IRB 2024-49, 2025-13, 2025-23, 2025-37 (7% all year).
 *  2026: IRB 2025-48 (Q1 7%), IRB 2026-8 (Q2 6%), IRB 2026-22 (Q3 7%), IRB 2026-36 / Rev. Rul. 2026-15 (Q4 7%).
 *  2027 Q1: not yet published (normally announced late Nov./early Dec. 2026) → null.
 */
const UNDERPAYMENT_RATES: Readonly<Record<string, number>> = {
  '2024-1': 0.08, '2024-2': 0.08, '2024-3': 0.08, '2024-4': 0.08,
  '2025-1': 0.07, '2025-2': 0.07, '2025-3': 0.07, '2025-4': 0.07,
  '2026-1': 0.07, '2026-2': 0.06, '2026-3': 0.07, '2026-4': 0.07,
};

export function getUnderpaymentRate(year: number, quarter: Quarter): number | null {
  return UNDERPAYMENT_RATES[`${year}-${quarter}`] ?? null;
}

export interface RatePeriod {
  label: string;
  /**
   * Form 2210 "computation starting date" for the period (worksheet lines 2, 5, 8, 11):
   * the day before the first day counted, so days in the period are `end − start`.
   */
  start: IsoDate;
  /** Last day counted in the period (worksheet: "or {end}, whichever is earlier"). */
  end: IsoDate;
  rateYear: number;
  rateQuarter: Quarter;
  rate: number | null;
}

/**
 * Form 2210 Penalty Worksheet rate periods for a calendar tax year. Under
 * §6621(b)(2)(B) the first-quarter rate of the following year also applies to the
 * first 15 days of April, so the final period runs January 1 through April 15.
 *
 * Day counts follow the worksheet: days late = payment date − due date, so the day
 * of the due date is not counted and the payment day is. A period therefore owns the
 * days after its computation starting date through its end date: Table 2 of the
 * instructions shows 76 days for 04/15–06/30, 92 for 06/30–09/30, 92 for 09/30–12/31
 * and 105 for 12/31–04/15 (15 days for 06/15–06/30 and 09/15–09/30, 90 for 01/15–04/15).
 */
export function getPenaltyRatePeriods(taxYear: number): RatePeriod[] {
  const next = taxYear + 1;
  const period = (label: string, start: IsoDate, end: IsoDate, rateYear: number, rateQuarter: Quarter): RatePeriod => ({
    label, start, end, rateYear, rateQuarter, rate: getUnderpaymentRate(rateYear, rateQuarter),
  });
  return [
    period(`April 16 – June 30, ${taxYear}`, `${taxYear}-04-15`, `${taxYear}-06-30`, taxYear, 2),
    period(`July 1 – September 30, ${taxYear}`, `${taxYear}-06-30`, `${taxYear}-09-30`, taxYear, 3),
    period(`October 1 – December 31, ${taxYear}`, `${taxYear}-09-30`, `${taxYear}-12-31`, taxYear, 4),
    period(`January 1 – April 15, ${next}`, `${taxYear}-12-31`, `${next}-04-15`, next, 1),
  ];
}

// ── Required annual payment (Form 2210 Part I / Pub 505 Worksheet 2-1) ─────

export type SafeHarborBasis = 'current_year_90' | 'prior_year_100' | 'prior_year_110';

export type PriorYearFacts =
  | { available: true; totalTax: number; agi: number; coveredTwelveMonths: true }
  | { available: false; reason: 'short_year_or_no_return' };

export interface RequiredAnnualPaymentInput {
  taxYear: number;
  /** Current-year filing status; decides the $75,000 MFS threshold. */
  filingStatus: string;
  /** Form 2210 line 4: current-year total tax less refundable credits (from the shared federal snapshot). */
  currentYearTax: number;
  /** Form 2210 line 6: full-year federal income tax withheld. */
  withholding: number;
  priorYear: PriorYearFacts;
}

export interface RequiredAnnualPayment {
  taxYear: number;
  filingStatus: FederalFilingStatus;
  currentYearTax: number;
  ninetyPercentOfCurrentYear: number;
  priorYear: { totalTax: number; agi: number; agiThreshold: number; multiplier: 1 | 1.1; target: number } | null;
  requiredAnnualPayment: number;
  basis: SafeHarborBasis;
  withholding: number;
  deMinimis: { threshold: number; taxLessWithholding: number; applies: boolean };
  /** Required annual payment less withholding, or $0 when the $1,000 rule applies. */
  estimatedPaymentsRequired: number;
}

export function calculateRequiredAnnualPayment(input: RequiredAnnualPaymentInput): RequiredAnnualPayment {
  getFederalTaxRules(input.taxYear); // Rejects unpublished years such as 2027.
  const filingStatus = normalizeFilingStatus(input.filingStatus);
  const currentTax = requireAmount(input.currentYearTax, 'current-year federal tax');
  const withholding = requireAmount(input.withholding, 'full-year federal withholding');
  const ninety = Math.round(currentTax * 0.9);
  let prior: RequiredAnnualPayment['priorYear'] = null;
  if (!input.priorYear || typeof input.priorYear.available !== 'boolean') {
    throw new QuarterlyReviewRequiredError('Confirm whether the prior-year return covered a full 12 months.');
  }
  if (input.priorYear.available) {
    if (input.priorYear.coveredTwelveMonths !== true) {
      throw new QuarterlyReviewRequiredError('The prior-year method requires a return covering all 12 months of the prior year.');
    }
    const priorTax = requireAmount(input.priorYear.totalTax, 'prior-year total tax');
    const agi = requireAmount(input.priorYear.agi, 'prior-year adjusted gross income', true);
    // §6654(d)(1)(C): 110% when prior-year AGI exceeds $150,000 ($75,000 if the current-year return is MFS). Strictly greater than.
    const agiThreshold = (filingStatus === 'married_filing_separately' ? 75_000 : 150_000) * 100;
    const multiplier: 1 | 1.1 = agi > agiThreshold ? 1.1 : 1;
    prior = { totalTax: fromCents(priorTax), agi: fromCents(agi), agiThreshold: fromCents(agiThreshold), multiplier, target: fromCents(Math.round(priorTax * multiplier)) };
  }
  const usePrior = prior !== null && toCents(prior.target) < ninety;
  const required = prior !== null && usePrior ? toCents(prior.target) : ninety;
  const basis: SafeHarborBasis = prior !== null && usePrior ? (prior.multiplier === 1.1 ? 'prior_year_110' : 'prior_year_100') : 'current_year_90';
  const taxLessWithholding = currentTax - withholding;
  const deMinimisApplies = taxLessWithholding < DE_MINIMIS_THRESHOLD_CENTS;
  return {
    taxYear: input.taxYear, filingStatus,
    currentYearTax: fromCents(currentTax), ninetyPercentOfCurrentYear: fromCents(ninety),
    priorYear: prior, requiredAnnualPayment: fromCents(required), basis, withholding: fromCents(withholding),
    deMinimis: { threshold: fromCents(DE_MINIMIS_THRESHOLD_CENTS), taxLessWithholding: fromCents(taxLessWithholding), applies: deMinimisApplies },
    estimatedPaymentsRequired: deMinimisApplies ? 0 : fromCents(Math.max(0, required - withholding)),
  };
}

// ── Withholding and payment matching ────────────────────────────────────────

export interface DatedAmount { date: IsoDate; amount: number }

export type WithholdingSchedule =
  | { kind: 'even'; total: number }
  | { kind: 'dated'; entries: DatedAmount[] };

export interface WithholdingAllocation {
  quarter: Quarter;
  dueDate: IsoDate;
  amount: number;
  /** Dates the withholding is treated as paid: the statutory due date (even method, §6654(g)(1)) or the actual withholding dates. */
  creditedOn: DatedAmount[];
}

/**
 * Form 2210 Part III line 11: withholding counts as paid in four equal parts on the
 * due dates unless actual dated withholding is supplied, in which case each amount is
 * credited to the installment period in which it was withheld, on that date.
 */
export function allocateWithholding(schedule: WithholdingSchedule, taxYear: number): WithholdingAllocation[] {
  const due = getInstallmentDueDates(taxYear);
  if (schedule.kind === 'even') {
    const parts = allocateQuarterly(requireAmount(schedule.total, 'full-year federal withholding'));
    return due.map(({ quarter, dueDate, statutoryDueDate }) => {
      const amount = fromCents(parts[quarter - 1]);
      return { quarter, dueDate, amount, creditedOn: amount > 0 ? [{ date: statutoryDueDate, amount }] : [] };
    });
  }
  const cents = [0, 0, 0, 0];
  const creditedOn: DatedAmount[][] = [[], [], [], []];
  for (const entry of schedule.entries) {
    const amountCents = requireAmount(entry.amount, 'dated withholding amount');
    if (amountCents === 0) continue;
    const { quarter } = assignInstallmentPeriod(entry.date, taxYear);
    cents[quarter - 1] += amountCents;
    creditedOn[quarter - 1].push({ date: entry.date, amount: fromCents(amountCents) });
  }
  return due.map(({ quarter, dueDate }) => ({ quarter, dueDate, amount: fromCents(cents[quarter - 1]), creditedOn: creditedOn[quarter - 1] }));
}

export interface PeriodAssignment { quarter: Quarter; afterFinalDueDate: boolean }

/**
 * Installment period for a dated payment: on or before April 15 → Q1; after April 15
 * through June 15 → Q2; after June 15 through September 15 → Q3; after September 15
 * through January 15 → Q4 (shifted due dates included). Later payments still belong
 * to the year but fall after the final due date.
 */
export function assignInstallmentPeriod(paidDate: IsoDate, taxYear: number): PeriodAssignment {
  if (!isIsoDate(paidDate)) throw new RangeError('Provide the payment date as YYYY-MM-DD.');
  for (const { quarter, dueDate } of getInstallmentDueDates(taxYear)) {
    if (compareIso(paidDate, dueDate) <= 0) return { quarter, afterFinalDueDate: false };
  }
  return { quarter: 4, afterFinalDueDate: true };
}

export interface RecordedEstimatedPayment {
  amount: number;
  /** YYYY-MM-DD when recorded; null for legacy records without a date. */
  paidDate: IsoDate | null;
  /** Quarter key the payment was saved under (used only when no date exists). */
  recordedQuarter: Quarter;
}

export interface MatchedPayment extends RecordedEstimatedPayment {
  matchedQuarter: Quarter;
  afterFinalDueDate: boolean;
  /** Date used for interest purposes: the recorded date, or the recorded quarter's due date when undated. */
  effectiveDate: IsoDate;
  dated: boolean;
}

export function matchPaymentsToPeriods(payments: RecordedEstimatedPayment[], taxYear: number): MatchedPayment[] {
  const due = getInstallmentDueDates(taxYear);
  return payments
    .filter(payment => requireAmount(payment.amount, 'recorded payment amount') > 0)
    .map(payment => {
      if (payment.paidDate !== null && isIsoDate(payment.paidDate)) {
        const assignment = assignInstallmentPeriod(payment.paidDate, taxYear);
        return { ...payment, matchedQuarter: assignment.quarter, afterFinalDueDate: assignment.afterFinalDueDate, effectiveDate: payment.paidDate, dated: true };
      }
      const quarter = QUARTERS.includes(payment.recordedQuarter) ? payment.recordedQuarter : 4;
      return { ...payment, paidDate: null, matchedQuarter: quarter, afterFinalDueDate: false, effectiveDate: due[quarter - 1].dueDate, dated: false };
    })
    .sort((a, b) => compareIso(a.effectiveDate, b.effectiveDate));
}

// ── Form 2210 Part III regular method ───────────────────────────────────────

export type InstallmentStatus = 'upcoming' | 'payment_recorded' | 'no_payment_recorded';

export interface InstallmentPlan {
  quarter: Quarter;
  /** Payment deadline after any weekend/holiday shift. */
  dueDate: IsoDate;
  /** §6654(c)(2) date the underpayment period runs from (Form 2210 computation starting date). */
  statutoryDueDate: IsoDate;
  /** Line 10: 25% of the required annual payment. */
  requiredInstallment: number;
  /** Withholding credited to this period (line 11 component). */
  withholdingCredited: number;
  /** Line 10 less withholding credited: the estimated payment the regular method plans for this date. */
  plannedEstimatedPayment: number;
  paymentsMatched: MatchedPayment[];
  paymentsMatchedTotal: number;
  /** Line 12: overpayment carried in from the prior column. */
  overpaymentCarriedIn: number;
  /** Line 17: underpayment for this column after carried amounts. */
  underpayment: number;
  /** Line 18: overpayment carried to the next column. */
  overpaymentCarriedOut: number;
  status: InstallmentStatus;
}

export function computeInstallments(input: {
  taxYear: number; requiredAnnualPayment: number; estimatedPaymentsRequired: number;
  withholding: WithholdingAllocation[]; payments: MatchedPayment[]; asOf: IsoDate;
}): InstallmentPlan[] {
  const due = getInstallmentDueDates(input.taxYear);
  // Form 2210 Part I: no installments are required when the $1,000 rule applies
  // (line 7) or withholding already covers the required annual payment (line 9).
  const requiredCents = input.estimatedPaymentsRequired === 0 ? [0, 0, 0, 0] : allocateQuarterly(toCents(input.requiredAnnualPayment));
  let carriedOver = 0;
  let carriedUnder = 0;
  return due.map(({ quarter, dueDate, statutoryDueDate }, index) => {
    const required = requiredCents[index];
    const withholdingCredited = toCents(input.withholding.find(w => w.quarter === quarter)?.amount ?? 0);
    const matched = input.payments.filter(payment => payment.matchedQuarter === quarter);
    const paymentsTotal = matched.reduce((sum, payment) => sum + toCents(payment.amount), 0);
    const line11 = withholdingCredited + paymentsTotal;
    const line12 = index === 0 ? 0 : carriedOver;
    const line13 = line11 + line12;
    const line14 = index === 0 ? 0 : carriedUnder;
    const line15 = index === 0 ? line11 : Math.max(0, line13 - line14);
    const line16 = index === 0 ? 0 : line15 === 0 ? line14 - line13 : 0;
    const underpayment = required >= line15 ? required - line15 : 0;
    const overpayment = required >= line15 ? 0 : line15 - required;
    carriedOver = overpayment;
    carriedUnder = line16 + underpayment;
    const status: InstallmentStatus = compareIso(dueDate, input.asOf) >= 0 ? 'upcoming' : paymentsTotal > 0 ? 'payment_recorded' : 'no_payment_recorded';
    return {
      quarter, dueDate, statutoryDueDate,
      requiredInstallment: fromCents(required), withholdingCredited: fromCents(withholdingCredited),
      plannedEstimatedPayment: fromCents(Math.max(0, required - withholdingCredited)),
      paymentsMatched: matched, paymentsMatchedTotal: fromCents(paymentsTotal),
      overpaymentCarriedIn: fromCents(line12), underpayment: fromCents(underpayment), overpaymentCarriedOut: fromCents(overpayment),
      status,
    };
  });
}

// ── Form 2210 Penalty Worksheet illustration ────────────────────────────────

export interface InterestSegment {
  amount: number;
  /** Statutory due date of the installment (Form 2210 computation starting date). */
  from: IsoDate;
  to: IsoDate;
  days: number;
  /** True while the amount remains unpaid as of the illustration date. */
  stillUnpaid: boolean;
  interest: number | null;
  unpublishedRatePeriods: string[];
}

export interface InstallmentInterest {
  quarter: Quarter;
  dueDate: IsoDate;
  /** Portion of the installment still unpaid as of the illustration date. */
  unpaidAsOf: number;
  segments: InterestSegment[];
  interest: number | null;
  unpublishedRatePeriods: string[];
}

export interface InterestIllustration {
  label: string;
  asOf: IsoDate;
  penaltyPeriodEnd: IsoDate;
  ratePeriods: RatePeriod[];
  byInstallment: InstallmentInterest[];
  total: number | null;
  unpublishedRatePeriods: string[];
  notes: string[];
}

/**
 * Interest on `amountCents` from `from` to `to` (days = `to − from`, as Form 2210 counts
 * them) across the published rate periods. Each rate-period piece is rounded to cents
 * separately, matching worksheet lines 4, 7, 10 and 13 (underpayment × days ÷ 365 or
 * 366 × rate), which are then added on line 14.
 */
export function illustrateInterestForSegment(amountCents: number, from: IsoDate, to: IsoDate, taxYear: number): { interest: number | null; unpublishedRatePeriods: string[] } {
  if (compareIso(to, from) <= 0 || amountCents <= 0) return { interest: 0, unpublishedRatePeriods: [] };
  let interestCents = 0;
  const unpublished: string[] = [];
  for (const period of getPenaltyRatePeriods(taxYear)) {
    const start = compareIso(from, period.start) > 0 ? from : period.start;
    const end = compareIso(to, period.end) < 0 ? to : period.end;
    const days = daysBetween(start, end);
    if (days <= 0) continue;
    if (period.rate === null) { unpublished.push(`${period.rateYear}-Q${period.rateQuarter}`); continue; }
    interestCents += Math.round(amountCents * period.rate * days / daysInYear(period.rateYear));
  }
  return { interest: unpublished.length ? null : interestCents / 100, unpublishedRatePeriods: unpublished };
}

/**
 * Applies withholding (on due dates) and dated payments to the earliest unpaid
 * installment first, then accrues interest on each late-paid or still-unpaid piece
 * from its statutory due date to the payment date, the illustration date, or April 15
 * of the following year, whichever is earliest. A payment made by the shifted
 * (weekend/holiday) deadline is timely under §7503 and accrues nothing; a later
 * payment runs from the statutory date, as the Form 2210 Penalty Worksheet does.
 * Not a penalty determination: waivers, annualized income, and IRS payment posting
 * rules are outside this illustration.
 */
export function illustrateUnderpaymentInterest(input: {
  taxYear: number; installments: InstallmentPlan[]; withholding: WithholdingAllocation[]; payments: MatchedPayment[]; asOf: IsoDate; deMinimisApplies: boolean;
}): InterestIllustration {
  const end = penaltyPeriodEnd(input.taxYear);
  const horizon = minIso(input.asOf, end);
  const ratePeriods = getPenaltyRatePeriods(input.taxYear);
  const notes: string[] = [];
  const events: { date: IsoDate; amount: number }[] = [
    ...input.withholding.flatMap(w => w.creditedOn.map(entry => ({ date: entry.date, amount: toCents(entry.amount) }))),
    ...input.payments.map(p => ({ date: p.effectiveDate, amount: toCents(p.amount) })),
  ].filter(event => event.amount > 0 && compareIso(event.date, horizon) <= 0).sort((a, b) => compareIso(a.date, b.date));
  const ledger = input.installments.map(installment => ({ installment, remaining: toCents(installment.requiredInstallment), segments: [] as InterestSegment[] }));
  const accrualStart = (installment: InstallmentPlan): IsoDate => installment.statutoryDueDate;
  for (const event of events) {
    let available = event.amount;
    for (const entry of ledger) {
      if (available <= 0) break;
      if (entry.remaining <= 0) continue;
      const applied = Math.min(available, entry.remaining);
      entry.remaining -= applied;
      available -= applied;
      if (compareIso(event.date, entry.installment.dueDate) > 0) {
        const from = accrualStart(entry.installment);
        const to = minIso(event.date, end);
        const { interest, unpublishedRatePeriods } = illustrateInterestForSegment(applied, from, to, input.taxYear);
        entry.segments.push({ amount: fromCents(applied), from, to, days: daysBetween(from, to), stillUnpaid: false, interest, unpublishedRatePeriods });
      }
    }
  }
  const byInstallment: InstallmentInterest[] = ledger.map(entry => {
    if (entry.remaining > 0 && compareIso(entry.installment.dueDate, horizon) < 0) {
      const from = accrualStart(entry.installment);
      const { interest, unpublishedRatePeriods } = illustrateInterestForSegment(entry.remaining, from, horizon, input.taxYear);
      entry.segments.push({ amount: fromCents(entry.remaining), from, to: horizon, days: daysBetween(from, horizon), stillUnpaid: true, interest, unpublishedRatePeriods });
    }
    const unpublished = [...new Set(entry.segments.flatMap(segment => segment.unpublishedRatePeriods))];
    const interest = unpublished.length ? null : Math.round(entry.segments.reduce((sum, segment) => sum + (segment.interest ?? 0) * 100, 0)) / 100;
    return { quarter: entry.installment.quarter, dueDate: entry.installment.dueDate, unpaidAsOf: fromCents(entry.remaining), segments: entry.segments, interest, unpublishedRatePeriods: unpublished };
  });
  const unpublished = [...new Set(byInstallment.flatMap(item => item.unpublishedRatePeriods))];
  const total = unpublished.length ? null : Math.round(byInstallment.reduce((sum, item) => sum + (item.interest ?? 0) * 100, 0)) / 100;
  if (input.deMinimisApplies) notes.push('Current-year tax less withholding is under $1,000, so no estimated-tax penalty applies under §6654(e)(1); the illustration is $0.');
  if (unpublished.length) notes.push(`The IRS has not published the §6621 underpayment rate for ${unpublished.join(', ')}. Interest for days in that period cannot be illustrated yet and is shown as unavailable rather than estimated.`);
  if (compareIso(input.asOf, end) > 0) notes.push(`Interest is illustrated only through ${end}, the return due date used by Form 2210. Later interest on an unpaid balance follows different rules.`);
  notes.push('Illustration only. It applies recorded payments to the earliest unpaid installment, treats withholding as paid evenly on the due dates unless dated withholding was supplied, and ignores waivers, annualized income and IRS posting dates. The IRS figures any penalty when the return is filed.');
  notes.push('Payments made by a deadline that moved to the next business day are timely; a later payment accrues from the statutory due date (April 15, June 15, September 15, January 15), which is how the Form 2210 Penalty Worksheet counts days.');
  return { label: 'Underpayment interest illustration (Form 2210 regular method) — not a penalty determination', asOf: input.asOf, penaltyPeriodEnd: end, ratePeriods, byInstallment, total, unpublishedRatePeriods: unpublished, notes };
}

// ── Next due date and amount ────────────────────────────────────────────────

export interface NextDue {
  quarter: Quarter;
  dueDate: IsoDate;
  /** Cumulative required installments through this date less withholding credited through it and all recorded payments. */
  amountToPay: number;
  includesEarlierShortfall: boolean;
  installmentOnly: number;
}

export function getNextDueDate(taxYear: number, asOf: IsoDate): InstallmentDueDate | null {
  if (!isIsoDate(asOf)) throw new RangeError('Provide the planning date as YYYY-MM-DD.');
  return getInstallmentDueDates(taxYear).find(item => compareIso(item.dueDate, asOf) >= 0) ?? null;
}

export function calculateNextDue(installments: InstallmentPlan[], taxYear: number, asOf: IsoDate): NextDue | null {
  const next = getNextDueDate(taxYear, asOf);
  if (!next) return null;
  const through = installments.filter(item => item.quarter <= next.quarter);
  const requiredThrough = through.reduce((sum, item) => sum + toCents(item.requiredInstallment), 0);
  const withholdingThrough = through.reduce((sum, item) => sum + toCents(item.withholdingCredited), 0);
  const recorded = installments.reduce((sum, item) => sum + toCents(item.paymentsMatchedTotal), 0);
  const amount = Math.max(0, requiredThrough - withholdingThrough - recorded);
  const installmentOnly = toCents(installments.find(item => item.quarter === next.quarter)?.plannedEstimatedPayment ?? 0);
  return { quarter: next.quarter, dueDate: next.dueDate, amountToPay: fromCents(amount), includesEarlierShortfall: amount > installmentOnly, installmentOnly: fromCents(installmentOnly) };
}

// ── Whole plan ──────────────────────────────────────────────────────────────

export interface QuarterlyPlanInput extends RequiredAnnualPaymentInput {
  withholdingSchedule?: WithholdingSchedule;
  payments: RecordedEstimatedPayment[];
  asOf: IsoDate;
  /** Extra caller assumptions (for example how the current-year figure was produced). */
  assumptions?: string[];
}

export interface QuarterlyPlan {
  status: 'ready';
  taxYear: number;
  filingStatus: FederalFilingStatus;
  asOf: IsoDate;
  requiredAnnualPayment: RequiredAnnualPayment;
  installments: InstallmentPlan[];
  nextDue: NextDue | null;
  afterFinalDueDate: { returnDueDate: IsoDate; remainingShortfall: number } | null;
  totals: { requiredInstallments: number; withholdingCredited: number; recordedPayments: number; remainingEstimatedPayments: number };
  underpaymentInterestIllustration: InterestIllustration;
  annualizedIncomeMethod: { available: false; note: string };
  assumptions: string[];
  sources: typeof QUARTERLY_PLANNER_SOURCES;
}

const basisLabel = (basis: SafeHarborBasis): string => basis === 'current_year_90'
  ? '90% of the current-year federal estimate'
  : basis === 'prior_year_110' ? '110% of prior-year tax (prior-year AGI above the threshold)' : '100% of prior-year tax';

export function buildQuarterlyPlan(input: QuarterlyPlanInput): QuarterlyPlan {
  if (!isIsoDate(input.asOf)) throw new RangeError('Provide the planning date as YYYY-MM-DD.');
  const required = calculateRequiredAnnualPayment(input);
  const withholding = allocateWithholding(input.withholdingSchedule ?? { kind: 'even', total: input.withholding }, input.taxYear);
  const payments = matchPaymentsToPeriods(input.payments, input.taxYear);
  const installments = computeInstallments({
    taxYear: input.taxYear, requiredAnnualPayment: required.requiredAnnualPayment, estimatedPaymentsRequired: required.estimatedPaymentsRequired,
    withholding, payments, asOf: input.asOf,
  });
  const nextDue = calculateNextDue(installments, input.taxYear, input.asOf);
  const requiredTotal = installments.reduce((sum, item) => sum + toCents(item.requiredInstallment), 0);
  const withholdingTotal = installments.reduce((sum, item) => sum + toCents(item.withholdingCredited), 0);
  const recordedTotal = installments.reduce((sum, item) => sum + toCents(item.paymentsMatchedTotal), 0);
  const remaining = Math.max(0, requiredTotal - withholdingTotal - recordedTotal);
  const illustration = illustrateUnderpaymentInterest({ taxYear: input.taxYear, installments, withholding, payments, asOf: input.asOf, deMinimisApplies: required.deMinimis.applies });
  const assumptions = [
    `Required annual payment uses the lesser of 90% of the current-year federal estimate and ${required.priorYear ? `${required.priorYear.multiplier === 1.1 ? '110%' : '100%'} of prior-year tax` : 'the prior-year method (unavailable: the prior return did not cover 12 months, so only the current-year 90% target is used)'}; basis selected: ${basisLabel(required.basis)}.`,
    required.deMinimis.applies
      ? `Current-year tax less withholding is ${money(required.deMinimis.taxLessWithholding)}, under the $1,000 threshold; no estimated payments are required by the regular method.`
      : `Current-year tax less withholding is ${money(required.deMinimis.taxLessWithholding)}, so the $1,000 exception does not apply.`,
    `Installments are 25% of the required annual payment on each due date; withholding is credited ${input.withholdingSchedule?.kind === 'dated' ? 'by the period in which it was withheld' : 'in four equal parts'}; recorded payments are matched to periods by payment date.`,
    ...(payments.some(payment => !payment.dated) ? ['One or more recorded payments have no payment date and are treated as paid on the due date of the quarter they were saved under.'] : []),
    ...(payments.some(payment => payment.afterFinalDueDate) ? ['One or more recorded payments are dated after the final installment date and are applied as late payments.'] : []),
    ...(required.priorYear && required.priorYear.totalTax === 0 ? ['Prior-year total tax is $0 with a 12-month return, so the prior-year method requires no annual payment; keep the prior-year return available to support this.'] : []),
    'Federal only. State estimated taxes, special relief, farming/fishing rules and fiscal-year returns are outside this plan.',
    ...(input.assumptions ?? []),
  ];
  return {
    status: 'ready', taxYear: input.taxYear, filingStatus: required.filingStatus, asOf: input.asOf,
    requiredAnnualPayment: required, installments, nextDue,
    afterFinalDueDate: nextDue ? null : { returnDueDate: penaltyPeriodEnd(input.taxYear), remainingShortfall: fromCents(remaining) },
    totals: { requiredInstallments: fromCents(requiredTotal), withholdingCredited: fromCents(withholdingTotal), recordedPayments: fromCents(recordedTotal), remainingEstimatedPayments: fromCents(remaining) },
    underpaymentInterestIllustration: illustration,
    annualizedIncomeMethod: { available: false, note: ANNUALIZED_INCOME_METHOD_NOTE },
    assumptions, sources: QUARTERLY_PLANNER_SOURCES,
  };
}

// ── Fact resolution from saved records ──────────────────────────────────────

export type MissingFactKey = 'prior_year_total_tax' | 'prior_year_agi' | 'prior_return_twelve_months' | 'current_year_estimate' | 'filing_status';

export interface MissingFact {
  key: MissingFactKey;
  label: string;
  detail: string;
  enterAt: { screen: string; href: string; label: string }[];
}

export const PLANNER_FACT_SCREENS = {
  taxOrganizer: { screen: 'tax-organizer', href: '/protected?screen=tax-organizer', label: 'Tax Organizer › Prior year' },
  deductions: { screen: 'deductions-entry', href: '/protected?screen=deductions-entry', label: 'Deductions › Prior-year tax' },
  income: { screen: 'income-tracking', href: '/protected?screen=income-tracking', label: 'Income records' },
  profile: { screen: 'settings', href: '/protected/settings', label: 'Settings › Tax profile' },
} as const;

export interface PlannerFactSources {
  taxYear: number;
  /** Values from the shared annual snapshot response. */
  annual: { filingStatus: string; totalTax: number; refundableCredits: number; totalFederalWithheld: number; totalIncome: number };
  profile: Record<string, unknown> | null | undefined;
  organizer: Record<string, unknown> | null | undefined;
  deductions: Record<string, unknown> | null | undefined;
}

export interface ResolvedPlannerFacts {
  taxYear: number;
  filingStatus: string;
  currentYearTax: number;
  withholding: number;
  priorYear: PriorYearFacts;
  assumptions: string[];
}

export interface PlannerReviewRequired { status: 'review_required'; missingFacts: MissingFact[]; notes: string[] }

export type PlannerFactResolution =
  | { status: 'ready'; facts: ResolvedPlannerFacts }
  | PlannerReviewRequired;

/** Shape of the `planner` field returned by /api/tax/quarterly-reminders. */
export type QuarterlyPlannerResponse = QuarterlyPlan | PlannerReviewRequired;

function readNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return null;
  const parsed = typeof value === 'string' ? Number(value.replace(/[$,\s]/g, '')) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

/**
 * Collects the planner facts from saved records without guessing. Prior-year tax
 * and AGI come from the Tax Organizer prior-year step first, then the Deductions
 * prior-year section, then the profile; the 12-month answer and the declared filing
 * status are explicit records. Missing facts are listed with where to enter them.
 */
export function resolveQuarterlyPlannerFacts(sources: PlannerFactSources): PlannerFactResolution {
  const org = sources.organizer ?? {};
  const ded = sources.deductions ?? {};
  const profile = sources.profile ?? {};
  const missing: MissingFact[] = [];
  const notes: string[] = [];
  const assumptions: string[] = [];
  const year = sources.taxYear;

  const declaredStatus = [profile.filing_status, org.filingStatus].find(value => typeof value === 'string' && value.trim() !== '');
  if (declaredStatus === undefined) {
    missing.push({ key: 'filing_status', label: 'Filing status', detail: `Select your ${year} filing status; the 110% rule uses a $75,000 prior-year AGI threshold for married filing separately and $150,000 otherwise.`, enterAt: [PLANNER_FACT_SCREENS.profile, PLANNER_FACT_SCREENS.taxOrganizer] });
  } else if (typeof profile.filing_status === 'string' && profile.filing_status.trim() && typeof org.filingStatus === 'string' && org.filingStatus.trim()) {
    try {
      if (normalizeFilingStatus(profile.filing_status) !== normalizeFilingStatus(org.filingStatus)) assumptions.push('Profile and Tax Organizer list different filing statuses; the Profile status used by the annual estimate was applied.');
    } catch { /* The annual snapshot already rejected an unsupported status. */ }
  }

  if (!(sources.annual.totalIncome > 0)) {
    missing.push({ key: 'current_year_estimate', label: `${year} federal estimate`, detail: `No ${year} income records are saved yet, so there is no current-year tax estimate to compare against the 90% test. Add or sync income first.`, enterAt: [PLANNER_FACT_SCREENS.income] });
  }

  const twelveMonths = typeof org.priorReturnCoveredTwelveMonths === 'string' ? org.priorReturnCoveredTwelveMonths.trim().toLowerCase() : '';
  if (twelveMonths !== 'yes' && twelveMonths !== 'no') {
    missing.push({ key: 'prior_return_twelve_months', label: `${year - 1} return covered 12 months`, detail: `Answer whether your ${year - 1} federal return covered a full 12 months. The prior-year safe harbor is only available when it did.`, enterAt: [PLANNER_FACT_SCREENS.taxOrganizer] });
  }

  let priorYear: PriorYearFacts | null = null;
  if (twelveMonths === 'no') {
    priorYear = { available: false, reason: 'short_year_or_no_return' };
    assumptions.push(`You answered that the ${year - 1} return did not cover 12 months (or was not filed), so the prior-year safe harbor is unavailable and the 90% current-year target is used. If you had no ${year - 1} tax liability as a full-year U.S. citizen or resident with a 12-month tax year, Pub 505's no-tax-liability exception may mean no estimated payments are required; review before paying.`);
  } else {
    const organizerTax = readNumber(org.priorYearTax);
    const deductionsTax = readNumber(ded.priorYearTotalTax);
    const profileTax = readNumber(profile.prior_year_tax);
    const priorTax = organizerTax !== null && organizerTax >= 0 ? organizerTax
      : deductionsTax !== null && deductionsTax > 0 ? deductionsTax
      : profileTax !== null && profileTax > 0 ? profileTax : null;
    if (priorTax === null) {
      missing.push({ key: 'prior_year_total_tax', label: `${year - 1} total tax`, detail: `Enter the total tax from your ${year - 1} Form 1040 (line 24, less refundable credits per the 1040-ES instructions). Enter 0 if the return showed no tax.`, enterAt: [PLANNER_FACT_SCREENS.taxOrganizer, PLANNER_FACT_SCREENS.deductions] });
    } else if (organizerTax !== null && deductionsTax !== null && deductionsTax > 0 && toCents(organizerTax) !== toCents(deductionsTax)) {
      assumptions.push(`Tax Organizer (${money(organizerTax)}) and Deductions (${money(deductionsTax)}) list different ${year - 1} total tax amounts; the Tax Organizer value was used.`);
    }
    const organizerAgi = readNumber(org.priorYearAGI);
    // The Deductions API stores 0 for fields never entered, so only a positive value counts there.
    const deductionsAgiRaw = readNumber(ded.priorYearAGI);
    const deductionsAgi = deductionsAgiRaw !== null && deductionsAgiRaw > 0 ? deductionsAgiRaw : null;
    const priorAgi = organizerAgi ?? deductionsAgi;
    if (priorAgi === null) {
      missing.push({ key: 'prior_year_agi', label: `${year - 1} adjusted gross income`, detail: `Enter the adjusted gross income from your ${year - 1} Form 1040 (line 11). It decides whether the prior-year safe harbor is 100% or 110% of prior-year tax.`, enterAt: [PLANNER_FACT_SCREENS.taxOrganizer, PLANNER_FACT_SCREENS.deductions] });
    } else if (organizerAgi !== null && deductionsAgi !== null && toCents(organizerAgi) !== toCents(deductionsAgi)) {
      assumptions.push(`Tax Organizer (${money(organizerAgi)}) and Deductions (${money(deductionsAgi)}) list different ${year - 1} AGI amounts; the Tax Organizer value was used.`);
    }
    if (twelveMonths === 'yes' && priorTax !== null && priorAgi !== null) priorYear = { available: true, totalTax: priorTax, agi: priorAgi, coveredTwelveMonths: true };
  }

  if (missing.length || priorYear === null) {
    notes.push('Planning figures stay hidden until every listed fact is saved. Saved transactions alone do not establish an amount due.');
    return { status: 'review_required', missingFacts: missing, notes };
  }
  const currentYearTax = Math.max(0, Math.round((sources.annual.totalTax - Math.max(0, sources.annual.refundableCredits)) * 100) / 100);
  assumptions.unshift(`Current-year tax of ${money(currentYearTax)} is the federal estimate from your saved ${year} records (total tax ${money(sources.annual.totalTax)} less refundable credits ${money(Math.max(0, sources.annual.refundableCredits))}), treated as the full-year forecast. If your records cover only part of the year, the 90% target is understated; the prior-year target does not depend on it.`);
  return {
    status: 'ready',
    facts: { taxYear: year, filingStatus: sources.annual.filingStatus, currentYearTax, withholding: Math.max(0, sources.annual.totalFederalWithheld), priorYear, assumptions },
  };
}
