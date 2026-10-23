import { calculateFederalIncomeTax } from '@/lib/tax-rules/federal-brackets';
import { normalizeFilingStatus } from '@/lib/tax-rules/filing-status';
import { getFederalTaxRules, type FederalFilingStatus } from '@/lib/tax-rules/federal-year-rules';
import { CURRENT_YEAR_SAFE_HARBOR_RATE } from '@/lib/tax-rules/estimated-tax-safe-harbor';
import { calcScheduleSE } from '@/lib/reports/calcSE';

export interface ProjectedTaxInput {
  taxYear: number;
  filingStatus: string;
  /** Net self-employment earnings after expenses. */
  netSelfEmploymentEarnings: number;
  w2SocialSecurityWages?: number;
  w2MedicareWages?: number;
  otherIncome?: number;
  refundableCredits?: number;
}

export interface ProjectedTaxResult {
  filingStatus: FederalFilingStatus;
  seBase: number;
  ssPart: number;
  medicarePart: number;
  seTax: number;
  additionalMedicareTax: number;
  /** Schedule SE total. Additional Medicare is not included. */
  totalSETax: number;
  halfSEDeduction: number;
  standardDeduction: number;
  qbiDeduction: number;
  taxable: number;
  incomeTax: number;
  refundableCredits: number;
  /** incomeTax + seTax - refundable credits, before Additional Medicare and before the zero floor. */
  section103Figure: number;
  projectedTax: number;
  ninety: number;
}

const toCents = (value: number) => Math.round(value * 100);
const fromCents = (cents: number) => cents / 100;

/**
 * 90% path for a projected year with no saved income records.
 * Year figures come from getFederalTaxRules. Self-employment tax comes from calcScheduleSE unchanged.
 * Above the QBI threshold this leaves the deduction at 0. The annual engine requires review there,
 * and omitting the deduction keeps the estimate on the high side.
 */
export function projectCurrentYearTax(input: ProjectedTaxInput): ProjectedTaxResult {
  const rules = getFederalTaxRules(input.taxYear);
  const filingStatus = normalizeFilingStatus(input.filingStatus);
  const nse = input.netSelfEmploymentEarnings;
  const otherIncome = input.otherIncome ?? 0;
  const refundableCredits = input.refundableCredits ?? 0;
  const w2SocialSecurityWages = input.w2SocialSecurityWages ?? 0;
  const w2MedicareWages = input.w2MedicareWages ?? 0;
  if (![nse, otherIncome, refundableCredits, w2SocialSecurityWages, w2MedicareWages].every(Number.isFinite)) {
    throw new RangeError('Provide finite amounts for the current-year projection.');
  }
  if (refundableCredits < 0 || w2SocialSecurityWages < 0 || w2MedicareWages < 0) {
    throw new RangeError('Credits and W-2 wages cannot be negative.');
  }
  const se = calcScheduleSE(
    { scheduleCNetProfit: nse, taxYear: input.taxYear },
    filingStatus,
    w2SocialSecurityWages,
    w2MedicareWages,
  );
  const standardDeduction = rules.standardDeductions[filingStatus];
  const qualified = Math.max(0, nse - se.halfSEDeduction);
  const taxableBeforeQbi = Math.max(0, otherIncome + nse - se.halfSEDeduction - standardDeduction);
  const qbiThreshold = rules.qbiThreshold[filingStatus];
  const qbiDeduction = qualified > 0 && taxableBeforeQbi <= qbiThreshold
    ? fromCents(Math.min(toCents(qualified * 0.2), toCents(taxableBeforeQbi * 0.2)))
    : 0;
  const taxable = fromCents(Math.max(0, toCents(otherIncome + nse - se.halfSEDeduction - standardDeduction - qbiDeduction)));
  const incomeTax = fromCents(toCents(calculateFederalIncomeTax(taxable, filingStatus, input.taxYear)));
  const section103Cents = toCents(incomeTax) + toCents(se.totalSETax) - toCents(refundableCredits);
  const projectedCents = Math.max(0, section103Cents + toCents(se.additionalMedicareTax));
  const ninetyCents = Math.round(projectedCents * CURRENT_YEAR_SAFE_HARBOR_RATE);
  return {
    filingStatus,
    seBase: se.seBase,
    ssPart: se.socialSecurityTax,
    medicarePart: se.medicareTax,
    seTax: se.totalSETax,
    additionalMedicareTax: se.additionalMedicareTax,
    totalSETax: se.totalSETax,
    halfSEDeduction: se.halfSEDeduction,
    standardDeduction,
    qbiDeduction,
    taxable,
    incomeTax,
    refundableCredits,
    section103Figure: fromCents(section103Cents),
    projectedTax: fromCents(projectedCents),
    ninety: fromCents(ninetyCents),
  };
}
