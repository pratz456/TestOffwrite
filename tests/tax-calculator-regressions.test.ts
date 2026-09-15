import { describe, expect, it } from 'vitest';
import { compute1040, type Form1040Input } from '../lib/tax-rules/compute-1040';
import { calculateAllCredits, calculateCTC, calculateEITC, calculateLTCGTax, calculateSEPIRAMax, type CreditInput } from '../lib/tax-rules/credits';
import { calculateFederalIncomeTax, FEDERAL_TAX_BRACKETS_2024, FEDERAL_TAX_BRACKETS_2025 } from '../lib/tax-rules/federal-brackets';
import { calculateSALTLimit, getFederalTaxRules, UnsupportedTaxYearError } from '../lib/tax-rules/federal-year-rules';

const ordinaryWageInput: Form1040Input = {
  taxYear: 2025, filingStatus: 'single', scheduleCNetProfit: 0, w2Wages: 100000,
  w2FederalWithheld: 0, estimatedPayments: 0, selfEmploymentTax: 0, halfSEDeduction: 0,
  healthInsurancePremiums: 0, sepIraContribution: 0, solo401kContribution: 0,
  simpleIraContribution: 0, hsaContribution: 0, studentLoanInterest: 0,
  taxPayerAge: 35,
};
const creditInput: CreditInput = {
  taxYear: 2025, earnedIncome: 100000, agi: 100000, filingStatus: 'single',
  numDependents: 1, numEITCChildren: 1, taxPayerAge: 35,
  taxableIncome: 84250, taxLiabilityBeforeCTC: 13449,
};

// Expected ordinary bracket results use IRS Rev. Proc. 2023-34, 2024-40 and 2025-32.
// These are planning-estimate fixtures, not certification of IRS tax-table rounding,
// eligibility tests, or complete returns with unmodeled adjustments and taxes.
describe('annual federal parameters are applied by the real 1040 function', () => {
  it.each([
    [2024, 14600, 13841], [2025, 15750, 13449], [2026, 16100, 13170],
  ])('uses tax year %i for the 100,000-dollar single wage example', (taxYear, standardDeduction, incomeTax) => {
    const result = compute1040({ ...ordinaryWageInput, taxYear });
    expect(result.taxYear).toBe(taxYear);
    expect(result.standardDeduction).toBe(standardDeduction);
    expect(result.incomeTax).toBe(incomeTax);
    expect(result.balanceDue).toBe(incomeTax);
  });

  it.each([
    ['single', 12400, 1240], ['married_filing_jointly', 24800, 2480],
    ['married_filing_separately', 12400, 1240], ['head_of_household', 17700, 1770],
  ])('taxes the first 2026 marginal band correctly for %s', (status, income, tax) => {
    expect(calculateFederalIncomeTax(Number(income), String(status), 2026)).toBe(tax);
    expect(calculateFederalIncomeTax(Number(income) + 100, String(status), 2026)).toBe(Number(tax) + 12);
  });

  it('restores the 2024 export while preserving the legacy 2025 helper default', () => {
    expect(FEDERAL_TAX_BRACKETS_2024.single[0].max).toBe(11600);
    expect(FEDERAL_TAX_BRACKETS_2025.single[0].max).toBe(11925);
    expect(calculateFederalIncomeTax(84250, 'single')).toBe(13449);
  });

  it.each([2023, 2027, 2026.5, NaN])('rejects unsupported year %s without substituting another year', taxYear => {
    expect(() => compute1040({ ...ordinaryWageInput, taxYear })).toThrow(UnsupportedTaxYearError);
    expect(() => calculateFederalIncomeTax(0, 'single', taxYear)).toThrow(UnsupportedTaxYearError);
    expect(() => calculateSEPIRAMax(0, taxYear)).toThrow(UnsupportedTaxYearError);
  });
});

// Schedule 8812 lines 12–17: ACTC is limited by unused CTC, not an independent bonus.
// Fixtures assume all supplied children satisfy applicable SSN/age/residency tests.
describe('Child Tax Credit and Additional Child Tax Credit', () => {
  it('fixes the reproduced $3,900 benefit: one child reduces the wage balance by $2,200', () => {
    const without = compute1040(ordinaryWageInput);
    const withChild = compute1040({ ...ordinaryWageInput, numDependents: 1, numEITCChildren: 1 });
    expect(withChild.childTaxCredit).toBe(2200);
    expect(withChild.additionalCTC).toBe(0);
    expect(without.balanceDue - withChild.balanceDue).toBe(2200);
  });

  it('allocates only unused credit to ACTC when income tax uses part of the credit', () => {
    const result = compute1040({ ...ordinaryWageInput, w2Wages: 30000, numDependents: 1, numEITCChildren: 1 });
    expect(result.childTaxCredit).toBe(1471.5);
    expect(result.additionalCTC).toBe(728.5);
    expect(result.childTaxCredit + result.additionalCTC).toBe(2200);
  });

  it('caps the refundable amount and leaves regular self-employment tax intact', () => {
    const result = compute1040({ ...ordinaryWageInput, w2Wages: 0, scheduleCNetProfit: 10000,
      selfEmploymentTax: 1412.96, halfSEDeduction: 706.48, numDependents: 1, numEITCChildren: 1 });
    expect(result.incomeTax).toBe(0);
    expect(result.childTaxCredit).toBe(0);
    expect(result.totalTax).toBe(1412.96);
    expect(result.additionalCTC).toBe(1019.03);
  });

  it.each([[2024, 2000], [2025, 2200], [2026, 2200]])('uses the %i child-credit cap', (taxYear, cap) => {
    expect(calculateCTC({ ...creditInput, taxYear })).toEqual({ ctc: cap, actc: 0 });
  });

  it('does not refund credit already eliminated by the MAGI phaseout', () => {
    expect(calculateCTC({ ...creditInput, agi: 244000, taxLiabilityBeforeCTC: 0 })).toEqual({ ctc: 0, actc: 0 });
    expect(calculateCTC({ ...creditInput, agi: 200001 })).toEqual({ ctc: 2150, actc: 0 });
  });

  it('uses the earned-income threshold and refundable ceiling', () => {
    expect(calculateCTC({ ...creditInput, agi: 2500, earnedIncome: 2500, taxLiabilityBeforeCTC: 0 })).toEqual({ ctc: 0, actc: 0 });
    expect(calculateCTC({ ...creditInput, agi: 3000, earnedIncome: 3000, taxLiabilityBeforeCTC: 0 })).toEqual({ ctc: 0, actc: 75 });
    expect(calculateCTC({ ...creditInput, agi: 20000, earnedIncome: 20000, taxLiabilityBeforeCTC: 0 })).toEqual({ ctc: 0, actc: 1700 });
  });

  it('keeps EITC out of the nonrefundable total', () => {
    const result = calculateAllCredits({ ...creditInput, earnedIncome: 20000, agi: 20000, taxableIncome: 4250, taxLiabilityBeforeCTC: 425 });
    expect(result.eitc).toBe(4328);
    expect(result.totalCredits).toBe(425);
    expect(result.totalRefundableCredits).toBe(result.eitc + result.additionalCTC);
  });
});

describe('SEP maximum under the Publication 560 reduced-rate worksheet', () => {
  it('uses 20% of profit after the deductible half of SE tax', () => {
    expect(calculateSEPIRAMax(100000)).toBe(18587.05);
  });
  it('uses the actual half-SE deduction when W-2 wages consume the Social Security base', () => {
    // $100,000 profit * .9235 * .029 / 2 = $1,339.075 regular half-SE deduction.
    expect(calculateSEPIRAMax(100000, 2025, 1339.075)).toBe(19732.19);
    const result = compute1040({ ...ordinaryWageInput, scheduleCNetProfit: 100000,
      selfEmploymentTax: 2678.15, halfSEDeduction: 1339.075 });
    expect(result.sepIRAMaxContribution).toBe(19732.19);
  });
  it.each([[2024, 69000], [2025, 70000], [2026, 72000]])('caps tax year %i at its published dollar limit', (taxYear, limit) => {
    expect(calculateSEPIRAMax(1000000, taxYear)).toBe(limit);
  });
  it('applies the Schedule SE threshold and does not create negative contributions', () => {
    expect(calculateSEPIRAMax(400, 2026)).toBe(80);
    expect(calculateSEPIRAMax(-10000, 2026)).toBe(0);
    expect(calculateSEPIRAMax(0, 2026)).toBe(0);
  });
});

describe('annual SALT limits and MFS ordering', () => {
  it.each([[2024, 10000], [2025, 40000], [2026, 40400]])('uses the %i cap for eligible taxes paid', (taxYear, cap) => {
    expect(compute1040({ ...ordinaryWageInput, taxYear, saltDeduction: 50000 }).itemizedDeductions).toBe(cap);
  });
  it('phases down using SALT MAGI and never assumes the cap was actually paid', () => {
    expect(calculateSALTLimit(2026, 'single', 515000)).toBe(37400);
    expect(calculateSALTLimit(2026, 'single', 1000000)).toBe(10000);
    expect(compute1040({ ...ordinaryWageInput, taxYear: 2026, saltDeduction: 2000 }).itemizedDeductions).toBe(2000);
    expect(compute1040({ ...ordinaryWageInput, taxYear: 2026, saltDeduction: 50000, saltModifiedAGI: 515000 }).itemizedDeductions).toBe(37400);
  });
  it('halves the resulting MFS limitation after applying the 30% worksheet reduction', () => {
    expect(calculateSALTLimit(2026, 'married_filing_separately', 252500)).toBe(20200);
    expect(calculateSALTLimit(2026, 'married_filing_separately', 262500)).toBe(18700);
    expect(calculateSALTLimit(2026, 'married_filing_separately', 1000000)).toBe(5000);
  });
});

describe('year-specific credit and capital-gain calculations', () => {
  it.each([[2024, 4213], [2025, 4328], [2026, 4427]])('uses the published %i one-child EITC plateau', (taxYear, amount) => {
    expect(calculateEITC({ ...creditInput, taxYear, agi: 20000, earnedIncome: 20000 }).amount).toBe(amount);
  });
  it('fixes the 2025 EITC phaseout start and refuses to invent a missing childless age', () => {
    expect(calculateEITC({ ...creditInput, agi: 23350, earnedIncome: 23350 }).amount).toBe(4328);
    expect(calculateEITC({ ...creditInput, agi: 20000, earnedIncome: 20000, numEITCChildren: 0, taxPayerAge: undefined }).eligible).toBe(false);
  });
  it('compares the phase-in amount with the maximum-credit phaseout when AGI exceeds earned income', () => {
    expect(calculateEITC({ ...creditInput, earnedIncome: 10000, agi: 30000 }).amount).toBe(3265.33);
  });
  it('stacks ordinary long-term gains above ordinary taxable income', () => {
    const result = compute1040({ ...ordinaryWageInput, w2Wages: 65750, otherIncome: 20000, longTermCapGains: 20000 });
    expect(result.taxableIncome).toBe(70000);
    expect(result.longTermCapGainsTax).toBe(3000);
    expect(result.incomeTax).toBe(8914);
  });
  it.each([[2024, 446.25], [2025, 247.5], [2026, 82.5]])('uses the %i single zero-rate capital-gain threshold', (taxYear, tax) => {
    expect(calculateLTCGTax(50000, 50000, 'single', taxYear)).toBe(tax);
  });
});

describe('Additional Medicare Tax integration', () => {
  it('uses net SE earnings and the MFS threshold, with explicit Box 5 zero preserved', () => {
    const result = compute1040({ ...ordinaryWageInput, filingStatus: 'married_filing_separately', w2Wages: 0,
      w2MedicareWages: 0, scheduleCNetProfit: 150000, selfEmploymentTax: 21194.33, halfSEDeduction: 10597.16 });
    expect(result.additionalMedicareTax).toBe(121.73);
  });
  it('combines Box 5 wages with SE earnings using one threshold', () => {
    const result = compute1040({ ...ordinaryWageInput, w2Wages: 190000, w2MedicareWages: 210000,
      scheduleCNetProfit: 10000, selfEmploymentTax: 267.82, halfSEDeduction: 133.91 });
    expect(result.additionalMedicareTax).toBe(173.12);
    expect(result.totalTax).toBeCloseTo(result.incomeTax + result.selfEmploymentTax + result.additionalMedicareTax, 2);
  });
  it('exposes the absence of a Box 5 input rather than hiding the approximation', () => {
    expect(compute1040(ordinaryWageInput).calculationWarnings.some(note => note.includes('Box 5'))).toBe(true);
    expect(compute1040({ ...ordinaryWageInput, w2MedicareWages: 0 }).calculationWarnings.some(note => note.includes('Box 5'))).toBe(false);
  });
  it('provides the same verified annual Social Security bases to downstream Schedule SE', () => {
    expect([2024, 2025, 2026].map(year => getFederalTaxRules(year).socialSecurityWageBase)).toEqual([168600, 176100, 184500]);
  });
});
