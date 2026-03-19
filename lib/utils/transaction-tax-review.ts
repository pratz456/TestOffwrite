/**
 * Single definition of "still needs user tax classification" across list, review, and dashboard.
 * - Confirmed when `is_deductible` is true or false.
 * - Swipe "Skip" records a reason but leaves `is_deductible` null — we treat that as reviewed for queue purposes.
 */
export function transactionNeedsTaxReview(t: {
  is_deductible?: boolean | null;
  user_classification_reason?: string | null;
}): boolean {
  if (t.is_deductible === true || t.is_deductible === false) return false;
  const reason = t.user_classification_reason;
  if (reason != null && String(reason).includes('Skipped by user')) return false;
  return true;
}
