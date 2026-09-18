import { describe, expect, it } from 'vitest';
import { calcScheduleSE, getTaxRatesAndLimits, validateTaxSummarySettings } from '../lib/reports/calcSE';

// SSA annual contribution/benefit bases and IRS Schedule SE / Form 8959 formulas.
// https://www.ssa.gov/oact/COLA/cbb.html ; https://www.irs.gov/instructions/i8959

describe('Schedule SE reference scenarios', () => {
  it.each([[2024, 168600], [2025, 176100], [2026, 184500]])('uses the %i Social Security wage base', (taxYear, wageBase) => {
    const result = calcScheduleSE({ scheduleCNetProfit: 300000, taxYear });
    expect(result.socialSecurityTax).toBeCloseTo(wageBase * 0.124, 2);
    expect(getTaxRatesAndLimits(taxYear).socialSecurityWageBase).toBe(wageBase);
  });

  it('keeps Additional Medicare outside Schedule SE and its half-tax deduction', () => {
    const result = calcScheduleSE({ scheduleCNetProfit: 300000, taxYear: 2026 });
    expect(result.seBase).toBe(277050);
    expect(result.socialSecurityTax).toBe(22878);
    expect(result.medicareTax).toBe(8034.45);
    expect(result.additionalMedicareTax).toBe(693.45);
    expect(result.totalSETax).toBe(30912.45);
    expect(result.halfSEDeduction).toBe(15456.23);
  });

  it('reduces the SS wage base using the same taxpayer’s W-2 Social Security wages', () => {
    const result = calcScheduleSE({ scheduleCNetProfit: 100000, taxYear: 2026 }, 'single', 180000, 180000);
    expect(result.socialSecurityTax).toBe(558);
    expect(result.medicareTax).toBe(2678.15);
    expect(result.additionalMedicareTax).toBe(651.15);
    expect(result.totalSETax).toBe(3236.15);
    expect(result.halfSEDeduction).toBe(1618.08);
  });

  it('uses the married-separate Additional Medicare threshold and preserves legacy joint alias', () => {
    const input = { scheduleCNetProfit: 200000, taxYear: 2026 };
    expect(calcScheduleSE(input, 'married_filing_separately').additionalMedicareTax).toBe(537.3);
    expect(calcScheduleSE(input, 'married').additionalMedicareTax).toBe(0);
    expect(calcScheduleSE(input, 'married_filing_jointly').additionalMedicareTax).toBe(0);
  });

  it('keeps legitimate losses and the net-earnings minimum from creating SE liability', () => {
    expect(calcScheduleSE({ scheduleCNetProfit: -5000, taxYear: 2026 }).netEarnings).toBe(-5000);
    expect(calcScheduleSE({ scheduleCNetProfit: -5000, taxYear: 2026 }).totalSETax).toBe(0);
    expect(calcScheduleSE({ scheduleCNetProfit: 400, taxYear: 2026 }).totalSETax).toBe(0);
    expect(calcScheduleSE({ scheduleCNetProfit: 500, taxYear: 2026 }).totalSETax).toBe(70.65);
    expect(validateTaxSummarySettings({ scheduleCNetProfit: -5000, taxYear: 2026 })).toEqual([]);
  });

  it('rejects unverified years and non-finite input', () => {
    expect(() => calcScheduleSE({ scheduleCNetProfit: 100000, taxYear: 2027 })).toThrow();
    expect(() => calcScheduleSE({ scheduleCNetProfit: NaN, taxYear: 2026 })).toThrow();
    expect(() => calcScheduleSE({ scheduleCNetProfit: 100000, taxYear: 2026 }, 'single', -1)).toThrow();
  });
});
