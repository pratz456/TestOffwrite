/** Federal ordinary-income helpers. Legacy calls without a year use 2025. */
import { getFederalTaxRules, type TaxBrackets } from './federal-year-rules';
export type { TaxBracket, TaxBrackets } from './federal-year-rules';

// Preserve historical exports while making each label match its actual year.
export const FEDERAL_TAX_BRACKETS_2024 = getFederalTaxRules(2024).brackets;
export const FEDERAL_TAX_BRACKETS_2025 = getFederalTaxRules(2025).brackets;
export const FEDERAL_TAX_BRACKETS_2026 = getFederalTaxRules(2026).brackets;
export const STANDARD_DEDUCTIONS_2024 = getFederalTaxRules(2024).standardDeductions;
export const STANDARD_DEDUCTIONS_2025 = getFederalTaxRules(2025).standardDeductions;
export const STANDARD_DEDUCTIONS_2026 = getFederalTaxRules(2026).standardDeductions;

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
export function calculateFederalIncomeTax(taxableIncome: number, filingStatus: string, taxYear: number = 2025): number {
  const yearBrackets = getFederalTaxRules(taxYear).brackets;
  const brackets = yearBrackets[filingStatus as keyof TaxBrackets] || yearBrackets.single;
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
  const brackets = FEDERAL_TAX_BRACKETS_2025[filingStatus as keyof TaxBrackets] || FEDERAL_TAX_BRACKETS_2025.single;

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
