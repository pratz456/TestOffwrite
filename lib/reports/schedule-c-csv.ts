import { aggregateScheduleC, CATEGORY_MAP, type LineItemSummary } from '@/lib/schedule-c/aggregate';
import { scheduleCExportLine } from '@/lib/schedule-c/export-lines';
import { csvCell } from './transaction-export';

/** Needs more information receipts held out of the export total. Same block position as flagged duplicate rows. */
export interface UnplacedReceipts {
  count: number;
  total: number;
}

export function unplacedExportCells(summary: UnplacedReceipts): string[] {
  return ['Needs more information', 'Unplaced receipts', String(summary.count), summary.total.toFixed(2), '/protected?screen=review-transactions'];
}

export function generateScheduleCCSV(lines: LineItemSummary[], taxYear: number, unplaced?: UnplacedReceipts): string {
  const headers = ['Tax date', 'Merchant', 'Recorded category', 'Schedule C planning reference', 'Signed amount', 'Confirmed contribution', 'Scope', 'Description'];
  const rows = lines.flatMap(line => line.transactions.map(tx => [tx.date, tx.merchant_name, tx.category,
    scheduleCExportLine(line.lineCode, taxYear), tx.amount,
    aggregateScheduleC([tx], String(taxYear), CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible,
    'Confirmed in app - preparer review required; not a complete Schedule C', tx.description ?? tx.deductible_reason ?? tx.notes ?? '',
  ]));
  const table = [headers, ...rows];
  if (unplaced && unplaced.count > 0) table.push(unplacedExportCells(unplaced));
  return table.map(row => row.map(csvCell).join(',')).join('\r\n');
}
