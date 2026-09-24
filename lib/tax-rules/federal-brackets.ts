/** Federal ordinary-income helpers. Calls without a year use the latest published parameter set. */
import {
  getFederalTaxRules,
  LATEST_PUBLISHED_TAX_YEAR,
  UnsupportedTaxYearError,
} from './federal-year-rules';
import { normalizeFilingStatus, FilingStatusReviewRequiredError } from './filing-status';
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

export class TaxRateProfileRequiredError extends RangeError {
  readonly code = 'TAX_RATE_PROFILE_REQUIRED';
  constructor() {
    super('Add your self-employment income in Profile before WriteOff estimates tax savings.');
    this.name = 'TaxRateProfileRequiredError';
  }
}

/**
 * Calculate federal income tax for a given taxable income and filing status
 */
export function calculateFederalIncomeTax(taxableIncome: number, filingStatus: string, taxYear: number = LATEST_PUBLISHED_TAX_YEAR): number {
  const yearBrackets = getFederalTaxRules(taxYear).brackets;
  const brackets = yearBrackets[normalizeFilingStatus(filingStatus)];
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
 * Uses the requested year's standard deduction and brackets. Unsupported years fail closed.
 */
export function calculateEffectiveTaxRate(userProfile: UserProfile, taxYear: number = LATEST_PUBLISHED_TAX_YEAR): number {
  const filingStatus = normalizeFilingStatus(userProfile.filing_status);
  const year = getFederalTaxRules(taxYear);
  const seIncome = typeof userProfile.income === 'string'
    ? parseFloat(userProfile.income.replace(/[,$]/g, ''))
    : (userProfile.income ?? 0);

  if (isNaN(seIncome) || seIncome <= 0) throw new TaxRateProfileRequiredError();

  const standardDeduction = year.standardDeductions[filingStatus];

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

  const federalTax = calculateFederalIncomeTax(taxableIncome, filingStatus, year.taxYear);
  const totalIncome = seIncome + w2Income;

  if (totalIncome <= 0) throw new TaxRateProfileRequiredError();
  const effectiveRate = (federalTax / totalIncome) * 100;
  return Math.min(effectiveRate, 40);
}

/**
 * Get marginal tax rate for additional self-employment income
 */
export function getMarginalTaxRate(userProfile: UserProfile, taxYear: number = LATEST_PUBLISHED_TAX_YEAR): number {
  const filingStatus = normalizeFilingStatus(userProfile.filing_status);
  const seIncome = typeof userProfile.income === 'string'
    ? parseFloat(userProfile.income.replace(/[,$]/g, ''))
    : (userProfile.income ?? 0);

  if (isNaN(seIncome) || seIncome <= 0) throw new TaxRateProfileRequiredError();

  const brackets = getFederalTaxRules(taxYear).brackets[filingStatus];

  for (const bracket of brackets) {
    if (seIncome >= bracket.min && seIncome < bracket.max) {
      return bracket.rate * 100;
    }
  }
  return brackets[brackets.length - 1].rate * 100;
}

/**
 * Returns user's effective tax rate as a decimal (e.g. 0.27).
 * Requires saved income; callers that render optional estimates should use getUserTaxRateDisplay.
 */
export function getUserTaxRate(profile?: Partial<UserProfile> | null, taxYear: number = LATEST_PUBLISHED_TAX_YEAR): number {
  if (profile) normalizeFilingStatus(profile.filing_status);
  if (!profile || !profile.income) throw new TaxRateProfileRequiredError();
  const pct = calculateEffectiveTaxRate(profile as UserProfile, taxYear);
  return pct / 100;
}

/** Display boundary: unsupported status withholds the estimate without crashing a page. */
export function getUserTaxRateDisplay(profile?: Partial<UserProfile> | null, taxYear: number = LATEST_PUBLISHED_TAX_YEAR) {
  try {
    getFederalTaxRules(taxYear);
    const rawIncome = typeof profile?.income === 'string'
      ? Number(profile.income.replace(/[,$\s]/g, ''))
      : profile?.income;
    if (!profile || !Number.isFinite(rawIncome) || Number(rawIncome) <= 0) {
      return {
        rate: null,
        filingStatus: profile?.filing_status ? normalizeFilingStatus(profile.filing_status) : null,
        reviewMessage: 'Add your self-employment income in Profile before WriteOff estimates tax savings.',
      };
    }
    return { rate: getUserTaxRate(profile, taxYear), filingStatus: normalizeFilingStatus(profile?.filing_status), reviewMessage: null };
  } catch (error) {
    if (error instanceof FilingStatusReviewRequiredError || error instanceof UnsupportedTaxYearError) {
      return { rate: null, filingStatus: null, reviewMessage: error.message };
    }
    throw error;
  }
}
