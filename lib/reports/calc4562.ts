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
 * Gear kind that replaces the first yes/no question on an equipment asset.
 * PLACEHOLDER wording. Cell phones and computers do not count: 26 U.S.C. 280F(d)(4)(A)
 * as amended by Pub. L. 115-97 (computers placed in service after 2017) and Pub. L. 111-240
 * (phones and similar telecommunications equipment). This is not the regulation's
 * "certain computers" wording.
 */
export const LISTED_EQUIPMENT_KIND_PHOTO = 'photo_audio_video_communication' as const;
export const LISTED_EQUIPMENT_KIND_RECREATION = 'recreation_or_amusement' as const;
export const LISTED_EQUIPMENT_KIND_NEITHER = 'neither' as const;
export const LISTED_EQUIPMENT_KINDS = [LISTED_EQUIPMENT_KIND_PHOTO, LISTED_EQUIPMENT_KIND_RECREATION, LISTED_EQUIPMENT_KIND_NEITHER] as const;
export type ListedEquipmentKind = (typeof LISTED_EQUIPMENT_KINDS)[number];

export const LISTED_EQUIPMENT_KIND_PHOTO_PLACEHOLDER = 'PLACEHOLDER: photo, audio, video or communication gear';
export const LISTED_EQUIPMENT_KIND_RECREATION_PLACEHOLDER = 'PLACEHOLDER: recreation or amusement gear';
export const LISTED_EQUIPMENT_KIND_NEITHER_PLACEHOLDER = 'PLACEHOLDER: neither';
export const LISTED_EQUIPMENT_KIND_NOTE_PLACEHOLDER = 'PLACEHOLDER: Cell phones and computers do not count.';
/** Kept so earlier screens and notes still have a question constant. The kind choice replaces the yes/no question. */
export const LISTED_EQUIPMENT_QUESTION_PLACEHOLDER = LISTED_EQUIPMENT_KIND_NOTE_PLACEHOLDER;

/**
 * Shown when an equipment asset at 50% or less business use has no gear kind yet,
 * including a saved yes answer from before the kind was stored. PLACEHOLDER wording.
 * `{asset name}` is replaced with the saved description. This does not say a deduction was removed.
 */
export const LISTED_EQUIPMENT_KIND_NEEDED_PLACEHOLDER =
  'PLACEHOLDER: We need one answer about {asset name} before we can show your estimate. What kind of equipment is it?';

/** Blank release answers on photo, audio, video, or communication gear. PLACEHOLDER wording. */
export const LISTED_EQUIPMENT_MAIN_LINE_NEEDED_PLACEHOLDER =
  'PLACEHOLDER: We need one more answer about {asset name}. Do you use it in your main line of work?';

/** Business location is yes and the outside-home follow-up is still blank. PLACEHOLDER wording. */
export const LISTED_EQUIPMENT_FOLLOW_UP_NEEDED_PLACEHOLDER =
  'PLACEHOLDER: We need one more answer about {asset name}. Is that a studio or office outside your home?';

/** Main line is no and the business-location answer is still blank. PLACEHOLDER wording. */
export const LISTED_EQUIPMENT_LOCATION_NEEDED_PLACEHOLDER =
  'PLACEHOLDER: We need one more answer about {asset name}. Do you use it only at your business location?';

function listedEquipmentNamedCopy(template: string, assetName: string): string {
  const name = assetName.trim() || 'this asset';
  return template.replace('{asset name}', name);
}

export function listedEquipmentKindNeededCopy(assetName: string): string {
  return listedEquipmentNamedCopy(LISTED_EQUIPMENT_KIND_NEEDED_PLACEHOLDER, assetName);
}

export function listedEquipmentMainLineNeededCopy(assetName: string): string {
  return listedEquipmentNamedCopy(LISTED_EQUIPMENT_MAIN_LINE_NEEDED_PLACEHOLDER, assetName);
}

export function listedEquipmentFollowUpNeededCopy(assetName: string): string {
  return listedEquipmentNamedCopy(LISTED_EQUIPMENT_FOLLOW_UP_NEEDED_PLACEHOLDER, assetName);
}

export function listedEquipmentLocationNeededCopy(assetName: string): string {
  return listedEquipmentNamedCopy(LISTED_EQUIPMENT_LOCATION_NEEDED_PLACEHOLDER, assetName);
}

/**
 * Release questions, shown only for photo, audio, video, or communication gear.
 * PLACEHOLDER wording. Reg. §1.280F-6(b)(3) does not exclude recreation equipment.
 */
export const LISTED_EQUIPMENT_MAIN_LINE_PLACEHOLDER = 'PLACEHOLDER: Used in my main line of work';
export const LISTED_EQUIPMENT_BUSINESS_LOCATION_PLACEHOLDER = 'PLACEHOLDER: Used only at my business location';
export const LISTED_EQUIPMENT_LOCATION_FOLLOW_UP_PLACEHOLDER =
  'PLACEHOLDER: Is that a studio or office outside your home, or a home office you use regularly and only for business?';
export const LISTED_EQUIPMENT_LOCATION_OUTSIDE = 'outside_home' as const;
export const LISTED_EQUIPMENT_LOCATION_HOME = 'home_office' as const;
export const LISTED_EQUIPMENT_LOCATIONS = [LISTED_EQUIPMENT_LOCATION_OUTSIDE, LISTED_EQUIPMENT_LOCATION_HOME] as const;
export type ListedEquipmentLocation = (typeof LISTED_EQUIPMENT_LOCATIONS)[number];
export const LISTED_EQUIPMENT_LOCATION_OUTSIDE_PLACEHOLDER = 'PLACEHOLDER: Outside the home';
export const LISTED_EQUIPMENT_LOCATION_HOME_PLACEHOLDER = 'PLACEHOLDER: A home office';
/** Earlier single release question. A stored yes or no on this field does not release a hold. */
export const LISTED_EQUIPMENT_RELEASE_QUESTION_PLACEHOLDER = LISTED_EQUIPMENT_MAIN_LINE_PLACEHOLDER;

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

/** Which unanswered question a held asset is showing. Kind questions omit `ask`. */
export type ListedEquipmentAsk = 'kind' | 'main_line' | 'follow_up' | 'location';

/** An asset the worksheet held instead of calculating. `question` withholds the estimate until the named answer is saved. */
export interface ListedEquipmentHeldAsset {
  id: string;
  name: string;
  reason: 'review' | 'question';
  /** Set for a release question. A blank gear kind leaves this off and uses the kind question. */
  ask?: Exclude<ListedEquipmentAsk, 'kind'>;
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
   * Earlier yes/no equipment question. A saved yes with no gear kind reads as a blank kind.
   * A saved no with no gear kind reads as neither. Ignored once a gear kind is stored.
   */
  listedEquipmentAnswer?: ListedEquipmentAnswer | null;
  /**
   * Earlier single release answer. It does not release a hold. The two answers below do.
   */
  listedEquipmentReleaseAnswer?: ListedEquipmentAnswer | null;
  /**
   * Equipment only. Photo, audio, video, or communication gear can be released.
   * Recreation or amusement gear at 50% or less stays held. Neither is not held.
   * Blank, including a legacy yes with no kind, asks again.
   */
  listedEquipmentKind?: ListedEquipmentKind | null;
  /** Yes releases photo, audio, video, or communication gear wherever it is kept. Blank asks. No asks the business location when that answer is blank. */
  listedEquipmentMainLineOfWork?: ListedEquipmentAnswer | null;
  /** Yes can release that gear only when the location follow-up says the office is outside the home. */
  listedEquipmentBusinessLocation?: ListedEquipmentAnswer | null;
  /**
   * Follow-up for a yes business-location answer.
   * Home office settings do not store a confirmed qualifying home office for a tax year,
   * so `home_office` does not release.
   */
  listedEquipmentLocationFollowUp?: ListedEquipmentLocation | null;
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

export function normalizeListedEquipmentKind(value: unknown): ListedEquipmentKind | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null;
  if ((LISTED_EQUIPMENT_KINDS as readonly string[]).includes(String(value))) return value as ListedEquipmentKind;
  return 'invalid';
}

export function normalizeListedEquipmentLocation(value: unknown): ListedEquipmentLocation | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null;
  if ((LISTED_EQUIPMENT_LOCATIONS as readonly string[]).includes(String(value))) return value as ListedEquipmentLocation;
  return 'invalid';
}

/**
 * Stored gear kind, or the legacy yes/no question when no kind was saved.
 * A saved yes with no kind stays blank so the question is asked again and the asset is never released.
 * A saved no with no kind reads as neither.
 */
export function listedEquipmentKindFor(asset: Pick<Asset, 'listedEquipmentKind' | 'listedEquipmentAnswer'>): ListedEquipmentKind | null {
  const kind = normalizeListedEquipmentKind(asset.listedEquipmentKind);
  if (kind && kind !== 'invalid') return kind;
  if (asset.listedEquipmentAnswer === 'no') return LISTED_EQUIPMENT_KIND_NEITHER;
  return null;
}

/**
 * The sentence shown instead of a profit figure while an answer is still missing.
 * Recreation, a home-office follow-up, and a no on both release answers keep the generic review sentence.
 */
export function listedEquipmentReviewDetail(heldAssets: readonly ListedEquipmentHeldAsset[]): string {
  const asking = heldAssets.find(asset => asset.reason === 'question');
  if (!asking) return LISTED_EQUIPMENT_PROFIT_REVIEW_PLACEHOLDER;
  if (asking.ask === 'main_line') return listedEquipmentMainLineNeededCopy(asking.name);
  if (asking.ask === 'follow_up') return listedEquipmentFollowUpNeededCopy(asking.name);
  if (asking.ask === 'location') return listedEquipmentLocationNeededCopy(asking.name);
  return listedEquipmentKindNeededCopy(asking.name);
}

/** Attach the held asset id and name when a depreciation review error carries them. */
export function depreciationReviewBody(error: unknown, fallback: string, code: string): { error: string; code: string; heldAssets?: ListedEquipmentHeldAsset[] } {
  const message = error instanceof Error && error.message.trim() ? error.message : fallback;
  const heldAssets = error && typeof error === 'object' && 'heldAssets' in error && Array.isArray((error as { heldAssets?: unknown }).heldAssets)
    ? (error as { heldAssets: ListedEquipmentHeldAsset[] }).heldAssets : undefined;
  return heldAssets ? { error: message, code, heldAssets } : { error: message, code };
}

/**
 * Equipment at 50% or less business use:
 * neither, including a legacy no with no kind → no hold;
 * photo, audio, video, or communication gear releases when it is used in the main line of work,
 * or only at a business location that the follow-up places outside the home (Reg. §1.280F-6(b)(3));
 * a home-office follow-up does not release, because home office settings do not store a confirmed
 * qualifying home office for a tax year, and stays on the generic review;
 * a yes business location with a blank follow-up asks that follow-up;
 * blank release answers on that named kind ask the main-line question;
 * a no on the main line with a blank business location asks that location question;
 * a no on both answers stays on the generic review;
 * recreation or amusement gear stays on the generic review and cannot be released;
 * a blank kind, including a legacy yes with no kind, asks again;
 * business use over 50%, or any non-equipment category → no hold.
 * A stored answer on the earlier single release question does not release anything.
 */
type ListedEquipmentHoldInput = Pick<Asset, 'category' | 'businessUsePercent' | 'listedEquipmentAnswer' | 'listedEquipmentKind' | 'listedEquipmentMainLineOfWork' | 'listedEquipmentBusinessLocation' | 'listedEquipmentLocationFollowUp'>;

export function listedEquipmentHoldFor(asset: ListedEquipmentHoldInput): ListedEquipmentHold | null {
  if (!isEquipmentAssetCategory(asset.category)) return null;
  if (!listedEquipmentBusinessUseAtOrUnderCeiling(asset.businessUsePercent)) return null;
  const kind = listedEquipmentKindFor(asset);
  if (kind === LISTED_EQUIPMENT_KIND_NEITHER) return null;
  if (kind === LISTED_EQUIPMENT_KIND_PHOTO) {
    if (asset.listedEquipmentMainLineOfWork === 'yes') return null;
    if (asset.listedEquipmentBusinessLocation === 'yes' && asset.listedEquipmentLocationFollowUp === LISTED_EQUIPMENT_LOCATION_OUTSIDE) return null;
    if (asset.listedEquipmentBusinessLocation === 'yes' && asset.listedEquipmentLocationFollowUp === LISTED_EQUIPMENT_LOCATION_HOME) return 'review';
    if (asset.listedEquipmentBusinessLocation === 'yes') return 'question_required';
    if (asset.listedEquipmentMainLineOfWork !== 'no') return 'question_required';
    if (asset.listedEquipmentBusinessLocation !== 'no') return 'question_required';
    return 'review';
  }
  if (kind === LISTED_EQUIPMENT_KIND_RECREATION) return 'review';
  return 'question_required';
}

/** Which question to show for a held asset. Review holds and released assets return null. */
export function listedEquipmentAskFor(asset: ListedEquipmentHoldInput): ListedEquipmentAsk | null {
  if (listedEquipmentHoldFor(asset) !== 'question_required') return null;
  const kind = listedEquipmentKindFor(asset);
  if (kind === LISTED_EQUIPMENT_KIND_PHOTO && asset.listedEquipmentBusinessLocation === 'yes') return 'follow_up';
  if (kind === LISTED_EQUIPMENT_KIND_PHOTO && asset.listedEquipmentMainLineOfWork !== 'no') return 'main_line';
  if (kind === LISTED_EQUIPMENT_KIND_PHOTO) return 'location';
  return 'kind';
}

/** The sentence for the question this asset is waiting on. Review holds use the generic review sentence instead. */
export function listedEquipmentQuestionCopy(asset: ListedEquipmentHoldInput & Pick<Asset, 'description'>): string {
  const ask = listedEquipmentAskFor(asset);
  if (ask === 'main_line') return listedEquipmentMainLineNeededCopy(asset.description);
  if (ask === 'follow_up') return listedEquipmentFollowUpNeededCopy(asset.description);
  if (ask === 'location') return listedEquipmentLocationNeededCopy(asset.description);
  return listedEquipmentKindNeededCopy(asset.description);
}

/** Held asset record for a review error. The id is the Answer now link. A question also carries the named ask. */
function listedEquipmentHeldRecord(asset: Pick<Asset, 'id' | 'description'> & ListedEquipmentHoldInput): ListedEquipmentHeldAsset | null {
  const hold = listedEquipmentHoldFor(asset);
  if (hold === 'review') return { id: asset.id, name: asset.description, reason: 'review' };
  if (hold !== 'question_required') return null;
  const ask = listedEquipmentAskFor(asset);
  return ask === 'main_line' || ask === 'follow_up' || ask === 'location'
    ? { id: asset.id, name: asset.description, reason: 'question', ask }
    : { id: asset.id, name: asset.description, reason: 'question' };
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
 * Equipment at 50% or less business use is withheld under IRC 280F(b) and 280F(d)(4)
 * until its gear kind is known. Photo, audio, video, or communication gear is released
 * when it is used in the main line of work, or only at a business location outside the
 * home (Reg. §1.280F-6(b)(3)). Recreation or amusement gear is not released.
 * Cell phones and computers are not listed property under 26 U.S.C. 280F(d)(4)(A) as
 * amended by Pub. L. 115-97 and Pub. L. 111-240. A blank kind asks again and does not
 * remove a deduction figure. This helper does not calculate ADS straight line for held property.
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
  // Full cost, before the listed-equipment hold. A selected item is expensed at its business share and is not held.
  const deMinimisElected = electedYears.includes(taxYear);
  const deMinimis = current.filter(asset => deMinimisElected && asset.cost <= DE_MINIMIS_SAFE_HARBOR_LIMIT);
  const holdFor = (asset: Asset): ListedEquipmentHold | null => deMinimis.includes(asset) ? null : listedEquipmentHoldFor(asset);
  for (const asset of current) {
    const year = assetDate(asset.datePlacedInService).getUTCFullYear();
    if (year < taxYear) throw new DepreciationReviewRequiredError('Prior-year assets require their depreciation history and adjusted basis.');
    if (asset.category === 'vehicle' || asset.category === 'other') throw new DepreciationReviewRequiredError('Confirm the asset class, vehicle limits and listed-property rules.');
    // Held equipment is not given Section 179, bonus, or accelerated MACRS. Do not block the rest of the worksheet.
    if (holdFor(asset)) continue;
    if (asset.bonusEligible) throw new DepreciationReviewRequiredError('Bonus depreciation needs the acquisition date (binding-contract test for the January 19, 2025 boundary), purchase eligibility and any class election out. Automatic bonus deductions are unavailable until these are confirmed.');
    if (asset.method === 'SL') throw new DepreciationReviewRequiredError('Straight-line depreciation needs a recovery period and convention.');
  }
  const calculable = current.filter(asset => !holdFor(asset));
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
    // 2025 Form 4562 line 2 includes listed property from Part V. §179(b)(2) and (d)(1)
    // phase out on the full cost of section 179 property. A held asset is in this total
    // and still receives no section 179 amount. De minimis items are not section 179 property.
    const costOfSection179Property = current.filter(asset => !deMinimis.includes(asset)).reduce((sum, asset) => sum + asset.cost, 0);
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

  // 2025 Form 4562 instructions and Reg. §1.168(d)-1(b)(2): the 40% test covers MACRS
  // property placed in service during the year, and ADS property counts. Listed property
  // at 50% or less business use is ADS property, so a held asset counts.
  // Reg. §1.168(d)-1(b)(4): basis is depreciable basis after the section 179 expense and before bonus.
  // Section 179 elected for a held asset is zero. De minimis safe-harbor items are not
  // MACRS property. Real property and same-year dispositions are not in this population.
  const midQuarterProperty = current.filter(asset => !deMinimis.includes(asset));
  const depreciableBasisAfterSection179 = (asset: Asset) => businessBasis(asset) - (elected.get(asset) ?? 0);
  const totalBasis = midQuarterProperty.reduce((sum, asset) => sum + depreciableBasisAfterSection179(asset), 0);
  const lastQuarterBasis = midQuarterProperty.filter(asset => assetDate(asset.datePlacedInService).getUTCMonth() >= 9)
    .reduce((sum, asset) => sum + depreciableBasisAfterSection179(asset), 0);
  // Only held assets means nothing is calculated under the half-year convention.
  // A single held asset in the last quarter therefore stays a withheld result.
  const calculatesHalfYear = midQuarterProperty.some(asset => !listedEquipmentHoldFor(asset));
  const heldAssets: ListedEquipmentHeldAsset[] = [];
  for (const asset of current) {
    if (deMinimis.includes(asset)) continue;
    const held = listedEquipmentHeldRecord(asset);
    if (held) heldAssets.push(held);
  }
  if (calculatesHalfYear && totalBasis > 0 && lastQuarterBasis / totalBasis > 0.4) throw new DepreciationReviewRequiredError('More than 40% of this year’s basis was placed in service in the last quarter; the mid-quarter convention requires a separate calculation.', heldAssets);

  for (const asset of current) {
    const hold = holdFor(asset);
    if (hold === 'review') notes.push(`${asset.description}: ${LISTED_EQUIPMENT_REVIEW_NOTE_PLACEHOLDER}`);
    if (hold === 'question_required') notes.push(listedEquipmentQuestionCopy(asset));
  }

  const calculations: AssetCalculation[] = current.map(asset => {
    const hold = holdFor(asset);
    if (hold) return withheldAssetCalculation(asset, hold);
    const basis = businessBasis(asset);
    if (deMinimis.includes(asset)) {
      const expense = roundCents(basis);
      return { asset, treatment: 'de_minimis_expense', listedEquipmentHold: null, deMinimisExpense: expense, section179Elected: 0, section179Deduction: 0,
        bonusDepreciation: 0, regularDepreciation: 0, totalDepreciation: 0, remainingBasis: 0, carryoverToNextYear: 0 };
    }
    const section179Elected = elected.get(asset) ?? 0;
    const section179Deduction = allowed.get(asset) ?? 0;
    const regularDepreciation = acceleratedMacrsDeduction(depreciableBasisAfterSection179(asset), asset.method);
    return { asset, treatment: section179Elected > 0 ? 'section_179' : 'macrs', listedEquipmentHold: null, deMinimisExpense: 0, section179Elected, section179Deduction,
      bonusDepreciation: 0, regularDepreciation, totalDepreciation: roundCents(section179Deduction + regularDepreciation),
      remainingBasis: roundCents(basis - section179Elected - regularDepreciation), carryoverToNextYear: roundCents(section179Elected - section179Deduction) };
  });
  const sum = (select: (row: AssetCalculation) => number) => roundCents(calculations.reduce((total, row) => total + select(row), 0));
  const totalSection179 = sum(row => row.section179Deduction);
  const totalRegularDepreciation = sum(row => row.regularDepreciation);
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
