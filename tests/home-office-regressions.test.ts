import { describe, expect, it } from 'vitest';
import { allocateHomeOfficeExpenses, calc8829, validateHomeOfficeSettings, type HomeOfficeSettings, type RentalHomeOfficeContext } from '../lib/reports/calc8829';

const settings: HomeOfficeSettings = {
  totalHomeSqFt: 1000, officeSqFt: 200, rentOrMortgageInterest: 24_000,
  utilities: 2400, insurance: 600, repairsMaintenance: 1000, propertyTax: 0, other: 0,
};
const rental: RentalHomeOfficeContext = {
  method: 'actual', housingType: 'rented', qualifiedScheduleCBusinessUse: true,
  expensesLimitedToBusinessUsePeriod: true, form8829Line8Income: 10_000,
  directOperatingExpenses: 0, priorOperatingExpenseCarryover: 0,
  casualtyLosses: 0, depreciationAndCasualtyCarryover: 0,
};

describe('actual home office expense calculation', () => {
  // IRS Form 8829 uses actual rent/operating expenses and an income limit;
  // $5 × up to 300 square feet belongs only to the separate simplified method.
  it('allows a qualified rental deduction above $1,500 when income supports it', () => {
    const result = calc8829(settings, rental);
    expect(result.businessUsePercentage).toBe(20);
    expect(result.totalAllowableDeduction).toBe(5600);
    expect(result.carryoverToNextYear).toBe(0);
  });
  it('does not apply the simplified 300-square-foot limit to actual expenses', () => {
    const result = calc8829({ ...settings, totalHomeSqFt: 2000, officeSqFt: 400 }, rental);
    expect(result.totalAllowableDeduction).toBe(5600);
  });
  it('limits current and carried operating expenses to qualified-home income', () => {
    const result = calc8829(settings, { ...rental, form8829Line8Income: 1000, directOperatingExpenses: 400, priorOperatingExpenseCarryover: 800 });
    expect(result.directOfficeExpenses).toBe(400);
    expect(result.totalAllowableDeduction).toBe(1000);
    expect(result.carryoverToNextYear).toBe(5800);
  });
  it.each([0, -2500])('does not turn operating expenses into a business loss when income is %s', income => {
    const result = calc8829(settings, { ...rental, form8829Line8Income: income });
    expect(result.totalAllowableDeduction).toBe(0);
    expect(result.carryoverToNextYear).toBe(5600);
  });
  it('uses an actual-expense operating carryover in the following eligible year', () => {
    const previous = calc8829(settings, { ...rental, form8829Line8Income: 1000 });
    const following = calc8829({ ...settings, rentOrMortgageInterest: 0, utilities: 0, insurance: 0, repairsMaintenance: 0 }, {
      ...rental, priorOperatingExpenseCarryover: previous.carryoverToNextYear,
    });
    expect(following.totalAllowableDeduction).toBe(4600);
    expect(following.carryoverToNextYear).toBe(0);
  });
  it('allocates actual expenses without claiming missing eligibility or income facts', () => {
    const allocation = allocateHomeOfficeExpenses(settings);
    expect(allocation.totalAllocatedExpenses).toBe(5600);
    expect(allocation).not.toHaveProperty('totalAllowableDeduction');
    expect(allocation).not.toHaveProperty('carryoverToNextYear');
    expect(() => calc8829(settings)).toThrow(/current settings do not collect these details/);
    try { calc8829(settings); } catch (error) { expect(error).toMatchObject({ code: 'HOME_OFFICE_DETAILS_REQUIRED' }); }
  });
  it.each([
    { housingType: 'owned' }, { method: 'simplified' }, { casualtyLosses: 100 }, { depreciationAndCasualtyCarryover: 100 },
  ])('withholds a result for unsupported ordering or method: %j', partial => {
    expect(() => calc8829(settings, { ...rental, ...partial } as RentalHomeOfficeContext)).toThrow(/separate reviewed calculation/);
  });
  it('does not treat property taxes as ordinary rental operating expenses', () => {
    expect(() => calc8829({ ...settings, propertyTax: 2000 }, rental)).toThrow(/real estate taxes/);
  });
  it.each([{ qualifiedScheduleCBusinessUse: false }, { expensesLimitedToBusinessUsePeriod: false }])('requires confirmed qualification and expense periods: %j', partial => {
    expect(() => calc8829(settings, { ...rental, ...partial })).toThrow(/Confirm qualifying/);
  });
  it.each([
    { form8829Line8Income: NaN }, { form8829Line8Income: Infinity },
    { directOperatingExpenses: -1 }, { priorOperatingExpenseCarryover: -1 },
  ])('rejects invalid financial context: %j', partial => {
    expect(() => calc8829(settings, { ...rental, ...partial })).toThrow(/finite Form 8829/);
  });
  it.each([
    { officeSqFt: 0 }, { totalHomeSqFt: 0 }, { officeSqFt: 1200 }, { officeSqFt: Infinity },
    { utilities: -1 }, { insurance: NaN }, { other: Infinity }, { rentOrMortgageInterest: '24000' },
  ])('rejects invalid geometry or expense values before arithmetic: %j', partial => {
    const input = { ...settings, ...partial } as HomeOfficeSettings;
    expect(validateHomeOfficeSettings(input).length).toBeGreaterThan(0);
    expect(() => allocateHomeOfficeExpenses(input)).toThrow();
  });
});
