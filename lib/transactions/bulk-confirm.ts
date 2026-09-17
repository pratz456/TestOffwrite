/**
 * Bulk confirmation for similar charges: the owner's explicit decision about one
 * merchant, applied to their other unreviewed charges from that merchant.
 *
 * Rows are read only under `user_profiles/{uid}` and through the owner-filtered
 * legacy root collection, so a caller can never reach another account. Every
 * write carries the same server stamps as the single update route
 * (`taxDecisionUpdate`): `review_status`, `review_source`, `reviewed_at`.
 * Nothing here decides tax treatment; the user's tap is the decision.
 */
import { z } from 'zod';
import type { DocumentReference, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { aiLearningEngine } from '@/lib/ai/learning-engine';
import { learningMerchantKey } from '@/lib/ai/merchant-key';
import { invalidateTaxpayerContextCache } from '@/lib/ai/taxpayer-context-server';
import { reviewCategory } from './ai-review-contract';
import { recordTimestampMs } from './confirmed-deduction';
import { AI_PROPOSAL_CONFIRMED_REASON, AI_PROPOSAL_REJECTED_REASON, taxDecisionUpdate } from './tax-decision';

/** Matching charges beyond this many are left for a second call; the response says `truncated: true`. */
export const BULK_CONFIRM_MAX_TRANSACTIONS = 200;
/** Firestore accepts 500 writes per batch; stay well under it. */
export const BULK_CONFIRM_BATCH_SIZE = 400;
const MAX_PURPOSE_LENGTH = 500;

export const bulkConfirmInput = z.object({
  merchantKey: z.string().trim().min(1).max(500),
  decision: z.enum(['business', 'personal']),
  businessPurpose: z.string().trim().max(MAX_PURPOSE_LENGTH).optional(),
  category: z.string().trim().min(1).max(200).optional(),
}).strict().refine(value => value.decision === 'business' || (value.category === undefined && value.businessPurpose === undefined),
  'A business purpose and category apply to business decisions only');

export type BulkConfirmInput = z.infer<typeof bulkConfirmInput>;

export class BulkConfirmError extends Error {
  constructor(readonly code: string, message: string, readonly status = 422) { super(message); }
}

export interface BulkConfirmResult {
  merchantKey: string;
  updated: number;
  /** Matching charges left untouched because this route cannot record a deduction for them. */
  skipped: number;
  truncated: boolean;
  /** `trans_id` of every stamped row, so a client can update its local copies without a re-read. */
  transactionIds: string[];
}

interface Candidate { ref: DocumentReference; id: string; data: Record<string, any> }

/** Fields the decision, its stamps and the learning correction read. */
const CANDIDATE_FIELDS = ['trans_id', 'account_id', 'accountId', 'userId', 'user_id', 'merchant_name', 'merchant', 'name', 'amount', 'date',
  'category', 'transaction_kind', 'ai_transaction_kind', 'pending', 'bank_removed', 'superseded_by', 'review_status', 'is_deductible',
  'ai_suggestion', 'deduction_score', 'mcc', 'location'];

const NON_EXPENSE_KINDS = new Set(['income', 'transfer', 'personal', 'refund']);

function ownedBy(data: Record<string, any>, uid: string): boolean {
  return [data.userId, data.user_id].every(value => value == null || value === uid);
}

/** An owner's posted, still-present charge from this merchant with no saved decision. */
function isCandidate(data: Record<string, any>, uid: string, merchantKey: string): boolean {
  if (!ownedBy(data, uid)) return false;
  if (data.review_status || typeof data.is_deductible === 'boolean') return false;
  if (data.pending === true || data.bank_removed === true || data.superseded_by) return false;
  if (!(Number(data.amount) > 0)) return false;
  return learningMerchantKey(data) === merchantKey;
}

async function loadCandidates(uid: string, merchantKey: string): Promise<Candidate[]> {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const consider = (docs: QueryDocumentSnapshot[]) => {
    for (const doc of docs) {
      const data = doc.data() ?? {};
      const id = String(data.trans_id || doc.id);
      const key = `${data.account_id || data.accountId || ''}::${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (isCandidate(data, uid, merchantKey)) candidates.push({ ref: doc.ref, id, data });
    }
  };
  const accounts = await adminDb.collection('user_profiles').doc(uid).collection('accounts').get();
  const perAccount = await Promise.all(accounts.docs.map(account => account.ref.collection('transactions').select(...CANDIDATE_FIELDS).get()));
  for (const snapshot of perAccount) consider(snapshot.docs);
  // Legacy root rows are reachable only through their owner field, never by merchant alone.
  for (const ownerField of ['userId', 'user_id'] as const) {
    consider((await adminDb.collection('transactions').where(ownerField, '==', uid).select(...CANDIDATE_FIELDS).get()).docs);
  }
  return candidates.sort((a, b) => (recordTimestampMs(b.data.date) ?? 0) - (recordTimestampMs(a.data.date) ?? 0));
}

function analysisKind(data: Record<string, any>): string | undefined {
  const suggested = data.ai_suggestion && typeof data.ai_suggestion === 'object' ? (data.ai_suggestion as { transactionKind?: unknown }).transactionKind : undefined;
  return typeof suggested === 'string' ? suggested : typeof data.ai_transaction_kind === 'string' ? data.ai_transaction_kind : undefined;
}

/** Apply one decision to the caller's unreviewed charges from a merchant. Throws `BulkConfirmError` for rejected input. */
export async function bulkConfirmMerchant(uid: string, input: BulkConfirmInput, now: Date = new Date()): Promise<BulkConfirmResult> {
  const merchantKey = learningMerchantKey({ merchant: input.merchantKey });
  if (!merchantKey) throw new BulkConfirmError('INVALID_MERCHANT', 'Provide the merchant these charges came from.', 400);
  const category = input.category === undefined ? null : reviewCategory(input.category) ?? null;
  if (input.category !== undefined && !category) throw new BulkConfirmError('INVALID_CATEGORY', 'Choose a supported category.', 400);
  if (category && category.recordedCategory.endsWith('_REVIEW_REQUIRED')) {
    throw new BulkConfirmError('DEDUCTION_REVIEW_REQUIRED', 'This category needs a separate tax method review. Confirm each charge on its own.');
  }

  const business = input.decision === 'business';
  const purpose = business ? input.businessPurpose?.replace(/\s+/g, ' ').trim() : '';
  const decision = business
    ? { is_deductible: true as const, expense_type: 'business' as const, user_classification_reason: AI_PROPOSAL_CONFIRMED_REASON,
        ...(purpose ? { business_purpose: purpose } : {}),
        ...(category ? { category: category.recordedCategory, transaction_kind: 'expense' as const } : {}) }
    : { is_deductible: false as const, expense_type: 'personal' as const, user_classification_reason: AI_PROPOSAL_REJECTED_REASON };

  const matches = await loadCandidates(uid, merchantKey);
  const truncated = matches.length > BULK_CONFIRM_MAX_TRANSACTIONS;
  const candidates = matches.slice(0, BULK_CONFIRM_MAX_TRANSACTIONS);

  let updated = 0;
  let skipped = 0;
  const transactionIds: string[] = [];
  let representative: Candidate | null = null;
  let batch = adminDb.batch();
  let pendingWrites = 0;
  const commit = async () => {
    if (!pendingWrites) return;
    await batch.commit();
    batch = adminDb.batch();
    pendingWrites = 0;
  };

  for (const candidate of candidates) {
    let stamps: ReturnType<typeof taxDecisionUpdate>;
    try {
      // A charge the analysis read as income, a transfer, a refund or personal is never a bulk deduction.
      if (business && NON_EXPENSE_KINDS.has(analysisKind(candidate.data) ?? '')) throw new Error('not an expense');
      // The saved kind still governs; only the category the caller chose replaces the saved one.
      stamps = taxDecisionUpdate({ ...candidate.data, ...(category ? { category: category.recordedCategory } : {}) }, decision, now);
    } catch {
      skipped += 1;
      continue;
    }
    batch.update(candidate.ref, { ...decision, ...stamps, updated_at: now });
    pendingWrites += 1;
    updated += 1;
    transactionIds.push(candidate.id);
    representative ??= candidate;
    if (pendingWrites >= BULK_CONFIRM_BATCH_SIZE) await commit();
  }
  await commit();

  if (representative) {
    // One correction per merchant pattern; the engine only keeps context for later analyses.
    try {
      const suggestion = representative.data.ai_suggestion && typeof representative.data.ai_suggestion === 'object'
        ? representative.data.ai_suggestion as { isDeductible?: boolean | null; reasoning?: string } : null;
      await aiLearningEngine.recordCorrection(uid, representative.id,
        { merchant_name: representative.data.merchant_name || representative.data.merchant || representative.data.name, category: representative.data.category,
          amount: representative.data.amount, date: representative.data.date, mcc: representative.data.mcc, location: representative.data.location },
        { is_deductible: suggestion?.isDeductible ?? null, confidence: representative.data.deduction_score ?? 0, reasoning: suggestion?.reasoning },
        { isDeductible: business, reasoning: purpose || decision.user_classification_reason });
    } catch (error) {
      console.warn('[bulk-confirm] learning correction was not recorded', error instanceof Error ? error.message : error);
    }
    // Confirmed rows are new priors for this user's later analyses.
    invalidateTaxpayerContextCache(uid);
  }

  return { merchantKey, updated, skipped, truncated, transactionIds };
}
