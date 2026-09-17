import { describe, expect, it } from 'vitest';
import { calc4562, type Asset } from '@/lib/reports/calc4562';
const asset = (overrides: Partial<Asset> = {}): Asset => ({ id: 'a', description: 'Business computer',
  datePlacedInService: new Date('2026-05-01T00:00:00Z'), cost: 1000, businessUsePercent: 100,
  category: 'computer', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false, ...overrides });

describe('scoped first-year MACRS worksheet', () => {
  it('uses 5-year half-year depreciation and keeps ordinary basis separate from an election carryforward', () => {
    const result = calc4562([asset()], 10000, 2026);
    expect(result.totalDepreciation).toBe(200);
    expect(result.assets[0].remainingBasis).toBe(800);
    expect(result.totalCarryover).toBe(0);
  });
  it('uses selected year and 7-year rate against business basis', () => {
    const result = calc4562([asset({ datePlacedInService: new Date('2024-06-01'), method: 'MACRS_7YR', category: 'furniture', cost: 10000, businessUsePercent: 50 })], 0, 2024);
    expect(result.totalRegularDepreciation).toBe(714.5);
    expect(result.assets[0].remainingBasis).toBe(4285.5);
  });
  it('does not deduct an asset before its placed-in-service year', () => {
    expect(calc4562([asset()], 10000, 2025).totalDepreciation).toBe(0);
  });
  it('accepts serialized dates from the settings API', () => {
    expect(calc4562([asset({ datePlacedInService: '2026-05-01' as unknown as Date })], 10000, 2026).totalDepreciation).toBe(200);
  });
  it.each([
    [{ section179Requested: true, businessUsePercent: 50 }, 'Section 179'], [{ bonusEligible: true }, 'bonus'],
    [{ category: 'vehicle' }, 'vehicle'], [{ method: 'SL' }, 'recovery period'],
    [{ datePlacedInService: new Date('2025-05-01') }, 'Prior-year'],
    [{ datePlacedInService: new Date('2026-11-01') }, 'mid-quarter'],
  ] as [Partial<Asset>, string][])('requests missing facts for %j instead of guessing deductions', (overrides, message) => {
    expect(() => calc4562([asset(overrides)], 10000, 2026)).toThrow(message);
    try { calc4562([asset(overrides)], 10000, 2026); } catch (error) { expect(error).toMatchObject({ code: 'DEPRECIATION_REVIEW_REQUIRED' }); }
  });
  it('uses the combined current-year basis for the 40% convention test', () => {
    expect(calc4562([asset({ cost: 600 }), asset({ id: 'b', cost: 400, datePlacedInService: new Date('2026-11-01') })], 10000, 2026).totalDepreciation).toBe(200);
  });
  it.each([{ cost: Infinity }, { cost: -1 }, { businessUsePercent: 101 }, { datePlacedInService: new Date('invalid') }])('rejects invalid financial input %j', overrides => {
    expect(() => calc4562([asset(overrides)], 10000, 2026)).toThrow();
  });
  it('refuses unpublished tax years', () => expect(() => calc4562([asset()], 10000, 2027)).toThrow('supported tax year'));
});
