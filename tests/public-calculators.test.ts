import { describe, expect, it } from 'vitest';
import { TaxCalculationScopeReviewRequiredError } from '../lib/tax-rules/calculation-scope';
import { QBIReviewRequiredError } from '../lib/tax-rules/qbi';
import {
  additionalMedicareThreshold,
  estimate1099FederalTax,
  estimatedTaxDueDates,
  isPublicCalculatorTaxYear,
  PUBLIC_CALCULATOR_TAX_YEARS,
  socialSecurityWageBase,
  standardDeduction,
} from '../lib/tax-rules/public-calculators';

const round2 = (value: number) => Math.round(value * 100) / 100;

describe('public calculator parameters by tax year', () => {
  it('exposes only years with a complete published parameter set', () => {
    expect(PUBLIC_CALCULATOR_TAX_YEARS).toEqual([2025, 2026]);
    expect(isPublicCalculatorTaxYear(2027)).toBe(false);
    expect(isPublicCalculatorTaxYear('2026')).toBe(false);
  });

  it.each([
    [2025, 176100, 15750, 31500, 15750, 23625],
    [2026, 184500, 16100, 32200, 16100, 24150],
  ] as const)('%s uses the SSA wage base and OBBBA/Rev. Proc. standard deductions', (year, wageBase, single, joint, separate, head) => {
    expect(socialSecurityWageBase(year)).toBe(wageBase);
    expect(standardDeduction(year, 'single')).toBe(single);
    expect(standardDeduction(year, 'married_filing_jointly')).toBe(joint);
    expect(standardDeduction(year, 'married_filing_separately')).toBe(separate);
    expect(standardDeduction(year, 'head_of_household')).toBe(head);
  });

  it('uses the statutory, non-indexed Additional Medicare thresholds', () => {
    expect(additionalMedicareThreshold('single')).toBe(200000);
    expect(additionalMedicareThreshold('head_of_household')).toBe(200000);
    expect(additionalMedicareThreshold('married_filing_jointly')).toBe(250000);
    expect(additionalMedicareThreshold('married')).toBe(250000);
    expect(additionalMedicareThreshold('married_filing_separately')).toBe(125000);
  });
});

describe('estimate1099FederalTax', () => {
  it('applies 92.35% × 15.3% below the wage base and deducts half of SE tax', () => {
    const result = estimate1099FederalTax({ grossIncome: 100000, expenses: 20000, w2Wages: 0, filingStatus: 'single', taxYear: 2026 });
    expect(result.netProfit).toBe(80000);
    expect(result.seTax).toBe(round2(80000 * 0.9235 * 0.153));
    expect(result.halfSEDeduction).toBe(round2(result.seTax / 2));
    expect(result.agi).toBe(80000 - result.halfSEDeduction);
    expect(result.standardDeduction).toBe(16100);
    expect(result.additionalMedicareTax).toBe(0);
    expect(result.qbiAboveThreshold).toBe(false);
    expect(result.qbiDeduction).toBe(Math.min((80000 - result.halfSEDeduction) * 0.2, (result.agi - 16100) * 0.2));
    expect(result.totalTax).toBe(result.incomeTax + result.seTax);
    expect(result.quarterOfTotalTax).toBe(result.totalTax / 4);
  });

  it.each([
    [2025, 176100],
    [2026, 184500],
  ] as const)('%s caps the 12.4% Social Security part at the wage base while 2.9% Medicare is uncapped', (year, wageBase) => {
    // Joint, business-only income stays below the QBI review threshold while crossing the SS ceiling.
    const result = estimate1099FederalTax({ grossIncome: 300000, expenses: 0, w2Wages: 0, filingStatus: 'married_filing_jointly', taxYear: year });
    const seBase = 300000 * 0.9235;
    expect(result.seBreakdown.socialSecurityTax).toBe(round2(wageBase * 0.124));
    expect(result.seBreakdown.medicareTax).toBe(round2(seBase * 0.029));
    expect(result.additionalMedicareTax).toBe(round2((seBase - 250000) * 0.009));
    expect(result.qbiAboveThreshold).toBe(false);
    expect(result.qbiDeduction).toBeGreaterThan(0);
  });

  it('requires Boxes 3 and 5 before combining W-2 and business income', () => {
    expect(() => estimate1099FederalTax({
      grossIncome: 50000, expenses: 0, w2Wages: 150000,
      filingStatus: 'married_filing_separately', taxYear: 2026,
    })).toThrow(TaxCalculationScopeReviewRequiredError);
    const result = estimate1099FederalTax({
      grossIncome: 50000, expenses: 0, w2Wages: 150000,
      w2SocialSecurityWages: 150000, w2MedicareWages: 150000,
      filingStatus: 'married_filing_separately', taxYear: 2026,
    });
    const seBase = 50000 * 0.9235;
    expect(result.seBreakdown.socialSecurityTax).toBe(round2((184500 - 150000) * 0.124));
    expect(result.additionalMedicareTax).toBe(round2(seBase * 0.009) + (150000 - 125000) * 0.009);
  });

  it('owes no SE tax below the $400 net-earnings threshold and never returns negative figures', () => {
    const result = estimate1099FederalTax({ grossIncome: 500, expenses: 200, w2Wages: 0, filingStatus: 'single', taxYear: 2025 });
    expect(result.seTax).toBe(0);
    expect(result.taxableIncome).toBe(0);
    expect(result.incomeTax).toBe(0);
    expect(result.effectiveRate).toBe(0);
    expect(() => estimate1099FederalTax({
      grossIncome: 1000, expenses: 5000, w2Wages: 0,
      filingStatus: 'single', taxYear: 2025,
    })).toThrow(TaxCalculationScopeReviewRequiredError);
  });

  it('changes brackets and deductions when the tax year changes', () => {
    const input = { grossIncome: 90000, expenses: 0, w2Wages: 0, filingStatus: 'head_of_household' };
    const y2025 = estimate1099FederalTax({ ...input, taxYear: 2025 });
    const y2026 = estimate1099FederalTax({ ...input, taxYear: 2026 });
    expect(y2025.standardDeduction).toBe(23625);
    expect(y2026.standardDeduction).toBe(24150);
    expect(y2026.incomeTax).toBeLessThan(y2025.incomeTax);
    expect(y2026.seTax).toBe(y2025.seTax);
  });

  it.each([2025, 2026] as const)('withholds %s above-threshold QBI instead of inventing a zero deduction', taxYear => {
    expect(() => estimate1099FederalTax({ grossIncome: 300000, expenses: 0, w2Wages: 0, filingStatus: 'single', taxYear }))
      .toThrow(QBIReviewRequiredError);
    // Wage-only income does not require nonexistent business QBI facts.
    expect(estimate1099FederalTax({
      grossIncome: 0, expenses: 0, w2Wages: 300000,
      w2SocialSecurityWages: 184500, w2MedicareWages: 300000,
      filingStatus: 'single', taxYear,
    }).qbiDeduction).toBe(0);
  });

  it('requires owner-specific wages for a joint mixed-wage/business estimate', () => {
    expect(() => estimate1099FederalTax({
      grossIncome: 50000, expenses: 0, w2Wages: 100000,
      w2SocialSecurityWages: 100000, w2MedicareWages: 100000,
      filingStatus: 'married_filing_jointly', taxYear: 2026,
    }))
      .toThrow(TaxCalculationScopeReviewRequiredError);
    expect(estimate1099FederalTax({
      grossIncome: 0, expenses: 0, w2Wages: 100000,
      w2SocialSecurityWages: 100000, w2MedicareWages: 100000,
      filingStatus: 'married_filing_jointly', taxYear: 2026,
    }).seTax).toBe(0);
  });

  it('withholds affected 2026 minimum-QBI cases without applying that new rule to 2025', () => {
    const input = { grossIncome: 2000, expenses: 0, w2Wages: 0, filingStatus: 'single' };
    expect(() => estimate1099FederalTax({ ...input, taxYear: 2026 })).toThrow(TaxCalculationScopeReviewRequiredError);
    expect(estimate1099FederalTax({ ...input, taxYear: 2025 }).qbiDeduction).toBe(0);
  });
});

describe('estimatedTaxDueDates', () => {
  it.each([
    [2025, ['2025-04-15', '2025-06-16', '2025-09-15', '2026-01-15']],
    [2026, ['2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15']],
    // Jan 15, 2028 is a Saturday and Jan 17, 2028 is the Martin Luther King Jr. holiday.
    [2027, ['2027-04-15', '2027-06-15', '2027-09-15', '2028-01-18']],
  ])('%s installment dates shift for weekends and legal holidays', (year, expected) => {
    const dates = estimatedTaxDueDates(year);
    expect(dates.map(date => date.isoDate)).toEqual(expected);
    expect(dates.map(date => date.quarter)).toEqual([1, 2, 3, 4]);
    expect(dates[0].incomePeriod).toBe('Jan 1 – Mar 31');
  });

  it('formats labels in UTC so the displayed day never drifts', () => {
    expect(estimatedTaxDueDates(2025)[1].label).toBe('June 16, 2025');
    expect(estimatedTaxDueDates(2027)[3].label).toBe('January 18, 2028');
  });
});
