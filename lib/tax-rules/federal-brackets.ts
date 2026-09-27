/** Federal ordinary-income helpers. Calls without a year use the latest published parameter set. */
import { getFederalTaxRules, LATEST_PUBLISHED_TAX_YEAR, UnsupportedTaxYearError } from './federal-year-rules';
import { normalizeFilingStatus, FilingStatusReviewRequiredError } from './filing-status';
import { calcScheduleSE } from '@/lib/reports/calcSE';
import { assertWageOwnershipScope, TaxCalculationScopeReviewRequiredError } from './calculation-scope';
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
  /** Same taxpayer's W-2 boxes 3 + 7; legacy profiles approximate these using wages. */
  w2_social_security_wages?: number;
  /** W-2 box 5, kept separate from taxable wages. */
  w2_medicare_wages?: number;
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

export class TaxRateReviewRequiredError extends Error {
  readonly code = 'TAX_RATE_REVIEW_REQUIRED';
  constructor(message = 'Update income and deduction amounts in Profile before estimating a tax rate. Enter a nonnegative annual business profit or W-2 wages, including an explicit zero when applicable.') {
    super(message);
    this.name = 'TaxRateReviewRequiredError';
  }
}

/** Shared basic income-tax assumptions; this is not a complete return or a savings calculation. */
function profileIncomeTaxInputs(profile: UserProfile, taxYear: number) {
  const rules = getFederalTaxRules(taxYear);
  const filingStatus = normalizeFilingStatus(profile.filing_status);
  const missingBusinessIncome = profile.income === undefined || (typeof profile.income === 'string' && !profile.income.trim());
  if (missingBusinessIncome && profile.w2_income === undefined) throw new TaxRateReviewRequiredError();
  const amount = (value: unknown): number => {
    const cleaned = typeof value === 'string' ? value.replace(/[,$\s]/g, '') : value;
    if (cleaned === '') throw new TaxRateReviewRequiredError();
    const parsed = typeof cleaned === 'string' ? Number(cleaned) : cleaned;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) throw new TaxRateReviewRequiredError();
    return parsed;
  };
  const seIncome = missingBusinessIncome ? 0 : amount(profile.income);
  const w2Income = amount(profile.w2_income ?? 0);
  const hasWageEvidence = [w2Income, profile.w2_social_security_wages, profile.w2_medicare_wages]
    .some(value => typeof value === 'number' && value > 0);
  if (seIncome > 0 && hasWageEvidence
      && (profile.w2_social_security_wages === undefined || profile.w2_medicare_wages === undefined)) {
    throw new TaxCalculationScopeReviewRequiredError('W-2 plus self-employment estimates require explicit Box 3 Social Security wages and Box 5 Medicare wages, including explicit zero');
  }
  const socialSecurityWages = amount(profile.w2_social_security_wages ?? 0);
  const medicareWages = amount(profile.w2_medicare_wages ?? 0);
  assertWageOwnershipScope(filingStatus, seIncome, w2Income, { socialSecurityWages, medicareWages });
  // Profile amounts do not include the eligibility/coverage/plan facts needed to
  // validate these deductions. Do not subtract an uncapped claim or silently omit it.
  const claimedAdjustments = [
    profile.health_insurance_premiums, profile.health_insurance_premium,
    profile.sep_ira_contribution, profile.solo_401k_contribution, profile.simple_ira_contribution,
    profile.hsa_contribution, profile.retirement_contribution,
  ].map(value => amount(value ?? 0));
  if (claimedAdjustments.some(value => value > 0)) {
    throw new TaxRateReviewRequiredError('Health-insurance, retirement, or HSA deduction claims require eligibility and annual-limit review in Tax Organizer before a profile tax rate can be estimated.');
  }
  const se = calcScheduleSE({ scheduleCNetProfit: seIncome, taxYear }, filingStatus,
    socialSecurityWages, medicareWages);
  const totalIncome = seIncome + w2Income;
  const agi = totalIncome - se.halfSEDeduction;
  const standardDeduction = rules.standardDeductions[filingStatus];
  return { filingStatus, totalIncome, agi, standardDeduction, taxableIncome: Math.max(0, agi - standardDeduction), rules };
}

/**
 * Calculate federal income tax for a given taxable income and filing status
 */
export function calculateFederalIncomeTax(taxableIncome: number, filingStatus: string, taxYear: number = LATEST_PUBLISHED_TAX_YEAR): number {
  const yearBrackets = getFederalTaxRules(taxYear).brackets;
  const brackets = yearBrackets[normalizeFilingStatus(filingStatus)];
  if (!Number.isFinite(taxableIncome)) throw new RangeError('Taxable income must be finite.');
  let tax = 0;
  for (const bracket of brackets) {
    if (taxableIncome <= bracket.min) break;
    const taxableInBracket = Math.min(taxableIncome, bracket.max) - bracket.min;
    tax += taxableInBracket * bracket.rate;
  }
  return tax;
}

/**
 * Calculate a basic effective income-tax rate using SE income, W-2 and half of regular SE tax.
 * Other claimed adjustments require eligibility review rather than uncapped subtraction.
 * Uses the requested year's published standard deduction and brackets; unsupported years are rejected.
 */
export function calculateEffectiveTaxRate(userProfile: UserProfile, taxYear: number = LATEST_PUBLISHED_TAX_YEAR): number {
  const { filingStatus, taxableIncome, totalIncome } = profileIncomeTaxInputs(userProfile, taxYear);
  const federalTax = calculateFederalIncomeTax(taxableIncome, filingStatus, taxYear);
  return totalIncome > 0 ? (federalTax / totalIncome) * 100 : 0;
}

/**
 * Get marginal tax rate for additional self-employment income
 */
export function getMarginalTaxRate(userProfile: UserProfile, taxYear: number = LATEST_PUBLISHED_TAX_YEAR): number {
  const { rules, filingStatus, taxableIncome, agi, standardDeduction } = profileIncomeTaxInputs(userProfile, taxYear);
  if (agi < standardDeduction) return 0;
  const brackets = rules.brackets[filingStatus];

  for (const bracket of brackets) {
    if (taxableIncome >= bracket.min && taxableIncome < bracket.max) {
      return bracket.rate * 100;
    }
  }
  return brackets[brackets.length - 1].rate * 100;
}

/**
 * Returns user's effective tax rate as a decimal (e.g. 0.27).
 * Missing income requires review; a generic rate is never substituted.
 */
export function getUserTaxRate(profile?: Partial<UserProfile> | null, taxYear: number = LATEST_PUBLISHED_TAX_YEAR): number {
  getFederalTaxRules(taxYear);
  if (!profile) throw new TaxRateReviewRequiredError();
  const pct = calculateEffectiveTaxRate(profile as UserProfile, taxYear);
  return pct / 100;
}

/** Display boundary: unsupported year or filing status withholds the estimate without crashing a page. */
export function getUserTaxRateDisplay(profile?: Partial<UserProfile> | null, taxYear: number = LATEST_PUBLISHED_TAX_YEAR) {
  try {
    return { rate: getUserTaxRate(profile, taxYear), filingStatus: normalizeFilingStatus(profile?.filing_status), reviewMessage: null };
  } catch (error) {
    if (!(error instanceof FilingStatusReviewRequiredError) && !(error instanceof UnsupportedTaxYearError)
      && !(error instanceof TaxRateReviewRequiredError) && !(error instanceof TaxCalculationScopeReviewRequiredError)) throw error;
    return { rate: null, filingStatus: null, reviewMessage: error.message };
  }
}
