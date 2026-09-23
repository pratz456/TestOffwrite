import { exportDate } from '@/lib/reports/transaction-export';
import { isCountableRecord } from '@/lib/transactions/record-scope';

/** Posted cash movement, never taxable income or deduction totals. */
export function summarizeRecordedCashFlow(records: readonly Record<string, unknown>[], year: number) {
  const months = Array.from({ length: 12 }, () => ({ income: 0, expenses: 0, net: 0 }));
  const seen = new Set<string>();
  let reviewMessage: string | null = null;
  for (const record of records) {
    if (!isCountableRecord(record)) continue;
    const date = exportDate(record.date ?? record.datetime);
    if (!date) { reviewMessage = 'Review missing or invalid dates before showing cash flow.'; continue; }
    if (Number(date.slice(0, 4)) !== year) continue;
    const identity = record.trans_id ?? record.id;
    if (typeof identity === 'string' && identity) {
      if (seen.has(identity)) reviewMessage = 'Reconcile duplicate transaction references before showing cash flow.';
      seen.add(identity);
    }
    const amount = record.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount * 100))) {
      reviewMessage = 'Review invalid amounts before showing cash flow.'; continue;
    }
    if (record.iso_currency_code !== 'USD' || record.unofficial_currency_code) {
      reviewMessage = 'Review missing or non-USD currencies before showing cash flow.'; continue;
    }
    const bucket = months[Number(date.slice(5, 7)) - 1];
    const cents = Math.round(amount * 100);
    if (cents > 0) bucket.expenses += cents;
    else bucket.income -= cents;
    bucket.net -= cents;
    if (![bucket.expenses, bucket.income, bucket.net].every(Number.isSafeInteger)) reviewMessage = 'Review transaction amounts before showing cash flow.';
  }
  return { reviewMessage, months: reviewMessage ? [] : months.map(month => ({ income: month.income / 100, expenses: month.expenses / 100, net: month.net / 100 })) };
}
