import { aggregateScheduleC, CATEGORY_MAP, type LineItemSummary, type ScheduleCTransactionLike } from '@/lib/schedule-c/aggregate';
import { scheduleCLineCsvCell } from '@/lib/schedule-c/export-lines';
import { csvCell } from './transaction-export';

export function generateScheduleCCSV(lines: LineItemSummary[], taxYear: number, needsMoreInformation: ScheduleCTransactionLike[] = []): string {
  const headers = ['Tax date', 'Merchant', 'Recorded category', 'Schedule C planning reference', 'Signed amount', 'Confirmed contribution', 'Scope', 'Description'];
  const rows = lines.flatMap(line => line.transactions.map(tx => [tx.date, tx.merchant_name, tx.category,
    scheduleCLineCsvCell(line.lineCode, taxYear), tx.amount,
    aggregateScheduleC([tx], String(taxYear), CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible,
    'Confirmed in app - preparer review required; not a complete Schedule C',
    [tx.description ?? tx.deductible_reason ?? tx.notes ?? '', tx.schedule_c_export_note].filter(Boolean).join(' '),
  ]));
  // Withheld rows are not a Schedule C line. The planning reference stays blank and the contribution stays 0.
  for (const tx of needsMoreInformation) {
    rows.push([tx.date, tx.merchant_name, tx.category, '', tx.amount, 0, 'Needs more information', tx.description ?? tx.deductible_reason ?? tx.notes ?? '']);
  }
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}
