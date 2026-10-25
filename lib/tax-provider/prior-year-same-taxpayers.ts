/**
 * Shared check for the prior-year method: the preceding return has to be for
 * the same taxpayer(s) and the same filing status. An explicit no is a review
 * state for both the quarterly planner and the regular-method worksheet.
 */
export interface PriorYearSameTaxpayersResult {
  allowed: boolean;
  review: boolean;
  message: string;
}

export function priorYearSameTaxpayersAndFilingStatus(sameTaxpayersAndFilingStatus: boolean): PriorYearSameTaxpayersResult {
  if (sameTaxpayersAndFilingStatus === true) {
    return { allowed: true, review: false, message: '' };
  }
  return {
    allowed: false,
    review: true,
    message: 'PLACEHOLDER The prior-year method needs the same taxpayer(s) and filing status. Review a changed joint or separate return before using a prior-year target.',
  };
}
