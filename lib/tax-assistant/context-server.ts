import { getAnalysisProfile } from '@/lib/ai/profile-context';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { ASSISTANT_TRANSACTION_LIMIT, assistantProfileFacts, mentionedMerchantFacts, merchantCandidates, type AssistantContext } from './context';

/** Fields the merchant aggregate and the review flag need; identity fields are always projected. */
const TRANSACTION_FIELDS = [
  'merchant_name', 'merchant', 'name', 'amount', 'date', 'type', 'pending', 'is_deductible', 'user_classification_reason',
  'review_status', 'review_source', 'review_suggestion_id', 'reviewed_at', 'tax_review_required', 'ai_suggestion', 'created_at',
];

/**
 * Best-effort, owner-scoped and bounded. The profile read always runs; the transaction read runs
 * only when the question names something that could be a merchant, and reads the owner's newest
 * ASSISTANT_TRANSACTION_LIMIT rows through the existing reader. Any failure yields partial context,
 * never an error for the user.
 */
export async function loadAssistantContext(uid: string, message: string, taxYear: number): Promise<AssistantContext> {
  const [profileResult, rows] = await Promise.all([
    getAnalysisProfile(uid).catch(() => ({ data: null })),
    merchantCandidates(message).length
      ? getTransactionsServer(uid, { limit: ASSISTANT_TRANSACTION_LIMIT, fields: TRANSACTION_FIELDS }).then(result => result.data ?? []).catch(() => [])
      : Promise.resolve([]),
  ]);
  const profile = assistantProfileFacts((profileResult?.data as Record<string, unknown> | null) ?? null);
  return { profile, merchant: rows.length ? mentionedMerchantFacts({ message, rows, taxYear, uid }) : null };
}
