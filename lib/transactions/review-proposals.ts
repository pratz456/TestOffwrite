/**
 * Client-safe helpers for the one-tap review flow. Everything here reads saved
 * analysis output; nothing decides tax treatment. The user's tap is the decision.
 */
import type { Transaction } from '@/lib/firebase/transactions';
import { learningMerchantKey } from '@/lib/ai/merchant-key';
import { reviewCategory, type AiReviewSuggestion, type ReviewCategory } from './ai-review-contract';
import { AI_PROPOSAL_CONFIRMED_REASON, AI_PROPOSAL_REJECTED_REASON } from './tax-decision';

/** Plain-language explanation saved on a transaction by the explanation writer. */
export interface AiExplanation {
  headline: string;
  why: string;
  yourFacts: string[];
  scheduleCLine: string;
  estimatedTaxEffect: string | null;
  strengthen: string[];
  nextQuestion: string | null;
}

/** Fields the analyzer may add to a saved suggestion; older suggestions lack them. */
type SuggestionWithProposal = AiReviewSuggestion & {
  proposed_purpose?: string | null; proposedPurpose?: string | null;
  schedule_c_line?: string | null; scheduleCLine?: string | null;
  missing_fields?: string[] | null; missingFields?: string[] | null;
};

/** Loose on purpose: the detail screen carries its own partial transaction shape. */
interface ReviewRecord {
  id?: string; trans_id?: string; merchant_name?: string; amount?: number; pending?: boolean | null; is_deductible?: boolean | null;
  business_purpose?: string | null; review_status?: string; category?: string;
  ai_suggestion?: AiReviewSuggestion | null; ai_missing_fields?: string[]; ai_customized_reason?: string | null; ai?: unknown;
}

const MAX_PURPOSE_LENGTH = 500;

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, MAX_PURPOSE_LENGTH) : null;
}

/** The AI's proposed business purpose, or its tailored reason when the suggestion predates `proposed_purpose`. */
export function proposedBusinessPurpose(transaction: ReviewRecord): string | null {
  const suggestion = transaction.ai_suggestion as SuggestionWithProposal | null | undefined;
  if (!suggestion) return null;
  return cleanText(suggestion.proposed_purpose) ?? cleanText(suggestion.proposedPurpose) ?? cleanText(transaction.ai_customized_reason);
}

export function suggestionScheduleCLine(transaction: ReviewRecord): string | null {
  const suggestion = transaction.ai_suggestion as SuggestionWithProposal | null | undefined;
  return cleanText(suggestion?.schedule_c_line) ?? cleanText(suggestion?.scheduleCLine);
}

/** Facts the last analysis asked for, wherever the analyzer saved them. */
export function suggestionMissingFields(transaction: ReviewRecord): string[] {
  const suggestion = transaction.ai_suggestion as SuggestionWithProposal | null | undefined;
  const legacy = transaction.ai && typeof transaction.ai === 'object' ? (transaction.ai as { missing_fields?: unknown }).missing_fields : undefined;
  const candidates = [suggestion?.missing_fields, suggestion?.missingFields, transaction.ai_missing_fields, legacy];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const fields = candidate.filter((field): field is string => typeof field === 'string' && field.trim() !== '');
      if (fields.length) return fields;
    }
  }
  return [];
}

/**
 * A deduction can be recorded through the update API only for a posted expense whose
 * suggested category does not need a separate tax-method review. Mirrors the server's
 * `taxDecisionUpdate` refusal so the chip never offers a tap that would fail.
 */
export function canRecordDeductionByTap(transaction: ReviewRecord): boolean {
  const suggestion = transaction.ai_suggestion;
  if (!suggestion || transaction.pending === true || !(Number(transaction.amount) > 0)) return false;
  if (suggestion.transactionKind !== 'expense') return false;
  if (typeof transaction.category === 'string' && transaction.category.endsWith('_REVIEW_REQUIRED')) return false;
  const category = reviewCategory(suggestion.category);
  if (suggestion.category && (!category || category.recordedCategory.endsWith('_REVIEW_REQUIRED'))) return false;
  return true;
}

/** Show the "Confirm purpose" chip: a proposal exists, no purpose is saved and the tap can record a deduction. */
export function canOfferPurposeConfirmation(transaction: ReviewRecord): boolean {
  if (transaction.is_deductible === false) return false;
  if (cleanText(transaction.business_purpose)) return false;
  return proposedBusinessPurpose(transaction) !== null && canRecordDeductionByTap(transaction);
}

/** Body for the existing PUT /api/transactions/[id]; the server stamps review_status/review_source/reviewed_at. */
export function confirmPurposeUpdates(purpose: string, proposal: string | null) {
  return {
    business_purpose: purpose.trim().slice(0, MAX_PURPOSE_LENGTH),
    is_deductible: true as const,
    expense_type: 'business' as const,
    user_classification_reason: proposal ? AI_PROPOSAL_CONFIRMED_REASON : 'business_purpose_entered_by_user',
  };
}

export function rejectProposalUpdates() {
  return { is_deductible: false as const, expense_type: 'personal' as const, user_classification_reason: AI_PROPOSAL_REJECTED_REASON };
}

export type OpenQuestionKind = 'business_purpose' | 'business_use_percentage' | 'meal_conditions' | 'settings_gate' | 'other';

export interface OpenQuestion { question: string; field: string | null; kind: OpenQuestionKind }

const SETTINGS_GATES = new Set(['supported_tax_year', 'entity_tax_treatment', 'business_entity_type', 'tax_year', 'profession', 'state']);

/** The first unanswered question with the fact it needs, so the UI can offer suggested answers. */
export function firstOpenQuestion(transaction: ReviewRecord): OpenQuestion | null {
  const question = transaction.ai_suggestion?.questions?.find(entry => typeof entry === 'string' && entry.trim());
  if (!question) return null;
  const field = suggestionMissingFields(transaction)[0] ?? null;
  const kind: OpenQuestionKind = field === 'business_purpose' ? 'business_purpose'
    : field === 'business_use_percentage' ? 'business_use_percentage'
    : field === 'meal_conditions' || field === 'attendees' ? 'meal_conditions'
    : field && SETTINGS_GATES.has(field) ? 'settings_gate' : 'other';
  return { question: question.trim(), field, kind };
}

/** The fact a question asks for is already saved on the record, so the chips can step aside. */
export function questionAnswered(transaction: Pick<Transaction, 'business_purpose' | 'equipment_details' | 'attendees'>, question: OpenQuestion): boolean {
  if (question.kind === 'business_purpose') return cleanText(transaction.business_purpose) !== null;
  if (question.kind === 'business_use_percentage') return typeof transaction.equipment_details?.business_use_percentage === 'number';
  if (question.kind === 'meal_conditions') return Array.isArray(transaction.attendees) && transaction.attendees.length > 0;
  return false;
}

export const BUSINESS_USE_CHOICES = [100, 75, 50, 25] as const;

/** Business-use percentage saves inside the allow-listed `equipment_details` map; keep its other fields. */
export function businessUseUpdates(transaction: Pick<Transaction, 'equipment_details'>, percentage: number) {
  return { equipment_details: { ...(transaction.equipment_details ?? {}), business_use_percentage: percentage } };
}

export function attendeesUpdates(raw: string) {
  const attendees = raw.split(/[,;\n]/).map(name => name.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 100).map(name => name.slice(0, 300));
  return attendees.length ? { attendees } : null;
}

/** Where the profile facts behind an entity or tax-year question live. */
export const TAX_SETTINGS_HREF = '/protected/settings?tab=tax';

export interface MerchantGroup {
  merchantKey: string;
  merchant: string;
  transactions: Transaction[];
  count: number;
  /** Sum of the charges in the group. */
  total: number;
  /** From any suggestion in the group, first one wins. */
  proposedPurpose: string | null;
  /** Set only when every suggestion in the group that names a category agrees. */
  category: ReviewCategory | null;
  categoryLabel: string | null;
  /** Charges a bulk business decision would leave for individual review (mirrors the server's skips). */
  needsIndividualReview: number;
}

function unreviewed(transaction: Transaction): boolean {
  return !transaction.review_status && typeof transaction.is_deductible !== 'boolean' && transaction.pending !== true;
}

/** A category only counts toward a group when the analysis read the charge as an expense. */
export function suggestedExpenseCategory(transaction: Pick<Transaction, 'ai_suggestion'>) {
  return transaction.ai_suggestion?.transactionKind === 'expense' ? reviewCategory(transaction.ai_suggestion.category) : undefined;
}

/** Same refusals as the bulk route for a business decision, minus the caller-chosen category. */
export function bulkDeductionBlocked(transaction: Pick<Transaction, 'ai_suggestion' | 'category' | 'transaction_kind'> & { ai_transaction_kind?: unknown }): boolean {
  const analysisKind = transaction.ai_suggestion?.transactionKind ?? (typeof transaction.ai_transaction_kind === 'string' ? transaction.ai_transaction_kind : undefined);
  if (analysisKind && ['income', 'transfer', 'personal', 'refund'].includes(analysisKind)) return true;
  if (transaction.transaction_kind && ['income', 'transfer', 'personal', 'refund'].includes(transaction.transaction_kind)) return true;
  return typeof transaction.category === 'string' && transaction.category.endsWith('_REVIEW_REQUIRED');
}

/** Unreviewed charges grouped by merchant key, most frequent merchant first. Credits and pending rows stay out. */
export function groupUnreviewedByMerchant(transactions: Transaction[]): MerchantGroup[] {
  const groups = new Map<string, MerchantGroup>();
  const disagreeing = new Set<string>();
  for (const transaction of transactions) {
    if (!unreviewed(transaction) || !(Number(transaction.amount) > 0)) continue;
    const merchantKey = learningMerchantKey(transaction);
    if (!merchantKey) continue;
    let group = groups.get(merchantKey);
    if (!group) {
      group = { merchantKey, merchant: transaction.merchant_name?.trim() || merchantKey, transactions: [], count: 0, total: 0,
        proposedPurpose: null, category: null, categoryLabel: null, needsIndividualReview: 0 };
      groups.set(merchantKey, group);
    }
    group.transactions.push(transaction);
    group.count += 1;
    group.total += transaction.amount;
    group.proposedPurpose ??= proposedBusinessPurpose(transaction);
    const category = suggestedExpenseCategory(transaction);
    if (category && !disagreeing.has(merchantKey)) {
      if (!group.category) { group.category = category.value; group.categoryLabel = category.label; }
      else if (group.category !== category.value) { disagreeing.add(merchantKey); group.category = null; group.categoryLabel = null; }
    }
    if (bulkDeductionBlocked(transaction)) group.needsIndividualReview += 1;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.total - a.total || a.merchant.localeCompare(b.merchant));
}

/** Group-level decision for POST /api/transactions/bulk-confirm. A category that needs its own tax review never travels. */
export function groupDecision(group: MerchantGroup, decision: 'business' | 'personal', purpose: string | null): BulkConfirmRequest {
  const category = decision === 'business' && group.category ? reviewCategory(group.category) : undefined;
  return { merchantKey: group.merchantKey, merchant: group.merchant, count: group.count, decision,
    businessPurpose: decision === 'business' ? cleanText(purpose) : null,
    category: category && !category.recordedCategory.endsWith('_REVIEW_REQUIRED') ? category.value : null };
}

/** Other unreviewed charges sharing this record's merchant key; the bulk offer needs at least two. */
export function similarUnreviewedCharges(transactions: Transaction[], transaction: Pick<Transaction, 'id' | 'trans_id' | 'merchant_name'>): Transaction[] {
  const merchantKey = learningMerchantKey(transaction);
  if (!merchantKey) return [];
  const id = transaction.trans_id || transaction.id;
  return transactions.filter(candidate => (candidate.trans_id || candidate.id) !== id && unreviewed(candidate) && learningMerchantKey(candidate) === merchantKey);
}

/** Body of POST /api/transactions/bulk-confirm plus the copy the offer needs. */
export interface BulkConfirmRequest {
  merchantKey: string;
  merchant: string;
  /** Other unreviewed charges from this merchant, not counting the one already decided. */
  count: number;
  decision: 'business' | 'personal';
  businessPurpose: string | null;
  /** Review category value, only when the decided record's category was itself reviewed. */
  category: ReviewCategory | null;
}

/** The bulk offer that follows a saved decision, or `null` when fewer than two similar charges wait. */
export function bulkOfferFor(saved: Transaction, transactions: Transaction[]): BulkConfirmRequest | null {
  if (typeof saved.is_deductible !== 'boolean' || !(Number(saved.amount) > 0)) return null;
  if (saved.transaction_kind && saved.transaction_kind !== 'expense' && saved.transaction_kind !== 'personal') return null;
  const merchantKey = learningMerchantKey(saved);
  if (!merchantKey) return null;
  const count = similarUnreviewedCharges(transactions, saved).length;
  if (count < 2) return null;
  const merchant = saved.merchant_name?.trim() || merchantKey;
  if (!saved.is_deductible) return { merchantKey, merchant, count, decision: 'personal', businessPurpose: null, category: null };
  // A category travels only after category review (the review route records the kind); a raw bank category never does.
  const category = saved.transaction_kind === 'expense' ? reviewCategory(saved.category) : undefined;
  return { merchantKey, merchant, count, decision: 'business', businessPurpose: cleanText(saved.business_purpose),
    category: category && !category.recordedCategory.endsWith('_REVIEW_REQUIRED') ? category.value : null };
}

/** Local copy of the stamps the bulk route writes, so confirmed rows leave the queue before the next snapshot. */
export function bulkConfirmedLocally(transaction: Transaction, offer: BulkConfirmRequest, reviewedAt: string): Transaction {
  const business = offer.decision === 'business';
  return {
    ...transaction,
    is_deductible: business, expense_type: business ? 'business' : 'personal',
    user_classification_reason: business ? AI_PROPOSAL_CONFIRMED_REASON : AI_PROPOSAL_REJECTED_REASON,
    ...(business && offer.businessPurpose ? { business_purpose: offer.businessPurpose } : {}),
    review_status: 'confirmed', reviewed_at: reviewedAt, tax_review_required: false,
    review_source: !business ? 'user_corrected' : transaction.ai_suggestion ? 'ai_confirmed' : 'user_decision',
  };
}

export function formatMoney(amount: number): string {
  return Number.isFinite(amount) ? `$${Math.abs(amount).toFixed(2)}` : 'Amount needs review';
}
