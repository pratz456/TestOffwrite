/** `user_classification_reason` sent by the one-tap review chips; the server derives `review_source` from it. */
export const AI_PROPOSAL_CONFIRMED_REASON = 'confirmed_ai_proposal';
export const AI_PROPOSAL_REJECTED_REASON = 'rejected_ai_proposal';

export type ReviewSource = 'user_decision' | 'ai_confirmed' | 'user_corrected';

/**
 * Provenance of an explicit tax decision saved through the update API. Confirming an AI
 * proposal counts as `ai_confirmed` only when the record actually carries a saved suggestion;
 * a caller cannot label an unassisted decision as AI-confirmed.
 */
export function reviewSourceFor(
  record: { ai_suggestion?: unknown },
  updates: { is_deductible?: boolean | null; user_classification_reason?: string | null },
): ReviewSource {
  const reason = typeof updates.user_classification_reason === 'string' ? updates.user_classification_reason.trim() : '';
  if (reason === AI_PROPOSAL_CONFIRMED_REASON && updates.is_deductible === true && record.ai_suggestion && typeof record.ai_suggestion === 'object') return 'ai_confirmed';
  if (reason === AI_PROPOSAL_REJECTED_REASON && updates.is_deductible === false) return 'user_corrected';
  return 'user_decision';
}

/** Server-side companion fields for an explicit user tax decision. Notes alone never resolve tax review. */
export function taxDecisionUpdate(
  record: { category?: unknown; transaction_kind?: unknown; pending?: unknown; ai_suggestion?: unknown },
  updates: { is_deductible?: boolean | null; user_classification_reason?: string | null },
  now: Date = new Date(),
): { tax_review_required?: boolean; review_status?: 'confirmed'; review_source?: ReviewSource; reviewed_at?: string } {
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
  return { tax_review_required: false, review_status: 'confirmed', review_source: reviewSourceFor(record, updates), reviewed_at: now.toISOString() };
}
