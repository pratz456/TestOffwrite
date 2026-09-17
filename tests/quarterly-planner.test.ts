import { describe, expect, it } from 'vitest';
import {
  ANNUALIZED_INCOME_METHOD_NOTE, allocateQuarterly, allocateWithholding, assignInstallmentPeriod, buildQuarterlyPlan,
  calculateNextDue, calculateRequiredAnnualPayment, computeInstallments, daysBetween, daysInYear, getInstallmentDueDates,
  getNextDueDate, getPenaltyRatePeriods, getStatutoryDueDate, getUnderpaymentRate, illustrateInterestForSegment, illustrateUnderpaymentInterest,
  isIsoDate, matchPaymentsToPeriods, penaltyPeriodEnd, resolveQuarterlyPlannerFacts, type PriorYearFacts, type RecordedEstimatedPayment,
} from '@/lib/tax-provider/quarterly-planner';
import { QuarterlyReviewRequiredError } from '@/lib/tax-provider/regular-estimated-payments';

const prior = (totalTax: number, agi: number): PriorYearFacts => ({ available: true, totalTax, agi, coveredTwelveMonths: true });
const noPrior: PriorYearFacts = { available: false, reason: 'short_year_or_no_return' };
const base = { taxYear: 2026, filingStatus: 'single', currentYearTax: 20000, withholding: 0, priorYear: prior(10000, 100000) };
const dated = (amount: number, paidDate: string, recordedQuarter: 1 | 2 | 3 | 4 = 1): RecordedEstimatedPayment => ({ amount, paidDate, recordedQuarter });
const dueDates = (year: number) => getInstallmentDueDates(year).map(item => item.dueDate);
const evenWithholding = (total: number, year = 2026) => allocateWithholding({ kind: 'even', total }, year);
const installmentsFor = (payments: RecordedEstimatedPayment[], asOf: string, required = 10000, withholding = 0, year = 2026) => computeInstallments({
  taxYear: year, requiredAnnualPayment: required, estimatedPaymentsRequired: Math.max(0, required - withholding),
  withholding: evenWithholding(withholding, year), payments: matchPaymentsToPeriods(payments, year), asOf,
});

describe('date helpers', () => {
  it('validates YYYY-MM-DD calendar dates only', () => {
    expect(isIsoDate('2026-04-15')).toBe(true); expect(isIsoDate('2026-02-30')).toBe(false); expect(isIsoDate('4/15/2026')).toBe(false); expect(isIsoDate(20260415)).toBe(false);
  });
  it('counts whole days and leap years the way Form 2210 does', () => {
    expect(daysBetween('2026-04-15', '2026-06-15')).toBe(61); expect(daysBetween('2025-04-15', '2026-04-15')).toBe(365);
    expect(daysInYear(2024)).toBe(366); expect(daysInYear(2025)).toBe(365); expect(daysInYear(2100)).toBe(365); expect(daysInYear(2000)).toBe(366);
  });
  it('splits cents into four installments with the remainder on the earliest quarters', () => {
    expect(allocateQuarterly(3)).toEqual([1, 1, 1, 0]); expect(allocateQuarterly(1000000)).toEqual([250000, 250000, 250000, 250000]); expect(allocateQuarterly(0)).toEqual([0, 0, 0, 0]);
  });
});

describe('installment due dates (Form 1040-ES: next business day for weekends and DC holidays)', () => {
  it('uses the standard dates for 2026 when none fall on a weekend', () => {
    expect(dueDates(2026)).toEqual(['2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15']);
  });
  it('moves the 2025 second installment from Sunday June 15 to Monday June 16', () => {
    expect(dueDates(2025)).toEqual(['2025-04-15', '2025-06-16', '2025-09-15', '2026-01-15']);
  });
  it('moves Saturday/Sunday dates in 2024 to the following Monday', () => {
    expect(dueDates(2024)).toEqual(['2024-04-15', '2024-06-17', '2024-09-16', '2025-01-15']);
  });
  it('moves a January 15 that lands on Martin Luther King Jr. Day (2023 return year) to January 16', () => {
    expect(dueDates(2023)[3]).toBe('2024-01-16');
  });
  it('ends the Form 2210 penalty period on April 15 of the following year', () => {
    expect(penaltyPeriodEnd(2026)).toBe('2027-04-15');
  });
});

describe('§6621 underpayment rates by calendar quarter', () => {
  it('returns 7% for every 2025 quarter', () => {
    expect(([1, 2, 3, 4] as const).map(quarter => getUnderpaymentRate(2025, quarter))).toEqual([0.07, 0.07, 0.07, 0.07]);
  });
  it('returns the published 2026 schedule including the 6% second quarter', () => {
    expect(([1, 2, 3, 4] as const).map(quarter => getUnderpaymentRate(2026, quarter))).toEqual([0.07, 0.06, 0.07, 0.07]);
  });
  it('returns null for the unpublished first quarter of 2027 rather than guessing', () => {
    expect(getUnderpaymentRate(2027, 1)).toBeNull(); expect(getUnderpaymentRate(2027, 2)).toBeNull();
  });
  it('builds the four Form 2210 rate periods on the worksheet computation dates and flags the unpublished one', () => {
    const periods = getPenaltyRatePeriods(2026);
    expect(periods.map(period => [period.start, period.end, period.rate])).toEqual([
      ['2026-04-15', '2026-06-30', 0.06], ['2026-06-30', '2026-09-30', 0.07], ['2026-09-30', '2026-12-31', 0.07], ['2026-12-31', '2027-04-15', null],
    ]);
    expect(getPenaltyRatePeriods(2025).every(period => period.rate === 0.07)).toBe(true);
  });
  it('reproduces Table 2 (chart of total days) of the 2025 Form 2210 instructions', () => {
    // https://www.irs.gov/pub/irs-pdf/i2210.pdf (2025), page 5, Table 2: 76 / 92 / 92 / 105 days for a column (a)
    // underpayment; 15 / 92 / 92 / 105 for column (b); 15 / 92 / 105 for column (c); 90 for column (d).
    const periods = getPenaltyRatePeriods(2025);
    const daysIn = (from: string) => periods.map(period => Math.max(0, daysBetween(from > period.start ? from : period.start, period.end)));
    expect(daysIn('2025-04-15')).toEqual([76, 92, 92, 105]);
    expect(daysIn('2025-06-15')).toEqual([15, 92, 92, 105]);
    expect(daysIn('2025-09-15')).toEqual([0, 15, 92, 105]);
    expect(daysIn('2026-01-15')).toEqual([0, 0, 0, 90]);
  });
});

describe('statutory versus shifted due dates', () => {
  it('keeps the §6654(c)(2) dates next to the shifted payment deadlines', () => {
    expect(getInstallmentDueDates(2024).map(item => [item.statutoryDueDate, item.dueDate])).toEqual([
      ['2024-04-15', '2024-04-15'], ['2024-06-15', '2024-06-17'], ['2024-09-15', '2024-09-16'], ['2025-01-15', '2025-01-15'],
    ]);
    expect(getStatutoryDueDate(2028, 1)).toBe('2028-04-15'); expect(getStatutoryDueDate(2028, 4)).toBe('2029-01-15');
  });
  it('moves the 2028 first installment past Saturday April 15 and observed Emancipation Day to Tuesday April 18 (leap year)', () => {
    expect(dueDates(2028)[0]).toBe('2028-04-18'); expect(daysInYear(2028)).toBe(366);
  });
});

describe('required annual payment (Form 2210 Part I / Pub 505 Worksheet 2-1)', () => {
  it('selects the lesser of 90% of current-year tax and 100% of prior-year tax', () => {
    const result = calculateRequiredAnnualPayment(base);
    expect(result.ninetyPercentOfCurrentYear).toBe(18000); expect(result.priorYear?.target).toBe(10000);
    expect(result.requiredAnnualPayment).toBe(10000); expect(result.basis).toBe('prior_year_100'); expect(result.estimatedPaymentsRequired).toBe(10000);
  });
  it('uses the 90% current-year target when it is lower', () => {
    const result = calculateRequiredAnnualPayment({ ...base, currentYearTax: 10000 });
    expect(result.requiredAnnualPayment).toBe(9000); expect(result.basis).toBe('current_year_90');
  });
  it('applies 110% only when prior-year AGI exceeds $150,000 (strictly greater)', () => {
    expect(calculateRequiredAnnualPayment({ ...base, priorYear: prior(10000, 150000) }).priorYear?.target).toBe(10000);
    const above = calculateRequiredAnnualPayment({ ...base, priorYear: prior(10000, 150000.01) });
    expect(above.priorYear?.target).toBe(11000); expect(above.priorYear?.multiplier).toBe(1.1); expect(above.basis).toBe('prior_year_110');
  });
  it('uses the $75,000 threshold when the current-year return is married filing separately', () => {
    expect(calculateRequiredAnnualPayment({ ...base, filingStatus: 'married_filing_separately', priorYear: prior(10000, 75000) }).priorYear?.target).toBe(10000);
    const mfs = calculateRequiredAnnualPayment({ ...base, filingStatus: 'married_filing_separately', priorYear: prior(10000, 75000.01) });
    expect(mfs.priorYear?.target).toBe(11000); expect(mfs.priorYear?.agiThreshold).toBe(75000);
    expect(calculateRequiredAnnualPayment({ ...base, filingStatus: 'single', priorYear: prior(10000, 100000) }).priorYear?.target).toBe(10000);
  });
  it('reproduces the IRS Pub 505 example: $71,253 forecast, $42,581 prior tax, $180,000 prior AGI', () => {
    const result = calculateRequiredAnnualPayment({ ...base, currentYearTax: 71253, priorYear: prior(42581, 180000) });
    expect(result.ninetyPercentOfCurrentYear).toBe(64127.7); expect(result.priorYear?.target).toBe(46839.1); expect(result.requiredAnnualPayment).toBe(46839.1); expect(result.basis).toBe('prior_year_110');
  });
  it('subtracts withholding from the required annual payment', () => {
    const result = calculateRequiredAnnualPayment({ ...base, currentYearTax: 8000, withholding: 2000 });
    expect(result.requiredAnnualPayment).toBe(7200); expect(result.estimatedPaymentsRequired).toBe(5200);
    expect(calculateRequiredAnnualPayment({ ...base, currentYearTax: 8000, withholding: 9000 }).estimatedPaymentsRequired).toBe(0);
  });
  it('applies the $1,000 de minimis rule strictly below $1,000 of tax less withholding', () => {
    const under = calculateRequiredAnnualPayment({ ...base, currentYearTax: 5999.99, withholding: 5000, priorYear: noPrior });
    expect(under.deMinimis).toEqual({ threshold: 1000, taxLessWithholding: 999.99, applies: true }); expect(under.estimatedPaymentsRequired).toBe(0);
    const at = calculateRequiredAnnualPayment({ ...base, currentYearTax: 6000, withholding: 5000, priorYear: noPrior });
    expect(at.deMinimis.applies).toBe(false); expect(at.estimatedPaymentsRequired).toBe(400);
  });
  it('uses only the current-year target when the prior return did not cover 12 months', () => {
    const result = calculateRequiredAnnualPayment({ ...base, priorYear: noPrior });
    expect(result.priorYear).toBeNull(); expect(result.requiredAnnualPayment).toBe(18000); expect(result.basis).toBe('current_year_90');
  });
  it('treats an explicit $0 prior-year tax with a 12-month return as a $0 prior target', () => {
    const result = calculateRequiredAnnualPayment({ ...base, priorYear: prior(0, 50000) });
    expect(result.priorYear?.target).toBe(0); expect(result.requiredAnnualPayment).toBe(0); expect(result.estimatedPaymentsRequired).toBe(0); expect(result.deMinimis.applies).toBe(false);
  });
  it('rounds the 110% target to cents', () => {
    expect(calculateRequiredAnnualPayment({ ...base, priorYear: prior(10000.01, 200000) }).priorYear?.target).toBe(11000.01);
  });
  it('requires explicit, valid facts instead of defaulting', () => {
    expect(() => calculateRequiredAnnualPayment({ ...base, priorYear: { available: true, totalTax: 10000, agi: 100000, coveredTwelveMonths: false } as unknown as PriorYearFacts })).toThrow(QuarterlyReviewRequiredError);
    expect(() => calculateRequiredAnnualPayment({ ...base, priorYear: undefined as unknown as PriorYearFacts })).toThrow('12 months');
    expect(() => calculateRequiredAnnualPayment({ ...base, currentYearTax: Number.NaN })).toThrow('current-year federal tax');
    expect(() => calculateRequiredAnnualPayment({ ...base, currentYearTax: -1 })).toThrow(QuarterlyReviewRequiredError);
    expect(() => calculateRequiredAnnualPayment({ ...base, priorYear: prior(Number.POSITIVE_INFINITY, 1) })).toThrow('prior-year total tax');
    expect(() => calculateRequiredAnnualPayment({ ...base, filingStatus: 'unknown' })).toThrow();
    expect(() => calculateRequiredAnnualPayment({ ...base, taxYear: 2027 })).toThrow();
  });
});

describe('withholding allocation (Form 2210 line 11)', () => {
  it('credits even withholding in four equal parts on the statutory due dates (§6654(g)(1))', () => {
    const result = evenWithholding(4000);
    expect(result.map(item => item.amount)).toEqual([1000, 1000, 1000, 1000]);
    expect(result[1].creditedOn).toEqual([{ date: '2026-06-15', amount: 1000 }]);
    expect(evenWithholding(0.03).map(item => item.amount)).toEqual([0.01, 0.01, 0.01, 0]); expect(evenWithholding(0)[0].creditedOn).toEqual([]);
    const shifted = evenWithholding(4000, 2025)[1];
    expect(shifted.dueDate).toBe('2025-06-16'); expect(shifted.creditedOn).toEqual([{ date: '2025-06-15', amount: 1000 }]);
  });
  it('credits dated withholding to the period in which it was withheld, on that date', () => {
    const result = allocateWithholding({ kind: 'dated', entries: [{ date: '2026-03-01', amount: 1000 }, { date: '2026-04-16', amount: 300 }, { date: '2026-07-04', amount: 500 }, { date: '2026-12-31', amount: 200 }, { date: '2026-02-01', amount: 0 }] }, 2026);
    expect(result.map(item => item.amount)).toEqual([1000, 300, 500, 200]);
    expect(result[0].creditedOn).toEqual([{ date: '2026-03-01', amount: 1000 }]); expect(result[1].creditedOn).toEqual([{ date: '2026-04-16', amount: 300 }]);
  });
  it('rejects invalid withholding amounts', () => {
    expect(() => allocateWithholding({ kind: 'even', total: -5 }, 2026)).toThrow(QuarterlyReviewRequiredError);
    expect(() => allocateWithholding({ kind: 'dated', entries: [{ date: 'soon', amount: 5 }] }, 2026)).toThrow(RangeError);
  });
});

describe('matching dated payments to installment periods', () => {
  it('assigns dates on or before each due date to that period, including shifted due dates', () => {
    expect(assignInstallmentPeriod('2026-01-02', 2026).quarter).toBe(1); expect(assignInstallmentPeriod('2026-04-15', 2026).quarter).toBe(1);
    expect(assignInstallmentPeriod('2026-04-16', 2026).quarter).toBe(2); expect(assignInstallmentPeriod('2026-06-15', 2026).quarter).toBe(2);
    expect(assignInstallmentPeriod('2026-06-16', 2026).quarter).toBe(3); expect(assignInstallmentPeriod('2026-09-15', 2026).quarter).toBe(3);
    expect(assignInstallmentPeriod('2026-09-16', 2026).quarter).toBe(4); expect(assignInstallmentPeriod('2027-01-15', 2026)).toEqual({ quarter: 4, afterFinalDueDate: false });
    expect(assignInstallmentPeriod('2027-01-16', 2026)).toEqual({ quarter: 4, afterFinalDueDate: true });
    expect(assignInstallmentPeriod('2025-06-16', 2025).quarter).toBe(2); expect(assignInstallmentPeriod('2025-06-17', 2025).quarter).toBe(3);
    expect(() => assignInstallmentPeriod('June 1', 2026)).toThrow(RangeError);
  });
  it('matches by payment date rather than the quarter a payment was saved under', () => {
    const matched = matchPaymentsToPeriods([dated(500, '2026-06-10', 1), dated(0, '2026-04-01', 1), { amount: 700, paidDate: null, recordedQuarter: 3 }, dated(200, '2026-02-01', 4)], 2026);
    expect(matched.map(item => [item.matchedQuarter, item.effectiveDate, item.dated])).toEqual([[1, '2026-02-01', true], [2, '2026-06-10', true], [3, '2026-09-15', false]]);
    expect(matched[2].paidDate).toBeNull();
  });
  it('rejects invalid recorded amounts', () => {
    expect(() => matchPaymentsToPeriods([dated(-5, '2026-04-01')], 2026)).toThrow(QuarterlyReviewRequiredError);
  });
});

describe('regular-method installments (Form 2210 Part III)', () => {
  it('splits the required annual payment 25% per due date less withholding credited', () => {
    const installments = installmentsFor([], '2026-01-01', 7200, 2000);
    expect(installments.map(item => item.requiredInstallment)).toEqual([1800, 1800, 1800, 1800]);
    expect(installments.map(item => item.withholdingCredited)).toEqual([500, 500, 500, 500]);
    expect(installments.map(item => item.plannedEstimatedPayment)).toEqual([1300, 1300, 1300, 1300]);
    expect(installments.every(item => item.status === 'upcoming')).toBe(true);
  });
  it('carries underpayments forward column by column', () => {
    const installments = installmentsFor([dated(1500, '2026-04-10', 1), dated(2500, '2026-06-10', 2)], '2026-09-17');
    expect(installments.map(item => item.underpayment)).toEqual([1000, 1000, 2500, 2500]);
    expect(installments.map(item => item.paymentsMatchedTotal)).toEqual([1500, 2500, 0, 0]);
    expect(installments.map(item => item.status)).toEqual(['payment_recorded', 'payment_recorded', 'no_payment_recorded', 'upcoming']);
  });
  it('carries overpayments to the next column', () => {
    const installments = installmentsFor([dated(3000, '2026-04-01', 1), dated(2500, '2026-06-01', 2)], '2026-09-15');
    expect(installments[0].overpaymentCarriedOut).toBe(500); expect(installments[1].overpaymentCarriedIn).toBe(500); expect(installments[1].underpayment).toBe(0);
    expect(installments[2].overpaymentCarriedIn).toBe(500); expect(installments[2].underpayment).toBe(2000); expect(installments[2].status).toBe('upcoming');
  });
  it('shows zero required installments when no estimated payments are required', () => {
    const installments = computeInstallments({ taxYear: 2026, requiredAnnualPayment: 9000, estimatedPaymentsRequired: 0, withholding: evenWithholding(9000), payments: [], asOf: '2026-05-01' });
    expect(installments.every(item => item.requiredInstallment === 0 && item.underpayment === 0 && item.plannedEstimatedPayment === 0)).toBe(true);
  });
});

describe('underpayment interest illustration (Form 2210 Penalty Worksheet)', () => {
  it('computes interest for a segment inside a 7% 2025 period', () => {
    expect(illustrateInterestForSegment(100000, '2025-04-15', '2025-06-16', 2025)).toEqual({ interest: 11.89, unpublishedRatePeriods: [] });
  });
  it('uses the 6% rate for the second quarter of 2026', () => {
    expect(illustrateInterestForSegment(100000, '2026-04-15', '2026-06-15', 2026)).toEqual({ interest: 10.03, unpublishedRatePeriods: [] });
  });
  it('splits a segment across rate periods the way Table 2 does (15 days at 6% through June 30, 77 days at 7%)', () => {
    // $1,000 × 15/365 × 6% = $2.47 plus $1,000 × 77/365 × 7% = $14.77 → $17.24 when each worksheet line is rounded separately.
    expect(illustrateInterestForSegment(100000, '2026-06-15', '2026-09-15', 2026)).toEqual({ interest: 17.24, unpublishedRatePeriods: [] });
  });
  it('rounds each rate-period line to cents before adding, and uses 366 days in a leap year (2024 instructions, Example 5)', () => {
    // https://www.irs.gov/pub/irs-prior/i2210--2024.pdf, Example 5: $2,000 × (15 ÷ 366) × 0.08 = $6.56 and $2,000 × (61 ÷ 366) × 0.08 = $26.67.
    expect(illustrateInterestForSegment(200000, '2024-04-15', '2024-04-30', 2024).interest).toBe(6.56);
    expect(illustrateInterestForSegment(200000, '2024-04-15', '2024-06-15', 2024).interest).toBe(26.67);
    // Column (c) of the same example: 15 days in 2024 Q3, 92 days in 2024 Q4 (÷366), 15 days in 2025 Q1 (÷365) = $9.84 + $60.33 + $8.63.
    expect(illustrateInterestForSegment(300000, '2024-09-15', '2025-01-15', 2024).interest).toBe(78.80);
  });
  it('returns null when any day falls in an unpublished rate period', () => {
    expect(illustrateInterestForSegment(100000, '2027-01-15', '2027-04-15', 2026)).toEqual({ interest: null, unpublishedRatePeriods: ['2027-Q1'] });
    expect(illustrateInterestForSegment(100000, '2026-12-01', '2027-02-01', 2026)).toEqual({ interest: null, unpublishedRatePeriods: ['2027-Q1'] });
  });
  it('returns zero for empty or reversed segments', () => {
    expect(illustrateInterestForSegment(100000, '2026-06-15', '2026-06-15', 2026).interest).toBe(0); expect(illustrateInterestForSegment(0, '2026-04-15', '2026-06-15', 2026).interest).toBe(0);
  });
  it('accrues a full year at 7% on an unpaid 2025 first installment through April 15, 2026, from the statutory dates', () => {
    const installments = installmentsFor([], '2026-04-15', 10000, 0, 2025);
    const result = illustrateUnderpaymentInterest({ taxYear: 2025, installments, withholding: evenWithholding(0, 2025), payments: [], asOf: '2026-04-15', deMinimisApplies: false });
    // Q2 runs 304 days from June 15, 2025 (the Form 2210 computation starting date), not 303 from the shifted June 16 deadline:
    // $2,500 × 7% × (15 + 92 + 92)/365 + $2,500 × 7% × 105/365 = $95.41 + $50.34 = $145.75.
    expect(result.byInstallment.map(item => item.interest)).toEqual([175, 145.75, 101.64, 43.15]); expect(result.total).toBe(465.54);
    expect(result.byInstallment[0].segments[0]).toMatchObject({ amount: 2500, from: '2025-04-15', to: '2026-04-15', days: 365, stillUnpaid: true });
    expect(result.byInstallment[1].segments[0]).toMatchObject({ from: '2025-06-15', days: 304 });
    expect(result.unpublishedRatePeriods).toEqual([]); expect(result.label).toContain('illustration'); expect(result.label).toContain('not a penalty determination');
  });
  it('treats a payment made by the shifted deadline as timely and runs a later payment from the statutory date', () => {
    const plan = (paidDate: string) => {
      const payments = matchPaymentsToPeriods([dated(2500, '2025-04-15', 1), dated(2500, paidDate, 2)], 2025);
      const installments = computeInstallments({ taxYear: 2025, requiredAnnualPayment: 10000, estimatedPaymentsRequired: 10000, withholding: evenWithholding(0, 2025), payments, asOf: '2025-07-01' });
      return illustrateUnderpaymentInterest({ taxYear: 2025, installments, withholding: evenWithholding(0, 2025), payments, asOf: '2025-07-01', deMinimisApplies: false }).byInstallment[1];
    };
    expect(plan('2025-06-16')).toMatchObject({ interest: 0, segments: [] });
    // Paid June 17: two days late counted from June 15 → $2,500 × 7% × 2/365 = $0.96.
    expect(plan('2025-06-17')).toMatchObject({ interest: 0.96 }); expect(plan('2025-06-17').segments[0]).toMatchObject({ from: '2025-06-15', to: '2025-06-17', days: 2 });
  });
  it('reproduces Examples 3 and 5 of the 2024 Form 2210 instructions column by column', () => {
    // https://www.irs.gov/pub/irs-prior/i2210--2024.pdf, pages 6–7. Required installments $4,000; payments 04/30 $2,000,
    // 06/15 $3,000, 09/15 $4,000, 01/15/25 $4,000. Column (a): $6.56 + $26.67. Column (b): $3,000 for 15 days (÷366, 8%) and
    // 77 days = $9.84 + $50.49. Column (c): 15 + 92 days at 8%/366 then 15 days at 7%/365 = $9.84 + $60.33 + $8.63.
    // Column (d): $3,000 × 90/365 × 7% = $51.78 through April 15, 2025.
    const payments = matchPaymentsToPeriods([dated(2000, '2024-04-30', 1), dated(3000, '2024-06-15', 2), dated(4000, '2024-09-15', 3), dated(4000, '2025-01-15', 4)], 2024);
    const installments = computeInstallments({ taxYear: 2024, requiredAnnualPayment: 16000, estimatedPaymentsRequired: 16000, withholding: evenWithholding(0, 2024), payments, asOf: '2025-04-15' });
    expect(installments.map(item => item.underpayment)).toEqual([4000, 3000, 3000, 3000]);
    const result = illustrateUnderpaymentInterest({ taxYear: 2024, installments, withholding: evenWithholding(0, 2024), payments, asOf: '2025-04-15', deMinimisApplies: false });
    expect(result.byInstallment[0].segments.map(segment => [segment.days, segment.interest])).toEqual([[15, 6.56], [61, 26.67]]);
    expect(result.byInstallment.map(item => item.interest)).toEqual([33.23, 60.33, 78.80, 51.78]);
    expect(result.total).toBe(224.14);
  });
  it('charges 30 days at 6% on a first installment paid May 15, 2026 and nothing on later installments not yet due', () => {
    const payments = matchPaymentsToPeriods([dated(2500, '2026-05-15', 1)], 2026);
    const installments = computeInstallments({ taxYear: 2026, requiredAnnualPayment: 10000, estimatedPaymentsRequired: 10000, withholding: evenWithholding(0), payments, asOf: '2026-06-15' });
    const result = illustrateUnderpaymentInterest({ taxYear: 2026, installments, withholding: evenWithholding(0), payments, asOf: '2026-06-15', deMinimisApplies: false });
    expect(result.byInstallment[0]).toMatchObject({ unpaidAsOf: 0, interest: 12.33 }); expect(result.byInstallment[0].segments[0]).toMatchObject({ days: 30, stillUnpaid: false });
    expect(result.byInstallment.slice(1).every(item => item.interest === 0 && item.segments.length === 0)).toBe(true); expect(result.total).toBe(12.33);
  });
  it('illustrates $0 when every installment is paid by its due date', () => {
    const payments = matchPaymentsToPeriods(dueDates(2026).map((date, index) => dated(2500, date, (index + 1) as 1 | 2 | 3 | 4)), 2026);
    const installments = computeInstallments({ taxYear: 2026, requiredAnnualPayment: 10000, estimatedPaymentsRequired: 10000, withholding: evenWithholding(0), payments, asOf: '2027-04-15' });
    const result = illustrateUnderpaymentInterest({ taxYear: 2026, installments, withholding: evenWithholding(0), payments, asOf: '2027-04-15', deMinimisApplies: false });
    expect(result.total).toBe(0); expect(result.byInstallment.every(item => item.unpaidAsOf === 0)).toBe(true);
  });
  it('treats even withholding as paid on the due dates so it never accrues interest', () => {
    const installments = installmentsFor([], '2026-09-17', 10000, 10000);
    const result = illustrateUnderpaymentInterest({ taxYear: 2026, installments, withholding: evenWithholding(10000), payments: [], asOf: '2026-09-17', deMinimisApplies: false });
    expect(result.total).toBe(0);
  });
  it('returns null totals and says so when the 2027 first-quarter rate is unpublished', () => {
    const installments = installmentsFor([], '2027-02-01');
    const result = illustrateUnderpaymentInterest({ taxYear: 2026, installments, withholding: evenWithholding(0), payments: [], asOf: '2027-02-01', deMinimisApplies: false });
    expect(result.total).toBeNull(); expect(result.unpublishedRatePeriods).toEqual(['2027-Q1']); expect(result.byInstallment[3].interest).toBeNull();
    expect(result.notes.join(' ')).toContain('has not published'); expect(result.notes.join(' ')).toContain('2027-Q1');
  });
  it('stops at April 15 of the following year and explains the de minimis result', () => {
    const installments = computeInstallments({ taxYear: 2025, requiredAnnualPayment: 900, estimatedPaymentsRequired: 0, withholding: evenWithholding(0, 2025), payments: [], asOf: '2026-09-17' });
    const result = illustrateUnderpaymentInterest({ taxYear: 2025, installments, withholding: evenWithholding(0, 2025), payments: [], asOf: '2026-09-17', deMinimisApplies: true });
    expect(result.total).toBe(0); expect(result.penaltyPeriodEnd).toBe('2026-04-15');
    expect(result.notes.join(' ')).toContain('§6654(e)(1)'); expect(result.notes.join(' ')).toContain('through 2026-04-15');
  });
});

describe('next due date and amount', () => {
  it('treats the due date itself as still upcoming and returns null after the final date', () => {
    expect(getNextDueDate(2026, '2026-09-15')?.quarter).toBe(3); expect(getNextDueDate(2026, '2026-09-16')?.quarter).toBe(4);
    expect(getNextDueDate(2026, '2027-01-15')?.dueDate).toBe('2027-01-15'); expect(getNextDueDate(2026, '2027-01-16')).toBeNull();
    expect(() => getNextDueDate(2026, 'today')).toThrow(RangeError);
  });
  it('includes earlier unpaid installments in the amount to pay by the next date', () => {
    const result = calculateNextDue(installmentsFor([], '2026-09-01'), 2026, '2026-09-01');
    expect(result).toEqual({ quarter: 3, dueDate: '2026-09-15', amountToPay: 7500, includesEarlierShortfall: true, installmentOnly: 2500 });
  });
  it('nets recorded payments and withholding against the cumulative requirement', () => {
    const paid = calculateNextDue(installmentsFor([dated(2500, '2026-04-15', 1), dated(2500, '2026-06-15', 2)], '2026-09-01'), 2026, '2026-09-01');
    expect(paid).toMatchObject({ amountToPay: 2500, includesEarlierShortfall: false });
    const withheld = calculateNextDue(installmentsFor([], '2026-03-01', 10000, 4000), 2026, '2026-03-01');
    expect(withheld).toMatchObject({ quarter: 1, amountToPay: 1500, installmentOnly: 1500 });
    expect(calculateNextDue(installmentsFor([dated(9000, '2026-02-01', 1)], '2026-03-01'), 2026, '2026-03-01')?.amountToPay).toBe(0);
    expect(calculateNextDue(installmentsFor([], '2027-02-01'), 2026, '2027-02-01')).toBeNull();
  });
});

describe('whole plan', () => {
  const planInput = { ...base, currentYearTax: 8000, withholding: 2000, payments: [dated(1300, '2026-04-10', 1)], asOf: '2026-09-17' };
  it('builds installments, next due amount, illustration and assumptions from reviewed facts', () => {
    const plan = buildQuarterlyPlan(planInput);
    expect(plan.status).toBe('ready'); expect(plan.requiredAnnualPayment.requiredAnnualPayment).toBe(7200); expect(plan.requiredAnnualPayment.basis).toBe('current_year_90');
    expect(plan.installments.map(item => item.plannedEstimatedPayment)).toEqual([1300, 1300, 1300, 1300]);
    expect(plan.nextDue).toEqual({ quarter: 4, dueDate: '2027-01-15', amountToPay: 3900, includesEarlierShortfall: true, installmentOnly: 1300 });
    expect(plan.totals).toEqual({ requiredInstallments: 7200, withholdingCredited: 2000, recordedPayments: 1300, remainingEstimatedPayments: 3900 });
    expect(plan.afterFinalDueDate).toBeNull(); expect(plan.annualizedIncomeMethod).toEqual({ available: false, note: ANNUALIZED_INCOME_METHOD_NOTE });
    expect(plan.assumptions.join(' ')).toContain('basis selected: 90% of the current-year federal estimate'); expect(plan.assumptions.join(' ')).toContain('Federal only');
    expect(plan.sources.form2210Instructions).toContain('irs.gov'); expect(plan.underpaymentInterestIllustration.total).toBeGreaterThan(0);
  });
  it('never derives installments from year-to-date figures times four', () => {
    const plan = buildQuarterlyPlan({ ...planInput, currentYearTax: 12000, withholding: 0, payments: [] });
    expect(plan.installments.map(item => item.requiredInstallment)).toEqual([2500, 2500, 2500, 2500]); expect(JSON.stringify(plan)).not.toContain('3000');
  });
  it('reports the remaining shortfall once every due date has passed', () => {
    const plan = buildQuarterlyPlan({ ...planInput, asOf: '2027-02-01' });
    expect(plan.nextDue).toBeNull(); expect(plan.afterFinalDueDate).toEqual({ returnDueDate: '2027-04-15', remainingShortfall: 3900 });
    expect(plan.underpaymentInterestIllustration.total).toBeNull();
  });
  it('explains undated and late payments and dated withholding in the assumptions', () => {
    const plan = buildQuarterlyPlan({ ...planInput, payments: [{ amount: 500, paidDate: null, recordedQuarter: 2 }, dated(100, '2027-01-20', 4)], withholdingSchedule: { kind: 'dated', entries: [{ date: '2026-02-01', amount: 2000 }] }, assumptions: ['Caller note.'] });
    const text = plan.assumptions.join(' ');
    expect(text).toContain('no payment date'); expect(text).toContain('after the final installment date'); expect(text).toContain('by the period in which it was withheld'); expect(text).toContain('Caller note.');
    expect(plan.installments[0].withholdingCredited).toBe(2000); expect(plan.installments[1].withholdingCredited).toBe(0);
  });
  it('rejects an invalid planning date and propagates review errors', () => {
    expect(() => buildQuarterlyPlan({ ...planInput, asOf: '2026-9-17' })).toThrow(RangeError);
    expect(() => buildQuarterlyPlan({ ...planInput, priorYear: undefined as unknown as PriorYearFacts })).toThrow(QuarterlyReviewRequiredError);
  });
});

describe('fact resolution from saved records', () => {
  const annual = { filingStatus: 'single', totalTax: 20000, refundableCredits: 0, totalFederalWithheld: 1500, totalIncome: 100000 };
  const organizer = { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '10000', priorYearAGI: '100000' };
  it('lists every missing fact with where to enter it instead of guessing', () => {
    const result = resolveQuarterlyPlannerFacts({ taxYear: 2026, annual: { ...annual, totalIncome: 0 }, profile: {}, organizer: {}, deductions: null });
    expect(result.status).toBe('review_required');
    if (result.status !== 'review_required') throw new Error('expected review');
    expect(result.missingFacts.map(fact => fact.key)).toEqual(['filing_status', 'current_year_estimate', 'prior_return_twelve_months', 'prior_year_total_tax', 'prior_year_agi']);
    expect(result.missingFacts.find(fact => fact.key === 'prior_year_agi')?.enterAt.map(item => item.href)).toEqual(['/protected?screen=tax-organizer', '/protected?screen=deductions-entry']);
    expect(result.notes.join(' ')).toContain('Saved transactions alone do not establish an amount due');
  });
  it('resolves complete facts from the Tax Organizer and the annual snapshot', () => {
    const result = resolveQuarterlyPlannerFacts({ taxYear: 2026, annual: { ...annual, refundableCredits: 500 }, profile: { filing_status: 'Single' }, organizer, deductions: {} });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.facts).toMatchObject({ taxYear: 2026, filingStatus: 'single', currentYearTax: 19500, withholding: 1500, priorYear: { available: true, totalTax: 10000, agi: 100000, coveredTwelveMonths: true } });
    expect(result.facts.assumptions[0]).toContain('$19,500.00');
  });
  it('accepts prior-year facts from the Deductions screen and formatted strings', () => {
    const result = resolveQuarterlyPlannerFacts({ taxYear: 2026, annual, profile: { filing_status: 'Single' }, organizer: { priorReturnCoveredTwelveMonths: 'yes', priorYearAGI: '$90,000' }, deductions: { priorYearTotalTax: 8000 } });
    expect(result.status).toBe('ready'); if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.facts.priorYear).toEqual({ available: true, totalTax: 8000, agi: 90000, coveredTwelveMonths: true });
  });
  it('treats the Deductions API default of 0 as not entered while honoring an explicit organizer 0', () => {
    const blank = resolveQuarterlyPlannerFacts({ taxYear: 2026, annual, profile: { filing_status: 'Single' }, organizer: { priorReturnCoveredTwelveMonths: 'yes' }, deductions: { priorYearTotalTax: 0, priorYearAGI: 0 } });
    expect(blank.status).toBe('review_required'); if (blank.status !== 'review_required') throw new Error('expected review');
    expect(blank.missingFacts.map(fact => fact.key)).toEqual(['prior_year_total_tax', 'prior_year_agi']);
    const explicit = resolveQuarterlyPlannerFacts({ taxYear: 2026, annual, profile: { filing_status: 'Single' }, organizer: { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '0', priorYearAGI: '0' }, deductions: { priorYearTotalTax: 0, priorYearAGI: 0 } });
    expect(explicit.status).toBe('ready'); if (explicit.status !== 'ready') throw new Error('expected ready');
    expect(explicit.facts.priorYear).toEqual({ available: true, totalTax: 0, agi: 0, coveredTwelveMonths: true });
  });
  it('prefers the Tax Organizer value and records a conflict with Deductions as an assumption', () => {
    const result = resolveQuarterlyPlannerFacts({ taxYear: 2026, annual, profile: { filing_status: 'Single' }, organizer, deductions: { priorYearTotalTax: 12000, priorYearAGI: 100000 } });
    expect(result.status).toBe('ready'); if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.facts.priorYear).toMatchObject({ totalTax: 10000 }); expect(result.facts.assumptions.join(' ')).toContain('Tax Organizer ($10,000.00) and Deductions ($12,000.00)');
  });
  it('treats a short prior year as prior-year method unavailable while still ready', () => {
    const result = resolveQuarterlyPlannerFacts({ taxYear: 2026, annual, profile: { filing_status: 'Single' }, organizer: { priorReturnCoveredTwelveMonths: 'no' }, deductions: {} });
    expect(result.status).toBe('ready'); if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.facts.priorYear).toEqual({ available: false, reason: 'short_year_or_no_return' }); expect(result.facts.assumptions.join(' ')).toContain('did not cover 12 months');
  });
  it('still requires prior-year tax and AGI when only the 12-month answer is saved', () => {
    const result = resolveQuarterlyPlannerFacts({ taxYear: 2026, annual, profile: { filing_status: 'Single' }, organizer: { priorReturnCoveredTwelveMonths: 'yes' }, deductions: {} });
    expect(result.status).toBe('review_required'); if (result.status !== 'review_required') throw new Error('expected review');
    expect(result.missingFacts.map(fact => fact.key)).toEqual(['prior_year_total_tax', 'prior_year_agi']);
  });
  it('flags a filing-status mismatch between Profile and Tax Organizer as an assumption', () => {
    const result = resolveQuarterlyPlannerFacts({ taxYear: 2026, annual, profile: { filing_status: 'Single' }, organizer: { ...organizer, filingStatus: 'married_filing_jointly' }, deductions: {} });
    expect(result.status).toBe('ready'); if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.facts.assumptions.join(' ')).toContain('different filing statuses');
  });
});
