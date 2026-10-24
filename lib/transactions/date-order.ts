import { exportDate } from '@/lib/reports/transaction-export';

export type DateSortDirection = 'asc' | 'desc';

/**
 * Calendar-day order for transaction lists.
 * A blank or invalid date sorts after every dated row in both directions.
 */
export function compareTransactionDates(a: unknown, b: unknown, direction: DateSortDirection = 'asc'): number {
  const left = exportDate(a);
  const right = exportDate(b);
  if (left && right) {
    const order = left < right ? -1 : left > right ? 1 : 0;
    return direction === 'desc' ? -order : order;
  }
  if (left) return -1;
  if (right) return 1;
  return 0;
}
