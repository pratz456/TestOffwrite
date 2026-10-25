import { aggregateScheduleC, CATEGORY_MAP, type LineItemSummary } from '@/lib/schedule-c/aggregate';
import { scheduleCExportLine } from '@/lib/schedule-c/export-lines';
import { csvCell, type DateNeededSummary } from './transaction-export';

export function generateScheduleCCSV(lines: LineItemSummary[], taxYear: number, dateNeeded?: DateNeededSummary, yearTotal?: number): string {
  const headers = ['Tax date', 'Merchant', 'Recorded category', 'Schedule C planning reference', 'Signed amount', 'Confirmed contribution', 'Scope', 'Description'];
  const rows = lines.flatMap(line => line.transactions.map(tx => [tx.date, tx.merchant_name, tx.category,
    scheduleCExportLine(line.lineCode, taxYear), tx.amount,
    aggregateScheduleC([tx], String(taxYear), CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible,
    'Confirmed in app - preparer review required; not a complete Schedule C', tx.description ?? tx.deductible_reason ?? tx.notes ?? '',
  ]));
  const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  if (!dateNeeded) return csv;
  const total = yearTotal ?? lines.reduce((sum, line) => sum + line.deductible, 0);
  const summary = ['Year total', '', '', '', total.toFixed(2), '', '', dateNeeded.label];
  const needed = dateNeeded.rows.map(row => ['', row.merchant, '', '', row.amount === null ? '' : row.amount.toFixed(2), '', 'Date needed', row.exportReference]);
  return [csv, summary.map(csvCell).join(','), ...needed.map(row => row.map(csvCell).join(','))].join('\r\n');
}
