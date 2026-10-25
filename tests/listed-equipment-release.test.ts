import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as depreciation from '@/lib/reports/calc4562';
import { computeScheduleCProfit, type ScheduleCProfit } from '@/lib/tax-rules/schedule-c-profit';
import type { Asset } from '@/lib/reports/calc4562';

const { calc4562 } = depreciation;

const TAX_YEAR = 2026;
const BUSINESS_INCOME = 50000;
const GROSS_RECEIPTS = 20000;
const REVIEW_NOTE = 'PLACEHOLDER: This asset needs review.';
const PROFIT_REVIEW = 'PLACEHOLDER: An equipment asset needs an answer or review before this figure can be shown.';
const PHOTO = 'photo_audio_video_communication';
const RECREATION = 'recreation_or_amusement';
const NEITHER = 'neither';
const kindNeeded = (name: string) => `PLACEHOLDER: We need one answer about ${name} before we can show your estimate. What kind of equipment is it?`;

const asset = (overrides: Partial<Asset> = {}): Asset => ({
  id: 'camera', description: 'Camera', datePlacedInService: new Date(Date.UTC(TAX_YEAR, 4, 1)),
  cost: 10000, businessUsePercent: 50, category: 'equipment', method: 'MACRS_5YR',
  section179Requested: false, bonusEligible: false, listedEquipmentAnswer: 'yes', ...overrides,
});

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
    section179: row.section179Deduction, bonus: row.bonusDepreciation, macrs: row.regularDepreciation,
    total: result.totalDepreciation, worksheetSection179: result.totalSection179,
    worksheetBonus: result.totalBonusDepreciation, worksheetMacrs: result.totalRegularDepreciation,
  };
};
const withheld = { section179: 0, bonus: 0, macrs: 0, total: 0, worksheetSection179: 0, worksheetBonus: 0, worksheetMacrs: 0 };

const runProfit = (overrides: Partial<Asset>) => computeScheduleCProfit({
  taxYear: TAX_YEAR, grossReceipts: GROSS_RECEIPTS, confirmedExpenses: 0, w2Wages: 0, assets: [asset(overrides)],
});
const captureProfit = (overrides: Partial<Asset>) => {
  try { return { profit: runProfit(overrides) as ScheduleCProfit | null, error: null as Error | null }; }
  catch (error) { return { profit: null, error: error as Error }; }
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.UTC(TAX_YEAR, 6, 15, 12)));
});
afterEach(() => { vi.useRealTimers(); });

describe('calc4562 release answer at 50 percent', () => {
  it('releases photo gear used in the main line of work and keeps the helper MACRS figure', () => {
    const sample = asset({ listedEquipmentKind: PHOTO, listedEquipmentMainLineOfWork: 'yes', listedEquipmentReleaseAnswer: 'yes' });
    const result = calc4562([sample], BUSINESS_INCOME, TAX_YEAR);
    const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
    const computer = calc4562([asset({ id: 'plain', category: 'computer', businessUsePercent: 50, listedEquipmentAnswer: 'no' })], BUSINESS_INCOME, TAX_YEAR);
    expect(baseMacrs).toBeGreaterThan(0);
    expect(baseMacrs).toBe(computer.totalRegularDepreciation);
    expect(figures(result)).toEqual({ ...withheld, macrs: baseMacrs, total: baseMacrs, worksheetMacrs: baseMacrs });
    expect(result.notes.join('\n')).not.toContain(REVIEW_NOTE);
  });

  it('keeps the hold when the release answer is no', () => {
    const sample = asset({ listedEquipmentKind: PHOTO, listedEquipmentReleaseAnswer: 'no' });
    const result = calc4562([sample], BUSINESS_INCOME, TAX_YEAR);
    const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
    expect(baseMacrs).toBeGreaterThan(0);
    expect({ ...figures(result), review: result.notes.join('\n').includes(REVIEW_NOTE) }).toEqual({ ...withheld, review: true });
    expect(result.totalDepreciation).not.toBe(baseMacrs);
  });

  it('keeps the hold when the release answer is blank', () => {
    for (const listedEquipmentReleaseAnswer of [undefined, null] as const) {
      const sample = asset({ listedEquipmentKind: PHOTO, listedEquipmentReleaseAnswer });
      const result = calc4562([sample], BUSINESS_INCOME, TAX_YEAR);
      const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
      expect(baseMacrs).toBeGreaterThan(0);
      expect({ ...figures(result), review: result.notes.join('\n').includes(REVIEW_NOTE) }).toEqual({ ...withheld, review: true });
      expect(result.totalDepreciation).not.toBe(baseMacrs);
    }
  });

  it('keeps a blank kind held when the earlier release answer is yes', () => {
    for (const listedEquipmentAnswer of [undefined, null] as const) {
      const sample = asset({ listedEquipmentAnswer, listedEquipmentKind: null, listedEquipmentReleaseAnswer: 'yes' });
      const result = calc4562([sample], BUSINESS_INCOME, TAX_YEAR);
      const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
      expect(baseMacrs).toBeGreaterThan(0);
      expect(figures(result)).toEqual(withheld);
      expect(result.totalDepreciation).not.toBe(baseMacrs);
      expect(result.notes.join('\n')).toContain(kindNeeded('Camera'));
      expect(result.notes.join('\n')).not.toContain(REVIEW_NOTE);
      expect(result.heldAssets).toEqual([{ id: 'camera', name: 'Camera', reason: 'question' }]);
    }
  });
});

describe('computeScheduleCProfit release answer at 50 percent', () => {
  it('keeps the helper profit when photo gear is used in the main line of work', () => {
    const sample = asset({ listedEquipmentKind: PHOTO, listedEquipmentMainLineOfWork: 'yes', listedEquipmentReleaseAnswer: 'yes' });
    const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
    const kept = runProfit(sample);
    const reference = runProfit({ id: 'plain', category: 'computer', businessUsePercent: 50, listedEquipmentAnswer: 'no', listedEquipmentReleaseAnswer: 'yes' });
    expect(kept.depreciationDeduction).toBe(baseMacrs);
    expect(kept.depreciationDeduction).toBe(reference.depreciationDeduction);
    expect(kept.netProfit).toBe(reference.netProfit);
    expect(kept.netProfit).toBe(GROSS_RECEIPTS - baseMacrs);
  });

  it('sends profit to review when the release answer is no', () => {
    const sample = asset({ listedEquipmentKind: PHOTO, listedEquipmentReleaseAnswer: 'no' });
    const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
    const { profit, error } = captureProfit(sample);
    expect(baseMacrs).toBeGreaterThan(0);
    expect(profit === null ? 0 : profit.depreciationDeduction).toBe(0);
    expect(profit === null ? null : profit.netProfit).toBeNull();
    expect(error?.message ?? '').toContain(PROFIT_REVIEW);
    expect((error as { code?: string } | null)?.code).toBe('DEPRECIATION_REVIEW_REQUIRED');
  });

  it('sends profit to review when the release answer is blank', () => {
    for (const listedEquipmentReleaseAnswer of [undefined, null] as const) {
      const { profit, error } = captureProfit({ listedEquipmentKind: PHOTO, listedEquipmentReleaseAnswer });
      expect(profit === null ? 0 : profit.depreciationDeduction).toBe(0);
      expect(profit === null ? null : profit.netProfit).toBeNull();
      expect(error?.message ?? '').toContain(PROFIT_REVIEW);
    }
  });

  it('sends profit to review when the kind is blank and the earlier release answer is yes', () => {
    const sample = asset({ listedEquipmentAnswer: null, listedEquipmentKind: null, listedEquipmentReleaseAnswer: 'yes' });
    const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
    const { profit, error } = captureProfit(sample);
    expect(baseMacrs).toBeGreaterThan(0);
    expect(profit === null ? 0 : profit.depreciationDeduction).toBe(0);
    expect(profit === null ? null : profit.netProfit).toBeNull();
    expect(error?.message ?? '').toContain(kindNeeded('Camera'));
    expect(error?.message ?? '').not.toContain(PROFIT_REVIEW);
  });
});

describe('gear kind replaces the first equipment question', () => {
  const held = (overrides: Partial<Asset>) => {
    const sample = asset({ section179Requested: false, bonusEligible: false, ...overrides });
    const result = calc4562([sample], BUSINESS_INCOME, TAX_YEAR);
    const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
    const { profit, error } = captureProfit(sample);
    return { sample, result, baseMacrs, profit, error };
  };

  it.each([30, 50])('keeps recreation held at %s percent when the earlier release answer is yes', (businessUsePercent) => {
    const { result, baseMacrs, profit, error } = held({
      businessUsePercent, listedEquipmentKind: RECREATION, listedEquipmentReleaseAnswer: 'yes', listedEquipmentMainLineOfWork: 'yes',
    });
    expect(baseMacrs).toBeGreaterThan(0);
    expect(figures(result)).toEqual(withheld);
    expect(result.totalDepreciation).not.toBe(baseMacrs);
    expect(result.notes.join('\n')).toContain(REVIEW_NOTE);
    expect(result.assets[0].bonusDepreciation).toBe(0);
    expect(profit === null ? 0 : profit.depreciationDeduction).toBe(0);
    expect(error?.message ?? '').toContain(PROFIT_REVIEW);
    expect(error?.message ?? '').not.toContain(kindNeeded('Camera'));
  });

  it('keeps a blank kind held at 50 percent', () => {
    const { result, baseMacrs, profit, error } = held({ listedEquipmentAnswer: null, listedEquipmentKind: null, listedEquipmentReleaseAnswer: 'yes' });
    expect(baseMacrs).toBeGreaterThan(0);
    expect(figures(result)).toEqual(withheld);
    expect(result.totalDepreciation).not.toBe(baseMacrs);
    expect(result.notes.join('\n')).toContain(kindNeeded('Camera'));
    expect(result.heldAssets).toEqual([{ id: 'camera', name: 'Camera', reason: 'question' }]);
    expect(profit === null ? 0 : profit.depreciationDeduction).toBe(0);
    expect(error?.message ?? '').toContain(kindNeeded('Camera'));
    expect(error?.message ?? '').not.toContain(PROFIT_REVIEW);
  });

  it('reads a legacy yes with no kind as a blank kind and keeps it held', () => {
    const { result, baseMacrs, profit, error } = held({ listedEquipmentAnswer: 'yes', listedEquipmentReleaseAnswer: 'yes' });
    expect(baseMacrs).toBeGreaterThan(0);
    expect(figures(result)).toEqual(withheld);
    expect(result.totalDepreciation).not.toBe(baseMacrs);
    expect(result.notes.join('\n')).toContain(kindNeeded('Camera'));
    expect(result.notes.join('\n')).not.toContain(REVIEW_NOTE);
    expect(result.heldAssets).toEqual([{ id: 'camera', name: 'Camera', reason: 'question' }]);
    expect(profit === null ? 0 : profit.depreciationDeduction).toBe(0);
    expect(error?.message ?? '').toContain(kindNeeded('Camera'));
    expect(error?.message ?? '').not.toContain(PROFIT_REVIEW);
  });

  it('does not hold neither at 50 percent', () => {
    const sample = asset({ listedEquipmentAnswer: 'yes', listedEquipmentKind: NEITHER, section179Requested: false, bonusEligible: false });
    const result = calc4562([sample], BUSINESS_INCOME, TAX_YEAR);
    const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
    const computer = calc4562([asset({ id: 'plain', category: 'computer', businessUsePercent: 50, listedEquipmentAnswer: 'no' })], BUSINESS_INCOME, TAX_YEAR);
    expect(baseMacrs).toBeGreaterThan(0);
    expect(figures(result)).toEqual({ ...withheld, macrs: baseMacrs, total: baseMacrs, worksheetMacrs: baseMacrs });
    expect(result.totalDepreciation).toBe(computer.totalRegularDepreciation);
    expect(result.notes.join('\n')).not.toContain('PLACEHOLDER');
    expect(result.heldAssets).toEqual([]);
    const kept = runProfit(sample);
    expect(kept.depreciationDeduction).toBe(baseMacrs);
    expect(kept.netProfit).toBe(GROSS_RECEIPTS - baseMacrs);
  });

  it('releases a named kind used in the main line of work to the helper base figure', () => {
    const sample = asset({
      listedEquipmentKind: PHOTO, listedEquipmentMainLineOfWork: 'yes', listedEquipmentReleaseAnswer: 'yes',
      section179Requested: false, bonusEligible: false,
    });
    const result = calc4562([sample], BUSINESS_INCOME, TAX_YEAR);
    const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
    const computer = calc4562([asset({ id: 'plain', category: 'computer', businessUsePercent: 50, method: sample.method, listedEquipmentAnswer: 'no' })], BUSINESS_INCOME, TAX_YEAR);
    expect(baseMacrs).toBe(computer.totalRegularDepreciation);
    expect(figures(result).macrs).toBe(baseMacrs);
    expect(result.totalDepreciation).toBe(baseMacrs);
    const kept = runProfit(sample);
    expect(kept.depreciationDeduction).toBe(baseMacrs);
    expect(kept.netProfit).toBe(GROSS_RECEIPTS - baseMacrs);
  });

  it('keeps photo gear held when the business location is a home office and no qualifying home office is stored', () => {
    const { result, baseMacrs, profit, error } = held({
      listedEquipmentKind: PHOTO,
      listedEquipmentBusinessLocation: 'yes',
      listedEquipmentLocationFollowUp: 'home_office',
      listedEquipmentReleaseAnswer: 'yes',
    });
    expect(baseMacrs).toBeGreaterThan(0);
    expect(figures(result)).toEqual(withheld);
    expect(result.totalDepreciation).not.toBe(baseMacrs);
    expect(result.notes.join('\n')).toContain(REVIEW_NOTE);
    expect(result.heldAssets).toEqual([{ id: 'camera', name: 'Camera', reason: 'review' }]);
    expect(profit === null ? 0 : profit.depreciationDeduction).toBe(0);
    expect(error?.message ?? '').toContain(PROFIT_REVIEW);
  });

  it('releases photo gear used only at a business location outside the home', () => {
    const sample = asset({
      listedEquipmentKind: PHOTO,
      listedEquipmentBusinessLocation: 'yes',
      listedEquipmentLocationFollowUp: 'outside_home',
      listedEquipmentReleaseAnswer: 'yes',
      section179Requested: false, bonusEligible: false,
    });
    const result = calc4562([sample], BUSINESS_INCOME, TAX_YEAR);
    const baseMacrs = macrsFromHelpers(sample.cost, sample.businessUsePercent, sample.method);
    expect(baseMacrs).toBeGreaterThan(0);
    expect(figures(result)).toEqual({ ...withheld, macrs: baseMacrs, total: baseMacrs, worksheetMacrs: baseMacrs });
    const kept = runProfit(sample);
    expect(kept.depreciationDeduction).toBe(baseMacrs);
    expect(kept.netProfit).toBe(GROSS_RECEIPTS - baseMacrs);
  });

  it('does not let a stored yes on the earlier release question release photo gear', () => {
    const { result, baseMacrs } = held({ listedEquipmentKind: PHOTO, listedEquipmentReleaseAnswer: 'yes' });
    expect(baseMacrs).toBeGreaterThan(0);
    expect(figures(result)).toEqual(withheld);
    expect(result.totalDepreciation).not.toBe(baseMacrs);
    expect(result.notes.join('\n')).toContain(REVIEW_NOTE);
  });
});
