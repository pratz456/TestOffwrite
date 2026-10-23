import { describe, expect, it } from 'vitest';
import { calcScheduleSE, getTaxRatesAndLimits } from '../lib/reports/calcSE';
import { estimateStateTax, federalAgiForStateEstimate, stateUsesFederalAgiIncomeBase } from '../lib/tax-rules/state';

const round2 = (n: number) => Math.round(n * 100) / 100;

describe('federal AGI for the state planning estimate', () => {
  it('subtracts half of Schedule SE tax from $50,000 of profit with no wages', () => {
    const taxYear = 2026;
    const profit = 50000;
    const se = calcScheduleSE({ scheduleCNetProfit: profit, taxYear });
    // calcScheduleSE rounds the unrounded SE tax to cents (7,064.775 → 7,064.78)
    // and rounds half of the unrounded tax (3,532.3875 → 3,532.39). That is
    // Schedule SE line 13, not a second 0.9235 × 0.153 copy.
    expect(se.totalSETax).toBe(7064.78);
    expect(se.halfSEDeduction).toBe(3532.39);
    const federalAGI = federalAgiForStateEstimate({
      stateCode: 'GA', taxYear, scheduleCNetProfit: profit, w2Wages: 0, otherIncome: 0,
    });
    expect(federalAGI).toBe(round2(profit - se.halfSEDeduction));
    expect(federalAGI).toBe(46467.61);
  });

  it('keeps other income in AGI without changing the self-employment deduction', () => {
    const withOther = federalAgiForStateEstimate({
      stateCode: 'NY', taxYear: 2026, scheduleCNetProfit: 50000, w2Wages: 0, otherIncome: 1000,
    });
    expect(withOther).toBe(47467.61);
  });

  it('deducts only half of the Medicare portion when the taxpayer’s own Box 3 wages are above the Social Security wage base', () => {
    const taxYear = 2026;
    const profit = 50000;
    const wageBase = getTaxRatesAndLimits(taxYear).socialSecurityWageBase;
    expect(wageBase).toBe(184500);
    const w2SocialSecurityWages = wageBase + 15500;
    const se = calcScheduleSE({ scheduleCNetProfit: profit, taxYear }, 'single', w2SocialSecurityWages);
    expect(se.socialSecurityTax).toBe(0);
    expect(se.medicareTax).toBe(1339.08);
    expect(se.totalSETax).toBe(1339.08);
    expect(se.halfSEDeduction).toBe(669.54);
    const federalAGI = federalAgiForStateEstimate({
      stateCode: 'NY', taxYear, scheduleCNetProfit: profit, w2Wages: 0, w2SocialSecurityWages, otherIncome: 0,
    });
    expect(federalAGI).toBe(round2(profit - se.halfSEDeduction));
    expect(federalAGI).toBe(49330.46);
  });

  it('keeps Box 1 wages in AGI and does not use them as the Social Security wage base', () => {
    const taxYear = 2026;
    const profit = 50000;
    const w2Wages = 200000;
    const capped = calcScheduleSE({ scheduleCNetProfit: profit, taxYear }, 'single', w2Wages);
    const uncapped = calcScheduleSE({ scheduleCNetProfit: profit, taxYear }, 'single', 0);
    expect(capped.socialSecurityTax).toBe(0);
    expect(uncapped.halfSEDeduction).toBe(3532.39);
    const federalAGI = federalAgiForStateEstimate({
      stateCode: 'GA', taxYear, scheduleCNetProfit: profit, w2Wages, w2SocialSecurityWages: 0, otherIncome: 0,
    });
    expect(federalAGI).toBe(round2(profit + w2Wages - uncapped.halfSEDeduction));
    expect(federalAGI).toBe(246467.61);
  });

  it('does not deduct when Schedule C profit is $300', () => {
    const se = calcScheduleSE({ scheduleCNetProfit: 300, taxYear: 2026 });
    expect(se.seBase).toBeLessThan(400);
    expect(se.halfSEDeduction).toBe(0);
    expect(federalAgiForStateEstimate({
      stateCode: 'IL', taxYear: 2026, scheduleCNetProfit: 300, w2Wages: 0, otherIncome: 0,
    })).toBe(300);
  });

  it('does not deduct when net SE earnings (profit × 0.9235) are under $400, even if profit itself is over $400', () => {
    const profit = 433;
    const se = calcScheduleSE({ scheduleCNetProfit: profit, taxYear: 2026 });
    expect(se.seBase).toBeLessThanOrEqual(400);
    expect(se.halfSEDeduction).toBe(0);
    expect(federalAgiForStateEstimate({
      stateCode: 'NC', taxYear: 2026, scheduleCNetProfit: profit, w2Wages: 0, otherIncome: 0,
    })).toBe(profit);
  });

  it('does not deduct zero or negative Schedule C profit', () => {
    expect(federalAgiForStateEstimate({
      stateCode: 'GA', taxYear: 2026, scheduleCNetProfit: 0, w2Wages: 40000, otherIncome: 1000,
    })).toBe(41000);
    expect(federalAgiForStateEstimate({
      stateCode: 'GA', taxYear: 2026, scheduleCNetProfit: -500, w2Wages: 40000, otherIncome: 0,
    })).toBe(39500);
  });

  it.each(['CA', 'NY', 'GA', 'IL', 'NC'] as const)('subtracts the deduction for %s', stateCode => {
    const taxYear = stateCode === 'CA' ? 2025 : 2026;
    expect(stateUsesFederalAgiIncomeBase(stateCode, taxYear)).toBe(true);
    const federalAGI = federalAgiForStateEstimate({
      stateCode, taxYear, scheduleCNetProfit: 50000, w2Wages: 0, otherIncome: 0,
    });
    expect(federalAGI).toBe(46467.61);
  });

  it('leaves Pennsylvania income classes exactly as they are', () => {
    const taxYear = 2026;
    const scheduleCNetProfit = 50000;
    const w2Wages = 20000;
    const otherIncome = 5000;
    const gross = scheduleCNetProfit + w2Wages + otherIncome;
    expect(stateUsesFederalAgiIncomeBase('PA', taxYear)).toBe(false);
    const federalAGI = federalAgiForStateEstimate({
      stateCode: 'PA', taxYear, scheduleCNetProfit, w2Wages, otherIncome,
    });
    expect(federalAGI).toBe(gross);

    const shared = {
      stateCode: 'PA', taxYear, filingStatus: 'single' as const,
      scheduleCNetProfit, w2Wages, otherIncome,
    };
    const before = estimateStateTax({ ...shared, federalAGI: gross });
    const after = estimateStateTax({ ...shared, federalAGI });
    expect(before.supported).toBe(true);
    expect(after).toEqual(before);
    if (!after.supported) return;
    expect(after.components.stateAGI).toBe(75000);
    expect(after.components.taxableIncome).toBe(75000);
    expect(after.components.detail.map(line => line.amount)).toEqual([20000, 50000, 5000]);
    expect(after.estimate).toBeCloseTo(75000 * 0.0307, 2);
  });

  it('does not subtract the deduction for Ohio or a no-income-tax state', () => {
    const input = { taxYear: 2025, scheduleCNetProfit: 50000, w2Wages: 0, otherIncome: 0 };
    expect(stateUsesFederalAgiIncomeBase('OH', 2025)).toBe(false);
    expect(federalAgiForStateEstimate({ ...input, stateCode: 'OH' })).toBe(50000);
    expect(federalAgiForStateEstimate({ ...input, stateCode: 'TX', taxYear: 2026 })).toBe(50000);
  });

  it('lowers the 2026 Georgia estimate for a single filer with $50,000 of Schedule C profit', () => {
    const shared = {
      stateCode: 'GA', taxYear: 2026, filingStatus: 'single' as const,
      scheduleCNetProfit: 50000, w2Wages: 0, otherIncome: 0,
    };
    const before = estimateStateTax({ ...shared, federalAGI: 50000 });
    const federalAGI = federalAgiForStateEstimate(shared);
    const after = estimateStateTax({ ...shared, federalAGI });
    expect(before.supported && after.supported).toBe(true);
    if (!before.supported || !after.supported) return;
    expect(before.components.federalAGI).toBe(50000);
    expect(before.estimate).toBe(1746.5);
    expect(after.components.federalAGI).toBe(46467.61);
    expect(after.estimate).toBe(1570.23);
  });
});
