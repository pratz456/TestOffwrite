import { aggregateScheduleC, CATEGORY_MAP, type LineItemSummary } from '@/lib/schedule-c/aggregate';
import { scheduleCExportLine } from '@/lib/schedule-c/export-lines';
import { createPlanningPDF, formatExportMoney as money } from './planning-pdf';

export interface ScheduleCExportData {
  taxYear: number; grossReceipts: number; lineItems: LineItemSummary[];
  /** `ssn` and `ein` are masked display values (last four digits); callers never pass full identifiers. */
  name?: string; ssn?: string; profession?: string; naicsCode?: string; ein?: string;
  includeAppendix: boolean;
}
export async function generateScheduleCPlanningPDF(data: ScheduleCExportData) {
  const pdf = await createPlanningPDF('Schedule C - business records for review', data.taxYear);
  pdf.paragraph('This is a preparer handoff, not an IRS Schedule C or an e-file-ready return. Recorded receipts and confirmed expense totals are included below; missing tax facts are not treated as zero.', true);
  pdf.paragraph(data.taxYear >= 2026 ? '2026 planning amounts use published 2025 Schedule C line references. Final 2026 form labels must be checked before filing.' : `Line references use the published ${data.taxYear} Schedule C.`);
  pdf.section('Owner and business records');
  pdf.paragraph('Taxpayer identification numbers print with their last digits only. Give the full SSN and EIN to your preparer directly.');
  pdf.table(['Record', 'Saved value'], [
    ['Name', data.name || 'Not provided'], ['SSN (last 4)', data.ssn || 'Not provided'],
    ['Profession / activity', data.profession || 'Not provided'], ['Business code', data.naicsCode || 'Not provided'],
    ['EIN (last 4)', data.ein || 'Not provided'],
    ['Accounting method, business address, participation, information returns', 'Not established by this export - review separately'],
  ], [195, 333]);
  pdf.section('Recorded income and confirmed expenses');
  const total = data.lineItems.reduce((sum, row) => sum + row.deductible, 0);
  pdf.table(['Reference', 'Recorded amount / scope', 'Amount'], [
    ['1', 'Reconciled gross receipts in WriteOff', money(data.grossReceipts)],
    ...data.lineItems.map(row => [scheduleCExportLine(row.lineCode, data.taxYear), `${row.lineName} - ${row.transactionCount} confirmed records`, money(row.deductible)]),
    ['28 subtotal', 'Confirmed expense subtotal only', money(total)],
    ['Worksheet', 'Receipts minus confirmed expenses, before other adjustments', money(data.grossReceipts - total)],
    ['29-31', 'Final tentative profit, home-office deduction and net profit', 'Not determined'],
  ], [70, 353, 105]);
  pdf.paragraph('Credits/refunds are signed and meals use the shared 50% calculation. A confirmed category is not proof of legal deductibility. Review mixed business/personal use, asset purchases, vehicle method, entertainment and contribution classification.');
  pdf.section('Required review before preparing the return');
  pdf.paragraph('Complete returns/allowances, inventory and cost of goods sold, other income, depreciation and elections, home-office eligibility and limits, business details, vehicle records, material participation, at-risk/passive-loss limits and required 1099 filings. This export does not establish these facts or prepare those schedules. Review missing identity details directly with your preparer.');
  if (data.includeAppendix) {
    pdf.section('Complete confirmed-transaction appendix');
    const rows = data.lineItems.flatMap(item => item.transactions.map(tx => {
      const contribution = aggregateScheduleC([tx], String(data.taxYear), CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible;
      return [tx.date, tx.merchant_name || tx.id || 'Unnamed record', scheduleCExportLine(item.lineCode, data.taxYear), money(tx.amount), money(contribution)];
    }));
    pdf.table(['Date', 'Merchant / record', 'Line', 'Signed amount', 'Contribution'], rows.length ? rows : [['', 'No confirmed records in this year', '', money(0), money(0)]], [68, 235, 35, 95, 95]);
  } else pdf.paragraph('Transaction appendix omitted at your request. Retain the detailed records and receipts with your preparer.');
  pdf.paragraph('Reference: irs.gov/pub/irs-pdf/f1040sc.pdf and irs.gov/pub/irs-prior/f1040sc--2024.pdf. Unsupported font characters are preserved as U+codepoints.');
  return pdf.save();
}
