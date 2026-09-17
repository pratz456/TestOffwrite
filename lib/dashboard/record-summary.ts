import { consolidateCategory } from '@/lib/utils';
import { transactionNeedsTaxReview } from '@/lib/utils/transaction-tax-review';

export interface DashboardRecord {
  amount?: number;
  category?: string;
  pending?: boolean;
  is_deductible?: boolean | null;
  tax_review_required?: boolean;
  review_status?: string;
  created_at?: unknown;
  date?: unknown;
  user_classification_reason?: string;
  iso_currency_code?: string;
  unofficial_currency_code?: string;
}

export function dashboardRecordStatus(record: DashboardRecord) {
  if (record.pending === true) return 'pending';
  const category = typeof record.category === 'string' ? record.category.toLowerCase() : '';
  if (category === 'income' || category === 'revenue') return 'income';
  if (record.tax_review_required === true) return 'review';
  if (record.is_deductible === true) return transactionNeedsTaxReview(record) ? 'review' : 'deductible';
  if (record.is_deductible === false) return 'personal';
  return transactionNeedsTaxReview(record) ? 'review' : 'skipped';
}

/** All-date record overview, not deductions after tax limits or a tax-savings calculation. */
export function summarizeDashboardRecords(records: readonly DashboardRecord[]) {
  const marked = records.filter(record => dashboardRecordStatus(record) === 'deductible');
  const categories = new Map<string, number>();
  let categoryIssue: string | null = null;
  for (const record of marked) {
    if (typeof record.amount !== 'number' || !Number.isFinite(record.amount)
      || !Number.isSafeInteger(Math.round(record.amount * 100))) {
      categoryIssue = 'Review recorded amounts before showing category totals.';
      break;
    }
    if (record.iso_currency_code !== 'USD' || record.unofficial_currency_code) {
      categoryIssue = 'Category totals need records with a confirmed USD currency. Review missing or other currencies.';
      break;
    }
    const category = consolidateCategory(record.category || 'Uncategorized').consolidatedName;
    const cents = (categories.get(category) || 0) + Math.round(record.amount * 100);
    if (!Number.isSafeInteger(cents)) {
      categoryIssue = 'Review recorded amounts before showing category totals.';
      break;
    }
    categories.set(category, cents);
  }
  const categoryEntries: [string, number][] = categoryIssue ? []
    : [...categories].map(([category, cents]): [string, number] => [category, cents / 100]).sort((a, b) => b[1] - a[1]);
  return {
    deductibleCount: marked.length,
    pendingCount: records.filter(record => dashboardRecordStatus(record) === 'pending').length,
    needsReviewCount: records.filter(record => dashboardRecordStatus(record) === 'review').length,
    categoryEntries,
    categoryMagnitude: categoryEntries.reduce((total, [, amount]) => total + Math.abs(amount), 0),
    categoryIssue,
  };
}
