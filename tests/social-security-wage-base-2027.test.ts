import { describe, expect, it } from 'vitest';
import { calcScheduleSE, getTaxRatesAndLimits } from '../lib/reports/calcSE';
import {
  expectedEmployeeSocialSecurityWithholding,
  getSocialSecurityWageBase,
  w2Box4SocialSecurityWithholdingWarning,
} from '../lib/tax-rules/federal-year-rules';

// SSA contribution and benefit base, https://www.ssa.gov/oact/cola/cbb.html
// 2027 base $192,300. Schedule SE still requires the rest of the annual rules.

describe('2027 Social Security wage base', () => {
  it('uses the published $192,300 base and keeps the earlier bases', () => {
    expect(getSocialSecurityWageBase(2025)).toBe(176100);
    expect(getSocialSecurityWageBase(2026)).toBe(184500);
    expect(getSocialSecurityWageBase(2027)).toBe(192300);
  });

  it('refuses a 2027 Schedule SE calculation while the other annual rules are unpublished', () => {
    expect(() => calcScheduleSE({ scheduleCNetProfit: 100000, taxYear: 2027 }, 'single', 150000, 150000)).toThrow(/not published the 2027/);
    expect(() => getTaxRatesAndLimits(2027)).toThrow(/not published the 2027/);
  });
});

describe('W-2 Box 4 withholding uses the wage base for that tax year', () => {
  it.each([
    [2025, 176100, 10918.2],
    [2026, 184500, 11439],
    [2027, 192300, 11922.6],
  ] as const)('%i wages of $200,000 withhold 6.2%% of the $%i base', (year, base, expectedWithholding) => {
    const expected = expectedEmployeeSocialSecurityWithholding(200000, year);
    expect(expected).toBeCloseTo(base * 0.062, 8);
    expect(expected).toBeCloseTo(expectedWithholding, 8);
    expect(w2Box4SocialSecurityWithholdingWarning(expected, 200000, year)).toBeNull();
    expect(w2Box4SocialSecurityWithholdingWarning(expected + 50, 200000, year)).toBeNull();
    expect(w2Box4SocialSecurityWithholdingWarning(expected + 50.01, 200000, year)).toMatch(/expected SS withholding/);
  });

  it('uses Box 3 itself when 2027 wages are under the cap', () => {
    // $50,000 × 6.2% = $3,100.00
    expect(expectedEmployeeSocialSecurityWithholding(50000, 2027)).toBeCloseTo(3100, 8);
    expect(w2Box4SocialSecurityWithholdingWarning(3100, 50000, 2027)).toBeNull();
  });

  it('does not judge a 2027 W-2 with the 2025 base, and skips years outside the table', () => {
    const withholding2027 = expectedEmployeeSocialSecurityWithholding(200000, 2027);
    expect(w2Box4SocialSecurityWithholdingWarning(withholding2027, 200000, 2025)).toMatch(/expected SS withholding/);
    // 2023 is $160,200 on the SSA table, but that year is not in the year-rules table.
    expect(w2Box4SocialSecurityWithholdingWarning(9932.4, 200000, 2023)).toBeNull();
    expect(w2Box4SocialSecurityWithholdingWarning(0, 200000, 2023)).toBeNull();
  });
});
