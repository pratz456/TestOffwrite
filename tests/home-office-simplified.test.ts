import { describe, expect, it } from 'vitest';
import {
  ACTUAL_METHOD_REVIEW_REASON, calc8829, calcSimplifiedHomeOffice, HomeOfficeReviewRequiredError, homeOfficeReviewReasons,
  resolveHomeOfficeDeduction, SIMPLIFIED_MAX_SQFT, SIMPLIFIED_RATE_PER_SQFT, type HomeOfficeSettings,
} from '@/lib/reports/calc8829';

/** Complete, eligible Publication 587 answers for a rented home; tests override single facts. */
const facts = (overrides: Partial<HomeOfficeSettings> = {}): HomeOfficeSettings => ({
  totalHomeSqFt: 1200, officeSqFt: 200, rentOrMortgageInterest: 0, utilities: 0, insurance: 0, repairsMaintenance: 0, propertyTax: 0, other: 0,
  method: 'simplified', regularUse: 'yes', exclusiveUse: 'yes', exclusiveUseException: null, qualifyingUse: 'principal_place_of_business',
  housingType: 'rented', monthsUsed: 12, ...overrides,
});
const simplified = (overrides: Partial<HomeOfficeSettings> = {}, grossIncomeLimit = 50000, taxYear = 2026) =>
  calcSimplifiedHomeOffice(facts(overrides), { taxYear, grossIncomeLimit });
const reviewCode = (run: () => unknown) => {
  try { run(); } catch (error) { return (error as { code?: string }).code; }
  return null;
};

describe('simplified method (Rev. Proc. 2013-13) worksheet', () => {
  it('multiplies $5 by the office square footage for a full year of qualified use', () => {
    const result = simplified();
    expect(result).toMatchObject({ eligible: true, allowableSqFt: 200, averageMonthlyAllowableSqFt: 200, ratePerSqFt: 5, tentativeDeduction: 1000, allowableDeduction: 1000, disallowedNoCarryover: 0 });
    expect(SIMPLIFIED_RATE_PER_SQFT * SIMPLIFIED_MAX_SQFT).toBe(1500);
  });
  it('caps the area at 300 square feet ($1,500) and says so', () => {
    const result = simplified({ officeSqFt: 450 });
    expect(result).toMatchObject({ allowableSqFt: 300, tentativeDeduction: 1500, allowableDeduction: 1500 });
    expect(result.notes.join(' ')).toContain('Only 300 of 450 square feet');
  });
  it('prorates by months of qualified use (§4.04 average monthly square feet)', () => {
    const result = simplified({ officeSqFt: 300, monthsUsed: 5 });
    expect(result).toMatchObject({ allowableSqFt: 300, averageMonthlyAllowableSqFt: 125, tentativeDeduction: 625, allowableDeduction: 625 });
    expect(result.notes.join(' ')).toContain('Prorated for 5 of 12 months');
    expect(simplified({ monthsUsed: 0 })).toMatchObject({ eligible: false, allowableDeduction: 0 });
  });
  it('limits the deduction to gross income from the business use after other expenses, with no carryover (§4.08)', () => {
    const limited = simplified({ officeSqFt: 300 }, 900);
    expect(limited).toMatchObject({ tentativeDeduction: 1500, grossIncomeLimit: 900, allowableDeduction: 900, disallowedNoCarryover: 600 });
    expect(limited.notes.join(' ')).toContain('cannot be carried over');
    expect(simplified({ officeSqFt: 300 }, -2500)).toMatchObject({ grossIncomeLimit: 0, allowableDeduction: 0, disallowedNoCarryover: 1500 });
    expect(simplified({}, 1000.004)).toMatchObject({ grossIncomeLimit: 1000, allowableDeduction: 1000 });
  });
  it('treats an unanswered exclusive-use fact as review, never as "no"', () => {
    expect(() => simplified({ exclusiveUse: null })).toThrow(HomeOfficeReviewRequiredError);
    expect(reviewCode(() => simplified({ exclusiveUse: null }))).toBe('HOME_OFFICE_REVIEW_REQUIRED');
    expect(() => simplified({ exclusiveUse: undefined })).toThrow(/exclusively for business/);
    expect(() => simplified({ regularUse: null })).toThrow(/regular basis/);
    expect(() => simplified({ qualifyingUse: null })).toThrow(/principal place of business/);
    expect(() => simplified({ monthsUsed: null })).toThrow(/how many months/);
    expect(() => simplified({ monthsUsed: 13 })).toThrow(/0 to 12/);
    expect(() => simplified({ officeSqFt: 0 })).toThrow(/square footage of the area/);
    expect(() => simplified({ officeSqFt: 1300 })).toThrow(/cannot exceed the total home/);
  });
  it('distinguishes an explicit "no" (an eligibility result of $0) from an unanswered fact', () => {
    expect(simplified({ regularUse: 'no' })).toMatchObject({ eligible: false, allowableSqFt: 0, allowableDeduction: 0, ineligibleReason: expect.stringContaining('regular use') });
    expect(simplified({ exclusiveUse: 'no', exclusiveUseException: 'none' })).toMatchObject({ eligible: false, allowableDeduction: 0, ineligibleReason: expect.stringContaining('exclusive use') });
    expect(simplified({ qualifyingUse: 'none' })).toMatchObject({ eligible: false, allowableDeduction: 0 });
  });
  it('sends the daycare and storage exceptions to review because their extra facts are not collected', () => {
    expect(() => simplified({ exclusiveUse: 'no', exclusiveUseException: null })).toThrow(/daycare or inventory/);
    expect(() => simplified({ exclusiveUse: 'no', exclusiveUseException: 'daycare' })).toThrow(/§280A\(c\)\(2\) and \(c\)\(4\)/);
    expect(() => simplified({ exclusiveUse: 'no', exclusiveUseException: 'inventory_storage' })).toThrow(HomeOfficeReviewRequiredError);
  });
  it('records the rented/owned fact without letting it change the amount', () => {
    const owned = simplified({ housingType: 'owned' });
    expect(owned.allowableDeduction).toBe(1000);
    expect(owned.notes.join(' ')).toContain('Schedule A');
    const unanswered = simplified({ housingType: null });
    expect(unanswered.allowableDeduction).toBe(1000);
    expect(unanswered.notes.join(' ')).toContain('rented or owned');
  });
  it('lists every unanswered question, not just the first', () => {
    const reasons = homeOfficeReviewReasons({ totalHomeSqFt: 1000, officeSqFt: 100 });
    expect(reasons.length).toBeGreaterThanOrEqual(5);
    expect(reasons.join(' ')).toMatch(/Choose the simplified method/);
    expect(homeOfficeReviewReasons(facts())).toEqual([]);
    expect(homeOfficeReviewReasons(facts({ method: 'actual' }))).toEqual([ACTUAL_METHOD_REVIEW_REASON]);
  });
});

describe('shared-snapshot home office resolution', () => {
  it('claims nothing when no settings exist and no legacy method was selected', () => {
    expect(resolveHomeOfficeDeduction(null, { taxYear: 2026, grossIncomeLimit: 10000 })).toEqual({ deduction: 0, calculation: null, warnings: [] });
    expect(resolveHomeOfficeDeduction(undefined, { taxYear: 2026, grossIncomeLimit: 10000, legacyMethod: 'unexpected' })).toMatchObject({ deduction: 0 });
  });
  it('treats a legacy profile method with no saved facts as a review case, not a silent zero', () => {
    expect(() => resolveHomeOfficeDeduction(null, { taxYear: 2026, grossIncomeLimit: 10000, legacyMethod: 'simplified' })).toThrow(HomeOfficeReviewRequiredError);
  });
  it('warns when square footage is saved without a method and includes no deduction', () => {
    const result = resolveHomeOfficeDeduction(facts({ method: null }), { taxYear: 2026, grossIncomeLimit: 10000 });
    expect(result.deduction).toBe(0);
    expect(result.warnings[0]).toContain('no home office deduction is included');
  });
  it('keeps the actual-expense method review-blocked in the snapshot', () => {
    expect(reviewCode(() => resolveHomeOfficeDeduction(facts({ method: 'actual' }), { taxYear: 2026, grossIncomeLimit: 10000 }))).toBe('HOME_OFFICE_REVIEW_REQUIRED');
    expect(() => resolveHomeOfficeDeduction(facts({ method: 'actual' }), { taxYear: 2026, grossIncomeLimit: 10000 })).toThrow(/Form 8829/);
  });
  it('returns the simplified amount and a $0 warning for an ineligible answer', () => {
    expect(resolveHomeOfficeDeduction(facts(), { taxYear: 2026, grossIncomeLimit: 10000 })).toMatchObject({ deduction: 1000, warnings: [] });
    const ineligible = resolveHomeOfficeDeduction(facts({ regularUse: 'no' }), { taxYear: 2026, grossIncomeLimit: 10000 });
    expect(ineligible.deduction).toBe(0);
    expect(ineligible.warnings[0]).toMatch(/\$0/);
  });
  it('still supports the narrow rented-home actual-expense worksheet without widening it', () => {
    const settings = facts({ method: 'actual', rentOrMortgageInterest: 12000, utilities: 1200, totalHomeSqFt: 1000, officeSqFt: 200 });
    const context = { method: 'actual' as const, housingType: 'rented' as const, qualifiedScheduleCBusinessUse: true, expensesLimitedToBusinessUsePeriod: true, form8829Line8Income: 5000, directOperatingExpenses: 0, priorOperatingExpenseCarryover: 0, casualtyLosses: 0, depreciationAndCasualtyCarryover: 0 };
    expect(calc8829(settings, context)).toMatchObject({ businessUsePercentage: 20, totalAllowableDeduction: 2640, carryoverToNextYear: 0 });
    expect(() => calc8829(settings)).toThrow(/Form 8829 export is unavailable/);
    expect(() => calc8829({ ...settings, propertyTax: 1 }, context)).toThrow(/rented home only/);
  });
});
