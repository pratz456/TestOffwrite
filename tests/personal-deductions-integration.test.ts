import { describe, expect, it } from 'vitest';
import { compute1040, type Form1040Input } from '../lib/tax-rules/compute-1040';
import { buildFederalTaxSnapshot } from '../lib/tax-rules/federal-tax-snapshot';
import { PersonalDeductionReviewRequiredError } from '../lib/tax-rules/personal-deductions';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';

const input = (overrides: Partial<Form1040Input> = {}): Form1040Input => ({
  taxYear: 2026, filingStatus: 'single', personalDeductionOrganizer: reviewedPersonalDeductionOrganizer(),
  scheduleCNetProfit: 0, w2Wages: 100000, w2MedicareWages: 100000, otherIncome: 0,
  w2FederalWithheld: 0, estimatedPayments: 0, selfEmploymentTax: 0, halfSEDeduction: 0,
  healthInsurancePremiums: 0, sepIraContribution: 0, solo401kContribution: 0,
  simpleIraContribution: 0, hsaContribution: 0, studentLoanInterest: 0, ...overrides,
});

describe('annual engine uses the reviewed standard and senior deductions', () => {
  it('preserves the ordinary under65 result with complete declarations', () => {
    const result = compute1040(input());
    expect(result).toMatchObject({ agi: 100000, standardDeduction: 16100, enhancedSeniorDeduction: 0, incomeTax: 13170, totalTax: 13170 });
    expect(result.personalDeductions?.standard).toMatchObject({ additionalBoxCount: 0, standardDeduction: 16100 });
    expect(result.personalDeductions?.senior.deduction).toBe(0);
  });

  it('applies both age65 deductions at the January1 boundary, after AGI', () => {
    const result = compute1040(input({ personalDeductionOrganizer: reviewedPersonalDeductionOrganizer(2026, {}, { dateOfBirth: '1962-01-01' }) }));
    expect(result).toMatchObject({ agi: 100000, adjustments: 0, standardDeduction: 18150, enhancedSeniorDeduction: 4500, taxableIncome: 77350, incomeTax: 11729 });
    expect(result.personalDeductions?.senior).toMatchObject({ modifiedAGI: 100000, eligiblePeople: 1 });
  });

  it('applies the joint senior phaseout per person rather than once per return', () => {
    const result = compute1040(input({ filingStatus: 'married_filing_jointly', w2Wages: 200000, w2MedicareWages: 200000,
      personalDeductionOrganizer: reviewedPersonalDeductionOrganizer(2026, {}, { dateOfBirth: '1960-01-01', spouseDoB: '1961-01-01' }) }));
    expect(result).toMatchObject({ agi: 200000, standardDeduction: 35500, enhancedSeniorDeduction: 6000, taxableIncome: 158500 });
    expect(result.personalDeductions?.senior).toMatchObject({ eligiblePeople: 2, perPersonDeduction: 3000 });
  });

  it('subtracts Schedule1-A senior deduction before the Form8995 taxable-income cap', () => {
    // $40,000 profit - $2,825.91 half-SE = $37,174.09 AGI.
    // Form8995 line11: $37,174.09 - $18,150 standard - $6,000 senior = $13,024.09.
    // 20% cap is $2,604.818, below the $7,434.818 uncapped business deduction.
    const result = compute1040(input({ w2Wages: 0, w2MedicareWages: 0, scheduleCNetProfit: 40000,
      selfEmploymentTax: 5651.82, halfSEDeduction: 2825.91,
      personalDeductionOrganizer: reviewedPersonalDeductionOrganizer(2026, {}, { dateOfBirth: '1960-01-01' }) }));
    expect(result).toMatchObject({ agi: 37174.09, standardDeduction: 18150, enhancedSeniorDeduction: 6000, qbiDeduction: 2604.82, taxableIncome: 10419.27 });
  });

  it('does not label a barred MFS standard deduction as the chosen deduction', () => {
    const result = compute1040(input({ filingStatus: 'married_filing_separately', itemizedDeductions: 0,
      personalDeductionOrganizer: reviewedPersonalDeductionOrganizer(2026, { mfsSpouseItemizes: 'yes' }) }));
    expect(result).toMatchObject({ standardDeduction: 0, deductionUsed: 0, usingStandardDeduction: false, enhancedSeniorDeduction: 0 });
  });

  it('applies the dependent earned-income limit without creating an unreviewed EITC', () => {
    const result = compute1040(input({ w2Wages: 0, w2MedicareWages: 0, otherIncome: 30000, investmentIncome: 30000,
      personalDeductionOrganizer: reviewedPersonalDeductionOrganizer(2026, { taxpayerDependent: 'yes', dependentEarnedIncome: '0' }) }));
    expect(result).toMatchObject({ standardDeduction: 1350, taxableIncome: 28650, eitcCredit: 0 });
  });

  it.each([{}, reviewedPersonalDeductionOrganizer(2025)])('does not interpret missing or stale annual declarations as an ordinary taxpayer', organizer => {
    expect(() => compute1040(input({ personalDeductionOrganizer: organizer }))).toThrow(PersonalDeductionReviewRequiredError);
  });
});

describe('senior deductions remain below the Social Security worksheet and AGI', () => {
  it('preserves taxable benefits and retirement-income AGI while reducing taxable income', () => {
    const organizer = reviewedPersonalDeductionOrganizer(2026, {}, {
      dateOfBirth: '1960-01-01', filingStatus: 'Single', amountIRADistributions: '40000',
      socialSecurityRetirementReviewed: 'yes', hasSocialSecurity: 'yes', socialSecurityResident: 'yes',
      socialSecurityLumpSum: 'no', socialSecuritySpecialIRA: 'no', socialSecurityForeignExclusion: 'no',
      socialSecurityIncomeComplete: 'yes', socialSecurityAdjustmentsComplete: 'yes',
      socialSecurityNetBenefits: '20000', socialSecurityTaxExemptInterest: '0',
      socialSecurityExcludedSavingsBondInterest: '0', socialSecurityAdoptionExclusion: '0', socialSecurityFederalWithheld: '1200',
    });
    const snapshot = (org: Record<string, unknown>) => buildFederalTaxSnapshot({ taxYear: 2026,
      profile: { filing_status: 'Single' }, organizer: org, transactions: [], grossReceipts: [], forms1099: [],
      w2Entries: [], deductions: {}, assets: [], estimatedPayments: 0,
    });
    const senior = snapshot(organizer);
    const ineligible = snapshot({ ...organizer,
      personalDeductionFacts: reviewedPersonalDeductionOrganizer(2026, { taxpayerSeniorSSN: 'no' }).personalDeductionFacts });
    expect(senior.socialSecurityWorksheet).toEqual(ineligible.socialSecurityWorksheet);
    expect(senior.socialSecurityWorksheet).toMatchObject({ combinedIncome: 50000, taxableBenefits: 17000 });
    expect(senior.result).toMatchObject({ totalIncome: 57000, agi: 57000, adjustments: 0, enhancedSeniorDeduction: 6000, taxableIncome: 32850, socialSecurityFederalWithheld: 1200 });
    expect(ineligible.result).toMatchObject({ agi: 57000, enhancedSeniorDeduction: 0, taxableIncome: 38850 });
  });
});
