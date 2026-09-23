/** An affected tax calculation requires facts or a worksheet the current model lacks. */
export class TaxCalculationScopeReviewRequiredError extends Error {
  readonly code = 'TAX_CALCULATION_SCOPE_REVIEW_REQUIRED';
  constructor(detail: string) {
    super(`${detail} A tax preparer must review this case; this calculation is unavailable until the required rules and facts are supported.`);
    this.name = 'TaxCalculationScopeReviewRequiredError';
  }
}

/** Saved W-2 records do not identify which spouse earned wages. Do not consume the wrong SS base. */
export function assertWageOwnershipScope(filingStatus: string, businessProfit: number, w2Wages: number,
  wageBoxes: { socialSecurityWages?: number; medicareWages?: number } = {}): void {
  // Pre-tax deductions can make box 1 zero while boxes 3/7 or 5 remain positive.
  // Those wages still affect a spouse's separate SE base and need ownership facts.
  const hasWages = [w2Wages, wageBoxes.socialSecurityWages, wageBoxes.medicareWages].some(value => typeof value === 'number' && value > 0);
  if (filingStatus === 'married_filing_jointly' && businessProfit > 0 && hasWages) {
    throw new TaxCalculationScopeReviewRequiredError('A joint return with both W-2 wages and business profit requires wages to be assigned to the spouse who earned them. Each self-employed spouse has a separate Social Security wage base');
  }
}

/** Saved contribution/payment totals are claims, not reviewed allowable Schedule 1 deductions.
 * This boundary stays closed until eligibility facts and their worksheets are supported.
 * Check retirement components separately so signed entries cannot cancel and bypass review.
 */
export function assertSavedAdjustmentScope(input: {
  hsaContribution: number;
  healthInsurancePremiums: number;
  retirementContributions: readonly number[];
}): void {
  const missingRules: string[] = [];
  if (input.hsaContribution !== 0) {
    missingRules.push('HSA eligibility, coverage type and eligible months, age, Medicare coverage, and employer or other contributions');
  }
  if (input.retirementContributions.some(amount => amount !== 0)) {
    missingRules.push('retirement-plan eligibility, contribution type, age, earned-income limits, and contributions across other plans');
  }
  if (input.healthInsurancePremiums !== 0) {
    missingRules.push('self-employed health-insurance eligibility, coverage months, access to an employer-subsidized plan, and premium-tax-credit coordination');
  }
  if (missingRules.length) {
    throw new TaxCalculationScopeReviewRequiredError(`Saved payment or contribution amounts do not establish an allowable deduction. WriteOff does not yet validate ${missingRules.join('; ')}`);
  }
}
