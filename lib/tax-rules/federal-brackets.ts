/**
 * Federal tax brackets and calculation utilities
 * Based on 2025 tax year brackets (IRS Rev. Proc. 2024-40, updated by OBBB P.L. 119-21)
 * Source: https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2025
 */

export interface TaxBracket {
  min: number;
  max: number;
  rate: number;
}

export interface TaxBrackets {
  single: TaxBracket[];
  married_filing_jointly: TaxBracket[];
  married_filing_separately: TaxBracket[];
  head_of_household: TaxBracket[];
}

// 2025 Federal Tax Brackets (IRS Rev. Proc. 2024-40 + OBBB adjustments)
export const FEDERAL_TAX_BRACKETS_2024: TaxBrackets = {
  single: [
    { min: 0,       max: 11925,  rate: 0.10 },
    { min: 11925,   max: 48475,  rate: 0.12 },
    { min: 48475,   max: 103350, rate: 0.22 },
    { min: 103350,  max: 197300, rate: 0.24 },
    { min: 197300,  max: 250525, rate: 0.32 },
    { min: 250525,  max: 626350, rate: 0.35 },
    { min: 626350,  max: Infinity, rate: 0.37 }
  ],
  married_filing_jointly: [
    { min: 0,       max: 23850,  rate: 0.10 },
    { min: 23850,   max: 96950,  rate: 0.12 },
    { min: 96950,   max: 206700, rate: 0.22 },
    { min: 206700,  max: 394600, rate: 0.24 },
    { min: 394600,  max: 501050, rate: 0.32 },
    { min: 501050,  max: 751600, rate: 0.35 },
    { min: 751600,  max: Infinity, rate: 0.37 }
  ],
  married_filing_separately: [
    { min: 0,       max: 11925,  rate: 0.10 },
    { min: 11925,   max: 48475,  rate: 0.12 },
    { min: 48475,   max: 103350, rate: 0.22 },
    { min: 103350,  max: 197300, rate: 0.24 },
    { min: 197300,  max: 250525, rate: 0.32 },
    { min: 250525,  max: 375800, rate: 0.35 },
    { min: 375800,  max: Infinity, rate: 0.37 }
  ],
  head_of_household: [
    { min: 0,       max: 17000,  rate: 0.10 },
    { min: 17000,   max: 64850,  rate: 0.12 },
    { min: 64850,   max: 103350, rate: 0.22 },
    { min: 103350,  max: 197300, rate: 0.24 },
    { min: 197300,  max: 250500, rate: 0.32 },
    { min: 250500,  max: 626350, rate: 0.35 },
    { min: 626350,  max: Infinity, rate: 0.37 }
  ]
};

// Also export as 2025 for clarity
export const FEDERAL_TAX_BRACKETS_2025 = FEDERAL_TAX_BRACKETS_2024;

// 2025 Standard Deductions (OBBB-updated amounts)
export const STANDARD_DEDUCTIONS_2025 = {
  single: 15750,
  married_filing_jointly: 31500,
  married_filing_separately: 15750,
  head_of_household: 23625,
};

export interface UserProfile {
  income?: number | string;
  filing_status?: string;
  w2_income?: number;
  // Above-the-line deductions (actual field names from Firebase profile)
  health_insurance_premiums?: number;
  sep_ira_contribution?: number;
  solo_401k_contribution?: number;
  hsa_contribution?: number;
  simple_ira_contribution?: number;
  // Legacy field names (kept for backwards compatibility)
  health_insurance_premium?: number;
  retirement_contribution?: number;
}

/**
 * Calculate federal income tax for a given taxable income and filing status
 */
export function calculateFederalIncomeTax(taxableIncome: number, filingStatus: string): number {
  const brackets = FEDERAL_TAX_BRACKETS_2024[filingStatus as keyof TaxBrackets] || FEDERAL_TAX_BRACKETS_2024.single;
  let tax = 0;
  for (const bracket of brackets) {
    if (taxableIncome <= bracket.min) break;
    const taxableInBracket = Math.min(taxableIncome, bracket.max) - bracket.min;
    tax += taxableInBracket * bracket.rate;
  }
  return tax;
}

/**
 * Calculate effective tax rate incorporating SE income, W-2, and above-the-line deductions.
 * Uses 2025 standard deductions and brackets.
 */
export function calculateEffectiveTaxRate(userProfile: UserProfile): number {
  const seIncome = typeof userProfile.income === 'string'
    ? parseFloat(userProfile.income.replace(/[,$]/g, ''))
    : (userProfile.income ?? 0);

  if (isNaN(seIncome) || seIncome <= 0) return 25;

  const filingStatus = userProfile.filing_status || 'single';
  const standardDeduction = STANDARD_DEDUCTIONS_2025[filingStatus as keyof typeof STANDARD_DEDUCTIONS_2025] ?? 15750;

  // SE tax deduction (half of SE tax)
  const seTax = seIncome * 0.9235 * 0.153;
  const halfSEDeduction = seTax / 2;

  // Above-the-line deductions - use actual profile field names, fall back to legacy names
  const healthInsurance = userProfile.health_insurance_premiums ?? userProfile.health_insurance_premium ?? 0;
  const retirementContrib = (
    (userProfile.sep_ira_contribution ?? 0) +
    (userProfile.solo_401k_contribution ?? 0) +
    (userProfile.hsa_contribution ?? 0) +
    (userProfile.simple_ira_contribution ?? 0)
  ) || (userProfile.retirement_contribution ?? 0);

  // W-2 income (already taxed via withholding, but affects bracket)
  const w2Income = userProfile.w2_income ?? 0;

  // AGI
  const agi = seIncome + w2Income - halfSEDeduction - healthInsurance - retirementContrib;
  const taxableIncome = Math.max(0, agi - standardDeduction);

  const federalTax = calculateFederalIncomeTax(taxableIncome, filingStatus);
  const totalIncome = seIncome + w2Income;

  if (totalIncome <= 0) return 25;
  const effectiveRate = (federalTax / totalIncome) * 100;
  return Math.min(effectiveRate, 40);
}

/**
 * Get marginal tax rate for additional self-employment income
 */
export function getMarginalTaxRate(userProfile: UserProfile): number {
  const seIncome = typeof userProfile.income === 'string'
    ? parseFloat(userProfile.income.replace(/[,$]/g, ''))
    : (userProfile.income ?? 0);

  if (isNaN(seIncome) || seIncome <= 0) return 25;

  const filingStatus = userProfile.filing_status || 'single';
  const brackets = FEDERAL_TAX_BRACKETS_2024[filingStatus as keyof TaxBrackets] || FEDERAL_TAX_BRACKETS_2024.single;

  for (const bracket of brackets) {
    if (seIncome >= bracket.min && seIncome < bracket.max) {
      return bracket.rate * 100;
    }
  }
  return brackets[brackets.length - 1].rate * 100;
}

/**
 * Returns user's effective tax rate as a decimal (e.g. 0.27).
 * Falls back to 0.25 when profile data is missing.
 */
export function getUserTaxRate(profile?: Partial<UserProfile> | null): number {
  if (!profile || !profile.income) return 0.25;
  const pct = calculateEffectiveTaxRate(profile as UserProfile);
  return pct / 100;
}
