import { transactionNeedsCategoryReview, transactionNeedsTaxReview } from '@/lib/utils/transaction-tax-review';
import { isSupersededRecord } from './record-scope';

type ReviewRecord = Parameters<typeof transactionNeedsTaxReview>[0] & {
  amount?: number; pending?: boolean | null; analysisStatus?: string; analysis_status?: string; analysisJobId?: string | null;
  ai_suggestion?: { status?: string; questions?: string[] } | null; superseded_by?: string | null;
};

/** Put answerable blockers first; a large bank charge is never represented as a tax-saving amount. */
export function reviewPriority(record: ReviewRecord): number {
  if (isSupersededRecord(record) || record.pending === true) return 6;
  if (!transactionNeedsCategoryReview(record) && !transactionNeedsTaxReview(record)) return 5;
  const status = record.analysis_status || record.analysisStatus;
  if (status === 'running' || status === 'pending' && record.analysisJobId) return 4;
  if (record.tax_review_required || record.ai_suggestion?.status === 'needs_more_info' || record.ai_suggestion?.status === 'blocked') return 0;
  if (status === 'failed') return 1;
  if (!record.ai_suggestion) return 2;
  return 3;
}

export function prioritizeTransactionReview<T extends ReviewRecord>(records: readonly T[]): T[] {
  return records.map((record, index) => ({ record, index })).sort((a, b) => {
    const priority = reviewPriority(a.record) - reviewPriority(b.record);
    if (priority) return priority;
    const magnitude = (record: T) => typeof record.amount === 'number' && Number.isFinite(record.amount) ? Math.abs(record.amount) : 0;
    return magnitude(b.record) - magnitude(a.record) || a.index - b.index;
  }).map(entry => entry.record);
}
