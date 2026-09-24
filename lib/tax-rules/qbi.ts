/** Form 8995-A cannot be inferred from profit and personal filing status alone. */
export class QBIReviewRequiredError extends Error {
  readonly code = 'QBI_REVIEW_REQUIRED';
  constructor(taxYear: number, threshold: number) {
    super(`The ${taxYear} QBI deduction needs a preparer's review because taxable income before QBI exceeds $${threshold.toLocaleString('en-US')}. Confirm the business type, business W-2 wages and qualified-property basis for Form 8995-A. No complete federal estimate is shown until these rules are supported.`);
    this.name = 'QBIReviewRequiredError';
  }
}
