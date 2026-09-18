import { describe, expect, it } from 'vitest';
import { calc4562, DE_MINIMIS_SAFE_HARBOR_LIMIT, SECTION_179_CALCULATION_YEARS, type Asset } from '@/lib/reports/calc4562';
import { getSection179Limits, UnsupportedTaxYearError } from '@/lib/tax-rules/federal-year-rules';

const asset = (overrides: Partial<Asset> = {}): Asset => ({ id: 'a', description: 'Business computer',
  datePlacedInService: new Date('2026-05-01T00:00:00Z'), cost: 10000, businessUsePercent: 100,
  category: 'computer', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false, ...overrides });
const elected = (...years: number[]) => ({ deMinimisSafeHarborYears: years });
const reviewCode = (run: () => unknown) => {
  try { run(); } catch (error) { return (error as { code?: string }).code; }
  return null;
};

describe('year-labeled Section 179 limits', () => {
  it('publishes the post-OBBBA 2025 and Rev. Proc. 2025-32 2026 amounts with their sources', () => {
    expect(getSection179Limits(2024)).toMatchObject({ limit: 1220000, phaseoutThreshold: 3050000, source: expect.stringContaining('Rev. Proc. 2023-34') });
    expect(getSection179Limits(2025)).toMatchObject({ limit: 2500000, phaseoutThreshold: 4000000, source: expect.stringContaining('OBBBA §70306') });
    expect(getSection179Limits(2026)).toMatchObject({ limit: 2560000, phaseoutThreshold: 4090000, source: expect.stringContaining('Rev. Proc. 2025-32') });
    expect(() => getSection179Limits(2027)).toThrow(UnsupportedTaxYearError);
    expect(SECTION_179_CALCULATION_YEARS).toEqual([2025, 2026]);
  });
});

describe('de minimis safe harbor (Reg. §1.263(a)-1(f))', () => {
  it('expenses items at or under $2,500 in an elected year instead of depreciating them', () => {
    const result = calc4562([asset({ cost: 2000 })], 50000, 2026, elected(2026));
    expect(result).toMatchObject({ totalDeMinimisExpense: 2000, totalDepreciation: 0, totalRegularDepreciation: 0, totalSection179: 0, section179: null });
    expect(result.assets[0]).toMatchObject({ treatment: 'de_minimis_expense', deMinimisExpense: 2000, regularDepreciation: 0, remainingBasis: 0 });
    expect(result.notes.join(' ')).toMatch(/not depreciation/);
    expect(DE_MINIMIS_SAFE_HARBOR_LIMIT).toBe(2500);
  });
  it('keeps MACRS for the same item when the year was not elected or the item exceeds the limit', () => {
    expect(calc4562([asset({ cost: 2000 })], 50000, 2026, null)).toMatchObject({ totalDeMinimisExpense: 0, totalDepreciation: 400 });
    expect(calc4562([asset({ cost: 2000 })], 50000, 2026, elected(2025))).toMatchObject({ totalDeMinimisExpense: 0, totalDepreciation: 400 });
    expect(calc4562([asset({ cost: 2500 })], 50000, 2026, elected(2026))).toMatchObject({ totalDeMinimisExpense: 2500, totalDepreciation: 0 });
    expect(calc4562([asset({ cost: 2500.01 })], 50000, 2026, elected(2026))).toMatchObject({ totalDeMinimisExpense: 0, totalDepreciation: 500 });
  });
  it('tests the limit against the item cost but expenses only the business share', () => {
    const result = calc4562([asset({ cost: 2000, businessUsePercent: 60 })], 50000, 2026, elected(2026));
    expect(result.assets[0]).toMatchObject({ treatment: 'de_minimis_expense', deMinimisExpense: 1200 });
  });
  it('does not route a §179 request for a de minimis item through the election', () => {
    const result = calc4562([asset({ cost: 1500, section179Requested: true })], 50000, 2026, elected(2026));
    expect(result).toMatchObject({ totalDeMinimisExpense: 1500, totalSection179: 0, section179: null });
  });
  it('ignores an item expensed in an earlier elected year instead of demanding prior-year basis', () => {
    const result = calc4562([asset({ cost: 800, datePlacedInService: new Date('2025-06-01T00:00:00Z') }), asset({ id: 'b', cost: 5000 })], 50000, 2026, elected(2025));
    expect(result).toMatchObject({ totalDeMinimisExpense: 0, totalDepreciation: 1000 });
    expect(result.assets).toHaveLength(1);
    expect(result.notes.join(' ')).toContain('earlier elected year');
    // Without the earlier election the item is still prior-year MACRS property and stays behind the review gate.
    expect(reviewCode(() => calc4562([asset({ cost: 800, datePlacedInService: new Date('2025-06-01T00:00:00Z') })], 50000, 2026, null))).toBe('DEPRECIATION_REVIEW_REQUIRED');
  });
  it('still sends vehicles and unspecified categories to review even when cheap and elected', () => {
    expect(() => calc4562([asset({ cost: 2000, category: 'vehicle' })], 50000, 2026, elected(2026))).toThrow(/vehicle limits/);
    expect(() => calc4562([asset({ cost: 2000, category: 'other' })], 50000, 2026, elected(2026))).toThrow(/asset class/);
  });
});

describe('first-year Section 179 expensing', () => {
  it('allows the election within the year limit and business income and records the election year', () => {
    const result = calc4562([asset({ section179Requested: true })], 50000, 2026);
    expect(result.section179).toMatchObject({ electionYear: 2026, limit: 2560000, phaseoutThreshold: 4090000, costOfSection179Property: 10000, dollarLimitAfterPhaseout: 2560000, businessIncomeLimit: 50000, elected: 10000, allowed: 10000, carryover: 0, source: 'Rev. Proc. 2025-32 §4.24' });
    expect(result).toMatchObject({ totalSection179: 10000, totalRegularDepreciation: 0, totalDepreciation: 10000, totalCarryover: 0 });
    expect(result.assets[0]).toMatchObject({ treatment: 'section_179', section179Elected: 10000, section179Deduction: 10000, regularDepreciation: 0, remainingBasis: 0, carryoverToNextYear: 0 });
    expect(result.notes.join(' ')).toContain('§179(b)(3)(A)');
    expect(calc4562([asset({ section179Requested: true, datePlacedInService: new Date('2025-05-01T00:00:00Z') })], 50000, 2025).section179).toMatchObject({ electionYear: 2025, limit: 2500000, phaseoutThreshold: 4000000 });
  });
  it('limits the deduction to business taxable income (§179(b)(3)(A)) and carries the rest forward with basis already reduced', () => {
    const result = calc4562([asset({ section179Requested: true })], 4000, 2026);
    expect(result.section179).toMatchObject({ elected: 10000, allowed: 4000, carryover: 6000, businessIncomeLimit: 4000 });
    expect(result).toMatchObject({ totalSection179: 4000, totalRegularDepreciation: 0, totalDepreciation: 4000, totalCarryover: 6000 });
    expect(result.assets[0]).toMatchObject({ section179Elected: 10000, section179Deduction: 4000, remainingBasis: 0, carryoverToNextYear: 6000 });
    expect(calc4562([asset({ section179Requested: true })], -2500, 2026).section179).toMatchObject({ allowed: 0, carryover: 10000, businessIncomeLimit: 0 });
  });
  it('elects only the business share and depreciates nothing else on that asset', () => {
    const result = calc4562([asset({ section179Requested: true, businessUsePercent: 60 })], 50000, 2026);
    expect(result.assets[0]).toMatchObject({ section179Elected: 6000, section179Deduction: 6000, regularDepreciation: 0, remainingBasis: 0 });
  });
  it('applies the year dollar limit and depreciates the excess basis under MACRS', () => {
    const result = calc4562([asset({ section179Requested: true, cost: 3000000 })], 5000000, 2026);
    expect(result.section179).toMatchObject({ dollarLimitAfterPhaseout: 2560000, elected: 2560000, allowed: 2560000 });
    expect(result.assets[0]).toMatchObject({ section179Deduction: 2560000, regularDepreciation: 88000, totalDepreciation: 2648000 });
    expect(result.notes.join(' ')).toContain('exceed the 2026 dollar limit');
    const phasedOut = calc4562([asset({ section179Requested: true, cost: 4100000 })], 9000000, 2026);
    expect(phasedOut.section179).toMatchObject({ costOfSection179Property: 4100000, dollarLimitAfterPhaseout: 2550000, elected: 2550000 });
  });
  it('splits the election and the income limit across several elected assets by business basis', () => {
    const result = calc4562([asset({ section179Requested: true, cost: 6000 }), asset({ id: 'b', section179Requested: true, cost: 4000, method: 'MACRS_7YR', category: 'furniture' }), asset({ id: 'c', cost: 1000 })], 5000, 2026);
    expect(result.section179).toMatchObject({ costOfSection179Property: 11000, elected: 10000, allowed: 5000, carryover: 5000 });
    expect(result.assets.map(row => [row.section179Elected, row.section179Deduction])).toEqual([[6000, 3000], [4000, 2000], [0, 0]]);
    expect(result.assets[2]).toMatchObject({ treatment: 'macrs', regularDepreciation: 200 });
    expect(result.totalDepreciation).toBe(5200);
  });
  it('runs the 40% mid-quarter test on basis after the §179 reduction (Publication 946 ch. 4)', () => {
    expect(() => calc4562([asset({ section179Requested: true }), asset({ id: 'b', cost: 1000, datePlacedInService: new Date('2026-11-01T00:00:00Z') })], 50000, 2026)).toThrow(/mid-quarter/);
    expect(calc4562([asset(), asset({ id: 'b', cost: 1000, datePlacedInService: new Date('2026-11-01T00:00:00Z') })], 50000, 2026).totalDepreciation).toBe(2200);
  });
  it.each([
    [{ section179Requested: true, businessUsePercent: 50 }, 'more than 50%'],
    [{ section179Requested: true, category: 'vehicle' }, 'vehicle limits'],
    [{ section179Requested: true, bonusEligible: true }, 'Bonus depreciation'],
    [{ bonusEligible: true }, 'Bonus depreciation'],
    [{ section179Requested: true, method: 'SL' }, 'Straight-line'],
  ] as [Partial<Asset>, string][])('keeps %j behind the review gate', (overrides, message) => {
    expect(() => calc4562([asset(overrides)], 50000, 2026)).toThrow(message);
    expect(reviewCode(() => calc4562([asset(overrides)], 50000, 2026))).toBe('DEPRECIATION_REVIEW_REQUIRED');
  });
  it('refuses §179 for years without published post-OBBBA limits in this planning subset', () => {
    expect(() => calc4562([asset({ section179Requested: true, datePlacedInService: new Date('2024-05-01T00:00:00Z') })], 50000, 2024)).toThrow(/2025 or 2026/);
    expect(() => calc4562([asset({ section179Requested: true, datePlacedInService: new Date('2027-05-01T00:00:00Z') })], 50000, 2027)).toThrow(/supported tax year/);
  });
});
