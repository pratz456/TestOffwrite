export interface TaxSummarySettings {
  scheduleCNetProfit: number;
  taxYear: number;
  adjustments?: number; // Any adjustments to net profit
}

export interface ScheduleSECalculation {
  netProfitFromScheduleC: number;
  adjustments: number;
  netEarnings: number;
  seBase: number; // Net earnings * 0.9235
  socialSecurityTax: number; // 12.4% up to wage base
  medicareTax: number; // 2.9% on all earnings
  additionalMedicareTax: number; // 0.9% on earnings over threshold
  totalSETax: number;
  halfSEDeduction: number; // Half of SE tax (deductible)
}

// 2025 Tax Rates and Limits (IRS Rev. Proc. 2024-40, IR-2024-285)
const SOCIAL_SECURITY_RATE = 0.124; // 12.4%
const MEDICARE_RATE = 0.029; // 2.9%
const ADDITIONAL_MEDICARE_RATE = 0.009; // 0.9%
const SE_ADJUSTMENT_FACTOR = 0.9235; // 92.35%

// 2025 Wage Base and Thresholds
const SOCIAL_SECURITY_WAGE_BASE = 176100; // $176,100 for 2025 (IRS IR-2024-285)
const ADDITIONAL_MEDICARE_THRESHOLD_SINGLE = 200000; // $200,000
const ADDITIONAL_MEDICARE_THRESHOLD_MARRIED = 250000; // $250,000

/**
 * Calculate Schedule SE - Self-Employment Tax
 * Based on IRS Schedule SE instructions
 */
export function calcScheduleSE(
  taxSummary: TaxSummarySettings,
  filingStatus: string = 'single',
  w2SocialSecurityWages: number = 0  // Box 3 of W-2 — reduces SS wage base (Schedule SE Line 8a)
): ScheduleSECalculation {
  const { scheduleCNetProfit, adjustments = 0 } = taxSummary;

  // Net earnings from self-employment
  const netEarnings = scheduleCNetProfit + adjustments;

  // Apply SE adjustment factor (92.35%) — IRS Schedule SE Line 4a
  const seBase = netEarnings * SE_ADJUSTMENT_FACTOR;

  // IRS: No SE tax if net earnings < $400 (Schedule SE Part I Line 4c)
  if (seBase < 400) {
    return {
      netProfitFromScheduleC: Math.round(scheduleCNetProfit * 100) / 100,
      adjustments: Math.round(adjustments * 100) / 100,
      netEarnings: Math.round(netEarnings * 100) / 100,
      seBase: Math.round(seBase * 100) / 100,
      socialSecurityTax: 0,
      medicareTax: 0,
      additionalMedicareTax: 0,
      totalSETax: 0,
      halfSEDeduction: 0,
    };
  }

  // Social Security tax (12.4% up to wage base)
  // IRS Schedule SE Line 8: W-2 SS wages already paid reduce available SS wage base
  // This prevents double-paying SS tax for workers with both W-2 and SE income
  const remainingSSWageBase = Math.max(0, SOCIAL_SECURITY_WAGE_BASE - w2SocialSecurityWages);
  const socialSecurityTaxable = Math.min(seBase, remainingSSWageBase);
  const socialSecurityTax = socialSecurityTaxable * SOCIAL_SECURITY_RATE;

  // Medicare tax (2.9% on all earnings)
  const medicareTax = seBase * MEDICARE_RATE;

  // Additional Medicare tax (0.9% on earnings over threshold)
  let additionalMedicareTax = 0;
  const threshold = filingStatus === 'married' 
    ? ADDITIONAL_MEDICARE_THRESHOLD_MARRIED 
    : ADDITIONAL_MEDICARE_THRESHOLD_SINGLE;
  
  if (seBase > threshold) {
    const additionalTaxable = seBase - threshold;
    additionalMedicareTax = additionalTaxable * ADDITIONAL_MEDICARE_RATE;
  }

  // Total SE tax
  const totalSETax = socialSecurityTax + medicareTax + additionalMedicareTax;

  // Half of SE tax (deductible on Schedule 1)
  const halfSEDeduction = totalSETax * 0.5;

  return {
    netProfitFromScheduleC: Math.round(scheduleCNetProfit * 100) / 100,
    adjustments: Math.round(adjustments * 100) / 100,
    netEarnings: Math.round(netEarnings * 100) / 100,
    seBase: Math.round(seBase * 100) / 100,
    socialSecurityTax: Math.round(socialSecurityTax * 100) / 100,
    medicareTax: Math.round(medicareTax * 100) / 100,
    additionalMedicareTax: Math.round(additionalMedicareTax * 100) / 100,
    totalSETax: Math.round(totalSETax * 100) / 100,
    halfSEDeduction: Math.round(halfSEDeduction * 100) / 100,
  };
}

/**
 * Calculate SE tax for multiple years (useful for planning)
 */
export function calcScheduleSEMultiYear(
  taxSummaries: TaxSummarySettings[],
  filingStatus: string = 'single'
): ScheduleSECalculation[] {
  return taxSummaries.map(summary => calcScheduleSE(summary, filingStatus));
}

/**
 * Validate tax summary settings
 */
export function validateTaxSummarySettings(settings: Partial<TaxSummarySettings>): string[] {
  const errors: string[] = [];

  if (settings.scheduleCNetProfit === undefined || settings.scheduleCNetProfit === null) {
    errors.push('Schedule C net profit is required');
  } else if (settings.scheduleCNetProfit < 0) {
    errors.push('Schedule C net profit cannot be negative');
  }

  if (settings.taxYear && (settings.taxYear < 2020 || settings.taxYear > new Date().getFullYear() + 1)) {
    errors.push('Tax year must be between 2020 and next year');
  }

  if (settings.adjustments && settings.adjustments < 0) {
    errors.push('Adjustments cannot be negative');
  }

  return errors;
}

/**
 * Get tax rates and limits for a given year
 */
export function getTaxRatesAndLimits(year: number) {
  // This could be expanded to support different years
  // For now, we'll use 2024 rates
  return {
    socialSecurityRate: SOCIAL_SECURITY_RATE,
    medicareRate: MEDICARE_RATE,
    additionalMedicareRate: ADDITIONAL_MEDICARE_RATE,
    seAdjustmentFactor: SE_ADJUSTMENT_FACTOR,
    socialSecurityWageBase: SOCIAL_SECURITY_WAGE_BASE,
    additionalMedicareThresholdSingle: ADDITIONAL_MEDICARE_THRESHOLD_SINGLE,
    additionalMedicareThresholdMarried: ADDITIONAL_MEDICARE_THRESHOLD_MARRIED,
  };
}
