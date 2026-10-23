import { aggregateScheduleC, CATEGORY_MAP, type LineItemSummary, type ScheduleCTransactionLike } from '@/lib/schedule-c/aggregate';
import type { ScheduleCComparisonSection } from '@/lib/schedule-c/filed-year';
import { scheduleCExportLine } from '@/lib/schedule-c/export-lines';
import { csvCell } from './transaction-export';

export function generateScheduleCCSV(lines: LineItemSummary[], taxYear: number, options?: {
  contribution?: (tx: ScheduleCTransactionLike) => number;
  comparison?: ScheduleCComparisonSection | null;
}): string {
  const contributionOf = options?.contribution ?? ((tx: ScheduleCTransactionLike) => aggregateScheduleC([tx], String(taxYear), CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible);
  const headers = ['Tax date', 'Merchant', 'Recorded category', 'Schedule C planning reference', 'Signed amount', 'Confirmed contribution', 'Scope', 'Description'];
  const rows = lines.flatMap(line => line.transactions.map(tx => [tx.date, tx.merchant_name, tx.category,
    scheduleCExportLine(line.lineCode, taxYear), tx.amount,
    contributionOf(tx),
    'Confirmed in app - preparer review required; not a complete Schedule C', tx.description ?? tx.deductible_reason ?? tx.notes ?? '',
  ]));
  const body = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  const comparison = options?.comparison;
  if (!comparison) return body;
  const dollar = (change: number) => change < 0 ? `down ${Math.abs(change).toFixed(2)}` : change > 0 ? `up ${change.toFixed(2)}` : '0.00';
  const extra = [
    [],
    ['Comparison'],
    [comparison.notice],
    ['Line', 'Old total', 'New total', 'Dollar change'],
    ...comparison.lineChanges.map(row => [row.line, row.oldAmount.toFixed(2), row.newAmount.toFixed(2), dollar(row.change)]),
    ['Charge', 'Reason'],
    ...comparison.movedCharges.map(charge => [charge.id, charge.reason]),
  ];
  return `${body}\r\n${extra.map(row => row.map(cell => csvCell(cell)).join(',')).join('\r\n')}`;
}
