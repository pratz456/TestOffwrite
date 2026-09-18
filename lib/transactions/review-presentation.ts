import type { Transaction } from '@/lib/firebase/transactions';
import { analysisOutcomeLabel, analysisRecordState } from '@/lib/ai/analysis-state';
import { canConfirmSuggestion, reviewCategory, type AiReviewSuggestion } from './ai-review-contract';

export function transactionReviewKey(transaction: Pick<Transaction, 'id' | 'trans_id' | 'account_id' | 'accountId'>): string {
  return `${transaction.account_id || transaction.accountId || ''}:${transaction.trans_id || transaction.id}`;
}

/** Never promote legacy prose or a bank category into a model-produced suggestion. */
export function reviewPresentation(transaction: Transaction) {
  const suggestion = transaction.ai_suggestion;
  const running = transaction.analysisStatus === 'running' || transaction.analysis_status === 'running';
  const queued = !!transaction.analysisJobId && (transaction.analysisStatus === 'pending' || transaction.analysis_status === 'pending');
  const pending = transaction.pending === true;
  const category = reviewCategory(suggestion?.category);
  const kindLabel = suggestion?.transactionKind === 'income' ? 'Business income'
    : suggestion?.transactionKind === 'personal' ? 'Personal purchase'
    : suggestion?.transactionKind === 'transfer' ? 'Transfer / card payment'
    : suggestion?.transactionKind === 'refund' ? 'Expense refund' : null;
  const needsTaxFacts = !!suggestion && (suggestion.status !== 'ok' || suggestion.isDeductible === null);
  const sources = (suggestion?.sources ?? []).filter(isOfficialTaxSource);
  // Why the durable pipeline stopped without a suggestion; null while queued, running or analyzed.
  const outcome = analysisRecordState(transaction).outcome;
  return {
    label: pending ? 'Waiting for the bank to post' : running ? 'AI analysis in progress'
      : queued ? 'Queued for AI analysis' : suggestion ? needsTaxFacts ? 'AI category · tax details needed' : 'AI suggested category'
      : outcome ? analysisOutcomeLabel(outcome) : 'No AI suggestion yet',
    categoryLabel: kindLabel ?? category?.label ?? 'Category needs review',
    reasoning: pending ? 'The bank can still change this transaction. Review it once the final amount posts.'
      : suggestion?.reasoning || (running ? 'AI is reviewing the saved transaction and your business context.'
        : 'AI has not provided a current suggestion. Run analysis or choose the category yourself.'),
    confirmationHint: pending ? 'Confirmation is available after this transaction posts.'
      : running ? 'Wait for the latest suggestion before confirming.'
      : queued ? 'The latest categorization is queued for analysis.'
      : !canConfirmSuggestion(suggestion) ? 'Choose a category yourself or add the missing details before confirming.'
      : needsTaxFacts ? 'Confirming saves the category only. The tax deduction stays unresolved until the missing facts are reviewed.' : '',
    needsTaxFacts,
    outcome,
    taxYear: Number.isInteger(suggestion?.taxYear) ? suggestion!.taxYear : null,
    questions: suggestion?.questions?.filter(question => typeof question === 'string' && question.trim()) ?? [],
    documentation: suggestion?.documentationRequired?.filter(item => typeof item === 'string' && item.trim()) ?? [],
    sources,
  };
}

function isOfficialTaxSource(source: AiReviewSuggestion['sources'][number]): boolean {
  try {
    const url = new URL(source.url);
    return !!source.title && url.protocol === 'https:' && !url.username && !url.password &&
      ['irs.gov', 'www.irs.gov', 'uscode.house.gov', 'www.govinfo.gov', 'govinfo.gov'].includes(url.hostname);
  } catch { return false; }
}
