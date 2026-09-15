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

export interface AssetCalculation {
  asset: Asset;
  section179Deduction: number;
  bonusDepreciation: number;
  regularDepreciation: number;
  totalDepreciation: number;
  remainingBasis: number;
  carryoverToNextYear: number;
}

export interface Form4562Calculation {
  assets: AssetCalculation[];
  totalSection179: number;
  totalBonusDepreciation: number;
  totalRegularDepreciation: number;
  totalDepreciation: number;
  totalCarryover: number;
}

/** The current asset form lacks the facts needed to calculate elections and prior-year basis. */
export class DepreciationReviewRequiredError extends Error {
  readonly code = 'DEPRECIATION_REVIEW_REQUIRED';
  constructor(detail: string) { super(`Asset depreciation needs review: ${detail}`); }
}

const roundCents = (value: number) => Math.round(value * 100) / 100;
const assetDate = (value: unknown): Date => {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate();
  return new Date(value as string | number | Date);
};

/**
 * First-year, nonlisted 5/7-year MACRS property using the half-year convention.
 * Publication 946 tables A-1/A-2. Elections, vehicles, prior-year basis and
 * mid-quarter cases require information that the existing asset form does not collect.
 * https://www.irs.gov/publications/p946
 */
export function calc4562(assets: Asset[], businessIncome: number, taxYear = 2026): Form4562Calculation {
  if (![2024, 2025, 2026].includes(taxYear)) throw new DepreciationReviewRequiredError('Select a supported tax year (2024–2026).');
  if (!Number.isFinite(businessIncome)) throw new DepreciationReviewRequiredError('Business income must be a finite amount.');
  const errors = validateAssets(assets);
  if (errors.length) throw new DepreciationReviewRequiredError(errors.join(' '));
  const current = assets.filter(asset => assetDate(asset.datePlacedInService).getUTCFullYear() <= taxYear);
  for (const asset of current) {
    const year = assetDate(asset.datePlacedInService).getUTCFullYear();
    if (year < taxYear) throw new DepreciationReviewRequiredError('Prior-year assets require their depreciation history and adjusted basis.');
    if (asset.category === 'vehicle' || asset.category === 'other') throw new DepreciationReviewRequiredError('Confirm the asset class, vehicle limits and listed-property rules.');
    if (asset.section179Requested || asset.bonusEligible) throw new DepreciationReviewRequiredError('Section 179 and bonus depreciation need acquisition dates, purchase eligibility, elections and applicable limits. Automatic deductions are unavailable until these are confirmed.');
    if (asset.method === 'SL') throw new DepreciationReviewRequiredError('Straight-line depreciation needs a recovery period and convention.');
  }
  const totalBasis = current.reduce((sum, asset) => sum + asset.cost * asset.businessUsePercent / 100, 0);
  const lastQuarterBasis = current.filter(asset => assetDate(asset.datePlacedInService).getUTCMonth() >= 9)
    .reduce((sum, asset) => sum + asset.cost * asset.businessUsePercent / 100, 0);
  if (totalBasis > 0 && lastQuarterBasis / totalBasis > 0.4) throw new DepreciationReviewRequiredError('More than 40% of this year’s basis was placed in service in the last quarter; the mid-quarter convention requires a separate calculation.');
  const calculations = current.map(asset => {
    const basis = asset.cost * asset.businessUsePercent / 100;
    const regularDepreciation = roundCents(basis * (asset.method === 'MACRS_5YR' ? 0.2 : 0.1429));
    return { asset, section179Deduction: 0, bonusDepreciation: 0, regularDepreciation,
      totalDepreciation: regularDepreciation, remainingBasis: roundCents(basis - regularDepreciation), carryoverToNextYear: 0 };
  });
  const total = roundCents(calculations.reduce((sum, row) => sum + row.regularDepreciation, 0));
  return { assets: calculations, totalSection179: 0, totalBonusDepreciation: 0, totalRegularDepreciation: total,
    totalDepreciation: total, totalCarryover: 0 };
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
