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

// MACRS depreciation rates (2024)
const MACRS_RATES = {
  'MACRS_5YR': {
    1: 0.20, // 20%
    2: 0.32, // 32%
    3: 0.192, // 19.2%
    4: 0.1152, // 11.52%
    5: 0.1152, // 11.52%
    6: 0.0576, // 5.76%
  },
  'MACRS_7YR': {
    1: 0.1429, // 14.29%
    2: 0.2449, // 24.49%
    3: 0.1749, // 17.49%
    4: 0.1249, // 12.49%
    5: 0.0893, // 8.93%
    6: 0.0892, // 8.92%
    7: 0.0893, // 8.93%
    8: 0.0446, // 4.46%
  }
};

// Section 179 limits (2024)
const SECTION_179_LIMIT = 1160000; // $1,160,000
const SECTION_179_THRESHOLD = 2900000; // $2,900,000

// Bonus depreciation (2024)
const BONUS_DEPRECIATION_RATE = 0.60; // 60% for 2024

/**
 * Calculate Form 4562 - Depreciation and Amortization
 * Based on IRS Form 4562 instructions
 */
export function calc4562(assets: Asset[], businessIncome: number): Form4562Calculation {
  const currentYear = new Date().getFullYear();
  const assetCalculations: AssetCalculation[] = [];

  // Sort assets by cost (highest first) for Section 179 optimization
  const sortedAssets = [...assets].sort((a, b) => b.cost - a.cost);

  let totalSection179Used = 0;
  let totalBonusDepreciation = 0;
  let totalRegularDepreciation = 0;

  for (const asset of sortedAssets) {
    const calculation = calculateAssetDepreciation(asset, currentYear, businessIncome, totalSection179Used);
    assetCalculations.push(calculation);

    totalSection179Used += calculation.section179Deduction;
    totalBonusDepreciation += calculation.bonusDepreciation;
    totalRegularDepreciation += calculation.regularDepreciation;
  }

  const totalDepreciation = totalSection179Used + totalBonusDepreciation + totalRegularDepreciation;
  const totalCarryover = assetCalculations.reduce((sum, calc) => sum + calc.carryoverToNextYear, 0);

  return {
    assets: assetCalculations,
    totalSection179: totalSection179Used,
    totalBonusDepreciation,
    totalRegularDepreciation,
    totalDepreciation,
    totalCarryover,
  };
}

/**
 * Calculate depreciation for a single asset
 */
function calculateAssetDepreciation(
  asset: Asset,
  currentYear: number,
  businessIncome: number,
  section179UsedSoFar: number
): AssetCalculation {
  const businessUseFactor = asset.businessUsePercent / 100;
  const businessBasis = asset.cost * businessUseFactor;

  // Calculate years in service
  const yearsInService = currentYear - asset.datePlacedInService.getFullYear() + 1;

  let section179Deduction = 0;
  let bonusDepreciation = 0;
  let regularDepreciation = 0;
  let remainingBasis = businessBasis;

  // Section 179 deduction (if requested and eligible)
  if (asset.section179Requested && asset.cost <= SECTION_179_LIMIT) {
    const availableSection179 = Math.min(
      SECTION_179_LIMIT - section179UsedSoFar,
      businessIncome,
      businessBasis
    );
    
    if (availableSection179 > 0) {
      section179Deduction = availableSection179;
      remainingBasis -= section179Deduction;
    }
  }

  // Bonus depreciation (if eligible and not fully used by Section 179)
  if (asset.bonusEligible && remainingBasis > 0) {
    bonusDepreciation = remainingBasis * BONUS_DEPRECIATION_RATE;
    remainingBasis -= bonusDepreciation;
  }

  // Regular depreciation (MACRS or Straight Line)
  if (remainingBasis > 0) {
    if (asset.method === 'SL') {
      // Straight Line - assume 5 year life for simplicity
      const usefulLife = 5;
      regularDepreciation = Math.min(remainingBasis, remainingBasis / usefulLife);
    } else {
      // MACRS depreciation
      const rates = MACRS_RATES[asset.method];
      if (rates && yearsInService <= Object.keys(rates).length) {
        const rate = rates[yearsInService as keyof typeof rates];
        regularDepreciation = remainingBasis * rate;
      }
    }
  }

  const totalDepreciation = section179Deduction + bonusDepreciation + regularDepreciation;
  const carryoverToNextYear = Math.max(0, businessBasis - totalDepreciation);

  return {
    asset,
    section179Deduction: Math.round(section179Deduction * 100) / 100,
    bonusDepreciation: Math.round(bonusDepreciation * 100) / 100,
    regularDepreciation: Math.round(regularDepreciation * 100) / 100,
    totalDepreciation: Math.round(totalDepreciation * 100) / 100,
    remainingBasis: Math.round(remainingBasis * 100) / 100,
    carryoverToNextYear: Math.round(carryoverToNextYear * 100) / 100,
  };
}

/**
 * Validate assets for completeness
 */
export function validateAssets(assets: Asset[]): string[] {
  const errors: string[] = [];

  if (!assets || assets.length === 0) {
    errors.push('At least one asset is required');
    return errors;
  }

  assets.forEach((asset, index) => {
    if (!asset.description || asset.description.trim() === '') {
      errors.push(`Asset ${index + 1}: Description is required`);
    }

    if (!asset.cost || asset.cost <= 0) {
      errors.push(`Asset ${index + 1}: Cost must be greater than 0`);
    }

    if (!asset.businessUsePercent || asset.businessUsePercent < 0 || asset.businessUsePercent > 100) {
      errors.push(`Asset ${index + 1}: Business use percentage must be between 0 and 100`);
    }

    if (!asset.datePlacedInService) {
      errors.push(`Asset ${index + 1}: Date placed in service is required`);
    } else {
      const currentYear = new Date().getFullYear();
      const assetYear = asset.datePlacedInService.getFullYear();
      if (assetYear > currentYear) {
        errors.push(`Asset ${index + 1}: Date placed in service cannot be in the future`);
      }
    }

    if (!['computer', 'furniture', 'vehicle', 'equipment', 'other'].includes(asset.category)) {
      errors.push(`Asset ${index + 1}: Invalid category`);
    }

    if (!['MACRS_5YR', 'MACRS_7YR', 'SL'].includes(asset.method)) {
      errors.push(`Asset ${index + 1}: Invalid depreciation method`);
    }
  });

  return errors;
}
