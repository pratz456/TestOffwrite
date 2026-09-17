import { getSection179Limits, SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';

export interface Asset {
  id: string;
  description: string;
  datePlacedInService: Date;
  cost: number;
  businessUsePercent: number; // 0-100
  category: 'computer' | 'furniture' | 'vehicle' | 'equipment' | 'other';
  method: 'MACRS_5YR' | 'MACRS_7YR' | 'SL'; // Straight Line
  section179Requested: boolean;
  bonusEligible: boolean;
}

/**
 * Annual elections the asset form cannot infer. Stored in settings/depreciation.
 * The de minimis safe harbor is elected each year by a statement attached to a
 * timely filed original return (Reg. §1.263(a)-1(f)(5)); it is not an asset attribute.
 */
export interface DepreciationElections {
  deMinimisSafeHarborYears: readonly number[];
}

export type AssetTreatment = 'de_minimis_expense' | 'section_179' | 'macrs';

export interface AssetCalculation {
  asset: Asset;
  treatment: AssetTreatment;
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
  notes: string[];
}

/** The current asset form lacks the facts needed to calculate elections and prior-year basis. */
export class DepreciationReviewRequiredError extends Error {
  readonly code = 'DEPRECIATION_REVIEW_REQUIRED';
  constructor(detail: string) { super(`Asset depreciation needs review: ${detail}`); }
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

const roundCents = (value: number) => Math.round(value * 100) / 100;
const assetDate = (value: unknown): Date => {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate();
  return new Date(value as string | number | Date);
};
const businessBasis = (asset: Asset) => asset.cost * asset.businessUsePercent / 100;

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
 * vehicles/listed property (§280F caps, substantiation), prior-year basis, straight-line
 * and mid-quarter cases require facts the existing asset form does not collect.
 * https://www.irs.gov/publications/p946 · https://www.irs.gov/instructions/i4562
 */
export function calc4562(assets: Asset[], businessIncome: number, taxYear = 2026, elections?: DepreciationElections | null): Form4562Calculation {
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
    if (asset.bonusEligible) throw new DepreciationReviewRequiredError('Bonus depreciation needs the acquisition date (binding-contract test for the January 19, 2025 boundary), purchase eligibility and any class election out. Automatic bonus deductions are unavailable until these are confirmed.');
    if (asset.method === 'SL') throw new DepreciationReviewRequiredError('Straight-line depreciation needs a recovery period and convention.');
  }
  const deMinimisElected = electedYears.includes(taxYear);

  const deMinimis = current.filter(asset => deMinimisElected && asset.cost <= DE_MINIMIS_SAFE_HARBOR_LIMIT);
  const depreciable = current.filter(asset => !deMinimis.includes(asset));
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

  const calculations: AssetCalculation[] = current.map(asset => {
    const basis = businessBasis(asset);
    if (deMinimis.includes(asset)) {
      const expense = roundCents(basis);
      return { asset, treatment: 'de_minimis_expense', deMinimisExpense: expense, section179Elected: 0, section179Deduction: 0,
        bonusDepreciation: 0, regularDepreciation: 0, totalDepreciation: 0, remainingBasis: 0, carryoverToNextYear: 0 };
    }
    const section179Elected = elected.get(asset) ?? 0;
    const section179Deduction = allowed.get(asset) ?? 0;
    const regularDepreciation = roundCents((basis - section179Elected) * (asset.method === 'MACRS_5YR' ? 0.2 : 0.1429));
    return { asset, treatment: section179Elected > 0 ? 'section_179' : 'macrs', deMinimisExpense: 0, section179Elected, section179Deduction,
      bonusDepreciation: 0, regularDepreciation, totalDepreciation: roundCents(section179Deduction + regularDepreciation),
      remainingBasis: roundCents(basis - section179Elected - regularDepreciation), carryoverToNextYear: roundCents(section179Elected - section179Deduction) };
  });
  const sum = (select: (row: AssetCalculation) => number) => roundCents(calculations.reduce((total, row) => total + select(row), 0));
  const totalSection179 = sum(row => row.section179Deduction);
  const totalRegularDepreciation = sum(row => row.regularDepreciation);
  return {
    taxYear, assets: calculations, totalDeMinimisExpense: sum(row => row.deMinimisExpense), section179, totalSection179,
    totalBonusDepreciation: 0, totalRegularDepreciation, totalDepreciation: roundCents(totalSection179 + totalRegularDepreciation),
    totalCarryover: sum(row => row.carryoverToNextYear), notes,
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
    if (!['computer', 'furniture', 'vehicle', 'equipment', 'other'].includes(asset?.category)) errors.push(`${label} Invalid category.`);
    if (!['MACRS_5YR', 'MACRS_7YR', 'SL'].includes(asset?.method)) errors.push(`${label} Invalid depreciation method.`);
  }
  return errors;
}
