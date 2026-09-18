import { describe, expect, it } from 'vitest';
import { compute1040, type Form1040Input } from '../lib/tax-rules/compute-1040';
import { buildFederalTaxSnapshot } from '../lib/tax-rules/federal-tax-snapshot';
import { SocialSecurityReviewRequiredError } from '../lib/tax-rules/social-security';
import {
  CAPITAL_LOSS_LIMIT, CAPITAL_LOSS_LIMIT_SEPARATE, CapitalGainReviewRequiredError,
  calculateCapitalGainCharacter, hasCapitalGainAmounts, readCapitalGainFacts,
} from '../lib/tax-rules/capital-gains';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';

const character = (shortTerm: number, longTerm: number, filingStatus = 'single', taxYear = 2026) =>
  calculateCapitalGainCharacter({ taxYear, filingStatus, shortTerm, longTerm });

describe('organizer capital-gain facts', () => {
  it('review-blocks a nonzero legacy combined total instead of assuming long-term character', () => {
    expect(() => readCapitalGainFacts({ hasCapGains: 'yes', amountCapGains: '5000' })).toThrow(CapitalGainReviewRequiredError);
    expect(() => readCapitalGainFacts({ amountCapGains: '-3000' })).toThrow(/long-term treatment is not assumed/);
    try { readCapitalGainFacts({ amountCapGains: '5000' }); } catch (error) {
      expect(error).toMatchObject({ code: 'CAPITAL_GAIN_REVIEW_REQUIRED', message: expect.stringContaining('Tax Organizer') });
    }
  });

  it('accepts a recorded short/long-term split, including explicit zeros, and blank as unanswered', () => {
    expect(readCapitalGainFacts({ hasCapGains: 'yes', amountShortTermCapGains: '1200.50', amountLongTermCapGains: '0' }))
      .toEqual({ shortTerm: 1200.5, longTerm: 0, characterRecorded: true });
    expect(readCapitalGainFacts({})).toEqual({ shortTerm: 0, longTerm: 0, characterRecorded: false });
    expect(readCapitalGainFacts({ hasCapGains: 'no', amountCapGains: '' })).toEqual({ shortTerm: 0, longTerm: 0, characterRecorded: false });
    expect(readCapitalGainFacts({ hasCapGains: 'yes', amountCapGains: '0' })).toEqual({ shortTerm: 0, longTerm: 0, characterRecorded: false });
  });

  it.each([
    { hasCapGains: 'yes' },
    { amountShortTermCapGains: '500' },
    { amountLongTermCapGains: '-500' },
    { amountShortTermCapGains: '1,000', amountLongTermCapGains: '0' },
    { amountShortTermCapGains: '100', amountLongTermCapGains: '200', amountCapGains: '5000' },
    { hasCapGains: 'no', amountShortTermCapGains: '100', amountLongTermCapGains: '0' },
  ])('requires review for incomplete or inconsistent entries %j rather than substituting zero', organizer => {
    expect(() => readCapitalGainFacts(organizer)).toThrow(CapitalGainReviewRequiredError);
  });

  it('reports any nonzero saved amount for the other review gates', () => {
    expect(hasCapitalGainAmounts({ amountCapGains: '10' })).toBe(true);
    expect(hasCapitalGainAmounts({ amountShortTermCapGains: '0', amountLongTermCapGains: '-1' })).toBe(true);
    expect(hasCapitalGainAmounts({ amountShortTermCapGains: '0', amountLongTermCapGains: '0', amountCapGains: '' })).toBe(false);
  });
});

describe('Schedule D character and the §1211(b) loss limit', () => {
  it('treats net short-term gain as ordinary income and net long-term gain as preferential', () => {
    expect(character(8000, 0)).toMatchObject({ line7: 8000, ordinaryShortTermGain: 8000, preferentialLongTermGain: 0, lossCarryforward: 0 });
    expect(character(0, 8000)).toMatchObject({ line7: 8000, ordinaryShortTermGain: 0, preferentialLongTermGain: 8000 });
  });

  it('nets a loss of one character against a gain of the other (Schedule D line 16)', () => {
    // Long-term gain reduced by a short-term loss keeps the remainder preferential.
    expect(character(-4000, 10000)).toMatchObject({ netGainOrLoss: 6000, line7: 6000, preferentialLongTermGain: 6000, ordinaryShortTermGain: 0 });
    // Short-term gain reduced by a long-term loss is entirely ordinary.
    expect(character(10000, -4000)).toMatchObject({ netGainOrLoss: 6000, line7: 6000, preferentialLongTermGain: 0, ordinaryShortTermGain: 6000 });
  });

  it('limits a net capital loss to $3,000 and notes the carryforward as a warning', () => {
    expect(CAPITAL_LOSS_LIMIT).toBe(3000);
    const within = character(-2000, -500);
    expect(within).toMatchObject({ line7: -2500, allowedLoss: 2500, lossCarryforward: 0 });
    expect(within.warnings.some(w => w.includes('carries forward'))).toBe(false);
    const limited = character(-5000, 1000);
    expect(limited).toMatchObject({ netGainOrLoss: -4000, line7: -3000, allowedLoss: 3000, lossCarryforward: 1000, preferentialLongTermGain: 0 });
    expect(limited.warnings.some(w => w.includes('$1,000 carries forward') && w.includes('Capital Loss Carryover Worksheet'))).toBe(true);
  });

  it('uses the $1,500 married-filing-separately loss limit', () => {
    expect(CAPITAL_LOSS_LIMIT_SEPARATE).toBe(1500);
    expect(character(-5000, 0, 'married_filing_separately')).toMatchObject({ capitalLossLimit: 1500, line7: -1500, lossCarryforward: 3500 });
    expect(character(-5000, 0, 'married_filing_jointly')).toMatchObject({ capitalLossLimit: 3000, line7: -3000, lossCarryforward: 2000 });
  });
});

describe('Form 1040 uses the recorded character', () => {
  const base: Form1040Input = {
    taxYear: 2026, filingStatus: 'single', personalDeductionOrganizer: reviewedPersonalDeductionOrganizer(),
    scheduleCNetProfit: 0, w2Wages: 100000, w2MedicareWages: 100000, otherIncome: 0,
    w2FederalWithheld: 0, estimatedPayments: 0, selfEmploymentTax: 0, halfSEDeduction: 0,
    healthInsurancePremiums: 0, sepIraContribution: 0, solo401kContribution: 0,
    simpleIraContribution: 0, hsaContribution: 0, studentLoanInterest: 0,
  };

  it('taxes short-term gains at ordinary rates and long-term gains at the stacked 0/15/20% rates', () => {
    const wagesOnly = compute1040({ ...base, w2Wages: 120000, w2MedicareWages: 120000 });
    const shortTerm = compute1040({ ...base, otherIncome: 20000, shortTermCapGains: 20000 });
    const longTerm = compute1040({ ...base, otherIncome: 20000, longTermCapGains: 20000 });
    expect(shortTerm.incomeTax).toBe(wagesOnly.incomeTax);
    expect(shortTerm.longTermCapGainsTax).toBe(0);
    expect(longTerm.longTermCapGainsTax).toBe(3000);
    expect(longTerm.incomeTax).toBeLessThan(shortTerm.incomeTax);
  });

  const snapshot = (organizer: Record<string, unknown>, filingStatus = 'Single') => buildFederalTaxSnapshot({
    taxYear: 2026, profile: { filing_status: filingStatus }, organizer, transactions: [], grossReceipts: [], forms1099: [],
    w2Entries: [{ box1Wages: 60000, box2FederalWithheld: 0, box3SocialSecurityWages: 60000, box5MedicareWages: 60000 }],
    deductions: {}, assets: [], estimatedPayments: 0,
  });

  it('applies the split and the loss limit through the organizer snapshot', () => {
    const result = snapshot(reviewedPersonalDeductionOrganizer(2026, {}, { hasCapGains: 'yes', amountShortTermCapGains: '-5000', amountLongTermCapGains: '1000' }));
    expect(result.income).toMatchObject({ capGains: -3000, shortTermCapGains: -5000, longTermCapGains: 1000, capitalLossCarryforward: 1000 });
    expect(result.result.totalIncome).toBe(57000);
    expect(result.result.agi).toBe(57000);
    expect(result.result.calculationWarnings.some(w => w.includes('$1,000 carries forward'))).toBe(true);
    const gain = snapshot(reviewedPersonalDeductionOrganizer(2026, {}, { hasCapGains: 'yes', amountShortTermCapGains: '0', amountLongTermCapGains: '20000' }));
    expect(gain.result.totalIncome).toBe(80000);
    // Taxable income $63,900 with $43,900 ordinary: $5,550 of the gain fills the 2026 single 0% band
    // (to $49,450, Rev. Proc. 2025-32) and $14,450 is taxed at 15%.
    expect(gain.result.longTermCapGainsTax).toBe(2167.5);
    expect(gain.capitalGains.preferentialLongTermGain).toBe(20000);
  });

  it('review-blocks the legacy combined total in the snapshot with the capital-gain code', () => {
    expect(() => snapshot(reviewedPersonalDeductionOrganizer(2026, {}, { hasCapGains: 'yes', amountCapGains: '20000' })))
      .toThrow(CapitalGainReviewRequiredError);
  });

  it('keeps the Social Security gate ahead of capital-gain character for split amounts too', () => {
    const benefits = {
      hasSocialSecurity: 'yes', filingStatus: 'Single', socialSecurityResident: 'yes', socialSecurityLumpSum: 'no', socialSecuritySpecialIRA: 'no',
      socialSecurityForeignExclusion: 'no', socialSecurityIncomeComplete: 'yes', socialSecurityAdjustmentsComplete: 'yes',
      socialSecurityNetBenefits: '20000', socialSecurityTaxExemptInterest: '0', socialSecurityExcludedSavingsBondInterest: '0',
      socialSecurityAdoptionExclusion: '0', socialSecurityFederalWithheld: '0',
    };
    expect(() => snapshot(reviewedPersonalDeductionOrganizer(2026, {}, { ...benefits, hasCapGains: 'yes', amountShortTermCapGains: '100', amountLongTermCapGains: '0' })))
      .toThrow(SocialSecurityReviewRequiredError);
    expect(() => snapshot(reviewedPersonalDeductionOrganizer(2026, {}, { ...benefits, amountCapGains: '100' })))
      .toThrow(SocialSecurityReviewRequiredError);
  });
});
