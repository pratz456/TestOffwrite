import { getFederalTaxRules } from './federal-year-rules';
import { isAge65AtTaxYearEnd } from './personal-deductions';

export class DependentCreditReviewRequiredError extends Error {
  readonly code = 'DEPENDENT_CREDIT_REVIEW_REQUIRED';
  constructor(detail: string) {
    super(`Review dependent credit eligibility in Tax Organizer: ${detail}`);
    this.name = 'DependentCreditReviewRequiredError';
  }
}

/** A household dependent count cannot establish either CTC or EITC eligibility. */
export function assertGenericDependentCreditScope(value: unknown): void {
  const count = value === undefined || value === null || value === '' ? 0
    : typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new DependentCreditReviewRequiredError('confirm a valid number of dependents.');
  }
  if (count > 0) {
    throw new DependentCreditReviewRequiredError('a dependent count does not identify qualifying children for the Child Tax Credit or Earned Income Tax Credit, or eligibility for the credit for other dependents. These facts require tax review before an annual total or refund can be shown.');
  }
}

/**
 * Pub596 Rule11: age25 is reached the day before the birthday; age65 is
 * reached ON the birthday. Do not reuse the senior-deduction age65 cutoff.
 * https://www.irs.gov/publications/p596 (Rule11, age requirements)
 */
export function noChildEITCAgeAtYearEnd(dateOfBirth: unknown, taxYear: number): number {
  getFederalTaxRules(taxYear);
  // Reuse strict calendar validation, but not the returned senior eligibility.
  isAge65AtTaxYearEnd(dateOfBirth, taxYear);
  const date = dateOfBirth as string;
  const age = taxYear - Number(date.slice(0, 4));
  return age === 24 && date.slice(5) === '01-01' ? 25 : age;
}

export function readNoChildEITCAge(organizer: Record<string, unknown>, taxYear: number, filingStatus: string): number {
  const taxpayerAge = noChildEITCAgeAtYearEnd(organizer.dateOfBirth, taxYear);
  if (filingStatus !== 'married_filing_jointly') return taxpayerAge;
  const spouseAge = noChildEITCAgeAtYearEnd(organizer.spouseDoB, taxYear);
  // A joint return meets Rule11 if either spouse meets the age requirement.
  return taxpayerAge >= 25 && taxpayerAge <= 64 ? taxpayerAge : spouseAge;
}

/**
 * Income, age and standard-deduction declarations do not establish EITC
 * eligibility. Pub596 Rules2,12,13,14 require additional SSN, dependency,
 * qualifying-child-of-another and U.S.-home facts, with specific exceptions.
 * https://www.irs.gov/publications/p596 (2025 edition, Table1 and Rules2,12–14)
 * Until those facts are collected, withhold the annual total, not the credit.
 */
export function assertEITCDependencyScope(potentialEITC: number, dependentLimitationApplied: boolean): void {
  if (potentialEITC <= 0) return;
  if (dependentLimitationApplied) {
    throw new DependentCreditReviewRequiredError('you or your spouse can be claimed as a dependent. Earned Income Tax Credit eligibility, including any exception for a person not required to file, needs review before applying this credit.');
  }
  throw new DependentCreditReviewRequiredError('a possible Earned Income Tax Credit needs eligibility review. The organizer does not yet collect all required facts, including valid SSNs, a main U.S. home for more than half the year, and whether you are another taxpayer’s qualifying child. Review these requirements and any exceptions in IRS Publication 596 with a tax professional before using an annual total or refund.');
}
