import { reviewTargetForCode, type DashboardTaxState } from '@/lib/tax/dashboard-snapshot';
import type { Transaction } from '@/lib/firebase/transactions';
import { transactionNeedsCategoryReview, transactionNeedsTaxReview } from '@/lib/utils/transaction-tax-review';
import { isSupersededRecord } from '@/lib/transactions/record-scope';
import { prioritizeTransactionReview } from '@/lib/transactions/review-priority';

export interface DashboardNextStep { id: string; title: string; detail: string; action: string;
  screen?: string; transaction?: Transaction; retry?: boolean }

/** At most three honest, actionable tasks, with blocked calculations ahead of routine review. */
export function dashboardNextSteps(records: Transaction[], taxState: DashboardTaxState): DashboardNextStep[] {
  const steps: DashboardNextStep[] = [];
  if (taxState.status === 'review') {
    const target = reviewTargetForCode(taxState.code);
    steps.push({ id: 'tax-inputs', title: 'Complete your tax estimate',
      detail: taxState.code === 'INCOME_RECONCILIATION_REQUIRED' ? 'Match overlapping income records before calculating tax.' : 'Resolve the flagged inputs to continue.',
      action: target.label, screen: target.screen });
  } else if (taxState.status === 'error') {
    steps.push({ id: 'tax-retry', title: 'Refresh your tax estimate', detail: 'The latest estimate could not load. Your records are saved.', action: 'Retry', retry: true });
  }
  const posted = prioritizeTransactionReview(records.filter(record => record.pending !== true && !isSupersededRecord(record) &&
    !['running'].includes(record.analysis_status || record.analysisStatus || '') &&
    !((record.analysis_status === 'pending' || record.analysisStatus === 'pending') && record.analysisJobId)));
  const questions = posted.filter(record => transactionNeedsTaxReview(record) &&
    (record.tax_review_required || record.ai_suggestion?.status === 'needs_more_info' || record.ai_suggestion?.status === 'blocked'));
  if (questions.length) steps.push({ id: 'facts', title: `${questions.length} ${questions.length === 1 ? 'transaction needs' : 'transactions need'} details`,
    detail: 'Answer missing facts first. AI updates the review after you save.', action: 'Answer', transaction: questions[0] });
  const categories = posted.filter(record => transactionNeedsCategoryReview(record) && !questions.includes(record));
  if (categories.length) steps.push({ id: 'categories', title: `Review ${categories.length} ${categories.length === 1 ? 'category' : 'categories'}`,
    detail: 'Confirm or correct your AI suggestions.', action: 'Review', screen: 'review-transactions' });
  if (!records.length) steps.push({ id: 'first-record', title: 'Add your first expense', detail: 'Start with a receipt or a business purchase.', action: 'Add', screen: 'add-manual-transaction' });
  return steps.slice(0, 3);
}
