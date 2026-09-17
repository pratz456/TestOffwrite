import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { isSupersededRecord } from '@/lib/transactions/record-scope';
import { exportDate, transactionAmount, selectExportYear, recordedDeductibility, ExportReviewRequiredError, type ExportRecord } from './transaction-export';

export function preparerMonthlySummary(records: ExportRecord[], year: number) {
  // Superseded duplicates of an earlier bank record are not part of the handoff totals.
  const selected = selectExportYear(records.filter(record => !isSupersededRecord(record)), year);
  if (selected.some(record => transactionAmount(record) === null)) throw new ExportReviewRequiredError('Some saved amounts are invalid. Correct them or download all records for review.');
  const seen = new Set<string>();
  for (const record of selected) {
    const id = record.trans_id ?? record.transaction_id;
    if (!id) continue;
    const key = `${record.account_id ?? record.accountId ?? ''}/${id}`;
    if (seen.has(key)) throw new ExportReviewRequiredError('Duplicate transaction references need reconciliation before generating a monthly summary. Download the transaction CSV for review.');
    seen.add(key);
  }
  const groups = new Map<string, { outflow: number; inflow: number; markedOutflow: number; count: number }[]>();
  for (const record of selected) {
    const currency = String(record.iso_currency_code ?? record.unofficial_currency_code ?? 'Currency not recorded');
    if (!groups.has(currency)) groups.set(currency, Array.from({ length: 12 }, () => ({ outflow: 0, inflow: 0, markedOutflow: 0, count: 0 })));
    if (record.pending === true) continue;
    const month = Number(exportDate(record.date ?? record.datetime)!.slice(5, 7)) - 1;
    const row = groups.get(currency)![month], cents = Math.round(transactionAmount(record)! * 100);
    row.count++;
    if (cents > 0) { row.outflow += cents; if (recordedDeductibility(record) === true) row.markedOutflow += cents; }
    if (cents < 0) row.inflow += -cents;
  }
  if (!groups.size) groups.set('Currency not recorded', Array.from({ length: 12 }, () => ({ outflow: 0, inflow: 0, markedOutflow: 0, count: 0 })));
  return { year, count: selected.length, pending: selected.filter(tx => tx.pending === true).length,
    unreviewed: selected.filter(tx => recordedDeductibility(tx) === null).length, groups };
}

export async function generatePreparerReport(records: ExportRecord[], year: number): Promise<Uint8Array> {
  const summary = preparerMonthlySummary(records, year);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`WriteOff ${year} - preparer transaction summary`);
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const textSafe = (value: string) => value.replace(/[^\x20-\x7e]/g, '?');
  for (const [currency, months] of summary.groups) {
    const page = pdf.addPage([612, 792]);
    const text = (value: string, y: number, size = 10, strong = false, x = 42) => page.drawText(textSafe(value), { x, y, size, font: strong ? bold : font, color: rgb(.12, .16, .20) });
    text(`WRITE OFF | ${year} PREPARER HANDOFF`, 747, 17, true);
    text('Recorded transaction summary - not an official tax return', 723, 11, true);
    text(`Generated ${new Date().toISOString().slice(0, 10)} | Selected calendar year ${year}`, 701);
    text(`Currency group: ${currency.slice(0, 65)}`, 680, 11, true);
    text(`${summary.count} records in selected year; ${summary.pending} pending; ${summary.unreviewed} unreviewed.`, 657);
    const notes = [
      'Posted records only appear in the monthly amounts below. Pending records remain in CSV.',
      'Outflows and inflows preserve cash direction. Transfers, refunds and taxable income',
      'must be reconciled by your preparer; cash inflows are not automatically revenue.',
      'Marked outflow = positive amount saved as deductible. It is NOT a filing deduction:',
      'meal limits, business-use allocation, depreciation and eligibility are not applied here.',
      'No tax savings, refund, return completeness or filing status is certified by this report.',
      'Download the transaction CSV and account archive for categories, notes and tax records.',
      'Receipt images are not attached. Private receipt links require authorized sign-in.',
    ];
    notes.forEach((note, index) => text(note, 628 - index * 15, 9));
    const columns = [42, 118, 229, 340, 491];
    ['Month', 'Outflows', 'Inflows', 'Marked outflows', 'Count'].forEach((label, index) => text(label, 477, 10, true, columns[index]));
    page.drawLine({ start: { x: 42, y: 469 }, end: { x: 570, y: 469 }, thickness: 1, color: rgb(.7, .75, .8) });
    const totals = { outflow: 0, inflow: 0, markedOutflow: 0, count: 0 };
    months.forEach((row, index) => {
      text(new Date(Date.UTC(year, index, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }), 450 - index * 23);
      [row.outflow, row.inflow, row.markedOutflow].forEach((value, col) => text((value / 100).toFixed(2), 450 - index * 23, 10, false, columns[col + 1]));
      text(String(row.count), 450 - index * 23, 10, false, columns[4]);
      for (const key of ['outflow', 'inflow', 'markedOutflow', 'count'] as const) totals[key] += row[key];
    });
    text('Total', 148, 11, true);
    [totals.outflow, totals.inflow, totals.markedOutflow].forEach((value, index) => text((value / 100).toFixed(2), 148, 10, true, columns[index + 1]));
    text(String(totals.count), 148, 10, true, columns[4]);
    text('Keep original statements and receipts. Review missing currency before combining totals.', 102, 9);
  }
  pdf.getPages().forEach((page, index, pages) => page.drawText(`Preparer handoff | Page ${index + 1} of ${pages.length}`, { x: 42, y: 37, size: 9, font }));
  return pdf.save();
}
