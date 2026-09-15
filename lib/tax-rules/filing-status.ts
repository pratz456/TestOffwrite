import type { FederalFilingStatus } from './federal-year-rules';

export class FilingStatusReviewRequiredError extends Error {
  readonly code = 'FILING_STATUS_REVIEW_REQUIRED';

  constructor(unsupportedSurvivingSpouse = false) {
    super(unsupportedSurvivingSpouse
      ? 'Qualifying widow(er) or surviving-spouse calculations require tax review and are not supported yet. Review your filing status in Profile; do not change a valid status solely to generate an estimate. No tax total has been calculated.'
      : 'Review your filing status in Profile before calculating tax. Select Single, Married Filing Jointly, Married Filing Separately, or Head of Household if applicable. No tax total has been calculated.');
    this.name = 'FilingStatusReviewRequiredError';
  }
}

/** Accept the explicit onboarding labels and engine keys, without guessing eligibility. */
export function normalizeFilingStatus(value: unknown): FederalFilingStatus {
  // Preserve the existing default for profiles saved before this field was collected.
  if (value === undefined || value === null || value === '') return 'single';
  if (typeof value !== 'string') throw new FilingStatusReviewRequiredError();
  const key = value.trim().toLowerCase().replace(/\s+/g, '_');
  switch (key) {
    case 'single':
    case 'married_filing_jointly':
    case 'married_filing_separately':
    case 'head_of_household':
      return key;
    default:
      throw new FilingStatusReviewRequiredError(key.startsWith('qualifying_'));
  }
}
