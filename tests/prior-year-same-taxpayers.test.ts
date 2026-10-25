import { describe, expect, it } from 'vitest';
import { priorYearSameTaxpayersAndFilingStatus } from '@/lib/tax-provider/prior-year-same-taxpayers';
import { calculateRegularEstimatedPayments } from '@/lib/tax-provider/regular-estimated-payments';
import { calculateRequiredAnnualPayment } from '@/lib/tax-provider/quarterly-planner';

describe('shared same taxpayers and filing status helper', () => {
  it('allows a yes answer and returns review for a no answer', () => {
    expect(priorYearSameTaxpayersAndFilingStatus(true)).toEqual({ allowed: true, review: false, message: '' });
    const declined = priorYearSameTaxpayersAndFilingStatus(false);
    expect(declined.allowed).toBe(false);
    expect(declined.review).toBe(true);
    expect(declined.message).toContain('same taxpayer');
  });

  it('supplies the review message used by the regular method and the planner', () => {
    const message = priorYearSameTaxpayersAndFilingStatus(false).message;
    expect(() => calculateRegularEstimatedPayments({
      taxYear: 2026, filingStatus: 'single', expectedTaxAfterCredits: 20000, expectedAnnualWithholding: 0,
      reviewedTaxAmounts: true, regularMethodConfirmed: true,
      priorYear: { available: true, adjustedGrossIncome: 50000, taxAfterAdjustments: 10000, fullTwelveMonths: true, sameTaxpayersAndFilingStatus: false, fullYearUSResident: true },
    })).toThrow(message);
    expect(() => calculateRequiredAnnualPayment({
      taxYear: 2026, filingStatus: 'single', currentYearTax: 2119.43, withholding: 0,
      priorYear: { available: true, totalTax: 10000, agi: 50000, coveredTwelveMonths: true, sameTaxpayersAndFilingStatus: false },
    })).toThrow(message);
  });
});
