type ReviewableTransaction = {
  is_deductible?: boolean | null;
  user_classification_reason?: string | null;
  review_status?: string;
  tax_review_required?: boolean;
  ai_suggestion?: unknown;
};

/** Categorization can be confirmed while eligibility still needs business-use or tax-method facts. */
export function transactionNeedsTaxReview(t: ReviewableTransaction): boolean {
  if (t.tax_review_required === true) return true;
  if (t.is_deductible === true || t.is_deductible === false) return false;
  return true;
}

/** Swipe queue handles categories. A skipped or unavailable analysis remains unresolved. */
export function transactionNeedsCategoryReview(t: ReviewableTransaction): boolean {
  if (t.review_status === 'confirmed') return false;
  return typeof t.is_deductible !== 'boolean';
}
