import { getFederalTaxRules, SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
import { normalizeFilingStatus } from '@/lib/tax-rules/filing-status';

export interface TaxSummarySettings {
  scheduleCNetProfit: number;
  taxYear: number;
  adjustments?: number;
}

export interface ScheduleSECalculation {
  netProfitFromScheduleC: number;
  adjustments: number;
  netEarnings: number;
  seBase: number;
  socialSecurityTax: number;
  medicareTax: number;
  /** SE portion of Form 8959; excluded from Schedule SE total and its half-tax deduction. */
  additionalMedicareTax: number;
  /** Schedule SE only: Social Security plus regular Medicare. */
  totalSETax: number;
  halfSEDeduction: number;
}

const SOCIAL_SECURITY_RATE = 0.124;
const MEDICARE_RATE = 0.029;
const ADDITIONAL_MEDICARE_RATE = 0.009;
const SE_ADJUSTMENT_FACTOR = 0.9235;
const roundCents = (value: number) => Math.round(value * 100) / 100;

function additionalMedicareThreshold(filingStatus: string): number {
  // This calculator historically accepts "married" as an explicit joint alias.
  const status = normalizeFilingStatus(filingStatus === 'married' ? 'married_filing_jointly' : filingStatus);
  if (status === 'married_filing_jointly') return 250000;
  if (status === 'married_filing_separately') return 125000;
  return 200000;
}

/**
 * Regular Schedule SE calculation for one individual's nonfarm business income.
 * https://www.irs.gov/instructions/i1040sse
 * https://www.ssa.gov/oact/COLA/cbb.html
 * Additional Medicare belongs on Form 8959, not in Schedule SE or its deduction.
 * Spouses need separate Schedule SE calculations; do not combine their wage bases.
 */
export function calcScheduleSE(
  taxSummary: TaxSummarySettings,
  filingStatus: string = 'single',
  w2SocialSecurityWages: number = 0,
  w2MedicareWages: number = 0
): ScheduleSECalculation {
  const rules = getFederalTaxRules(taxSummary.taxYear);
  const { scheduleCNetProfit, adjustments = 0 } = taxSummary;
  if (![scheduleCNetProfit, adjustments, w2SocialSecurityWages, w2MedicareWages].every(Number.isFinite)
    || w2SocialSecurityWages < 0 || w2MedicareWages < 0) {
    throw new RangeError('Provide finite income amounts and nonnegative W-2 wages.');
  }
  const netEarnings = scheduleCNetProfit + adjustments;
  const seBase = Math.max(0, netEarnings) * SE_ADJUSTMENT_FACTOR;
  const liable = seBase >= 400;
  const remainingSSWageBase = Math.max(0, rules.socialSecurityWageBase - w2SocialSecurityWages);
  const socialSecurityTax = liable ? Math.min(seBase, remainingSSWageBase) * SOCIAL_SECURITY_RATE : 0;
  const medicareTax = liable ? seBase * MEDICARE_RATE : 0;
  const remainingMedicareThreshold = Math.max(0, additionalMedicareThreshold(filingStatus) - w2MedicareWages);
  const additionalMedicareTax = liable ? Math.max(0, seBase - remainingMedicareThreshold) * ADDITIONAL_MEDICARE_RATE : 0;
  const totalSETax = socialSecurityTax + medicareTax;

  return {
    netProfitFromScheduleC: roundCents(scheduleCNetProfit),
    adjustments: roundCents(adjustments),
    netEarnings: roundCents(netEarnings),
    seBase: roundCents(seBase),
    socialSecurityTax: roundCents(socialSecurityTax),
    medicareTax: roundCents(medicareTax),
    additionalMedicareTax: roundCents(additionalMedicareTax),
    totalSETax: roundCents(totalSETax),
    halfSEDeduction: roundCents(totalSETax * 0.5),
  };
}

export function calcScheduleSEMultiYear(taxSummaries: TaxSummarySettings[], filingStatus: string = 'single'): ScheduleSECalculation[] {
  return taxSummaries.map(summary => calcScheduleSE(summary, filingStatus));
}

export function validateTaxSummarySettings(settings: Partial<TaxSummarySettings>): string[] {
  const errors: string[] = [];
  if (settings.scheduleCNetProfit === undefined || !Number.isFinite(settings.scheduleCNetProfit)) {
    errors.push('A finite Schedule C net profit or loss is required');
  }
  if (!(SUPPORTED_TAX_YEARS as readonly number[]).includes(settings.taxYear ?? NaN)) {
    errors.push(`Supported tax years: ${SUPPORTED_TAX_YEARS.join(', ')}`);
  }
  if (settings.adjustments !== undefined && !Number.isFinite(settings.adjustments)) {
    errors.push('Adjustments must be a finite number');
  }
  return errors;
}

export function getTaxRatesAndLimits(year: number) {
  const rules = getFederalTaxRules(year);
  return {
    socialSecurityRate: SOCIAL_SECURITY_RATE,
    medicareRate: MEDICARE_RATE,
    additionalMedicareRate: ADDITIONAL_MEDICARE_RATE,
    seAdjustmentFactor: SE_ADJUSTMENT_FACTOR,
    socialSecurityWageBase: rules.socialSecurityWageBase,
    additionalMedicareThresholdSingle: 200000,
    additionalMedicareThresholdMarried: 250000,
    additionalMedicareThresholdMarriedSeparate: 125000,
  };
}
