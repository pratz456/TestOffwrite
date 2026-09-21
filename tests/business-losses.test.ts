import { describe, expect, it } from 'vitest';
import { compute1040, type Form1040Input } from '../lib/tax-rules/compute-1040';
import { buildFederalTaxSnapshot } from '../lib/tax-rules/federal-tax-snapshot';
import { getFederalTaxRules } from '../lib/tax-rules/federal-year-rules';
import { SocialSecurityReviewRequiredError } from '../lib/tax-rules/social-security';
import { BusinessLossReviewRequiredError, calculateAllowedBusinessLoss, readBusinessLossAnswers } from '../lib/tax-rules/business-losses';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { reviewedBusinessLossFacts } from './fixtures/tier1-facts';

const allowed = (netLoss: number, businessLossFacts: string | undefined, filingStatus = 'single', taxYear = 2026) =>
  calculateAllowedBusinessLoss({ taxYear, filingStatus, netLoss, organizer: businessLossFacts === undefined ? {} : { businessLossFacts } });

describe('Schedule C loss facts', () => {
  it('review-blocks a loss without saved at-risk, participation and profit-motive facts', () => {
    expect(() => allowed(5000, undefined)).toThrow(BusinessLossReviewRequiredError);
    expect(() => calculateAllowedBusinessLoss({ taxYear: 2026, filingStatus: 'single', netLoss: 5000 })).toThrow(BusinessLossReviewRequiredError);
    try { allowed(5000, undefined); } catch (error) {
      expect(error).toMatchObject({ code: 'BUSINESS_LOSS_REVIEW_REQUIRED', message: expect.stringContaining('Tax Organizer') });
      expect((error as Error).message).toContain('$5,000');
    }
  });

  it('does not treat an unanswered question or another year as No, and does not treat No as allowed', () => {
    expect(() => allowed(5000, reviewedBusinessLossFacts(2026, { profitMotive: '' }))).toThrow(/unanswered question is not/);
    expect(() => allowed(5000, reviewedBusinessLossFacts(2025))).toThrow(/saved for 2025/);
    expect(() => allowed(5000, reviewedBusinessLossFacts(2026, { allInvestmentAtRisk: 'no' }))).toThrow(/Form 6198/);
    expect(() => allowed(5000, reviewedBusinessLossFacts(2026, { materialParticipation: 'no' }))).toThrow(/Form 8582/);
    expect(() => allowed(5000, reviewedBusinessLossFacts(2026, { profitMotive: 'no' }))).toThrow(/section 183 hobby/);
  });

  it.each(['{', '[]', JSON.stringify({ version: 2, taxYear: 2026 }), JSON.stringify({ version: 1, taxYear: 2026, profitMotive: true })])('rejects malformed saved answers %s', raw => {
    expect(() => readBusinessLossAnswers(raw)).toThrow(BusinessLossReviewRequiredError);
  });

  it('allows the full loss with complete declarations and a zero loss without facts', () => {
    const result = allowed(5000, reviewedBusinessLossFacts());
    expect(result).toMatchObject({ netLoss: 5000, allowedLoss: 5000, excessBusinessLoss: 0, excessBusinessLossThreshold: 256000 });
    expect(result.warnings[0]).toContain('offsets other income based on your at-risk, material participation and profit-motive declarations');
    expect(allowed(0, undefined)).toMatchObject({ allowedLoss: 0, excessBusinessLoss: 0, warnings: [] });
  });

  it.each([
    [2026, 'single', 256000, 256000],
    [2026, 'married_filing_jointly', 512000, 512000],
    [2026, 'married_filing_separately', 256000, 256000],
    [2026, 'head_of_household', 256000, 256000],
    [2025, 'single', 313000, 313000],
    [2025, 'married_filing_jointly', 626000, 626000],
    [2024, 'single', 305000, 305000],
    [2024, 'married_filing_jointly', 610000, 610000],
  ])('applies the %i §461(l) excess business loss threshold for %s', (taxYear, filingStatus, threshold, expectedAllowed) => {
    expect(getFederalTaxRules(taxYear).excessBusinessLossThreshold[filingStatus as 'single']).toBe(threshold);
    const result = allowed(700000, reviewedBusinessLossFacts(taxYear), filingStatus, taxYear);
    expect(result.allowedLoss).toBe(expectedAllowed);
    expect(result.excessBusinessLoss).toBe(700000 - expectedAllowed);
    expect(result.warnings.some(w => w.includes(`$${threshold.toLocaleString('en-US')}`) && w.includes('net operating loss carryforward'))).toBe(true);
  });

  it('caps exactly at the threshold with no excess', () => {
    expect(allowed(256000, reviewedBusinessLossFacts())).toMatchObject({ allowedLoss: 256000, excessBusinessLoss: 0 });
    expect(allowed(256000.01, reviewedBusinessLossFacts())).toMatchObject({ allowedLoss: 256000, excessBusinessLoss: 0.01 });
  });
});

describe('Form 1040 with a Schedule C loss', () => {
  const base: Form1040Input = {
    taxYear: 2026, filingStatus: 'single', personalDeductionOrganizer: reviewedPersonalDeductionOrganizer(),
    scheduleCNetProfit: -15000, w2Wages: 80000, w2MedicareWages: 80000, otherIncome: 0,
    w2FederalWithheld: 0, estimatedPayments: 0, selfEmploymentTax: 0, halfSEDeduction: 0,
    healthInsurancePremiums: 0, sepIraContribution: 0, solo401kContribution: 0,
    simpleIraContribution: 0, hsaContribution: 0, studentLoanInterest: 0,
  };
  const withFacts = (facts = reviewedBusinessLossFacts(), organizer: Record<string, unknown> = {}) =>
    reviewedPersonalDeductionOrganizer(2026, {}, { businessLossFacts: facts, ...organizer });

  it('no longer clamps the loss silently: missing facts are review-blocked', () => {
    expect(() => compute1040(base)).toThrow(BusinessLossReviewRequiredError);
    expect(() => compute1040({ ...base, personalDeductionOrganizer: undefined })).toThrow(BusinessLossReviewRequiredError);
  });

  it('offsets W-2 income with the allowed loss and reports zero QBI with a carryforward note', () => {
    const result = compute1040({ ...base, personalDeductionOrganizer: withFacts() });
    expect(result).toMatchObject({ scheduleCAllowed: -15000, totalIncome: 65000, agi: 65000, qbiDeduction: 0, taxableIncome: 48900 });
    expect(result.businessLoss).toMatchObject({ netLoss: 15000, allowedLoss: 15000, excessBusinessLoss: 0 });
    expect(result.calculationWarnings.some(w => w.includes('no QBI deduction applies this year') && w.includes('Form 8995 line 16'))).toBe(true);
    expect(result.calculationWarnings.some(w => w.includes('Business losses are not applied'))).toBe(false);
    expect(result.additionalMedicareTax).toBe(0);
  });

  it('applies depreciation before the loss facts and caps the loss at the §461(l) threshold', () => {
    const result = compute1040({ ...base, scheduleCNetProfit: -250000, depreciationDeduction: 50000, w2Wages: 400000, w2MedicareWages: 400000, personalDeductionOrganizer: withFacts() });
    expect(result.businessLoss).toMatchObject({ netLoss: 300000, allowedLoss: 256000, excessBusinessLoss: 44000 });
    expect(result).toMatchObject({ scheduleCAllowed: -256000, totalIncome: 144000 });
    expect(result.calculationWarnings.some(w => w.includes('$44,000 is disallowed this year'))).toBe(true);
  });

  it('floors AGI at zero with an NOL warning instead of a negative tax base', () => {
    const result = compute1040({ ...base, scheduleCNetProfit: -100000, personalDeductionOrganizer: withFacts() });
    expect(result).toMatchObject({ totalIncome: -20000, agi: 0, taxableIncome: 0, incomeTax: 0 });
    expect(result.calculationWarnings.some(w => w.includes('net operating loss') && w.includes('Publication 536'))).toBe(true);
  });

  const snapshot = (organizer: Record<string, unknown>, extra: Partial<Parameters<typeof buildFederalTaxSnapshot>[0]> = {}) => buildFederalTaxSnapshot({
    taxYear: 2026, profile: { filing_status: 'Single' }, organizer,
    transactions: [{ amount: 9000, date: '2026-03-01', category: 'office_expense', is_deductible: true }],
    grossReceipts: [{ amount: 4000 }], forms1099: [],
    w2Entries: [{ box1Wages: 50000, box2FederalWithheld: 0, box3SocialSecurityWages: 50000, box5MedicareWages: 50000 }],
    deductions: {}, assets: [], estimatedPayments: 0, ...extra,
  });

  it('keeps SE tax at $0 in a loss year and offsets other income through the organizer snapshot', () => {
    expect(() => snapshot(reviewedPersonalDeductionOrganizer())).toThrow(BusinessLossReviewRequiredError);
    const result = snapshot(withFacts());
    expect(result.income).toMatchObject({ scheduleCNetProfit: -5000, scheduleCAllowed: -5000 });
    expect(result.seCalc.totalSETax).toBe(0);
    expect(result.seCalc.halfSEDeduction).toBe(0);
    expect(result.result).toMatchObject({ totalIncome: 45000, agi: 45000, selfEmploymentTax: 0, qbiDeduction: 0 });
    expect(result.businessLoss).toMatchObject({ allowedLoss: 5000 });
  });

  it('does not weaken the Social Security business-loss gate', () => {
    const organizer = withFacts(reviewedBusinessLossFacts(), {
      hasSocialSecurity: 'yes', filingStatus: 'Single', socialSecurityResident: 'yes', socialSecurityLumpSum: 'no', socialSecuritySpecialIRA: 'no',
      socialSecurityForeignExclusion: 'no', socialSecurityIncomeComplete: 'yes', socialSecurityAdjustmentsComplete: 'yes',
      socialSecurityNetBenefits: '20000', socialSecurityTaxExemptInterest: '0', socialSecurityExcludedSavingsBondInterest: '0',
      socialSecurityAdoptionExclusion: '0', socialSecurityFederalWithheld: '0',
    });
    expect(() => snapshot(organizer)).toThrow(SocialSecurityReviewRequiredError);
  });
});
