import { describe, expect, it } from 'vitest';
import { calculateSocialSecurityWorksheet as calculate, readSocialSecurityFacts, SocialSecurityReviewRequiredError, type SocialSecurityWorksheetInput } from '../lib/tax-rules/social-security';

const input = (overrides: Partial<SocialSecurityWorksheetInput> = {}): SocialSecurityWorksheetInput => ({ taxYear: 2026, filingStatus: 'single', netBenefits: 20000, otherIncome: 0, taxExemptInterest: 0, excludedSavingsBondInterest: 0, exclusionAddbacks: 0, allowedAdjustments: 0, ...overrides });
export const completeBenefits = () => ({
  hasSocialSecurity: 'yes', amountSocialSecurity: '21000', filingStatus: 'single',
  socialSecurityNetBenefits: '20000', socialSecurityFederalWithheld: '0',
  socialSecurityTaxExemptInterest: '0', socialSecurityExcludedSavingsBondInterest: '0', socialSecurityAdoptionExclusion: '0',
  socialSecurityResident: 'yes', socialSecurityLumpSum: 'no', socialSecuritySpecialIRA: 'no', socialSecurityForeignExclusion: 'no',
  socialSecurityIncomeComplete: 'yes', socialSecurityAdjustmentsComplete: 'yes', socialSecurityLivedApartAllYear: '',
});

describe('Pub915 Worksheet1 published numeric examples', () => {
  it.each([
    ['Example1 single', { netBenefits: 5980, otherIncome: 28990 }, 2990],
    ['Example2 joint', { filingStatus: 'married_filing_jointly', netBenefits: 5600, otherIncome: 29750, allowedAdjustments: 1000 }, 0],
    ['Example3 joint with excluded bond interest', { filingStatus: 'married_filing_jointly', netBenefits: 10000, otherIncome: 40300, excludedSavingsBondInterest: 200 }, 6275],
    ['Example4 separate, together', { filingStatus: 'married_filing_separately', netBenefits: 4000, otherIncome: 8000, livedApartAllYear: false }, 3400],
  ] as const)('%s', (_name, overrides, expected) => {
    expect(calculate(input(overrides)).taxableBenefits).toBe(expected);
  });
});

describe('benefit thresholds and computation boundaries', () => {
  it.each([
    ['single', 15000, 0], ['single', 15000.02, .01], ['single', 24000, 4500], ['single', 24000.02, 4500.02],
    ['head_of_household', 15000, 0], ['married_filing_jointly', 22000, 0], ['married_filing_jointly', 22000.02, .01],
    ['married_filing_jointly', 34000, 6000], ['married_filing_jointly', 34000.02, 6000.02],
  ] as const)('%s with other income%s', (filingStatus, otherIncome, expected) => expect(calculate(input({ filingStatus, otherIncome })).taxableBenefits).toBe(expected));
  it('does not turn the85% cap into a default percentage', () => {
    expect(calculate(input()).taxableBenefits).toBe(0);
    expect(calculate(input({ otherIncome: 100000 })).taxableBenefits).toBe(17000);
    expect(calculate(input({ filingStatus: 'married_filing_separately', livedApartAllYear: false })).taxableBenefits).toBe(8500);
    expect(calculate(input({ filingStatus: 'married_filing_separately', livedApartAllYear: true })).taxableBenefits).toBe(0);
  });
  it('requires the separate-filer living arrangement', () => expect(() => calculate(input({ filingStatus: 'married_filing_separately' }))).toThrow(SocialSecurityReviewRequiredError));
  it('includes tax-exempt interest, bond exclusion and adoption addback without treating them as taxable income', () => {
    const result = calculate(input({ otherIncome: 14000, taxExemptInterest: 1000, excludedSavingsBondInterest: 500, exclusionAddbacks: 500 }));
    expect(result.combinedIncome).toBe(26000); expect(result.taxableBenefits).toBe(500); expect(result.otherIncome).toBe(14000);
  });
  it('subtracts permitted adjustments and floors combined income at zero', () => {
    expect(calculate(input({ otherIncome: 16000, allowedAdjustments: 1000 })).taxableBenefits).toBe(0);
    expect(calculate(input({ otherIncome: -20000 })).combinedIncome).toBe(0);
    expect(calculate(input({ filingStatus: 'married_filing_separately', livedApartAllYear: false, allowedAdjustments: 15000 })).taxableBenefits).toBe(0);
  });
  it('supports reviewed zero net benefits without fabricating income', () => expect(calculate(input({ netBenefits: 0, otherIncome: 200000 })).taxableBenefits).toBe(0));
  it.each([undefined, NaN, Infinity, -100, 'garbage'])('rejects unknown/malformed/negative net benefits%s', netBenefits => expect(() => calculate(input({ netBenefits } as Partial<SocialSecurityWorksheetInput>))).toThrow());
  it('rejects2027 before applying the supported-year rules', () => expect(() => calculate(input({ taxYear: 2027 }))).toThrow());
});

describe('persisted eligibility contract', () => {
  it('retains Box3 separately and reads confirmed Box5', () => expect(readSocialSecurityFacts(completeBenefits())).toMatchObject({ netBenefits: 20000 }));
  it.each(['socialSecurityNetBenefits', 'socialSecurityFederalWithheld', 'socialSecurityTaxExemptInterest', 'socialSecurityExcludedSavingsBondInterest', 'socialSecurityAdoptionExclusion'])('requires explicit monetary fact%s', field => expect(() => readSocialSecurityFacts({ ...completeBenefits(), [field]: '' })).toThrow(SocialSecurityReviewRequiredError));
  it.each([
    ['socialSecurityResident', 'no'], ['socialSecurityLumpSum', 'yes'], ['socialSecuritySpecialIRA', 'yes'], ['socialSecurityForeignExclusion', 'yes'],
    ['socialSecurityIncomeComplete', ''], ['socialSecurityAdjustmentsComplete', 'no'], ['socialSecurityNetBenefits', '-500'],
  ])('preserves review for%s=%s', (field, value) => expect(() => readSocialSecurityFacts({ ...completeBenefits(), [field]: value })).toThrow(SocialSecurityReviewRequiredError));
  it('does not let a No flag hide new benefit or withholding records', () => {
    expect(() => readSocialSecurityFacts({ hasSocialSecurity: 'no', socialSecurityNetBenefits: '20000' })).toThrow();
    expect(() => readSocialSecurityFacts({ hasSocialSecurity: 'no', socialSecurityFederalWithheld: '100' })).toThrow();
  });
});
