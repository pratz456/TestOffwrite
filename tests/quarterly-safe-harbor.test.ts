import { describe, expect, it } from 'vitest';
import { calculateRegularEstimatedPayments, QuarterlyReviewRequiredError, type RegularEstimatedPaymentInput } from '../lib/tax-provider/regular-estimated-payments';
import { compute1040, type Form1040Input } from '../lib/tax-rules/compute-1040';
import { calcQuarterlyStatus } from '../lib/tax-rules/kpi-calculations';

const fixture = (): RegularEstimatedPaymentInput => ({ taxYear: 2026, filingStatus: 'single', expectedTaxAfterCredits: 20000, expectedAnnualWithholding: 0, reviewedTaxAmounts: true, regularMethodConfirmed: true, priorYear: { available: true, adjustedGrossIncome: 100000, taxAfterAdjustments: 10000, fullTwelveMonths: true, sameTaxpayersAndFilingStatus: true, fullYearUSResident: true } });
function prior(overrides: Record<string, unknown>) { const input = fixture(); return { ...input, priorYear: { ...input.priorYear, ...overrides } } as RegularEstimatedPaymentInput; }

describe('reviewed regular-method estimated payment target — IRS2026 Pub505', () => {
  it.each([['single', 150000, 10000], ['single', 150000.01, 11000], ['Married Filing Separately', 75000, 10000], ['married_filing_separately', 75000.01, 11000], ['married_filing_jointly', 150000, 10000], ['head_of_household', -1000, 10000]])('uses prior AGI with correct strict threshold for %s at%s', (filingStatus, agi, target) => {
    const result = calculateRegularEstimatedPayments({ ...prior({ adjustedGrossIncome: agi }), filingStatus });
    expect(result.priorYearTarget).toBe(target);
  });
  it('does not increase prior-year percentage because the current-year forecast is high', () => {
    expect(calculateRegularEstimatedPayments({ ...fixture(), expectedTaxAfterCredits: 100000 }).priorYearTarget).toBe(10000);
  });
  it('matches the IRS example before whole-dollar display rounding and selects the lower target', () => {
    const result = calculateRegularEstimatedPayments({ ...prior({ adjustedGrossIncome: 180000, taxAfterAdjustments: 42581 }), expectedTaxAfterCredits: 71253 });
    expect(result.currentYearTarget).toBe(64127.7); expect(result.priorYearTarget).toBe(46839.1); expect(result.annualRequiredPayment).toBe(46839.1);
    expect(result.installments.reduce((sum, item) => sum + Math.round(item.amount * 100), 0)).toBe(4683910);
  });
  it('uses90% of current tax and subtracts full-year withholding once', () => {
    const result = calculateRegularEstimatedPayments({ ...fixture(), expectedTaxAfterCredits: 8000, expectedAnnualWithholding: 2000 });
    expect(result.annualRequiredPayment).toBe(7200); expect(result.annualEstimatedPayments).toBe(5200); expect(result.installments.map(q => q.amount)).toEqual([1300, 1300, 1300, 1300]);
  });
  it.each([[999.99, 0], [1000, 900]])('applies the strict under$1000 test to%s', (tax, expected) => {
    expect(calculateRegularEstimatedPayments({ ...fixture(), expectedTaxAfterCredits: tax, priorYear: { available: false, noPriorTaxExceptionRuledOut: true } }).annualEstimatedPayments).toBe(expected);
  });
  it('does not treat an eligible zero prior-year tax as missing', () => {
    expect(calculateRegularEstimatedPayments(prior({ taxAfterAdjustments: 0 })).annualEstimatedPayments).toBe(0);
    expect(calculateRegularEstimatedPayments({ ...fixture(), priorYear: { available: false, noPriorTaxExceptionRuledOut: true } }).annualEstimatedPayments).toBe(18000);
  });
  it('does not treat an absent return as proof the no-prior-tax exception is unavailable', () => {
    expect(() => calculateRegularEstimatedPayments({ ...fixture(), priorYear: { available: false, noPriorTaxExceptionRuledOut: false } })).toThrow('no-prior-year-tax exception');
  });
  it('withholding covering the target leaves no original installment requirement', () => {
    expect(calculateRegularEstimatedPayments({ ...fixture(), expectedAnnualWithholding: 12000 }).annualEstimatedPayments).toBe(0);
  });
  it.each(['fullTwelveMonths', 'sameTaxpayersAndFilingStatus', 'fullYearUSResident'])('requires prior-year eligibility fact%s', fact => {
    expect(() => calculateRegularEstimatedPayments(prior({ [fact]: false }))).toThrow(QuarterlyReviewRequiredError);
  });
  it.each(['reviewedTaxAmounts', 'regularMethodConfirmed'])('does not assume missing%s', fact => {
    expect(() => calculateRegularEstimatedPayments({ ...fixture(), [fact]: false })).toThrow(QuarterlyReviewRequiredError);
  });
  it.each([undefined, NaN, Infinity, -1, '10000'])('rejects invalid full-year tax%s without calculating zero', value => {
    expect(() => calculateRegularEstimatedPayments({ ...fixture(), expectedTaxAfterCredits: value } as RegularEstimatedPaymentInput)).toThrow(QuarterlyReviewRequiredError);
  });
  it('rejects unpublished2027 and invalid filing status', () => {
    expect(() => calculateRegularEstimatedPayments({ ...fixture(), taxYear: 2027 })).toThrow();
    expect(() => calculateRegularEstimatedPayments({ ...fixture(), filingStatus: 'unknown' })).toThrow();
  });
  it('returns original2026 deadlines without a current-due or penalty verdict', () => {
    const result = calculateRegularEstimatedPayments(fixture());
    expect(result.installments.map(q => q.dueDate)).toEqual(['2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15']);
    expect(result).not.toHaveProperty('onTrack'); expect(result).not.toHaveProperty('amountDue'); expect(result.note).toContain('not a current balance');
  });
});

it('annual1040 with prior-year tax alone omits unsafe harbor/quarterly amounts', () => {
  const input: Form1040Input = { taxYear: 2026, filingStatus: 'single', scheduleCNetProfit: 0, w2Wages: 300000, w2MedicareWages: 300000, w2FederalWithheld: 0, estimatedPayments: 15000, selfEmploymentTax: 0, halfSEDeduction: 0, healthInsurancePremiums: 0, sepIraContribution: 0, solo401kContribution: 0, simpleIraContribution: 0, hsaContribution: 0, studentLoanInterest: 0 };
  const result = compute1040(input, 10000);
  expect(result.safeHarborAmount).toBeUndefined(); expect(result.quarterlyRecommended).toBeUndefined(); expect(result.calculationWarnings.some(note => note.includes('prior-year AGI'))).toBe(true);
  expect(calcQuarterlyStatus(20000, 15000, 10000)).toMatchObject({ status: 'review_required', onTrack: null, quarterAmount: null, safeHarborAmount: null });
});
