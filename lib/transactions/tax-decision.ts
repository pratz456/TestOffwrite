/** Server-side companion fields for an explicit user tax decision. Notes alone never resolve tax review. */
export function taxDecisionUpdate(
  record: { category?: unknown; transaction_kind?: unknown; pending?: unknown },
  updates: { is_deductible?: boolean | null },
  now: Date = new Date(),
): { tax_review_required?: boolean; review_status?: 'confirmed'; review_source?: 'user_decision'; reviewed_at?: string } {
  if (updates.is_deductible === undefined) return {};
  if (updates.is_deductible === null) return { tax_review_required: true };
  if (updates.is_deductible === true && (
    record.pending === true ||
    typeof record.category === 'string' && record.category.endsWith('_REVIEW_REQUIRED') ||
    ['income', 'transfer', 'personal', 'refund'].includes(String(record.transaction_kind))
  )) {
    throw new Error('This transaction requires tax-method or refund reconciliation before it can be included as a deduction. Save its category and supporting details first.');
  }
  // Confirmed totals only trust is_deductible together with a server-recorded
  // decision (see lib/transactions/confirmed-deduction.ts), so stamp it here.
  return { tax_review_required: false, review_status: 'confirmed', review_source: 'user_decision', reviewed_at: now.toISOString() };
}
