import { aggregateScheduleC, categoryMapForTaxYear, UNREADABLE_DATE_REVIEW, type LineItemSummary, type ScheduleCTransactionLike } from '@/lib/schedule-c/aggregate';
import { resolveOtherExpensesYear } from '@/lib/schedule-c/other-expenses-line';
import { scheduleCExportLine } from '@/lib/schedule-c/export-lines';
import { csvCell } from './transaction-export';

export function generateScheduleCCSV(lines: LineItemSummary[], taxYear: number, unreadableDates: readonly ScheduleCTransactionLike[] = []): string {
  const headers = ['Tax date', 'Merchant', 'Recorded category', 'Schedule C planning reference', 'Signed amount', 'Confirmed contribution', 'Scope', 'Description'];
  const scope = 'Confirmed in app - preparer review required; not a complete Schedule C';
  const rows = lines.flatMap(line => line.transactions.map(tx => [tx.date, tx.merchant_name, tx.category,
    scheduleCExportLine(line.lineCode, taxYear), tx.amount,
    aggregateScheduleC([tx], String(taxYear), categoryMapForTaxYear(resolveOtherExpensesYear(tx)), { mode: 'confirmed-only' }).totalDeductible,
    scope, tx.description ?? tx.deductible_reason ?? tx.notes ?? '',
  ]));
  const flagged = unreadableDates.map(tx => [tx.date, tx.merchant_name, tx.category, '', tx.amount, '', scope, UNREADABLE_DATE_REVIEW]);
  return [headers, ...rows, ...flagged].map(row => row.map(csvCell).join(',')).join('\r\n');
}
