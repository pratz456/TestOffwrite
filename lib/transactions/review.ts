import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { finiteUsePercent, VEHICLE_ACTUAL_EXPENSE_CATEGORY, VEHICLE_LOAN_INTEREST_CATEGORY, VEHICLE_PROPERTY_TAX_CATEGORY } from '@/lib/ai/actual-expense-share';
import { analysisInputHash } from '@/lib/ai/analysis-persistence';
import { analysisProfileHash } from '@/lib/ai/profile-context';
import { hiredVehicleFare, standardMileageSeparateCost } from '@/lib/ai/vehicle-separate-costs';
import { invalidateTaxpayerContextCache } from '@/lib/ai/taxpayer-context-server';
import { TRANSACTION_TAX_POLICY_VERSION } from '@/lib/ai/transaction-tax-policy';
import { mileageVehicleCopyEnabled } from '@/lib/mileage/vehicle-copy';
import { vehicleFromDocument, vehicleMethodForTaxYear, type LegacyVehicleProfile, type VehicleRecord } from '@/lib/mileage/vehicles';
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

function taxYearOf(data: Record<string, unknown>): number {
  const date = typeof data.date === 'string' ? data.date : '';
  return /^\d{4}-\d{2}-\d{2}/.test(date) ? Number(date.slice(0, 4)) : new Date().getFullYear();
}

async function loadVehicles(tx: FirebaseFirestore.Transaction, profileRef: FirebaseFirestore.DocumentReference): Promise<VehicleRecord[]> {
  if (!mileageVehicleCopyEnabled()) return [];
  const snap = await tx.get(profileRef.collection('vehicles'));
  const docs = (snap as { docs?: Array<{ id: string; data: () => Record<string, unknown> }> }).docs;
  if (!Array.isArray(docs)) return [];
  return docs.map(doc => vehicleFromDocument(doc.id, doc.data()));
}

function chargeText(data: Record<string, unknown>): string {
  return ['merchant_name', 'name', 'description', 'notes', 'note', 'business_purpose']
    .map(key => typeof data[key] === 'string' ? data[key] as string : '').filter(Boolean).join(' ');
}

/**
 * Recorded business-use share for a car cost. Interest and vehicle property tax use it under either method.
 * Operating costs use it only for actual expenses. A hired fare is not a cost of the user's own car.
 */
function vehicleCostShare(data: Record<string, unknown>, profile: LegacyVehicleProfile | null, vehicles: VehicleRecord[]):
  { kind: 'actual' | 'loan_interest' | 'property_tax'; share: number } | null {
  if (!mileageVehicleCopyEnabled()) return null;
  const merchantText = ['merchant_name', 'name', 'description'].map(key => typeof data[key] === 'string' ? data[key] as string : '').filter(Boolean).join(' ');
  if (hiredVehicleFare(merchantText)) return null;
  const vehicleId = typeof data.vehicleId === 'string' ? data.vehicleId : typeof data.vehicle_id === 'string' ? data.vehicle_id : null;
  const fact = vehicleMethodForTaxYear({ vehicles, profile, taxYear: taxYearOf(data), vehicleId });
  const share = finiteUsePercent(data.business_use_percentage) ?? finiteUsePercent(fact.businessUsePercent);
  const separate = standardMileageSeparateCost(chargeText(data));
  if (separate) return share === null ? null : { kind: separate, share };
  if (fact.status !== 'known' || fact.method !== 'actual_expense' || share === null) return null;
  return { kind: 'actual', share };
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
    let confirmedSuggestion: AiReviewSuggestion | null = null;
    const profileData = profile.exists ? profile.data() as LegacyVehicleProfile : null;
    const vehicles = await loadVehicles(tx, profileRef);
    if (input.action === 'confirm') {
      if (data.review_status === 'confirmed' && data.review_source === 'ai_confirmed' && data.review_suggestion_id === input.suggestionId) {
        return hydrateReviewTransaction(data, id);
      }
      const suggestion = data.ai_suggestion as AiReviewSuggestion | undefined;
      if (!suggestion || suggestion.id !== input.suggestionId || suggestion.inputHash !== analysisInputHash(data)) {
        throw new TransactionReviewError('AI_SUGGESTION_CHANGED', 'The transaction or AI suggestion changed. Refresh and review the latest suggestion.', 409);
      }
      if (suggestion.policyVersion !== TRANSACTION_TAX_POLICY_VERSION) {
        throw new TransactionReviewError('AI_POLICY_CHANGED', 'WriteOff tax guidance changed after this analysis. Run AI again before confirming it.', 409);
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
      confirmedSuggestion = suggestion;
      if (deduction === true) {
        const mapped = reviewCategory(category);
        const suggestionShare = finiteUsePercent(suggestion.deductiblePercent);
        const cost = vehicleCostShare(data, profileData, vehicles);
        if (cost && suggestionShare === cost.share) {
          deduction = true;
        } else if (cost && (cost.kind === 'loan_interest' || cost.kind === 'property_tax')) {
          deduction = null;
        } else if (!mapped || mapped.recordedCategory.endsWith('_REVIEW_REQUIRED') ||
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
    let savedShare: number | null = null;
    if (kind === 'income') recordedCategory = 'INCOME';
    else if (kind === 'transfer') recordedCategory = 'TRANSFER';
    else if (kind === 'personal') recordedCategory = 'PERSONAL';
    else {
      const mapped = reviewCategory(category);
      if (!mapped) throw new TransactionReviewError('INVALID_CATEGORY', 'Choose a supported category.');
      recordedCategory = mapped.recordedCategory;
      const cost = deduction === true ? vehicleCostShare(data, profileData, vehicles) : null;
      const separate = standardMileageSeparateCost(chargeText(data));
      const suggestionShare = finiteUsePercent(confirmedSuggestion?.deductiblePercent);
      const shareMatches = input.action === 'correct' || suggestionShare === cost?.share;
      if (mileageVehicleCopyEnabled() && deduction === true && separate && !cost) {
        throw new TransactionReviewError('DEDUCTION_REVIEW_REQUIRED', 'This category needs a separate tax method review. Save the category without claiming a deduction.');
      }
      if (deduction === true && cost && (cost.kind === 'loan_interest' || cost.kind === 'property_tax') && shareMatches) {
        recordedCategory = cost.kind === 'property_tax' ? VEHICLE_PROPERTY_TAX_CATEGORY : VEHICLE_LOAN_INTEREST_CATEGORY;
        savedShare = cost.share;
      } else if (deduction === true && recordedCategory.endsWith('_REVIEW_REQUIRED')) {
        if (cost?.kind === 'actual' && shareMatches) {
          recordedCategory = VEHICLE_ACTUAL_EXPENSE_CATEGORY;
          savedShare = cost.share;
        } else throw new TransactionReviewError('DEDUCTION_REVIEW_REQUIRED', 'This category needs a separate tax method review. Save the category without claiming a deduction.');
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
      ...(savedShare !== null ? { business_use_percentage: savedShare, deductible_percent: savedShare } : {}),
    };
    tx.update(ref, update);
    return hydrateReviewTransaction({ ...data, ...update }, id);
  });
  // A confirmed row is a new prior for this user's later AI analyses; drop the memoized history.
  invalidateTaxpayerContextCache(uid);
  return reviewed;
}
