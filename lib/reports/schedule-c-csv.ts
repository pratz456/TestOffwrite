import { aggregateScheduleC, CATEGORY_MAP, type LineItemSummary, type ScheduleCTransactionLike } from '@/lib/schedule-c/aggregate';
import { scheduleCExportLine } from '@/lib/schedule-c/export-lines';
import { csvCell } from './transaction-export';

export function generateScheduleCCSV(lines: LineItemSummary[], taxYear: number, needsMoreInformation: readonly ScheduleCTransactionLike[] = []): string {
  const headers = ['Tax date', 'Merchant', 'Recorded category', 'Schedule C planning reference', 'Signed amount', 'Confirmed contribution', 'Scope', 'Description'];
  const rows = lines.flatMap(line => line.transactions.map(tx => [tx.date, tx.merchant_name, tx.category,
    scheduleCExportLine(line.lineCode, taxYear), tx.amount,
    aggregateScheduleC([tx], String(taxYear), CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible,
    'Confirmed in app - preparer review required; not a complete Schedule C', tx.description ?? tx.deductible_reason ?? tx.notes ?? '',
  ]));
  // Left-out charges follow every line row. The date cell stays blank and the contribution cell stays empty so they add into no total.
  const omitted = needsMoreInformation.map(tx => ['', tx.merchant_name ?? '', tx.category ?? '', 'Needs more information', tx.amount, '', '', tx.description ?? tx.deductible_reason ?? tx.notes ?? '']);
  return [headers, ...rows, ...omitted].map(row => row.map(csvCell).join(',')).join('\r\n');
}
