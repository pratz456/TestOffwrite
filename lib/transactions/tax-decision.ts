/** Server-side companion fields for an explicit user tax decision. Notes alone never resolve tax review. */
export function taxDecisionUpdate(
  record: { category?: unknown; transaction_kind?: unknown; pending?: unknown },
  updates: { is_deductible?: boolean | null },
): { tax_review_required?: boolean } {
  if (updates.is_deductible === undefined) return {};
  if (updates.is_deductible === null) return { tax_review_required: true };
  if (updates.is_deductible === true && (
    record.pending === true ||
    typeof record.category === 'string' && record.category.endsWith('_REVIEW_REQUIRED') ||
    ['income', 'transfer', 'personal', 'refund'].includes(String(record.transaction_kind))
  )) {
    throw new Error('This transaction requires tax-method or refund reconciliation before it can be included as a deduction. Save its category and supporting details first.');
  }
  return { tax_review_required: false };
}
