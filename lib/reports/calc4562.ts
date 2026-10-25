import { getSection179Limits, SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';

/** Categories the asset record can store. Only `equipment` is equipment for the listed-property question. */
export const ASSET_CATEGORIES = ['computer', 'furniture', 'vehicle', 'equipment', 'other'] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

/**
 * Asset categories this gate treats as equipment.
 * Vehicles stay on their own review path. Buildings are not an asset category here.
 */
export const EQUIPMENT_ASSET_CATEGORIES = ['equipment'] as const satisfies readonly AssetCategory[];

/** Qualified business use at this percent or lower is "50% or less". */
export const LISTED_EQUIPMENT_BUSINESS_USE_CEILING = 50;

/**
 * Customer-facing question shown for each equipment asset.
 * PLACEHOLDER wording. Replace with reviewed copy before this text is treated as final.
 */
export const LISTED_EQUIPMENT_QUESTION_PLACEHOLDER =
  'PLACEHOLDER: Is this photo, video, audio, communication or recreation equipment?';

/**
 * Customer-facing note when that answer is yes and business use is 50% or less.
 * PLACEHOLDER wording. This worksheet does not calculate ADS straight line.
 */
export const LISTED_EQUIPMENT_REVIEW_NOTE_PLACEHOLDER =
  'PLACEHOLDER: This asset needs review.';

/**
 * Customer-facing message when a profit, self-employment, or tax figure cannot be shown
 * because an equipment asset is held for an answer or review.
 * PLACEHOLDER wording. Replace with reviewed copy before this text is treated as final.
 */
export const LISTED_EQUIPMENT_PROFIT_REVIEW_PLACEHOLDER =
  'PLACEHOLDER: An equipment asset needs an answer or review before this figure can be shown.';

/** An asset the worksheet held instead of calculating. `question` means the equipment question is still blank. */
export interface ListedEquipmentHeldAsset {
  id: string;
  reason: 'review' | 'question';
}

/** Yes or no. Omit or null while the equipment question is still blank. */
export type ListedEquipmentAnswer = 'yes' | 'no';

/** `review` withholds figures. `question_required` asks the question and also withholds figures. */
export type ListedEquipmentHold = 'review' | 'question_required';

export interface Asset {
  id: string;
  description: string;
  datePlacedInService: Date;
  cost: number;
  businessUsePercent: number; // 0-100
  category: AssetCategory;
  method: 'MACRS_5YR' | 'MACRS_7YR' | 'SL'; // Straight Line
  section179Requested: boolean;
  bonusEligible: boolean;
  /**
   * Equipment only. Yes means photo, video, audio, communication, or recreation equipment.
   * No means it is not. Blank (omit or null) means the question has not been answered.
   * Ignored for every category other than equipment.
   */
  listedEquipmentAnswer?: ListedEquipmentAnswer | null;
}

/**
 * Annual elections the asset form cannot infer. Stored in settings/depreciation.
 * The de minimis safe harbor is elected each year by a statement attached to a
 * timely filed original return (Reg. §1.263(a)-1(f)(5)); it is not an asset attribute.
 */
export interface DepreciationElections {
  deMinimisSafeHarborYears: readonly number[];
}

export type AssetTreatment = 'de_minimis_expense' | 'section_179' | 'macrs' | 'listed_property_review';

export interface AssetCalculation {
  asset: Asset;
  treatment: AssetTreatment;
  /** Set when this equipment asset's Section 179, bonus, and accelerated MACRS figures are withheld. */
  listedEquipmentHold: ListedEquipmentHold | null;
  /** Current-year ordinary expense under Reg. §1.263(a)-1(f); not depreciation and not on Form 4562. */
  deMinimisExpense: number;
  /** Amount elected under §179(a); reduces depreciable basis even when carried forward. */
  section179Elected: number;
  section179Deduction: number;
  bonusDepreciation: number;
  regularDepreciation: number;
  totalDepreciation: number;
  remainingBasis: number;
  carryoverToNextYear: number;
}

export interface Section179Summary {
  electionYear: number;
  limit: number;
  phaseoutThreshold: number;
  /** Cost of all §179 property placed in service this year (§179(b)(2) reduction base). */
  costOfSection179Property: number;
  dollarLimitAfterPhaseout: number;
  /** §179(b)(3)(A): aggregate active trade/business taxable income supplied by the caller. */
  businessIncomeLimit: number;
  elected: number;
  allowed: number;
  carryover: number;
  source: string;
}

export interface Form4562Calculation {
  taxYear: number;
  assets: AssetCalculation[];
  totalDeMinimisExpense: number;
  section179: Section179Summary | null;
  totalSection179: number;
  totalBonusDepreciation: number;
  totalRegularDepreciation: number;
  /** Form 4562 line 22 equivalent for the supported subset: §179 allowed plus regular MACRS. */
  totalDepreciation: number;
  totalCarryover: number;
  /** Assets held for an answer or review. Empty when every current asset was calculated. */
  heldAssets: ListedEquipmentHeldAsset[];
  notes: string[];
}

/** The current asset form lacks the facts needed to calculate elections and prior-year basis. */
export class DepreciationReviewRequiredError extends Error {
  readonly code = 'DEPRECIATION_REVIEW_REQUIRED';
  readonly heldAssets?: ListedEquipmentHeldAsset[];
  constructor(detail: string, heldAssets?: ListedEquipmentHeldAsset[]) {
    super(`Asset depreciation needs review: ${detail}`);
    this.heldAssets = heldAssets;
  }
}

/**
 * Reg. §1.263(a)-1(f)(1)(ii)(D) as raised by Notice 2015-82: taxpayers without an
 * applicable financial statement may expense amounts that do not exceed $2,500 per
 * invoice, or per item as substantiated by the invoice. The asset record is treated
 * as one substantiated item; invoice grouping is a records fact the app cannot verify.
 */
export const DE_MINIMIS_SAFE_HARBOR_LIMIT = 2500;

/**
 * Years with published post-OBBBA §179 limits that this planning helper applies.
 * 2024 elections belong on an already-filed or amended 2024 return, so they stay in review.
 */
export const SECTION_179_CALCULATION_YEARS: readonly number[] = [2025, 2026];

export const roundCents = (value: number) => Math.round(value * 100) / 100;

/** Publication 946 Table A-1, half-year convention, 200% declining balance, first year. */
export const ACCELERATED_MACRS_HALF_YEAR_RATE = {
  MACRS_5YR: 0.2,
  MACRS_7YR: 0.1429,
} as const;

export function businessUseBasis(cost: number, businessUsePercent: number): number {
  return cost * businessUsePercent / 100;
}

/** First-year accelerated MACRS (200% declining balance, half-year). Straight line is not calculated here. */
export function acceleratedMacrsDeduction(basis: number, method: Asset['method']): number {
  const rate = method === 'MACRS_5YR' ? ACCELERATED_MACRS_HALF_YEAR_RATE.MACRS_5YR : ACCELERATED_MACRS_HALF_YEAR_RATE.MACRS_7YR;
  return roundCents(basis * rate);
}

export function isEquipmentAssetCategory(category: string | null | undefined): category is (typeof EQUIPMENT_ASSET_CATEGORIES)[number] {
  return (EQUIPMENT_ASSET_CATEGORIES as readonly string[]).includes(category ?? '');
}

/** True when qualified business use is 50% or less. Exactly 50 counts. */
export function listedEquipmentBusinessUseAtOrUnderCeiling(businessUsePercent: number): boolean {
  return roundCents(businessUsePercent) <= LISTED_EQUIPMENT_BUSINESS_USE_CEILING;
}

export function normalizeListedEquipmentAnswer(value: unknown): ListedEquipmentAnswer | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null;
  if (value === 'yes' || value === 'no') return value;
  return 'invalid';
}

/**
 * Equipment at 50% or less business use:
 * yes → review (no Section 179, bonus, or accelerated MACRS; ADS is not calculated);
 * blank → ask the question and withhold those figures;
 * no, or business use over 50%, or any non-equipment category → no hold.
 */
export function listedEquipmentHoldFor(asset: Pick<Asset, 'category' | 'businessUsePercent' | 'listedEquipmentAnswer'>): ListedEquipmentHold | null {
  if (!isEquipmentAssetCategory(asset.category)) return null;
  if (!listedEquipmentBusinessUseAtOrUnderCeiling(asset.businessUsePercent)) return null;
  if (asset.listedEquipmentAnswer === 'yes') return 'review';
  if (asset.listedEquipmentAnswer === 'no') return null;
  return 'question_required';
}

const assetDate = (value: unknown): Date => {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate();
  return new Date(value as string | number | Date);
};
const businessBasis = (asset: Asset) => businessUseBasis(asset.cost, asset.businessUsePercent);

const withheldAssetCalculation = (asset: Asset, hold: ListedEquipmentHold): AssetCalculation => ({
  asset, treatment: 'listed_property_review', listedEquipmentHold: hold, deMinimisExpense: 0, section179Elected: 0,
  section179Deduction: 0, bonusDepreciation: 0, regularDepreciation: 0, totalDepreciation: 0, remainingBasis: 0, carryoverToNextYear: 0,
});

/**
 * Supported subset, in Publication 946 order (§179 first, then MACRS):
 * - De minimis safe harbor: items at or under $2,500 in a year the taxpayer elected
 *   Reg. §1.263(a)-1(f) are current expenses, never MACRS property.
 * - §179: first-year, nonlisted 5/7-year property with more than 50% qualified business
 *   use (Reg. §1.179-1(d)) placed in service in 2025 or 2026, limited to the published
 *   §179(b)(1)/(b)(2) dollar limit and to business taxable income under §179(b)(3)(A);
 *   the disallowed amount carries forward (§179(b)(3)(B)) and still reduces basis
 *   (Reg. §1.179-1(f)(1), §1.179-3).
 * - Remaining basis: half-year MACRS from Publication 946 Tables A-1/A-2.
 * Bonus depreciation (acquisition-date and binding-contract tests, class elections),
 * vehicles (§280F caps, substantiation), prior-year basis, straight-line
 * and mid-quarter cases require facts the existing asset form does not collect.
 * Equipment answered yes as photo, video, audio, communication, or recreation equipment,
 * and equipment left blank, at 50% or less business use is withheld for review under
 * IRC 280F(b) and 280F(d)(4). This helper does not calculate ADS straight line for that property.
 * https://www.irs.gov/publications/p946 · https://www.irs.gov/instructions/i4562
 */
export function calc4562(assets: Asset[], businessIncome: number, taxYear: number, elections?: DepreciationElections | null): Form4562Calculation {
  if (!SUPPORTED_TAX_YEARS.includes(taxYear as typeof SUPPORTED_TAX_YEARS[number])) throw new DepreciationReviewRequiredError('Select a supported tax year (2024–2026).');
  if (!Number.isFinite(businessIncome)) throw new DepreciationReviewRequiredError('Business income must be a finite amount.');
  const errors = validateAssets(assets);
  if (errors.length) throw new DepreciationReviewRequiredError(errors.join(' '));
  const electedYears = elections?.deMinimisSafeHarborYears ?? [];
  // An item expensed under the safe harbor in its own (elected) year never became depreciable
  // property, so it has no basis to carry into this year; it is neither an expense nor
  // depreciation now. Vehicles and "other" stay behind the listed-property gate below.
  const expensedInEarlierYear = (asset: Asset) => {
    const year = assetDate(asset.datePlacedInService).getUTCFullYear();
    return year < taxYear && asset.cost <= DE_MINIMIS_SAFE_HARBOR_LIMIT && electedYears.includes(year) && asset.category !== 'vehicle' && asset.category !== 'other';
  };
  const current = assets.filter(asset => assetDate(asset.datePlacedInService).getUTCFullYear() <= taxYear && !expensedInEarlierYear(asset));
  const notes: string[] = [];
  const earlierDeMinimis = assets.filter(expensedInEarlierYear).length;
  if (earlierDeMinimis) notes.push(`${earlierDeMinimis} item(s) at or under $${DE_MINIMIS_SAFE_HARBOR_LIMIT.toLocaleString('en-US')} were expensed under the de minimis safe harbor in an earlier elected year and have no basis to depreciate in ${taxYear}.`);
  for (const asset of current) {
    const year = assetDate(asset.datePlacedInService).getUTCFullYear();
    if (year < taxYear) throw new DepreciationReviewRequiredError('Prior-year assets require their depreciation history and adjusted basis.');
    if (asset.category === 'vehicle' || asset.category === 'other') throw new DepreciationReviewRequiredError('Confirm the asset class, vehicle limits and listed-property rules.');
    // Held equipment is not given Section 179, bonus, or accelerated MACRS. Do not block the rest of the worksheet.
    if (listedEquipmentHoldFor(asset)) continue;
    if (asset.bonusEligible) throw new DepreciationReviewRequiredError('Bonus depreciation needs the acquisition date (binding-contract test for the January 19, 2025 boundary), purchase eligibility and any class election out. Automatic bonus deductions are unavailable until these are confirmed.');
    if (asset.method === 'SL') throw new DepreciationReviewRequiredError('Straight-line depreciation needs a recovery period and convention.');
  }
  const deMinimisElected = electedYears.includes(taxYear);
  const calculable = current.filter(asset => !listedEquipmentHoldFor(asset));

  const deMinimis = calculable.filter(asset => deMinimisElected && asset.cost <= DE_MINIMIS_SAFE_HARBOR_LIMIT);
  const depreciable = calculable.filter(asset => !deMinimis.includes(asset));
  const electing = depreciable.filter(asset => asset.section179Requested);
  for (const asset of electing) {
    if (!SECTION_179_CALCULATION_YEARS.includes(taxYear)) throw new DepreciationReviewRequiredError('Section 179 is calculated for property placed in service in 2025 or 2026 using the published limits. Elections for other years need a reviewed return.');
    if (asset.businessUsePercent <= 50) throw new DepreciationReviewRequiredError('Section 179 requires more than 50% qualified business use in the year the property is placed in service (Reg. §1.179-1(d)); otherwise the election is unavailable.');
  }

  let section179: Section179Summary | null = null;
  const elected = new Map<Asset, number>();
  const allowed = new Map<Asset, number>();
  if (electing.length) {
    const limits = getSection179Limits(taxYear);
    const costOfSection179Property = depreciable.reduce((sum, asset) => sum + asset.cost, 0);
    const dollarLimitAfterPhaseout = Math.max(0, limits.limit - Math.max(0, costOfSection179Property - limits.phaseoutThreshold));
    const requested = electing.reduce((sum, asset) => sum + businessBasis(asset), 0);
    const electedTotal = Math.min(requested, dollarLimitAfterPhaseout);
    const businessIncomeLimit = Math.max(0, businessIncome);
    const allowedTotal = Math.min(electedTotal, businessIncomeLimit);
    // Pro-rata allocation across elected assets; Reg. §1.179-3(b) lets the taxpayer
    // pick which properties carry the disallowed amount, so this split is a planning default.
    let electedRemaining = roundCents(electedTotal), allowedRemaining = roundCents(allowedTotal);
    electing.forEach((asset, index) => {
      const last = index === electing.length - 1;
      const share = requested > 0 ? businessBasis(asset) / requested : 0;
      const assetElected = last ? electedRemaining : roundCents(electedTotal * share);
      const assetAllowed = last ? allowedRemaining : roundCents(allowedTotal * share);
      electedRemaining = roundCents(electedRemaining - assetElected);
      allowedRemaining = roundCents(allowedRemaining - assetAllowed);
      elected.set(asset, assetElected);
      allowed.set(asset, assetAllowed);
    });
    section179 = {
      electionYear: taxYear, limit: limits.limit, phaseoutThreshold: limits.phaseoutThreshold, costOfSection179Property,
      dollarLimitAfterPhaseout, businessIncomeLimit, elected: roundCents(electedTotal), allowed: roundCents(allowedTotal),
      carryover: roundCents(electedTotal - allowedTotal), source: limits.source,
    };
    notes.push(`Section 179 election year ${taxYear}: the deduction is limited to business taxable income under §179(b)(3)(A); any carryover is reported on Form 4562 line 13 and reduces basis now (Reg. §1.179-1(f)). Recapture applies if business use falls to 50% or less (§179(d)(10)).`);
    if (requested > dollarLimitAfterPhaseout) notes.push(`Requested §179 amounts exceed the ${taxYear} dollar limit after the §179(b)(2) phaseout (${limits.source}); the excess stays in MACRS.`);
  }
  if (deMinimis.length) {
    notes.push(`De minimis safe harbor items are ordinary current-year expenses, not depreciation, because you elected Reg. §1.263(a)-1(f) for ${taxYear}. Attach the election statement to a timely filed return, keep invoices showing each item cost $${DE_MINIMIS_SAFE_HARBOR_LIMIT.toLocaleString('en-US')} or less, and do not also deduct the purchase transaction.`);
  }

  // Pub 946 ch. 4: the 40% test uses depreciable basis after the §179 reduction and personal use.
  const macrsBasis = (asset: Asset) => businessBasis(asset) - (elected.get(asset) ?? 0);
  const totalBasis = depreciable.reduce((sum, asset) => sum + macrsBasis(asset), 0);
  const lastQuarterBasis = depreciable.filter(asset => assetDate(asset.datePlacedInService).getUTCMonth() >= 9)
    .reduce((sum, asset) => sum + macrsBasis(asset), 0);
  if (totalBasis > 0 && lastQuarterBasis / totalBasis > 0.4) throw new DepreciationReviewRequiredError('More than 40% of this year’s basis was placed in service in the last quarter; the mid-quarter convention requires a separate calculation.');

  for (const asset of current) {
    const hold = listedEquipmentHoldFor(asset);
    if (hold === 'review') notes.push(`${asset.description}: ${LISTED_EQUIPMENT_REVIEW_NOTE_PLACEHOLDER}`);
    if (hold === 'question_required') notes.push(`${asset.description}: ${LISTED_EQUIPMENT_QUESTION_PLACEHOLDER}`);
  }

  const calculations: AssetCalculation[] = current.map(asset => {
    const hold = listedEquipmentHoldFor(asset);
    if (hold) return withheldAssetCalculation(asset, hold);
    const basis = businessBasis(asset);
    if (deMinimis.includes(asset)) {
      const expense = roundCents(basis);
      return { asset, treatment: 'de_minimis_expense', listedEquipmentHold: null, deMinimisExpense: expense, section179Elected: 0, section179Deduction: 0,
        bonusDepreciation: 0, regularDepreciation: 0, totalDepreciation: 0, remainingBasis: 0, carryoverToNextYear: 0 };
    }
    const section179Elected = elected.get(asset) ?? 0;
    const section179Deduction = allowed.get(asset) ?? 0;
    const regularDepreciation = acceleratedMacrsDeduction(basis - section179Elected, asset.method);
    return { asset, treatment: section179Elected > 0 ? 'section_179' : 'macrs', listedEquipmentHold: null, deMinimisExpense: 0, section179Elected, section179Deduction,
      bonusDepreciation: 0, regularDepreciation, totalDepreciation: roundCents(section179Deduction + regularDepreciation),
      remainingBasis: roundCents(basis - section179Elected - regularDepreciation), carryoverToNextYear: roundCents(section179Elected - section179Deduction) };
  });
  const sum = (select: (row: AssetCalculation) => number) => roundCents(calculations.reduce((total, row) => total + select(row), 0));
  const totalSection179 = sum(row => row.section179Deduction);
  const totalRegularDepreciation = sum(row => row.regularDepreciation);
  const heldAssets: ListedEquipmentHeldAsset[] = [];
  for (const row of calculations) {
    if (row.listedEquipmentHold === 'review') heldAssets.push({ id: row.asset.id, reason: 'review' });
    else if (row.listedEquipmentHold === 'question_required') heldAssets.push({ id: row.asset.id, reason: 'question' });
  }
  return {
    taxYear, assets: calculations, totalDeMinimisExpense: sum(row => row.deMinimisExpense), section179, totalSection179,
    totalBonusDepreciation: 0, totalRegularDepreciation, totalDepreciation: roundCents(totalSection179 + totalRegularDepreciation),
    totalCarryover: sum(row => row.carryoverToNextYear), heldAssets, notes,
  };
}

export function validateAssets(assets: Asset[]): string[] {
  const errors: string[] = [];
  if (!Array.isArray(assets)) return ['Assets must be a list.'];
  for (const [index, asset] of assets.entries()) {
    const label = `Asset ${index + 1}:`;
    if (!asset || typeof asset.description !== 'string' || !asset.description.trim()) errors.push(`${label} Description is required.`);
    if (!Number.isFinite(asset?.cost) || asset.cost <= 0) errors.push(`${label} Cost must be greater than zero.`);
    if (!Number.isFinite(asset?.businessUsePercent) || asset.businessUsePercent < 0 || asset.businessUsePercent > 100) errors.push(`${label} Business use must be between 0 and 100.`);
    if (!asset?.datePlacedInService || !Number.isFinite(assetDate(asset.datePlacedInService).getTime())) errors.push(`${label} A valid placed-in-service date is required.`);
    if (!ASSET_CATEGORIES.includes(asset?.category)) errors.push(`${label} Invalid category.`);
    if (!['MACRS_5YR', 'MACRS_7YR', 'SL'].includes(asset?.method)) errors.push(`${label} Invalid depreciation method.`);
  }
  return errors;
}
