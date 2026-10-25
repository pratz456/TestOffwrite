import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { UserProfile } from '@/lib/firebase/profiles-server';
import {
  ACCELERATED_MACRS_HALF_YEAR_RATE, ASSET_CATEGORIES, EQUIPMENT_ASSET_CATEGORIES, LISTED_EQUIPMENT_BUSINESS_USE_CEILING,
  LISTED_EQUIPMENT_REVIEW_NOTE_PLACEHOLDER, acceleratedMacrsDeduction, businessUseBasis,
  calc4562, depreciationReviewBody, listedEquipmentBusinessUseAtOrUnderCeiling, listedEquipmentQuestionCopy, roundCents, type Asset, type ListedEquipmentAnswer,
} from '@/lib/reports/calc4562';
import { generateForm4562PDF } from '@/lib/reports/form4562';
import { computeScheduleCProfit } from '@/lib/tax-rules/schedule-c-profit';

const TAX_YEAR = 2026;
const PINNED_NOW = new Date(Date.UTC(TAX_YEAR, 6, 15, 12, 0, 0));
const BUSINESS_INCOME = 50000;
const routeState = vi.hoisted(() => ({ assets: [] as Asset[], income: 50000 }));

vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'listed-equipment-owner' }, error: null }) }));
vi.mock('@/lib/reports/load-schedule-se', () => ({
  loadScheduleCRecords: async () => ({
    assets: routeState.assets,
    section179BusinessIncome: routeState.income,
    depreciationElections: { deMinimisSafeHarborYears: [] },
  }),
}));

import { GET as form4562Worksheet } from '@/app/api/tax/form-4562/route';

const placedInService = new Date(Date.UTC(TAX_YEAR, 4, 1));
const asset = (overrides: Partial<Asset> = {}): Asset => ({
  id: 'asset', description: 'Recorded asset', datePlacedInService: placedInService, cost: 10000, businessUsePercent: 100,
  category: 'equipment', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false, ...overrides,
});
const reviewCode = (run: () => unknown) => {
  try { run(); return null; } catch (error) { return (error as { code?: string }).code ?? 'THREW'; }
};
const moneyFields = (row: { section179Deduction: number; bonusDepreciation: number; regularDepreciation: number; totalDepreciation: number; deMinimisExpense: number; carryoverToNextYear: number }) => ({
  section179Deduction: row.section179Deduction, bonusDepreciation: row.bonusDepreciation, regularDepreciation: row.regularDepreciation,
  totalDepreciation: row.totalDepreciation, deMinimisExpense: row.deMinimisExpense, carryoverToNextYear: row.carryoverToNextYear,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(PINNED_NOW);
  routeState.assets = [];
  routeState.income = BUSINESS_INCOME;
});
afterEach(() => { vi.useRealTimers(); });

describe('listed equipment business-use ceiling', () => {
  it('treats 50 as 50% or less and 50.01 and 51 as over 50%', () => {
    expect(LISTED_EQUIPMENT_BUSINESS_USE_CEILING).toBe(50);
    expect(listedEquipmentBusinessUseAtOrUnderCeiling(50)).toBe(true);
    expect(listedEquipmentBusinessUseAtOrUnderCeiling(50.01)).toBe(false);
    expect(listedEquipmentBusinessUseAtOrUnderCeiling(51)).toBe(false);
    expect(EQUIPMENT_ASSET_CATEGORIES).toEqual(['equipment']);
    expect(ASSET_CATEGORIES).toEqual(['computer', 'furniture', 'vehicle', 'equipment', 'other']);
  });
});

describe('equipment listed-property flag', () => {
  it('withholds Section 179, bonus, and accelerated MACRS when the answer is yes at exactly 50%', () => {
    const equipment = asset({ businessUsePercent: 50, listedEquipmentAnswer: 'yes', listedEquipmentKind: 'recreation_or_amusement', section179Requested: true, bonusEligible: true, description: 'Camera body' });
    const sibling = asset({ id: 'sibling', description: 'Office computer', category: 'computer', cost: 3000, businessUsePercent: 100, listedEquipmentAnswer: 'yes' });
    const result = calc4562([equipment, sibling], BUSINESS_INCOME, TAX_YEAR);
    const held = result.assets.find(row => row.asset.id === equipment.id)!;
    const kept = result.assets.find(row => row.asset.id === sibling.id)!;
    const withheldSection179 = roundCents(businessUseBasis(equipment.cost, equipment.businessUsePercent));
    const withheldMacrs = acceleratedMacrsDeduction(businessUseBasis(equipment.cost, equipment.businessUsePercent), equipment.method);
    const siblingMacrs = acceleratedMacrsDeduction(businessUseBasis(sibling.cost, sibling.businessUsePercent), sibling.method);
    expect(withheldSection179).toBeGreaterThan(0);
    expect(withheldMacrs).toBeGreaterThan(0);
    expect(siblingMacrs).toBe(roundCents(businessUseBasis(sibling.cost, sibling.businessUsePercent) * ACCELERATED_MACRS_HALF_YEAR_RATE.MACRS_5YR));
    expect(held.listedEquipmentHold).toBe('review');
    expect(held.treatment).toBe('listed_property_review');
    expect(moneyFields(held)).toEqual({ section179Deduction: 0, bonusDepreciation: 0, regularDepreciation: 0, totalDepreciation: 0, deMinimisExpense: 0, carryoverToNextYear: 0 });
    expect(kept.listedEquipmentHold).toBeNull();
    expect(kept.regularDepreciation).toBe(siblingMacrs);
    expect(result.totalSection179).toBe(0);
    expect(result.totalBonusDepreciation).toBe(0);
    expect(result.totalRegularDepreciation).toBe(siblingMacrs);
    expect(result.totalDepreciation).toBe(siblingMacrs);
    expect(result.totalDeMinimisExpense).toBe(0);
    expect(result.totalCarryover).toBe(0);
    expect(result.totalDepreciation).not.toBe(roundCents(siblingMacrs + withheldMacrs));
    expect(result.totalSection179).not.toBe(withheldSection179);
    expect(result.notes.join('\n')).toContain(LISTED_EQUIPMENT_REVIEW_NOTE_PLACEHOLDER);
    expect(result.section179).toBeNull();
  });

  it.each([50.01, 51])('keeps the existing calculation when the answer is yes at %s% business use', (percent) => {
    const flagged = asset({ businessUsePercent: percent, listedEquipmentAnswer: 'yes', section179Requested: true });
    const plain = asset({ businessUsePercent: percent, section179Requested: true });
    const flaggedResult = calc4562([flagged], BUSINESS_INCOME, TAX_YEAR);
    const plainResult = calc4562([plain], BUSINESS_INCOME, TAX_YEAR);
    const basis = businessUseBasis(flagged.cost, percent);
    expect(flaggedResult.assets[0].listedEquipmentHold).toBeNull();
    expect(flaggedResult.assets[0].section179Deduction).toBe(roundCents(basis));
    expect(flaggedResult.assets[0].bonusDepreciation).toBe(0);
    expect(flaggedResult.assets[0].regularDepreciation).toBe(acceleratedMacrsDeduction(basis - roundCents(basis), flagged.method));
    expect(flaggedResult.totalDepreciation).toBe(plainResult.totalDepreciation);
    expect(flaggedResult.totalSection179).toBe(plainResult.totalSection179);
    expect(flaggedResult.assets[0].section179Deduction).toBe(plainResult.assets[0].section179Deduction);
    expect(flaggedResult.notes.join('\n')).not.toContain('PLACEHOLDER');
  });

  it.each([50, 50.01, 51])('keeps the existing calculation when the answer is no at %s% business use', (percent) => {
    const flagged = asset({ businessUsePercent: percent, listedEquipmentAnswer: 'no' });
    const computer = asset({ category: 'computer', businessUsePercent: percent });
    const result = calc4562([flagged], BUSINESS_INCOME, TAX_YEAR);
    const expected = acceleratedMacrsDeduction(businessUseBasis(flagged.cost, percent), flagged.method);
    expect(result.assets[0].listedEquipmentHold).toBeNull();
    expect(result.assets[0].regularDepreciation).toBe(expected);
    expect(result.assets[0].section179Deduction).toBe(0);
    expect(result.assets[0].bonusDepreciation).toBe(0);
    expect(result.totalDepreciation).toBe(expected);
    expect(result.totalDepreciation).toBe(calc4562([computer], BUSINESS_INCOME, TAX_YEAR).totalDepreciation);
    expect(result.notes.join('\n')).not.toContain('PLACEHOLDER');
  });

  it('still refuses Section 179 for an equipment asset answered no at 50% or less', () => {
    const flagged = asset({ businessUsePercent: 50, listedEquipmentAnswer: 'no', section179Requested: true });
    expect(reviewCode(() => calc4562([flagged], BUSINESS_INCOME, TAX_YEAR))).toBe('DEPRECIATION_REVIEW_REQUIRED');
    expect(() => calc4562([flagged], BUSINESS_INCOME, TAX_YEAR)).toThrow(/more than 50%/);
  });

  it('asks the question and withholds figures when an equipment asset at 50% is blank', () => {
    for (const listedEquipmentAnswer of [undefined, null] as const) {
      const equipment = asset({ businessUsePercent: 50, listedEquipmentAnswer, section179Requested: true, bonusEligible: true, description: 'Unanswered mixer' });
      const result = calc4562([equipment], BUSINESS_INCOME, TAX_YEAR);
      const withheld = acceleratedMacrsDeduction(businessUseBasis(equipment.cost, equipment.businessUsePercent), equipment.method);
      expect(withheld).toBeGreaterThan(0);
      expect(result.assets[0].listedEquipmentHold).toBe('question_required');
      expect(moneyFields(result.assets[0])).toEqual({ section179Deduction: 0, bonusDepreciation: 0, regularDepreciation: 0, totalDepreciation: 0, deMinimisExpense: 0, carryoverToNextYear: 0 });
      expect(result.totalDepreciation).toBe(0);
      expect(result.totalSection179).toBe(0);
      expect(result.totalBonusDepreciation).toBe(0);
      expect(result.notes.join('\n')).toContain('PLACEHOLDER: We need one answer about Unanswered mixer before we can show your estimate. What kind of equipment is it?');
      expect(result.heldAssets).toEqual([{ id: equipment.id, name: 'Unanswered mixer', reason: 'question' }]);
      expect(result.notes.join('\n')).not.toContain(LISTED_EQUIPMENT_REVIEW_NOTE_PLACEHOLDER);
    }
  });

  it.each([50.01, 51])('leaves a blank equipment answer alone at %s% business use', (percent) => {
    const blank = asset({ businessUsePercent: percent, listedEquipmentAnswer: null });
    const plain = asset({ businessUsePercent: percent });
    const result = calc4562([blank], BUSINESS_INCOME, TAX_YEAR);
    const expected = acceleratedMacrsDeduction(businessUseBasis(blank.cost, percent), blank.method);
    expect(result.assets[0].listedEquipmentHold).toBeNull();
    expect(result.assets[0].regularDepreciation).toBe(expected);
    expect(result.totalDepreciation).toBe(calc4562([plain], BUSINESS_INCOME, TAX_YEAR).totalDepreciation);
    expect(result.notes.join('\n')).not.toContain('PLACEHOLDER');
  });

  it.each(['computer', 'furniture'] as const)('does not apply the equipment question to %s', (category) => {
    const method = category === 'furniture' ? 'MACRS_7YR' : 'MACRS_5YR';
    const flagged = asset({ category, method, businessUsePercent: 50, listedEquipmentAnswer: 'yes' as ListedEquipmentAnswer });
    const plain = asset({ category, method, businessUsePercent: 50 });
    const result = calc4562([flagged], BUSINESS_INCOME, TAX_YEAR);
    const expected = acceleratedMacrsDeduction(businessUseBasis(flagged.cost, flagged.businessUsePercent), method);
    expect(result.assets[0].listedEquipmentHold).toBeNull();
    expect(result.assets[0].regularDepreciation).toBe(expected);
    expect(result.totalDepreciation).toBe(calc4562([plain], BUSINESS_INCOME, TAX_YEAR).totalDepreciation);
    expect(result.notes.join('\n')).not.toContain('PLACEHOLDER');
  });

  it('leaves vehicles, other categories, and unknown categories on their existing paths', () => {
    expect(reviewCode(() => calc4562([asset({ category: 'vehicle', businessUsePercent: 40, listedEquipmentAnswer: 'yes' })], BUSINESS_INCOME, TAX_YEAR))).toBe('DEPRECIATION_REVIEW_REQUIRED');
    expect(() => calc4562([asset({ category: 'vehicle', businessUsePercent: 40, listedEquipmentAnswer: 'no' })], BUSINESS_INCOME, TAX_YEAR)).toThrow(/vehicle limits/);
    expect(() => calc4562([asset({ category: 'other', businessUsePercent: 100, listedEquipmentAnswer: 'yes' })], BUSINESS_INCOME, TAX_YEAR)).toThrow(/asset class/);
    expect(reviewCode(() => calc4562([asset({ category: 'building' as Asset['category'], businessUsePercent: 50, listedEquipmentAnswer: 'yes' })], BUSINESS_INCOME, TAX_YEAR))).toBe('DEPRECIATION_REVIEW_REQUIRED');
    expect(() => calc4562([asset({ category: 'building' as Asset['category'] })], BUSINESS_INCOME, TAX_YEAR)).toThrow(/Invalid category/);
  });

  it('does not let a withheld equipment asset change another asset through de minimis, Section 179 phaseout, or the mid-quarter test', () => {
    const sibling = asset({ id: 'sibling', description: 'Office computer', category: 'computer', cost: 10000, businessUsePercent: 100, section179Requested: true });
    const held = asset({ id: 'held', description: 'Lighting kit', cost: 6650000, businessUsePercent: 50, listedEquipmentAnswer: 'yes', listedEquipmentKind: 'recreation_or_amusement', section179Requested: true, bonusEligible: true });
    const combined = calc4562([sibling, held], BUSINESS_INCOME, TAX_YEAR);
    const alone = calc4562([sibling], BUSINESS_INCOME, TAX_YEAR);
    const expected = roundCents(businessUseBasis(sibling.cost, sibling.businessUsePercent));
    expect(combined.assets.find(row => row.asset.id === 'held')!.totalDepreciation).toBe(0);
    expect(combined.totalSection179).toBe(expected);
    expect(combined.section179?.costOfSection179Property).toBe(sibling.cost);
    expect(combined.totalDepreciation).toBe(alone.totalDepreciation);
    expect(combined.totalSection179).toBe(alone.totalSection179);
    const heldLastQuarter = { ...held, datePlacedInService: new Date(Date.UTC(TAX_YEAR, 10, 1)) };
    expect(() => calc4562([sibling, heldLastQuarter], BUSINESS_INCOME, TAX_YEAR)).toThrow(/mid-quarter/);
    const cheapHeld = asset({ id: 'cheap', description: 'Microphone', cost: 2000, businessUsePercent: 50, listedEquipmentAnswer: 'yes', listedEquipmentKind: 'recreation_or_amusement' });
    const cheapSibling = asset({ id: 'mouse', description: 'Mouse', category: 'computer', cost: 1000, businessUsePercent: 100 });
    const expensed = calc4562([cheapSibling, cheapHeld], BUSINESS_INCOME, TAX_YEAR, { deMinimisSafeHarborYears: [TAX_YEAR] });
    const siblingExpense = roundCents(businessUseBasis(cheapSibling.cost, cheapSibling.businessUsePercent));
    const withheldExpense = roundCents(businessUseBasis(cheapHeld.cost, cheapHeld.businessUsePercent));
    expect(withheldExpense).toBeGreaterThan(0);
    expect(expensed.totalDeMinimisExpense).toBe(siblingExpense);
    expect(expensed.totalDeMinimisExpense).not.toBe(roundCents(siblingExpense + withheldExpense));
    expect(expensed.assets.find(row => row.asset.id === 'cheap')!.deMinimisExpense).toBe(0);
  });

  const heldPhoto = (overrides: Partial<Asset>): Asset => asset({
    id: 'camera', description: 'Camera', category: 'equipment', method: 'MACRS_5YR', businessUsePercent: 50,
    listedEquipmentKind: 'photo_audio_video_communication', listedEquipmentMainLineOfWork: 'no', listedEquipmentBusinessLocation: 'no',
    section179Requested: false, bonusEligible: false, ...overrides,
  });

  it('counts a held camera in the last quarter toward the mid-quarter test', () => {
    const laptop = asset({ id: 'laptop', description: 'Laptop', category: 'computer', cost: 2000, businessUsePercent: 100, datePlacedInService: new Date(Date.UTC(2025, 8, 1)) });
    const camera = heldPhoto({ cost: 4000, datePlacedInService: new Date(Date.UTC(2025, 9, 1)) });
    expect(businessUseBasis(camera.cost, camera.businessUsePercent)).toBe(2000);
    expect(() => calc4562([laptop, camera], BUSINESS_INCOME, 2025)).toThrow(/mid-quarter/);
  });

  it('carries the camera question on the mid-quarter review', () => {
    const laptop = asset({ id: 'laptop', description: 'Laptop', category: 'computer', cost: 2000, businessUsePercent: 100, datePlacedInService: new Date(Date.UTC(2025, 8, 1)) });
    const camera = heldPhoto({
      cost: 4000, datePlacedInService: new Date(Date.UTC(2025, 9, 1)),
      listedEquipmentMainLineOfWork: null, listedEquipmentBusinessLocation: null,
    });
    const question = listedEquipmentQuestionCopy(camera);
    expect(question).toBe('PLACEHOLDER: We need one more answer about Camera. Do you use it in your main line of work?');
    let thrown: unknown = null;
    expect(() => {
      try { calc4562([laptop, camera], BUSINESS_INCOME, 2025); }
      catch (error) { thrown = error; throw error; }
    }).toThrow(/mid-quarter/);
    expect(depreciationReviewBody(thrown, 'fallback', 'DEPRECIATION_REVIEW_REQUIRED')).toEqual({
      error: expect.stringMatching(/mid-quarter/),
      code: 'DEPRECIATION_REVIEW_REQUIRED',
      heldAssets: [{ id: 'camera', name: 'Camera', reason: 'question', ask: 'main_line' }],
    });
    expect(question).toContain('Camera');
  });

  it('does not apply the mid-quarter review when held basis makes the last quarter exactly 40 percent', () => {
    const camera = heldPhoto({ cost: 6000, datePlacedInService: new Date(Date.UTC(2025, 1, 1)) });
    const laptop = asset({ id: 'laptop', description: 'Laptop', category: 'computer', cost: 2000, businessUsePercent: 100, datePlacedInService: new Date(Date.UTC(2025, 11, 1)) });
    expect(businessUseBasis(camera.cost, camera.businessUsePercent)).toBe(3000);
    expect(() => calc4562([camera, laptop], BUSINESS_INCOME, 2025)).not.toThrow();
    const result = calc4562([camera, laptop], BUSINESS_INCOME, 2025);
    expect(result.assets.find(row => row.asset.id === 'camera')!.totalDepreciation).toBe(0);
    expect(result.assets.find(row => row.asset.id === 'laptop')!.regularDepreciation).toBe(acceleratedMacrsDeduction(2000, 'MACRS_5YR'));
  });

  it('returns a withheld result for a single held asset placed in the last quarter', () => {
    const camera = heldPhoto({ cost: 4000, datePlacedInService: new Date(Date.UTC(2025, 9, 1)) });
    expect(() => calc4562([camera], BUSINESS_INCOME, 2025)).not.toThrow();
    const result = calc4562([camera], BUSINESS_INCOME, 2025);
    expect(result.assets[0].listedEquipmentHold).toBe('review');
    expect(moneyFields(result.assets[0])).toEqual({ section179Deduction: 0, bonusDepreciation: 0, regularDepreciation: 0, totalDepreciation: 0, deMinimisExpense: 0, carryoverToNextYear: 0 });
    expect(result.totalDepreciation).toBe(0);
    expect(result.notes.join('\n')).not.toContain('mid-quarter');
  });
});

describe('callers that read calc4562 money totals', () => {
  const grossReceipts = 20000;
  const equipment = asset({ id: 'camera', description: 'Camera body', cost: 8642, businessUsePercent: 50, listedEquipmentAnswer: 'yes', listedEquipmentKind: 'recreation_or_amusement', section179Requested: true, bonusEligible: true });
  const sibling = asset({ id: 'sibling', description: 'Office computer', category: 'computer', cost: 3000, businessUsePercent: 100 });
  const siblingMacrs = () => acceleratedMacrsDeduction(businessUseBasis(sibling.cost, sibling.businessUsePercent), sibling.method);
  const withheldSection179 = () => roundCents(businessUseBasis(equipment.cost, equipment.businessUsePercent));
  const withheldMacrs = () => acceleratedMacrsDeduction(businessUseBasis(equipment.cost, equipment.businessUsePercent), equipment.method);

  it('keeps the withheld asset out of Schedule C profit', () => {
    expect(() => computeScheduleCProfit({ taxYear: TAX_YEAR, grossReceipts, confirmedExpenses: 0, w2Wages: 0, assets: [equipment, sibling] })).toThrow(/PLACEHOLDER: An equipment asset needs an answer or review before this figure can be shown/);
    try {
      computeScheduleCProfit({ taxYear: TAX_YEAR, grossReceipts, confirmedExpenses: 0, w2Wages: 0, assets: [equipment, sibling] });
    } catch (error) {
      expect(error).toMatchObject({ code: 'DEPRECIATION_REVIEW_REQUIRED' });
      expect((error as { heldAssets?: unknown }).heldAssets).toEqual([{ id: equipment.id, name: 'Camera body', reason: 'review' }]);
    }
  });

  it('blocks the Form 4562 PDF when an asset is held', async () => {
    const input = {
      userProfile: { name: 'Synthetic Taxpayer' } as UserProfile,
      assetsSettings: [equipment, sibling], transactions: [], taxYear: TAX_YEAR, businessIncome: BUSINESS_INCOME,
    };
    await expect(generateForm4562PDF(input)).rejects.toThrow(/PLACEHOLDER: An equipment asset needs an answer or review before this figure can be shown/);
    await expect(generateForm4562PDF(input)).rejects.toMatchObject({ code: 'DEPRECIATION_REVIEW_REQUIRED' });
  });

  it('blocks the Form 4562 PDF when an equipment asset at 50% is blank', async () => {
    const blank = asset({ ...equipment, listedEquipmentAnswer: null, listedEquipmentKind: null, description: 'Unanswered recorder' });
    const input = {
      userProfile: { name: 'Synthetic Taxpayer' } as UserProfile,
      assetsSettings: [blank, sibling], transactions: [], taxYear: TAX_YEAR, businessIncome: BUSINESS_INCOME,
    };
    await expect(generateForm4562PDF(input)).rejects.toMatchObject({ code: 'DEPRECIATION_REVIEW_REQUIRED' });
    await expect(generateForm4562PDF(input)).rejects.toThrow(/PLACEHOLDER: We need one answer about Unanswered recorder before we can show your estimate\. What kind of equipment is it\?/);
    try {
      await generateForm4562PDF(input);
    } catch (error) {
      expect((error as { heldAssets?: unknown }).heldAssets).toEqual([{ id: blank.id, name: 'Unanswered recorder', reason: 'question' }]);
    }
  });

  it('does not build a Schedule SE profit while an asset is held', () => {
    expect(() => computeScheduleCProfit({ taxYear: TAX_YEAR, grossReceipts, confirmedExpenses: 0, w2Wages: 0, assets: [equipment, sibling] })).toThrow(/PLACEHOLDER: An equipment asset needs an answer or review before this figure can be shown/);
  });

  it('returns withheld figures as zero from the Form 4562 worksheet route', async () => {
    routeState.assets = [equipment, sibling];
    const response = await form4562Worksheet(new NextRequest(`http://localhost/api/tax/form-4562?year=${TAX_YEAR}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    const held = body.calculation.assets.find((row: { asset: { id: string } }) => row.asset.id === equipment.id);
    expect(body.calculation.totalDepreciation).toBe(siblingMacrs());
    expect(body.calculation.totalSection179).toBe(0);
    expect(body.calculation.totalBonusDepreciation).toBe(0);
    expect(body.calculation.totalRegularDepreciation).toBe(siblingMacrs());
    expect(held.section179Deduction).toBe(0);
    expect(held.bonusDepreciation).toBe(0);
    expect(held.regularDepreciation).toBe(0);
    expect(held.totalDepreciation).toBe(0);
    expect(held.listedEquipmentHold).toBe('review');
    const serialized = JSON.stringify(body.calculation);
    expect(serialized).not.toContain(String(withheldSection179()));
    expect(serialized).not.toContain(String(withheldMacrs()));
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-07-15');
  });
});
