import { aggregateScheduleC, CATEGORY_MAP, type FuelSummary, type LineItemSummary, type PossibleRefund, type ScheduleCTransactionLike } from '@/lib/schedule-c/aggregate';
import { scheduleCLineCsvCell } from '@/lib/schedule-c/export-lines';
import { csvCell } from './transaction-export';

export interface ScheduleCCsvExtras {
  fuelSummaries?: FuelSummary[];
  possibleRefunds?: PossibleRefund[];
  refundNotice?: string | null;
  exportNotes?: string[];
}

export function generateScheduleCCSV(lines: LineItemSummary[], taxYear: number, needsMoreInformation: ScheduleCTransactionLike[] = [], extras: ScheduleCCsvExtras = {}): string {
  const headers = ['Tax date', 'Merchant', 'Recorded category', 'Schedule C planning reference', 'Signed amount', 'Confirmed contribution', 'Scope', 'Description'];
  const rows = lines.flatMap(line => line.transactions.map(tx => {
    const included = tx.fuelIncludedInSummary === true;
    const contribution = included ? 0 : typeof tx.confirmedContribution === 'number' ? tx.confirmedContribution : aggregateScheduleC([tx], String(taxYear), CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible;
    const scope = included
      ? 'Included in the fuel summary. Confirmed in app - preparer review required; not a complete Schedule C'
      : 'Confirmed in app - preparer review required; not a complete Schedule C';
    return [tx.date, tx.merchant_name, tx.category, included ? '' : scheduleCLineCsvCell(line.lineCode, taxYear), tx.amount, contribution, scope, tx.description ?? tx.deductible_reason ?? tx.notes ?? ''];
  }));
  for (const summary of extras.fuelSummaries ?? []) {
    if (summary.disposition === 'zero') {
      for (const tx of summary.charges) {
        rows.push([tx.date, tx.merchant_name, tx.category, '', tx.amount, 0, 'Included in the fuel summary', tx.description ?? tx.notes ?? '']);
      }
    }
    const percentage = summary.percentage === null ? 'not recorded' : `${summary.percentage}%`;
    const description = `Fuel total ${summary.total.toFixed(2)}. Percentage ${percentage}. Business share ${summary.businessShare.toFixed(2)}.${summary.note ? ` ${summary.note}` : ''}`;
    rows.push(['', summary.vehicleKey, 'FUEL_SUMMARY', summary.disposition === 'line' ? scheduleCLineCsvCell('9', taxYear) : '', summary.businessShare, summary.businessShare, 'Fuel summary', description]);
  }
  // Withheld rows are not a Schedule C line. The planning reference stays blank and the contribution stays 0.
  for (const tx of needsMoreInformation) {
    rows.push([tx.date, tx.merchant_name, tx.category, '', tx.amount, 0, 'Needs more information', tx.description ?? tx.deductible_reason ?? tx.notes ?? '']);
  }
  for (const refund of extras.possibleRefunds ?? []) {
    rows.push([refund.date, refund.merchant, refund.category, '', refund.amount, 0, 'Possible refund', '']);
  }
  if (extras.refundNotice) rows.push(['', '', '', '', extras.possibleRefunds?.reduce((sum, row) => sum + row.amount, 0) ?? 0, 0, 'Possible refunds', extras.refundNotice]);
  for (const note of extras.exportNotes ?? []) rows.push(['', '', '', '', '', '', 'Export note', note]);
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}
