import { describe, expect, it } from 'vitest';
import { calcScheduleSE } from '../lib/reports/calcSE';
import {
  expectedEmployeeSocialSecurityWithholding,
  getSocialSecurityWageBase,
  w2Box4SocialSecurityWithholdingWarning,
} from '../lib/tax-rules/federal-year-rules';

// SSA contribution and benefit base, https://www.ssa.gov/oact/cola/cbb.html
// 2027 base $192,300. Schedule SE / IRC §1402(b)(1): the 12.4% portion applies to
// net earnings (profit × 0.9235) up to the base remaining after W-2 Social Security wages.

describe('2027 Social Security wage base', () => {
  it('uses the published $192,300 base and keeps the earlier bases', () => {
    expect(getSocialSecurityWageBase(2025)).toBe(176100);
    expect(getSocialSecurityWageBase(2026)).toBe(184500);
    expect(getSocialSecurityWageBase(2027)).toBe(192300);
  });

  it('taxes only the wage base remaining after W-2 Social Security wages', () => {
    // Remaining base: $192,300 − $150,000 = $42,300.
    // Profit $100,000 → net earnings $92,350, which is above that remainder.
    // Social Security tax = $42,300 × 12.4% = $5,245.20.
    // Medicare stays on the full $92,350: $92,350 × 2.9% = $2,678.15.
    const result = calcScheduleSE({ scheduleCNetProfit: 100000, taxYear: 2027 }, 'single', 150000, 0);
    expect(result.netEarnings).toBe(100000);
    expect(result.seBase).toBe(92350);
    expect(result.socialSecurityTax).toBe(5245.2);
    expect(result.socialSecurityTax / 0.124).toBeCloseTo(42300, 2);
    expect(result.medicareTax).toBe(2678.15);
  });

  it('compares net earnings after the 92.35% step with the cap', () => {
    // $200,000 × 0.9235 = $184,700, under $192,300, so the full 12.4% applies.
    // Social Security tax = $184,700 × 0.124 = $22,902.80.
    // Medicare = $184,700 × 0.029 = $5,356.30.
    const under = calcScheduleSE({ scheduleCNetProfit: 200000, taxYear: 2027 });
    expect(under.seBase).toBe(184700);
    expect(under.seBase).toBeLessThan(192300);
    expect(under.socialSecurityTax).toBe(22902.8);
    expect(under.medicareTax).toBe(5356.3);

    // $210,000 × 0.9235 = $193,935, over $192,300.
    // Social Security tax = $192,300 × 0.124 = $23,845.20.
    // Medicare stays on $193,935 × 0.029 = $5,624.115, rounded to $5,624.12.
    const over = calcScheduleSE({ scheduleCNetProfit: 210000, taxYear: 2027 });
    expect(over.seBase).toBe(193935);
    expect(over.seBase).toBeGreaterThan(192300);
    expect(over.socialSecurityTax).toBe(23845.2);
    expect(over.medicareTax).toBe(5624.12);
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
