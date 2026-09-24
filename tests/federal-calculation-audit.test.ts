import { describe, expect, it } from 'vitest';
import { calculateEffectiveTaxRate, calculateFederalIncomeTax, getMarginalTaxRate, getUserTaxRate, getUserTaxRateDisplay, TaxRateReviewRequiredError } from '../lib/tax-rules/federal-brackets';
import { calcCombinedSERate } from '../lib/tax-rules/kpi-calculations';
import { compute1040, type Form1040Input } from '../lib/tax-rules/compute-1040';
import { QBIReviewRequiredError } from '../lib/tax-rules/qbi';
import { calcScheduleSE } from '../lib/reports/calcSE';
import { TaxCalculationScopeReviewRequiredError } from '../lib/tax-rules/calculation-scope';

const base: Form1040Input = {
  taxYear: 2026, filingStatus: 'single', scheduleCNetProfit: 0, w2Wages: 0,
  w2FederalWithheld: 0, estimatedPayments: 0, selfEmploymentTax: 0, halfSEDeduction: 0,
  healthInsurancePremiums: 0, sepIraContribution: 0, solo401kContribution: 0,
  simpleIraContribution: 0, hsaContribution: 0, studentLoanInterest: 0, taxPayerAge: 35,
};

describe('federal calculation audit: independently worked 2026 reference cases', () => {
  // SSA 2026 $184,500 wage base; Schedule SE lines 4a, 9–13; Form8959.
  // $300,000 profit => $277,050 net earnings, $22,878 SS, $8,034.45 regular
  // Medicare, $693.45 Additional Medicare, deductible half of regular SE $15,456.23.
  it('caps regular SE and includes separate Additional Medicare in the combined helper', () => {
    const combined = calcCombinedSERate(300000, 'single', 0, 2026);
    expect(combined.seTaxDollars).toBe(30912.45);
    expect(combined.incomeTaxDollars).toBe(62724.57);
    expect(combined.totalTaxDollars).toBe(94330.47);
    expect(combined.combinedMarginalRate).toBe(38);
    expect(calculateEffectiveTaxRate({ income: 300000, filing_status: 'single' }, 2026)).toBeCloseTo(20.9081898333, 8);
  });

  it('does not charge regular SE below $400 net earnings or fabricate income tax below the standard deduction', () => {
    expect(calcCombinedSERate(400, 'single', 0, 2026)).toMatchObject({ seTaxDollars: 0, totalTaxDollars: 0, combinedMarginalRate: 0 });
    expect(calcCombinedSERate(500, 'single', 0, 2026)).toMatchObject({ seTaxDollars: 70.65, totalTaxDollars: 70.65, combinedMarginalRate: 14.1 });
  });

  it('uses the same owner’s W-2 Social Security wages before the SE deduction and ordinary bracket', () => {
    // $180,000 W2 + $100,000 profit leaves $4,500 SS base: regular SE $3,236.15,
    // half $1,618.08, taxable income $262,281.92, ordinary income tax $60,567.922.
    const profile = { income: 100000, w2_income: 180000, w2_social_security_wages: 180000, w2_medicare_wages: 180000, filing_status: 'single' };
    expect(calculateEffectiveTaxRate(profile, 2026)).toBeCloseTo(60567.922 / 280000 * 100, 9);
    expect(getMarginalTaxRate(profile, 2026)).toBe(35);
    expect(calculateEffectiveTaxRate({ ...profile, w2_social_security_wages: 0 }, 2026)).toBeLessThan(calculateEffectiveTaxRate(profile, 2026));
  });

  it('withholds every W-2 plus self-employment rate until Box 3 and Box 5 are explicit', () => {
    const incomplete = { income: 100000, w2_income: 50000, filing_status: 'single' };
    expect(() => calculateEffectiveTaxRate(incomplete, 2026)).toThrow(TaxCalculationScopeReviewRequiredError);
    expect(getUserTaxRateDisplay(incomplete, 2026)).toMatchObject({
      rate: null,
      reviewMessage: expect.stringContaining('Box 3 Social Security wages and Box 5 Medicare wages'),
    });
    expect(calculateEffectiveTaxRate({
      ...incomplete,
      w2_social_security_wages: 0,
      w2_medicare_wages: 0,
    }, 2026)).toBeGreaterThan(0);
  });

  it('places a $60,000 business profit in its taxable bracket rather than its gross-income bracket', () => {
    expect(getMarginalTaxRate({ income: 60000, filing_status: 'single' }, 2026)).toBe(12);
    expect(getMarginalTaxRate({ income: 0, w2_income: 100000, filing_status: 'single' }, 2026)).toBe(22);
    expect(calculateEffectiveTaxRate({ w2_income: 100000, filing_status: 'single' }, 2026)).toBeCloseTo(13.17, 10);
    expect(getUserTaxRate({ income: 0, filing_status: 'single' }, 2026)).toBe(0);
  });

  it.each([undefined, '', '100000oops', NaN, Infinity, -1])('requires review instead of a generic 25%% for invalid or missing profit %s', income => {
    expect(() => getUserTaxRate({ income, filing_status: 'single' }, 2026)).toThrow(TaxRateReviewRequiredError);
    expect(getUserTaxRateDisplay({ income, filing_status: 'single' }, 2026)).toMatchObject({ rate: null, reviewMessage: expect.stringContaining('Update income') });
  });

  it.each([
    'health_insurance_premiums', 'health_insurance_premium', 'sep_ira_contribution',
    'solo_401k_contribution', 'simple_ira_contribution', 'hsa_contribution', 'retirement_contribution',
  ] as const)('withholds a profile rate for an unvalidated positive %s claim', key => {
    const profile = { income: 100000, filing_status: 'single', [key]: 25000 };
    expect(() => calculateEffectiveTaxRate(profile, 2026)).toThrow(TaxRateReviewRequiredError);
    expect(() => getMarginalTaxRate(profile, 2026)).toThrow(TaxRateReviewRequiredError);
    expect(() => getUserTaxRate(profile, 2026)).toThrow(TaxRateReviewRequiredError);
    expect(getUserTaxRateDisplay(profile, 2026)).toEqual({
      rate: null, filingStatus: null, reviewMessage: expect.stringContaining('eligibility and annual-limit review in Tax Organizer'),
    });
    expect(getUserTaxRate({ ...profile, [key]: 0 }, 2026)).toBe(getUserTaxRate({ income: 100000, filing_status: 'single' }, 2026));
  });

  it('does not hide positive legacy deduction claims behind a newer zero field or a zero income branch', () => {
    expect(() => getUserTaxRate({ income: 0, health_insurance_premiums: 0, health_insurance_premium: 5000 }, 2026)).toThrow(TaxRateReviewRequiredError);
    expect(() => getUserTaxRate({ w2_income: 100000, hsa_contribution: 9000 }, 2026)).toThrow(TaxRateReviewRequiredError);
  });

  it('rejects nonfinite direct numerical inputs', () => {
    for (const income of [NaN, Infinity, -Infinity]) {
      expect(() => calcCombinedSERate(income, 'single', 0, 2026)).toThrow(RangeError);
      expect(() => calculateFederalIncomeTax(income, 'single', 2026)).toThrow(RangeError);
    }
  });

  it.each([
    ['single', 201750, 16100],
    ['married_filing_jointly', 403500, 32200],
    ['married_filing_separately', 201775, 16100],
    ['head_of_household', 201750, 24150],
  ] as const)('keeps the %s QBI threshold inclusive and blocks unsupported Form8995-A one cent above it', (filingStatus, threshold, standard) => {
    // $1,000 profit, $141.30 regular SE / $70.65 deduction; ordinary other income places taxable income at the threshold.
    const input = { ...base, filingStatus, scheduleCNetProfit: 1000, selfEmploymentTax: 141.30, halfSEDeduction: 70.65, otherIncome: threshold + standard - 929.35 };
    expect(compute1040(input).qbiDeduction).toBe(185.87);
    expect(() => compute1040({ ...input, otherIncome: input.otherIncome + 0.01 })).toThrow(QBIReviewRequiredError);
    expect(() => compute1040({ ...input, otherIncome: input.otherIncome + 200000 })).toThrow(QBIReviewRequiredError);
  });

  it('does not block a high-income wage-only case for a nonexistent QBI deduction', () => {
    expect(compute1040({ ...base, w2Wages: 400000, w2MedicareWages: 400000 }).qbiDeduction).toBe(0);
  });

  it('uses Schedule C line31 after all business deductions for the separate Pennsylvania estimate', () => {
    const result = compute1040({ ...base, scheduleCNetProfit: 50000, depreciationDeduction: 1000, deMinimisExpense: 2000, homeOfficeDeduction: 1500, stateCode: 'PA' });
    expect(result.scheduleCAllowed).toBe(45500);
    expect(result.stateTax).toMatchObject({ supported: true, estimate: 1396.85 });
  });

  it('withholds the 2026 minimum QBI result when active-business eligibility would change the deduction', () => {
    expect(() => compute1040({ ...base, scheduleCNetProfit: 1200, selfEmploymentTax: 169.55, halfSEDeduction: 84.78, otherIncome: 30000 })).toThrow(TaxCalculationScopeReviewRequiredError);
    expect(compute1040({ ...base, taxYear: 2025, scheduleCNetProfit: 1200, selfEmploymentTax: 169.55, halfSEDeduction: 84.78, otherIncome: 30000 }).qbiDeduction).toBe(223.04);
  });

  it('withholds a positive section68 reduction but preserves the exact boundary and prior year', () => {
    expect(compute1040({ ...base, w2Wages: 640600, itemizedDeductions: 17000 }).itemizedDeductions).toBe(17000);
    expect(() => compute1040({ ...base, w2Wages: 640600.01, itemizedDeductions: 17000 })).toThrow(TaxCalculationScopeReviewRequiredError);
    expect(compute1040({ ...base, taxYear: 2025, w2Wages: 700000, itemizedDeductions: 17000 }).itemizedDeductions).toBe(17000);
  });

  it('requires spouse wage ownership before combining a joint return’s wages and business profit', () => {
    expect(() => compute1040({ ...base, filingStatus: 'married_filing_jointly', scheduleCNetProfit: 10000, w2Wages: 50000 })).toThrow(TaxCalculationScopeReviewRequiredError);
    expect(getUserTaxRateDisplay({ filing_status: 'married_filing_jointly', income: 10000, w2_income: 50000 })).toMatchObject({ rate: null, reviewMessage: expect.stringContaining('spouse') });
  });
  it.each(['socialSecurity', 'medicare'] as const)('does not bypass spouse ownership with zero taxable wages but positive %s wages', wageType => {
    const wageFields = wageType === 'socialSecurity' ? { w2SocialSecurityWages: 20000 } : { w2MedicareWages: 20000 };
    expect(() => compute1040({ ...base, filingStatus: 'married_filing_jointly', scheduleCNetProfit: 10000, w2Wages: 0, ...wageFields })).toThrow(TaxCalculationScopeReviewRequiredError);
    const profileFields = wageType === 'socialSecurity' ? { w2_social_security_wages: 20000 } : { w2_medicare_wages: 20000 };
    expect(getUserTaxRateDisplay({ filing_status: 'married_filing_jointly', income: 10000, w2_income: 0, ...profileFields })).toMatchObject({ rate: null, reviewMessage: expect.stringContaining('spouse') });
  });

  it('preserves separate Medicare wages and includes wage Additional Medicare independently', () => {
    const se = calcScheduleSE({ scheduleCNetProfit: 100000, taxYear: 2026 }, 'single', 180000, 210000);
    expect(se).toMatchObject({ socialSecurityTax: 558, totalSETax: 3236.15, halfSEDeduction: 1618.08, additionalMedicareTax: 831.15 });
    const wageOnly = compute1040({ ...base, w2Wages: 180000, w2MedicareWages: 210000 });
    expect(wageOnly.additionalMedicareTax).toBe(90);
  });
});
