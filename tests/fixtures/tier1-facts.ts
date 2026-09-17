import type { BusinessLossAnswers } from '../../lib/tax-rules/business-losses';
import type { OBBBADeductionAnswers } from '../../lib/tax-rules/obbba-deductions';

/** Explicit, synthetic loss-year declarations (Schedule C lines G/32a, §183). Never use as application defaults. */
export function reviewedBusinessLossFacts(taxYear = 2026, facts: Partial<BusinessLossAnswers> = {}): string {
  return JSON.stringify({ version: 1, taxYear, allInvestmentAtRisk: 'yes', materialParticipation: 'yes', profitMotive: 'yes', ...facts } satisfies BusinessLossAnswers);
}

/** Schedule 1-A / §170(p) intake with every question answered No unless overridden. */
export function reviewedOBBBADeductionFacts(taxYear = 2026, facts: Partial<OBBBADeductionAnswers> = {}): string {
  return JSON.stringify({
    version: 1, taxYear, magiForeignExclusions: 'no', hasQualifiedTips: 'no', hasW2Overtime: 'no', has1099Overtime: 'no',
    hasVehicleLoanInterest: 'no', hasNonItemizerCharity: 'no', workEligibleSSN: 'yes', ...facts,
  } satisfies OBBBADeductionAnswers);
}

/** A complete, valid-format synthetic VIN (17 characters, no I/O/Q). */
export const SYNTHETIC_VIN = '1HGCM82633A004352';
