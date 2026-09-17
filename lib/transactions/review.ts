import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { analysisInputHash } from '@/lib/ai/analysis-persistence';
import { analysisProfileHash } from '@/lib/ai/profile-context';
import { invalidateTaxpayerContextCache } from '@/lib/ai/taxpayer-context-server';
import { transactionIdInput } from './client-updates';
import { canConfirmAiSuggestion, recordedTransactionType, reviewCategory, reviewHydrationFields,
  type AiReviewSuggestion, type TransactionReviewRequest } from './ai-review-contract';

export const transactionReviewInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('confirm'), accountId: transactionIdInput, suggestionId: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal('correct'), accountId: transactionIdInput, category: z.string().min(1).max(200),
    transactionKind: z.enum(['expense', 'income', 'transfer', 'refund', 'personal']),
    isDeductible: z.boolean().nullable(), reason: z.string().trim().max(5000).optional() }).strict(),
]);

export class TransactionReviewError extends Error {
  constructor(readonly code: string, message: string, readonly status = 422) { super(message); }
}

/** Safe response fields shared by read and review APIs. Financial data never comes from the caller. */
export function hydrateReviewTransaction(data: Record<string, any>, id: string) {
  return {
    id: data.trans_id || id, trans_id: data.trans_id || id,
    merchant_name: data.merchant_name || data.name || '', amount: data.amount,
    date: data.date, datetime: data.datetime, category: data.category || '', type: recordedTransactionType(data),
    is_deductible: data.is_deductible ?? null, pending: data.pending ?? false,
    deductible_reason: data.deductible_reason ?? null, deduction_score: data.deduction_score ?? null,
    user_classification_reason: data.user_classification_reason ?? null,
    description: data.description, notes: data.notes, receipt_url: data.receipt_url, receipt_filename: data.receipt_filename,
    account_id: data.account_id || data.accountId, userId: data.userId || data.user_id,
    ai: data.ai ?? null, analyzed: data.analyzed ?? false, analysisStatus: data.analysis_status || data.analysisStatus,
    deductionStatus: data.deductionStatus, reasoning: data.reasoning, confidence: data.confidence,
    irsPublication: data.irsPublication, irsSection: data.irsSection, analysisUpdatedAt: data.analysisUpdatedAt,
    created_at: data.created_at, updated_at: data.updated_at,
    ...reviewHydrationFields(data),
  };
}

export async function reviewTransaction(uid: string, id: string, input: TransactionReviewRequest) {
  const accountRef = adminDb.doc(`user_profiles/${uid}/accounts/${input.accountId}`);
  const ref = accountRef.collection('transactions').doc(id);
  const profileRef = adminDb.doc(`user_profiles/${uid}`);
  const reviewed = await adminDb.runTransaction(async tx => {
    const [account, snapshot, profile] = await Promise.all([tx.get(accountRef), tx.get(ref), tx.get(profileRef)]);
    const data = snapshot.data();
    const matchesOwner = (record: Record<string, unknown>) => [record.userId, record.user_id].some(value => value === uid) &&
      [record.userId, record.user_id].every(value => value == null || value === uid);
    if (!snapshot.exists || !account.exists || !data || !matchesOwner(data) || !matchesOwner(account.data()!) ||
        [data.account_id, data.accountId].some(value => value != null && value !== input.accountId)) {
      throw new TransactionReviewError('TRANSACTION_NOT_FOUND', 'Transaction not found.', 404);
    }
    if (data.pending === true) throw new TransactionReviewError('TRANSACTION_PENDING', 'Wait until this transaction posts before confirming its category.');
    if (!Number.isFinite(data.amount) || data.iso_currency_code !== 'USD' || data.unofficial_currency_code) {
      throw new TransactionReviewError('TRANSACTION_REVIEW_REQUIRED', 'Review the transaction amount and U.S. dollar currency before confirming.');
    }
    let category: string;
    let kind: Exclude<AiReviewSuggestion['transactionKind'], 'unknown'>;
    let deduction: boolean | null;
    let reason: string;
    let suggestionId: string | null = null;
    let source: 'ai_confirmed' | 'user_corrected';
    if (input.action === 'confirm') {
      if (data.review_status === 'confirmed' && data.review_source === 'ai_confirmed' && data.review_suggestion_id === input.suggestionId) {
        return hydrateReviewTransaction(data, id);
      }
      const suggestion = data.ai_suggestion as AiReviewSuggestion | undefined;
      if (!suggestion || suggestion.id !== input.suggestionId || suggestion.inputHash !== analysisInputHash(data)) {
        throw new TransactionReviewError('AI_SUGGESTION_CHANGED', 'The transaction or AI suggestion changed. Refresh and review the latest suggestion.', 409);
      }
      if (!profile.exists || !suggestion.profileHash || suggestion.profileHash !== analysisProfileHash(profile.data()!, data.date)) {
        throw new TransactionReviewError('AI_PROFILE_CHANGED', 'Your business profile changed after this analysis. Run AI again or correct the category manually.', 409);
      }
      if (!canConfirmAiSuggestion(suggestion)) throw new TransactionReviewError('AI_REVIEW_REQUIRED', 'This suggestion needs more information before its category can be confirmed.');
      if (typeof data.is_deductible === 'boolean') throw new TransactionReviewError('CLASSIFICATION_EXISTS', 'This transaction already has a saved tax decision. Use Correct to change it.', 409);
      kind = suggestion.transactionKind as typeof kind;
      category = suggestion.category ?? 'other';
      deduction = suggestion.status === 'ok' ? suggestion.isDeductible : null;
      reason = suggestion.reasoning;
      suggestionId = suggestion.id;
      source = 'ai_confirmed';
      if (deduction === true) {
        const mapped = reviewCategory(category);
        if (!mapped || mapped.recordedCategory.endsWith('_REVIEW_REQUIRED') ||
            suggestion.deductiblePercent !== (mapped.value === 'meals_50' ? 50 : 100)) deduction = null;
      }
    } else {
      kind = input.transactionKind; category = input.category; deduction = input.isDeductible;
      reason = input.reason || 'Category reviewed and corrected by user.'; source = 'user_corrected';
    }
    if ((kind === 'expense' && data.amount <= 0) || (['income', 'refund'].includes(kind) && data.amount >= 0)) {
      throw new TransactionReviewError('TRANSACTION_KIND_MISMATCH', 'This category does not match the saved cash direction. Review whether it is a transfer or refund.');
    }
    if (['income', 'transfer', 'personal', 'refund'].includes(kind) && deduction === true) {
      throw new TransactionReviewError('DEDUCTION_REVIEW_REQUIRED', 'Income, transfers and personal entries are not expense deductions. Refunds need reconciliation with the original expense.');
    }
    let recordedCategory: string;
    if (kind === 'income') recordedCategory = 'INCOME';
    else if (kind === 'transfer') recordedCategory = 'TRANSFER';
    else if (kind === 'personal') recordedCategory = 'PERSONAL';
    else {
      const mapped = reviewCategory(category);
      if (!mapped) throw new TransactionReviewError('INVALID_CATEGORY', 'Choose a supported category.');
      recordedCategory = mapped.recordedCategory;
      if (deduction === true && recordedCategory.endsWith('_REVIEW_REQUIRED')) {
        throw new TransactionReviewError('DEDUCTION_REVIEW_REQUIRED', 'This category needs a separate tax method review. Save the category without claiming a deduction.');
      }
    }
    // Refund category is useful, but never claims an offset without original-expense reconciliation.
    if (kind === 'refund') deduction = null;
    else if (['income', 'transfer', 'personal'].includes(kind)) deduction = false;
    const update = {
      category: recordedCategory, transaction_kind: kind,
      is_deductible: deduction, expense_type: kind === 'personal' ? 'personal' : kind === 'expense' && deduction === true ? 'business' : null,
      user_classification_reason: reason, deductible_reason: deduction === null ? null : reason,
      review_status: 'confirmed', review_source: source, review_suggestion_id: suggestionId,
      reviewed_at: new Date().toISOString(), tax_review_required: deduction === null,
      updated_at: new Date(),
    };
    tx.update(ref, update);
    return hydrateReviewTransaction({ ...data, ...update }, id);
  });
  // A confirmed row is a new prior for this user's later AI analyses; drop the memoized history.
  invalidateTaxpayerContextCache(uid);
  return reviewed;
}
