import { describe, expect, it } from 'vitest';
import { calcScheduleSE } from '@/lib/reports/calcSE';
import { priorYearSameTaxpayersAndFilingStatus } from '@/lib/tax-provider/prior-year-same-taxpayers';
import { calculateRegularEstimatedPayments } from '@/lib/tax-provider/regular-estimated-payments';
import { calculateRequiredAnnualPayment } from '@/lib/tax-provider/quarterly-planner';

const yearToDateTax = calcScheduleSE({ scheduleCNetProfit: 15000, taxYear: 2026 }, 'single').totalSETax;

describe('shared same taxpayers and filing status helper', () => {
  it('allows a yes answer and returns review for a no answer', () => {
    expect(priorYearSameTaxpayersAndFilingStatus(true)).toEqual({ allowed: true, review: false, message: '' });
    const declined = priorYearSameTaxpayersAndFilingStatus(false);
    expect(declined.allowed).toBe(false);
    expect(declined.review).toBe(true);
    expect(declined.message).toContain('PLACEHOLDER');
    expect(declined.message).toContain('adjusting');
    expect(declined.message).not.toContain('unavailable');
  });

  it('supplies the review message used by the regular method and the planner', () => {
    const message = priorYearSameTaxpayersAndFilingStatus(false).message;
    expect(() => calculateRegularEstimatedPayments({
      taxYear: 2026, filingStatus: 'single', expectedTaxAfterCredits: 20000, expectedAnnualWithholding: 0,
      reviewedTaxAmounts: true, regularMethodConfirmed: true,
      priorYear: { available: true, adjustedGrossIncome: 50000, taxAfterAdjustments: 10000, fullTwelveMonths: true, sameTaxpayersAndFilingStatus: false, fullYearUSResident: true },
    })).toThrow(message);
    expect(() => calculateRequiredAnnualPayment({
      taxYear: 2026, filingStatus: 'single', currentYearTax: yearToDateTax, withholding: 0,
      priorYear: { available: true, totalTax: 10000, agi: 50000, coveredTwelveMonths: true, sameTaxpayersAndFilingStatus: false },
    })).toThrow(message);
  });

  it('reviews a married filing separately return followed by a joint return', () => {
    const message = priorYearSameTaxpayersAndFilingStatus({
      priorYearFilingStatus: 'married_filing_separately', currentYearFilingStatus: 'married_filing_jointly',
    }).message;
    expect(priorYearSameTaxpayersAndFilingStatus({
      priorYearFilingStatus: 'married_filing_jointly', currentYearFilingStatus: 'single',
    }).review).toBe(true);
    expect(() => calculateRegularEstimatedPayments({
      taxYear: 2026, filingStatus: 'married_filing_jointly', expectedTaxAfterCredits: 20000, expectedAnnualWithholding: 0,
      reviewedTaxAmounts: true, regularMethodConfirmed: true,
      priorYear: {
        available: true, adjustedGrossIncome: 50000, taxAfterAdjustments: 10000, fullTwelveMonths: true,
        sameTaxpayersAndFilingStatus: true, fullYearUSResident: true, priorYearFilingStatus: 'married_filing_separately',
      },
    })).toThrow(message);
  });

  it('keeps the prior-year target when single changes to head of household', () => {
    expect(priorYearSameTaxpayersAndFilingStatus({
      priorYearFilingStatus: 'single', currentYearFilingStatus: 'head_of_household',
    })).toEqual({ allowed: true, review: false, message: '' });
    const result = calculateRegularEstimatedPayments({
      taxYear: 2026, filingStatus: 'head_of_household', expectedTaxAfterCredits: 20000, expectedAnnualWithholding: 0,
      reviewedTaxAmounts: true, regularMethodConfirmed: true,
      priorYear: {
        available: true, adjustedGrossIncome: 50000, taxAfterAdjustments: 10000, fullTwelveMonths: true,
        sameTaxpayersAndFilingStatus: true, fullYearUSResident: true, priorYearFilingStatus: 'single',
      },
    });
    expect(result.priorYearTarget).toBe(10000);
  });
});
