import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as depreciation from '@/lib/reports/calc4562';
import { computeScheduleCProfit, type ScheduleCProfit } from '@/lib/tax-rules/schedule-c-profit';
import type { Asset } from '@/lib/reports/calc4562';

const { calc4562 } = depreciation;

const TAX_YEAR = 2026;
const BUSINESS_INCOME = 50000;
const GROSS_RECEIPTS = 20000;
const QUESTION = 'PLACEHOLDER: Is this photo, video, audio, communication or recreation equipment?';
const REVIEW_NOTE = 'PLACEHOLDER: This asset needs review.';
const PROFIT_REVIEW = 'PLACEHOLDER: An equipment asset needs an answer or review before this figure can be shown.';

const asset = (overrides: Partial<Asset> = {}): Asset => ({
  id: 'camera', description: 'Camera', datePlacedInService: new Date(Date.UTC(TAX_YEAR, 4, 1)),
  cost: 10000, businessUsePercent: 100, category: 'equipment', method: 'MACRS_5YR',
  section179Requested: false, bonusEligible: false, ...overrides,
});

/** Accelerated MACRS from the exported helpers when this source has them, otherwise the same public calculation for a computer. */
const macrsFromHelpers = (cost: number, percent: number, method: Asset['method']): number => {
  const helpers = depreciation as typeof depreciation & {
    businessUseBasis?: (cost: number, businessUsePercent: number) => number;
    acceleratedMacrsDeduction?: (basis: number, method: Asset['method']) => number;
  };
  if (typeof helpers.businessUseBasis === 'function' && typeof helpers.acceleratedMacrsDeduction === 'function') {
    return helpers.acceleratedMacrsDeduction(helpers.businessUseBasis(cost, percent), method);
  }
  return calc4562([asset({ id: 'plain', category: 'computer', businessUsePercent: percent, method, listedEquipmentAnswer: 'no' })], BUSINESS_INCOME, TAX_YEAR).totalRegularDepreciation;
};

const figures = (result: ReturnType<typeof calc4562>) => {
  const row = result.assets[0];
  return {
    section179: row.section179Deduction,
    bonus: row.bonusDepreciation,
    macrs: row.regularDepreciation,
    total: result.totalDepreciation,
    worksheetSection179: result.totalSection179,
    worksheetBonus: result.totalBonusDepreciation,
    worksheetMacrs: result.totalRegularDepreciation,
  };
};

const withheld = { section179: 0, bonus: 0, macrs: 0, total: 0, worksheetSection179: 0, worksheetBonus: 0, worksheetMacrs: 0 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.UTC(TAX_YEAR, 6, 15, 12)));
});
afterEach(() => { vi.useRealTimers(); });

describe('calc4562 at 30 percent business use', () => {
  it('holds a yes answer with no Section 179, bonus, or MACRS figure', () => {
    const sample = asset({ businessUsePercent: 30, listedEquipmentAnswer: 'yes', section179Requested: false, bonusEligible: false });
    const result = calc4562([sample], BUSINESS_INCOME, TAX_YEAR);
    const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
    expect(baseMacrs).toBeGreaterThan(0);
    expect({ ...figures(result), review: result.notes.join('\n').includes(REVIEW_NOTE) }).toEqual({ ...withheld, review: true });
    expect(result.totalDepreciation).not.toBe(baseMacrs);
  });

  it('asks the question and shows no figure for a blank answer', () => {
    for (const listedEquipmentAnswer of [undefined, null] as const) {
      const sample = asset({ businessUsePercent: 30, listedEquipmentAnswer, section179Requested: false, bonusEligible: false });
      const result = calc4562([sample], BUSINESS_INCOME, TAX_YEAR);
      const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
      expect(baseMacrs).toBeGreaterThan(0);
      expect({ ...figures(result), question: result.notes.join('\n').includes(QUESTION) }).toEqual({ ...withheld, question: true });
      expect(result.totalDepreciation).not.toBe(baseMacrs);
    }
  });

  it('keeps the base MACRS figure for a no answer', () => {
    const sample = asset({ businessUsePercent: 30, listedEquipmentAnswer: 'no', section179Requested: false, bonusEligible: false });
    const result = calc4562([sample], BUSINESS_INCOME, TAX_YEAR);
    const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
    const computer = calc4562([asset({ id: 'plain', category: 'computer', businessUsePercent: 30, method: sample.method, listedEquipmentAnswer: 'no' })], BUSINESS_INCOME, TAX_YEAR);
    expect(baseMacrs).toBe(computer.totalRegularDepreciation);
    expect(figures(result)).toEqual({ ...withheld, macrs: baseMacrs, total: baseMacrs, worksheetMacrs: baseMacrs });
    expect(result.notes.join('\n')).not.toContain('PLACEHOLDER');
  });
});

describe('computeScheduleCProfit at 30 percent business use', () => {
  const run = (overrides: Partial<Asset>) => computeScheduleCProfit({
    taxYear: TAX_YEAR, grossReceipts: GROSS_RECEIPTS, confirmedExpenses: 0, w2Wages: 0, assets: [asset(overrides)],
  });
  const capture = (overrides: Partial<Asset>) => {
    try { return { profit: run(overrides) as ScheduleCProfit | null, error: null as Error | null }; }
    catch (error) { return { profit: null, error: error as Error }; }
  };

  it('sends profit to review for a yes answer', () => {
    const sample = asset({ businessUsePercent: 30, listedEquipmentAnswer: 'yes', section179Requested: false, bonusEligible: false });
    const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
    const { profit, error } = capture(sample);
    expect(baseMacrs).toBeGreaterThan(0);
    expect(profit === null ? 0 : profit.depreciationDeduction).toBe(0);
    expect(profit === null ? null : profit.netProfit).toBeNull();
    expect(error?.message ?? '').toContain(PROFIT_REVIEW);
    expect((error as { code?: string } | null)?.code).toBe('DEPRECIATION_REVIEW_REQUIRED');
  });

  it('sends profit to review for a blank answer', () => {
    for (const listedEquipmentAnswer of [undefined, null] as const) {
      const sample = asset({ businessUsePercent: 30, listedEquipmentAnswer, section179Requested: false, bonusEligible: false });
      const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
      const { profit, error } = capture(sample);
      expect(baseMacrs).toBeGreaterThan(0);
      expect(profit === null ? 0 : profit.depreciationDeduction).toBe(0);
      expect(profit === null ? null : profit.netProfit).toBeNull();
      expect(error?.message ?? '').toContain(PROFIT_REVIEW);
      expect((error as { code?: string } | null)?.code).toBe('DEPRECIATION_REVIEW_REQUIRED');
    }
  });

  it('keeps the base profit for a no answer', () => {
    const sample = asset({ businessUsePercent: 30, listedEquipmentAnswer: 'no', section179Requested: false, bonusEligible: false });
    const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
    const kept = run(sample);
    const reference = run({ id: 'plain', category: 'computer', businessUsePercent: 30, method: sample.method, listedEquipmentAnswer: 'no' });
    expect(baseMacrs).toBeGreaterThan(0);
    expect(kept.depreciationDeduction).toBe(baseMacrs);
    expect(kept.depreciationDeduction).toBe(reference.depreciationDeduction);
    expect(kept.netProfit).toBe(reference.netProfit);
    expect(kept.netProfit).toBe(GROSS_RECEIPTS - baseMacrs);
  });
});

describe('calc4562 when Section 179 is not requested', () => {
  it.each([
    ['yes at 50 percent', 50],
    ['yes at 30 percent', 30],
  ])('holds %s with no figure', (_label, businessUsePercent) => {
    const sample = asset({ businessUsePercent, listedEquipmentAnswer: 'yes', section179Requested: false, bonusEligible: false });
    const result = calc4562([sample], BUSINESS_INCOME, TAX_YEAR);
    const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
    expect(baseMacrs).toBeGreaterThan(0);
    expect({ ...figures(result), review: result.notes.join('\n').includes(REVIEW_NOTE) }).toEqual({ ...withheld, review: true });
    expect(result.totalDepreciation).not.toBe(baseMacrs);
  });
});

describe('computeScheduleCProfit when Section 179 is not requested', () => {
  const capture = (businessUsePercent: number) => {
    const sample = asset({ businessUsePercent, listedEquipmentAnswer: 'yes', section179Requested: false, bonusEligible: false });
    try {
      const profit = computeScheduleCProfit({
        taxYear: TAX_YEAR, grossReceipts: GROSS_RECEIPTS, confirmedExpenses: 0, w2Wages: 0, assets: [sample],
      });
      return { profit, error: null as Error | null, baseMacrs: macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method) };
    } catch (error) {
      return { profit: null, error: error as Error, baseMacrs: macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method) };
    }
  };

  it.each([
    ['yes at 50 percent', 50],
    ['yes at 30 percent', 30],
  ])('sends profit to review for %s', (_label, businessUsePercent) => {
    const { profit, error, baseMacrs } = capture(businessUsePercent);
    expect(baseMacrs).toBeGreaterThan(0);
    expect(profit === null ? 0 : profit.depreciationDeduction).toBe(0);
    expect(profit === null ? null : profit.netProfit).toBeNull();
    expect(error?.message ?? '').toContain(PROFIT_REVIEW);
    expect((error as { code?: string } | null)?.code).toBe('DEPRECIATION_REVIEW_REQUIRED');
  });
});
