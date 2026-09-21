import { describe, expect, it } from 'vitest';
import { compute1040, type Form1040Input } from '../lib/tax-rules/compute-1040';
import {
  NON_ITEMIZER_CHARITY_LIMIT, NON_ITEMIZER_CHARITY_LIMIT_JOINT, OBBBADeductionReviewRequiredError, QUALIFIED_OVERTIME_LIMIT,
  QUALIFIED_OVERTIME_LIMIT_JOINT, QUALIFIED_TIPS_LIMIT, VEHICLE_LOAN_INTEREST_LIMIT, calculateOBBBADeductions, phaseoutReduction,
  type OBBBADeductionAnswers, type OBBBADeductionInput,
} from '../lib/tax-rules/obbba-deductions';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { reviewedOBBBADeductionFacts, SYNTHETIC_VIN } from './fixtures/tier1-facts';

const run = (facts: Partial<OBBBADeductionAnswers> | undefined, overrides: Partial<OBBBADeductionInput> = {}) => calculateOBBBADeductions({
  taxYear: 2026, filingStatus: 'single', agi: 100000, scheduleCNetProfit: 60000, usingStandardDeduction: true,
  organizer: facts === undefined ? {} : { obbbaDeductionFacts: reviewedOBBBADeductionFacts(overrides.taxYear ?? 2026, facts) },
  ...overrides,
});
const tips = (amount: string, extra: Partial<OBBBADeductionAnswers> = {}): Partial<OBBBADeductionAnswers> =>
  ({ hasQualifiedTips: 'yes', qualifiedTipsAmount: amount, tipsOccupationListed: 'yes', tipsBusinessSSTB: 'no', ...extra });
const vehicle = (amount: string, extra: Partial<OBBBADeductionAnswers> = {}): Partial<OBBBADeductionAnswers> => ({
  hasVehicleLoanInterest: 'yes', vehicleLoanInterestAmount: amount, vehicleLoanAfter2024: 'yes', vehicleNewUSAssembled: 'yes',
  vehiclePersonalUse: 'yes', vehicleLoanQualified: 'yes', vehicleVIN: SYNTHETIC_VIN, ...extra,
});

describe('Schedule 1-A intake states', () => {
  it('applies nothing for unanswered intake and says so, without treating blank as No', () => {
    const missing = run(undefined);
    expect(missing).toMatchObject({ reviewed: false, total: 0, scheduleOneATotal: 0, modifiedAGI: null });
    expect(missing.warnings[0]).toMatch(/not reviewed in Tax Organizer for 2026.*Blank answers are not treated as No/);
    const stale = run({}, { organizer: { obbbaDeductionFacts: reviewedOBBBADeductionFacts(2025) } });
    expect(stale.warnings[0]).toContain('saved answers belong to another year');
    const partial = run({ hasQualifiedTips: '', hasNonItemizerCharity: '' });
    expect(partial.reviewed).toBe(false);
    expect(partial.warnings[0]).toContain('not answered for 2026: qualified tips, non-itemizer charitable gifts');
    expect(partial.total).toBe(0);
  });

  it('is fully reviewed with all-No answers and yields no deduction', () => {
    expect(run({})).toMatchObject({ reviewed: true, total: 0, warnings: [] });
  });

  it('returns nothing before 2025 and does not ask for the charitable answer before 2026', () => {
    expect(run({}, { taxYear: 2024 })).toMatchObject({ reviewed: true, total: 0 });
    expect(run(tips('5000'), { taxYear: 2024 }).qualifiedTips.reason).toContain('begin in 2025');
    expect(run({ hasNonItemizerCharity: '' }, { taxYear: 2025 })).toMatchObject({ reviewed: true });
    expect(run({ hasNonItemizerCharity: 'yes', nonItemizerCashCharity: '900' }, { taxYear: 2025 }).nonItemizerCharitable).toMatchObject({ deduction: 0, reason: expect.stringContaining('begins in 2026') });
  });

  it('review-blocks unmodeled MAGI add-backs only when a deduction is claimed', () => {
    expect(() => run(tips('5000', { magiForeignExclusions: 'yes' }))).toThrow(OBBBADeductionReviewRequiredError);
    expect(() => run(tips('5000', { magiForeignExclusions: '' }))).toThrow(/unanswered question is not/);
    expect(run({ magiForeignExclusions: 'yes' }).total).toBe(0);
  });

  it.each(['{', '[1]', JSON.stringify({ version: 1, taxYear: 2026, hasQualifiedTips: 1 })])('review-blocks malformed saved answers %s', raw => {
    expect(() => run({}, { organizer: { obbbaDeductionFacts: raw } })).toThrow(OBBBADeductionReviewRequiredError);
  });
});

describe('qualified tips deduction (§224)', () => {
  it('is the smallest of tips, $25,000 and Schedule C net profit', () => {
    expect(QUALIFIED_TIPS_LIMIT).toBe(25000);
    expect(run(tips('30000')).qualifiedTips).toMatchObject({ deduction: 25000, amountReported: 30000, limitedAmount: 25000, phaseoutReduction: 0 });
    expect(run(tips('10000'), { scheduleCNetProfit: 8000 }).qualifiedTips.deduction).toBe(8000);
    expect(run(tips('10000'), { scheduleCNetProfit: 0 }).qualifiedTips).toMatchObject({ deduction: 0, reason: expect.stringContaining('cannot exceed the net profit') });
    expect(run(tips('10000'), { scheduleCNetProfit: -5000 }).qualifiedTips.deduction).toBe(0);
  });

  it.each([
    ['single', 150000, 0], ['single', 150999, 0], ['single', 151000, 100], ['single', 160000, 1000], ['single', 400000, 25000],
    ['married_filing_jointly', 300000, 0], ['married_filing_jointly', 300999, 0], ['married_filing_jointly', 301000, 100],
    ['head_of_household', 151000, 100],
  ])('phases out $100 per whole $1,000 of MAGI over the %s threshold at MAGI %i', (filingStatus, agi, reduction) => {
    const result = run(tips('30000'), { filingStatus, agi, scheduleCNetProfit: agi });
    expect(result.qualifiedTips).toMatchObject({ phaseoutReduction: reduction, deduction: 25000 - reduction });
    expect(result.modifiedAGI).toBe(agi);
  });

  it('is unavailable married filing separately and without a work-eligible SSN or a listed occupation', () => {
    expect(run(tips('5000'), { filingStatus: 'married_filing_separately' }).qualifiedTips).toMatchObject({ deduction: 0, amountReported: 5000, reason: expect.stringContaining('file jointly') });
    expect(run(tips('5000', { workEligibleSSN: 'no' })).qualifiedTips.reason).toContain('Social Security number');
    expect(run(tips('5000', { tipsOccupationListed: 'no' })).qualifiedTips.reason).toContain('tipped-occupation list');
  });

  it('review-blocks SSTB tips with the Notice 2025-69 transition note and incomplete facts', () => {
    expect(() => run(tips('5000', { tipsBusinessSSTB: 'yes' }))).toThrow(/Notice 2025-69/);
    expect(() => run(tips('5000', { tipsBusinessSSTB: '' }))).toThrow(OBBBADeductionReviewRequiredError);
    expect(() => run(tips(''))).toThrow(/enter qualified tips/);
    expect(() => run(tips('-5'))).toThrow(OBBBADeductionReviewRequiredError);
    expect(() => run(tips('5000', { tipsOccupationListed: '' }))).toThrow(/unanswered question is not/);
  });
});

describe('qualified overtime deduction (§225)', () => {
  it('caps W-2 box 12 code TT overtime at $12,500 ($25,000 joint) with the tips phaseout', () => {
    expect([QUALIFIED_OVERTIME_LIMIT, QUALIFIED_OVERTIME_LIMIT_JOINT]).toEqual([12500, 25000]);
    expect(run({ hasW2Overtime: 'yes', qualifiedOvertimeAmount: '20000' }).qualifiedOvertime).toMatchObject({ deduction: 12500, limitedAmount: 12500 });
    expect(run({ hasW2Overtime: 'yes', qualifiedOvertimeAmount: '30000' }, { filingStatus: 'married_filing_jointly' }).qualifiedOvertime.deduction).toBe(25000);
    expect(run({ hasW2Overtime: 'yes', qualifiedOvertimeAmount: '20000' }, { agi: 151000 }).qualifiedOvertime).toMatchObject({ phaseoutReduction: 100, deduction: 12400 });
    expect(run({ hasW2Overtime: 'yes', qualifiedOvertimeAmount: '20000' }, { agi: 275000 }).qualifiedOvertime.deduction).toBe(0);
  });

  it('is unavailable married filing separately and review-blocks contractor overtime', () => {
    expect(run({ hasW2Overtime: 'yes', qualifiedOvertimeAmount: '5000' }, { filingStatus: 'married_filing_separately' }).qualifiedOvertime).toMatchObject({ deduction: 0, reason: expect.stringContaining('file jointly') });
    expect(run({ hasW2Overtime: 'yes', qualifiedOvertimeAmount: '5000', workEligibleSSN: 'no' }).qualifiedOvertime.deduction).toBe(0);
    expect(() => run({ has1099Overtime: 'yes' })).toThrow(/Fair Labor Standards Act section 7 applies to employees/);
  });
});

describe('qualified passenger vehicle loan interest (§163(h)(4))', () => {
  it('rounds the phaseout up to the next $1,000 (or portion thereof)', () => {
    expect(phaseoutReduction(100001, 100000, 200, 'ceil')).toBe(200);
    expect(phaseoutReduction(101000, 100000, 200, 'ceil')).toBe(200);
    expect(phaseoutReduction(101001, 100000, 200, 'ceil')).toBe(400);
    expect(phaseoutReduction(150999, 150000, 100, 'floor')).toBe(0);
  });

  it.each([
    ['single', 100000, 0], ['single', 100001, 200], ['single', 101000, 200], ['single', 101001, 400], ['single', 150000, 10000],
    ['married_filing_jointly', 200000, 0], ['married_filing_jointly', 200001, 200], ['married_filing_separately', 100001, 200],
  ])('limits interest to $10,000 less $200 per $1,000 (or part) of MAGI over the %s threshold at MAGI %i', (filingStatus, agi, reduction) => {
    expect(VEHICLE_LOAN_INTEREST_LIMIT).toBe(10000);
    const result = run(vehicle('12000'), { filingStatus, agi });
    expect(result.vehicleLoanInterest).toMatchObject({ limitedAmount: 10000, phaseoutReduction: reduction, deduction: 10000 - reduction });
  });

  it('denies interest on pre-2025 loans, used or foreign-assembled vehicles and non-qualifying loans', () => {
    expect(run(vehicle('3000', { vehicleLoanAfter2024: 'no' })).vehicleLoanInterest).toMatchObject({ deduction: 0, amountReported: 3000, reason: expect.stringContaining('after December 31, 2024') });
    expect(run(vehicle('3000', { vehicleNewUSAssembled: 'no' })).vehicleLoanInterest.reason).toContain('final assembly in the United States');
    expect(run(vehicle('3000', { vehicleLoanQualified: 'no' })).vehicleLoanInterest.reason).toContain('Leases');
  });

  it('routes business-use vehicles to Schedule C review and requires a VIN', () => {
    expect(() => run(vehicle('3000', { vehiclePersonalUse: 'no' }))).toThrow(/Schedule C business-interest rules/);
    expect(() => run(vehicle('3000', { vehicleVIN: '' }))).toThrow(/17-character vehicle identification number/);
    expect(() => run(vehicle('3000', { vehicleVIN: '1HGCM82633A00435I' }))).toThrow(OBBBADeductionReviewRequiredError);
    expect(run(vehicle('3000', { vehicleVIN: SYNTHETIC_VIN.toLowerCase() })).vehicleLoanInterest.deduction).toBe(3000);
  });
});

describe('charitable deduction for non-itemizers (§170(p))', () => {
  it('allows up to $1,000 ($2,000 joint) of cash gifts from 2026 only when taking the standard deduction', () => {
    expect([NON_ITEMIZER_CHARITY_LIMIT, NON_ITEMIZER_CHARITY_LIMIT_JOINT]).toEqual([1000, 2000]);
    expect(run({ hasNonItemizerCharity: 'yes', nonItemizerCashCharity: '1500' }).nonItemizerCharitable).toMatchObject({ deduction: 1000, amountReported: 1500 });
    expect(run({ hasNonItemizerCharity: 'yes', nonItemizerCashCharity: '2500' }, { filingStatus: 'married_filing_jointly' }).nonItemizerCharitable.deduction).toBe(2000);
    expect(run({ hasNonItemizerCharity: 'yes', nonItemizerCashCharity: '2500' }, { filingStatus: 'married_filing_separately' }).nonItemizerCharitable.deduction).toBe(1000);
    const itemizer = run({ hasNonItemizerCharity: 'yes', nonItemizerCashCharity: '800' }, { usingStandardDeduction: false });
    expect(itemizer.nonItemizerCharitable).toMatchObject({ deduction: 0, reason: expect.stringContaining('Schedule A') });
    expect(itemizer.warnings.some(w => w.includes('0.5% of AGI'))).toBe(true);
  });

  it('keeps the §170(p) amount out of the Schedule 1-A Part VI total', () => {
    const result = run({ ...tips('5000'), hasNonItemizerCharity: 'yes', nonItemizerCashCharity: '600' });
    expect(result).toMatchObject({ scheduleOneATotal: 5000, total: 5600 });
  });
});

describe('Form 1040 applies Schedule 1-A before the QBI cap', () => {
  const base: Form1040Input = {
    taxYear: 2026, filingStatus: 'single', personalDeductionOrganizer: reviewedPersonalDeductionOrganizer(),
    scheduleCNetProfit: 0, w2Wages: 100000, w2MedicareWages: 100000, otherIncome: 0,
    w2FederalWithheld: 0, estimatedPayments: 0, selfEmploymentTax: 0, halfSEDeduction: 0,
    healthInsurancePremiums: 0, sepIraContribution: 0, solo401kContribution: 0,
    simpleIraContribution: 0, hsaContribution: 0, studentLoanInterest: 0,
  };
  const organizer = (facts: Partial<OBBBADeductionAnswers>, extra: Record<string, unknown> = {}) =>
    reviewedPersonalDeductionOrganizer(2026, {}, { obbbaDeductionFacts: reviewedOBBBADeductionFacts(2026, facts), ...extra });

  it('excludes deducted tips from QBI and subtracts them below AGI', () => {
    // AGI $160,000: tips limited to $25,000 less $1,000 phaseout = $24,000. QBI = ($60,000 - $24,000) x 20% = $7,200,
    // under the Form 8995 cap of ($160,000 - $16,100 - $24,000) x 20% = $23,980.
    const result = compute1040({ ...base, scheduleCNetProfit: 60000, personalDeductionOrganizer: organizer(tips('30000')) });
    expect(result).toMatchObject({ agi: 160000, qualifiedTipsDeduction: 24000, scheduleOneADeductions: 24000, qbiDeduction: 7200, taxableIncome: 112700 });
    expect(result.obbbaDeductions?.qualifiedTips.phaseoutReduction).toBe(1000);
    expect(result.calculationWarnings.some(w => w.includes('Qualified tips deduction of $24,000'))).toBe(true);
  });

  it('caps QBI using taxable income after the tips deduction', () => {
    // AGI $60,000 - $16,100 - $25,000 = $18,900 x 20% = $3,780 cap, below 20% of ($60,000 - $25,000).
    const result = compute1040({ ...base, w2Wages: 0, w2MedicareWages: 0, scheduleCNetProfit: 60000, personalDeductionOrganizer: organizer(tips('30000')) });
    expect(result).toMatchObject({ qualifiedTipsDeduction: 25000, qbiDeduction: 3780, taxableIncome: 15120 });
  });

  it('adds overtime, vehicle interest and the senior deduction on line 13b and the §170(p) gift separately', () => {
    const result = compute1040({ ...base, personalDeductionOrganizer: organizer({
      hasW2Overtime: 'yes', qualifiedOvertimeAmount: '5000', ...vehicle('5000'), hasNonItemizerCharity: 'yes', nonItemizerCashCharity: '1500',
    }, { dateOfBirth: '1960-01-01' }) });
    expect(result).toMatchObject({
      standardDeduction: 18150, enhancedSeniorDeduction: 4500, qualifiedOvertimeDeduction: 5000, vehicleLoanInterestDeduction: 5000,
      nonItemizerCharitableDeduction: 1000, scheduleOneADeductions: 14500, taxableIncome: 66350,
    });
  });

  it('propagates the review errors instead of a partial deduction', () => {
    expect(() => compute1040({ ...base, personalDeductionOrganizer: organizer(vehicle('3000', { vehiclePersonalUse: 'no' })) })).toThrow(OBBBADeductionReviewRequiredError);
    expect(() => compute1040({ ...base, scheduleCNetProfit: 20000, personalDeductionOrganizer: organizer(tips('4000', { tipsBusinessSSTB: 'yes' })) })).toThrow(OBBBADeductionReviewRequiredError);
  });
});
