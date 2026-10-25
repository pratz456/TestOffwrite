import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calc4562, type Asset } from '@/lib/reports/calc4562';
import { computeScheduleCProfit } from '@/lib/tax-rules/schedule-c-profit';

const TAX_YEAR = 2026;
const BUSINESS_INCOME = 50000;
const GROSS_RECEIPTS = 20000;
const MESSAGE = 'PLACEHOLDER: An equipment asset needs an answer or review before this figure can be shown.';

const asset = (overrides: Partial<Asset> = {}): Asset => ({
  id: 'camera', description: 'Camera', datePlacedInService: new Date(Date.UTC(TAX_YEAR, 4, 1)),
  cost: 10000, businessUsePercent: 100, category: 'equipment', method: 'MACRS_5YR',
  section179Requested: false, bonusEligible: false, ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.UTC(TAX_YEAR, 6, 15, 12)));
});
afterEach(() => { vi.useRealTimers(); });

describe('calc4562 hold for equipment that base would depreciate', () => {
  it('holds a yes answer at exactly 50 percent', () => {
    const held = calc4562([asset({ businessUsePercent: 50, listedEquipmentAnswer: 'yes', listedEquipmentKind: 'recreation_or_amusement' })], BUSINESS_INCOME, TAX_YEAR);
    const plain = calc4562([asset({ id: 'plain', category: 'computer', businessUsePercent: 50 })], BUSINESS_INCOME, TAX_YEAR);
    expect(held.totalDepreciation).toBe(0);
    expect(plain.totalDepreciation).toBeGreaterThan(0);
    expect(held.heldAssets).toEqual([{ id: 'camera', name: 'Camera', reason: 'review' }]);
  });

  it('holds a blank answer at exactly 50 percent', () => {
    for (const listedEquipmentAnswer of [undefined, null] as const) {
      const held = calc4562([asset({ businessUsePercent: 50, listedEquipmentAnswer })], BUSINESS_INCOME, TAX_YEAR);
      const plain = calc4562([asset({ id: 'plain', category: 'computer', businessUsePercent: 50 })], BUSINESS_INCOME, TAX_YEAR);
      expect(held.totalDepreciation).toBe(0);
      expect(plain.totalDepreciation).toBeGreaterThan(0);
      expect(held.notes.join('\n')).toContain('PLACEHOLDER: We need one answer about Camera before we can show your estimate. What kind of equipment is it?');
      expect(held.heldAssets).toEqual([{ id: 'camera', name: 'Camera', reason: 'question' }]);
    }
  });

  it.each([
    ['yes at 50.01', { businessUsePercent: 50.01, listedEquipmentAnswer: 'yes' as const }],
    ['yes at 51', { businessUsePercent: 51, listedEquipmentAnswer: 'yes' as const }],
    ['no at 50', { businessUsePercent: 50, listedEquipmentAnswer: 'no' as const }],
    ['computer at 50', { category: 'computer' as const, businessUsePercent: 50, listedEquipmentAnswer: 'yes' as const }],
  ])('keeps the base figure for %s', (_label, fields) => {
    const flagged = calc4562([asset(fields)], BUSINESS_INCOME, TAX_YEAR);
    const reference = calc4562([asset({ id: 'plain', category: 'computer', businessUsePercent: fields.businessUsePercent })], BUSINESS_INCOME, TAX_YEAR);
    expect(flagged.totalDepreciation).toBe(reference.totalDepreciation);
    expect(flagged.totalDepreciation).toBeGreaterThan(0);
  });
});

describe('computeScheduleCProfit carries a hold into the review error', () => {
  const run = (overrides: Partial<Asset>) => computeScheduleCProfit({
    taxYear: TAX_YEAR, grossReceipts: GROSS_RECEIPTS, confirmedExpenses: 0, w2Wages: 0, assets: [asset(overrides)],
  });
  const capture = (overrides: Partial<Asset>) => {
    try { return { profit: run(overrides), error: null as unknown }; }
    catch (error) { return { profit: null, error }; }
  };

  it('holds a yes answer at exactly 50 percent', () => {
    const { profit, error } = capture({ businessUsePercent: 50, listedEquipmentAnswer: 'yes', listedEquipmentKind: 'recreation_or_amusement' });
    expect(profit).toBeNull();
    expect(error).toMatchObject({ code: 'DEPRECIATION_REVIEW_REQUIRED' });
    expect((error as { heldAssets?: unknown }).heldAssets).toEqual([{ id: 'camera', name: 'Camera', reason: 'review' }]);
    expect((error as Error).message).toContain(MESSAGE);
  });

  it('holds a blank answer at exactly 50 percent', () => {
    for (const listedEquipmentAnswer of [undefined, null] as const) {
      const { profit, error } = capture({ businessUsePercent: 50, listedEquipmentAnswer });
      expect(profit).toBeNull();
      expect(error).toMatchObject({ code: 'DEPRECIATION_REVIEW_REQUIRED' });
      expect((error as { heldAssets?: unknown }).heldAssets).toEqual([{ id: 'camera', name: 'Camera', reason: 'question' }]);
      expect((error as Error).message).toContain('PLACEHOLDER: We need one answer about Camera before we can show your estimate. What kind of equipment is it?');
      expect((error as Error).message).not.toContain(MESSAGE);
    }
  });

  it.each([
    ['yes at 50.01', { businessUsePercent: 50.01, listedEquipmentAnswer: 'yes' as const }],
    ['yes at 51', { businessUsePercent: 51, listedEquipmentAnswer: 'yes' as const }],
    ['no at 50', { businessUsePercent: 50, listedEquipmentAnswer: 'no' as const }],
    ['computer at 50', { category: 'computer' as const, businessUsePercent: 50, listedEquipmentAnswer: 'yes' as const }],
  ])('keeps the base profit for %s', (_label, fields) => {
    const flagged = run(fields);
    const reference = run({ id: 'plain', category: 'computer', businessUsePercent: fields.businessUsePercent });
    expect(flagged.depreciationDeduction).toBe(reference.depreciationDeduction);
    expect(flagged.netProfit).toBe(reference.netProfit);
    expect(flagged.depreciationDeduction).toBeGreaterThan(0);
  });
});
