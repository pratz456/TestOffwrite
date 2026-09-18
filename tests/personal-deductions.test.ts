import { describe, expect, it } from 'vitest';
import { calculateEnhancedSeniorDeduction, calculateStandardDeduction, isAge65AtTaxYearEnd, PersonalDeductionReviewRequiredError, readPersonalDeductionAnswers } from '../lib/tax-rules/personal-deductions';
import { reviewedPersonalDeductionOrganizer as organizer } from './fixtures/personal-deductions';
const standard = (taxYear = 2026, filingStatus = 'single', org = organizer(taxYear)) => calculateStandardDeduction({ taxYear, filingStatus, organizer: org });
const senior = (agi = 75000, filingStatus = 'single', org = organizer(2026, {}, { dateOfBirth: '1962-01-01' }), taxYear = 2026) => calculateEnhancedSeniorDeduction({ taxYear, filingStatus, agi, organizer: org });

describe('published standard deduction and explicit eligibility facts', () => {
  it.each([
    [2024, 'single', 14600], [2024, 'married_filing_jointly', 29200], [2024, 'married_filing_separately', 14600], [2024, 'head_of_household', 21900],
    [2025, 'single', 15750], [2025, 'married_filing_jointly', 31500], [2025, 'married_filing_separately', 15750], [2025, 'head_of_household', 23625],
    [2026, 'single', 16100], [2026, 'married_filing_jointly', 32200], [2026, 'married_filing_separately', 16100], [2026, 'head_of_household', 24150],
  ])('preserves the fully reviewed base for %s %s', (year, status, expected) => {
    expect(standard(Number(year), String(status)).standardDeduction).toBe(expected);
  });
  it.each([[2024, 1950, 1550], [2025, 2000, 1600], [2026, 2050, 1650]])('applies each age/blindness box in %s', (year, unmarried, married) => {
    const org = organizer(year, { taxpayerBlind: 'yes', spouseBlind: 'yes' }, { dateOfBirth: '1950-01-01', spouseDoB: '1950-01-01' });
    expect(standard(year, 'single', org).additionalStandardDeduction).toBe(unmarried * 2);
    expect(standard(year, 'head_of_household', org).additionalStandardDeduction).toBe(unmarried * 2);
    expect(standard(year, 'married_filing_jointly', org).additionalStandardDeduction).toBe(married * 4);
  });
  it.each([2024, 2025, 2026])('uses the January1 birthday convention without timezone drift for %s', year => {
    expect(isAge65AtTaxYearEnd(`${year - 64}-01-01`, year)).toBe(true);
    expect(isAge65AtTaxYearEnd(`${year - 64}-01-02`, year)).toBe(false);
    expect(isAge65AtTaxYearEnd(`${year - 65}-12-31`, year)).toBe(true);
  });
  it.each(['', undefined, null, '1961', '1961-02-29', '2026-02-30', '2027-01-01', '1961-01-01T00:00:00Z'])('rejects invalid or future DOB %s', date => {
    expect(() => isAge65AtTaxYearEnd(date, 2026)).toThrow(PersonalDeductionReviewRequiredError);
  });
  it('supports dependent worksheet floors, earned addition, basic cap and negative net earnings', () => {
    expect(standard(2024, 'single', organizer(2024, { taxpayerDependent: 'yes', dependentEarnedIncome: '0' })).standardDeduction).toBe(1300);
    for (const [earned, expected] of [['150', 1350], ['2900', 3350], ['20000', 15750], ['-3000', 1350]] as const) {
      expect(standard(2025, 'single', organizer(2025, { taxpayerDependent: 'yes', dependentEarnedIncome: earned })).standardDeduction).toBe(expected);
    }
    expect(standard(2026, 'single', organizer(2026, { taxpayerDependent: 'yes', dependentEarnedIncome: '0' })).standardDeduction).toBe(1350);
  });
  it('matches Pub501 blind dependent example and preserves additions beyond the dependent basic cap', () => {
    expect(standard(2025, 'single', organizer(2025, { taxpayerDependent: 'yes', taxpayerBlind: 'yes', dependentEarnedIncome: '2900' })).standardDeduction).toBe(5350);
    expect(standard(2025, 'single', organizer(2025, { taxpayerDependent: 'yes', taxpayerBlind: 'yes', dependentEarnedIncome: '20000' })).standardDeduction).toBe(17750);
  });
  it('limits a joint return when only the spouse can be claimed as a dependent', () => {
    expect(standard(2026, 'married_filing_jointly', organizer(2026, { spouseDependent: 'yes', dependentEarnedIncome: '4000' })).standardDeduction).toBe(4450);
  });
  it('does not short-circuit a missing spouse dependency answer when taxpayer already answered Yes', () => {
    expect(() => standard(2026, 'married_filing_jointly', organizer(2026, { taxpayerDependent: 'yes', spouseDependent: '', dependentEarnedIncome: '4000' }))).toThrow('your spouse');
  });
  it('makes standard deduction zero when the MFS spouse itemizes regardless of age/blindness', () => {
    const result = standard(2026, 'married_filing_separately', organizer(2026, { mfsSpouseItemizes: 'yes', taxpayerBlind: 'yes' }, { dateOfBirth: '1950-01-01' }));
    expect(result.standardDeduction).toBe(0); expect(result.additionalStandardDeduction).toBe(0); expect(result.standardDeductionAllowed).toBe(false);
  });
  it('permits MFS spouse age/blindness only with explicit no-income/no-return/not-dependent eligibility', () => {
    const facts = { mfsSpouseAdditionalEligible: 'yes', spouseBlind: 'yes' };
    const result = standard(2026, 'married_filing_separately', organizer(2026, facts, { spouseDoB: '1950-01-01' }));
    expect(result.standardDeduction).toBe(19400); expect(result.additionalBoxCount).toBe(2);
    expect(standard(2026, 'married_filing_separately', organizer(2026, { ...facts, mfsSpouseAdditionalEligible: 'no' }, { spouseDoB: '1950-01-01' })).standardDeduction).toBe(16100);
  });
  it.each(['ordinaryScope', 'taxpayerBlind', 'taxpayerDependent'])('does not silently assume missing %s', key => {
    expect(() => standard(2026, 'single', organizer(2026, { [key]: '' }))).toThrow(PersonalDeductionReviewRequiredError);
  });
  it('review-blocks unsupported special cases and stale-year answers', () => {
    expect(() => standard(2026, 'single', organizer(2026, { ordinaryScope: 'no' }))).toThrow('deceased');
    expect(() => standard(2026, 'single', organizer(2025))).toThrow('saved for 2025');
    expect(() => standard(2027, 'single', organizer(2027))).toThrow();
  });
  it.each(['', '[]', '{', 'null', '{"version":2,"taxYear":2026}', '{"version":1}', '{"version":1,"taxYear":2026,"taxpayerBlind":false}'])('safely rejects malformed facts %s', raw => {
    expect(() => readPersonalDeductionAnswers(raw)).toThrow(PersonalDeductionReviewRequiredError);
  });
  it('requires explicit dependent worksheet amount instead of substituting wages or AGI', () => {
    expect(() => standard(2026, 'single', organizer(2026, { taxpayerDependent: 'yes' }))).toThrow('earned income');
  });
});

describe('2025–26 enhanced senior deduction: Schedule1A PartI and V', () => {
  it('starts in2025, supports2026 and refuses guessed2027 parameters', () => {
    expect(senior(75000, 'single', organizer(2024), 2024).deduction).toBe(0);
    expect(senior(75000, 'single', organizer(2025, {}, { dateOfBirth: '1961-01-01' }), 2025).deduction).toBe(6000);
    expect(senior().deduction).toBe(6000);
    expect(() => senior(75000, 'single', organizer(2027), 2027)).toThrow();
  });
  it.each([[75000, 6000], [75001, 5999.94], [100000, 4500], [174999, .06], [175000, 0], [500000, 0], [-1000, 6000]])('single MAGI%s yields%s without rounding phaseout into1000-dollar steps', (agi, deduction) => {
    expect(senior(agi).deduction).toBe(deduction);
  });
  it.each([[150000, 12000], [200000, 6000], [250000, 0]])('phases out each of two eligible spouses separately atMAGI%s', (agi, deduction) => {
    const result = senior(agi, 'married_filing_jointly', organizer(2026, {}, { dateOfBirth: '1950-01-01', spouseDoB: '1950-01-01' }));
    expect(result.deduction).toBe(deduction); expect(result.eligiblePeople).toBe(2);
  });
  it('uses joint threshold but only one deduction if only one spouse qualifies', () => {
    expect(senior(200000, 'married_filing_jointly').deduction).toBe(3000);
    const spouseOnly = organizer(2026, {}, { dateOfBirth: '1990-01-01', spouseDoB: '1950-01-01' });
    expect(senior(200000, 'married_filing_jointly', spouseOnly).deduction).toBe(3000);
  });
  it('adds all four specified MAGI amounts once and leaves supplied AGI unchanged', () => {
    const org = organizer(2026, { seniorHasAddbacks: 'yes', excludedPuertoRicoIncome: '10000', form2555Line45: '5000', form2555Line50: '2000', form4563Line15: '3000' }, { dateOfBirth: '1950-01-01' });
    const input = { taxYear: 2026, filingStatus: 'single', agi: 70000, organizer: org };
    expect(calculateEnhancedSeniorDeduction(input)).toMatchObject({ modifiedAGI: 90000, magiAddbacks: 20000, deduction: 5100 });
    expect(input.agi).toBe(70000);
  });
  it('requires a valid-for-employment SSN declaration for each eligible person, not just a stored number', () => {
    expect(() => senior(75000, 'single', organizer(2026, { taxpayerSeniorSSN: '' }, { dateOfBirth: '1950-01-01', taxpayerSSN: '000000000' }))).toThrow('SSN');
    expect(senior(75000, 'single', organizer(2026, { taxpayerSeniorSSN: 'no' }, { dateOfBirth: '1950-01-01' })).deduction).toBe(0);
    expect(senior(150000, 'married_filing_jointly', organizer(2026, { taxpayerSeniorSSN: 'no' }, { dateOfBirth: '1950-01-01', spouseDoB: '1950-01-01' })).deduction).toBe(6000);
  });
  it('returns0 for MFS and under65 without pretending blindness alone confers senior eligibility', () => {
    expect(senior(75000, 'married_filing_separately').deduction).toBe(0);
    expect(senior(75000, 'single', organizer(2026, { taxpayerBlind: 'yes' }, { dateOfBirth: '1962-01-02' })).deduction).toBe(0);
  });
  it('does not discard an eligible senior deduction merely because the person can be claimed as a dependent', () => {
    expect(senior(1000, 'single', organizer(2026, { taxpayerDependent: 'yes', dependentEarnedIncome: '0' }, { dateOfBirth: '1950-01-01' })).deduction).toBe(6000);
  });
  it('withholds amounts when addbacks are unknown, blank, invalid or contradict No', () => {
    for (const facts of [{ seniorHasAddbacks: '' }, { seniorHasAddbacks: 'yes' }, { seniorHasAddbacks: 'no', form2555Line45: '1000' }, { seniorHasAddbacks: 'no', form2555Line45: 'bad' }]) {
      expect(() => senior(75000, 'single', organizer(2026, facts, { dateOfBirth: '1950-01-01' }))).toThrow(PersonalDeductionReviewRequiredError);
    }
    expect(() => senior(NaN)).toThrow(PersonalDeductionReviewRequiredError);
  });
});
