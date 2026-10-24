import { CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { validateReceiptPreviewPath } from '@/lib/receipts/preview-path';
import { isSupersededRecord } from '@/lib/transactions/record-scope';

export type ExportRecord = Record<string, unknown>;
export class ExportReviewRequiredError extends Error {
  readonly code = 'EXPORT_REVIEW_REQUIRED';
}
export function exportYear(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!/^(?:20\d{2}|2100)$/.test(String(value))) throw new RangeError('Provide a four-digit year from 2000 through 2100.');
  return Number(value);
}
export function exportDate(value: unknown): string | null {
  try {
    if (value instanceof Date) value = value.toISOString();
    if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') value = value.toDate().toISOString();
  } catch { return null; }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return null;
  const day = value.slice(0, 10), parsed = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
}
export interface DateNeededRow { merchant: string; amount: number | null }
export interface DateNeededSummary {
  count: number;
  total: number;
  label: string;
  rows: DateNeededRow[];
}
export function formatDateNeededMoney(value: number): string {
  const sign = value < 0 ? '-' : '';
  const cents = Math.round(Math.abs(value) * 100);
  const dollars = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');
  return `${sign}$${String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}
export function formatDateNeededSummary(count: number, total: number): string {
  return `Date needed: ${count} ${count === 1 ? 'row' : 'rows'}, ${formatDateNeededMoney(total)}`;
}
export function exportMerchant(record: ExportRecord): string {
  const value = record.merchant_name ?? record.merchant ?? record.name;
  return typeof value === 'string' && value.trim() ? value.trim() : 'Unnamed record';
}
export function sumRecordedAmounts(records: ExportRecord[]): number {
  let cents = 0;
  for (const record of records) {
    const amount = transactionAmount(record);
    if (amount !== null) cents += Math.round(amount * 100);
  }
  return cents / 100;
}
export function summarizeDateNeeded(records: ExportRecord[]): DateNeededSummary {
  let cents = 0;
  const rows = records.map(record => {
    const amount = transactionAmount(record);
    if (amount !== null) cents += Math.round(amount * 100);
    return { merchant: exportMerchant(record), amount };
  });
  const total = cents / 100;
  return { count: records.length, total, label: formatDateNeededSummary(records.length, total), rows };
}
/** Dated rows for the year, plus every blank or invalid date. Other years stay in neither list. */
export function partitionExportYear(records: ExportRecord[], year: number): { dated: ExportRecord[]; dateNeeded: ExportRecord[] } {
  const dated: ExportRecord[] = [];
  const dateNeeded: ExportRecord[] = [];
  for (const record of records) {
    const date = exportDate(record.date ?? record.datetime);
    if (!date) dateNeeded.push(record);
    else if (date.startsWith(`${year}-`)) dated.push(record);
  }
  return { dated, dateNeeded };
}
export function selectExportYear(records: ExportRecord[], year?: number): ExportRecord[] {
  if (year === undefined) return [...records];
  return partitionExportYear(records, year).dated;
}
function blankCsvCells(): string[] {
  return TRANSACTION_CSV_HEADERS.map(() => '');
}
/** Selected-year CSV: dated rows, then the year total beside the Date needed count and dollars. */
export function appendTransactionDateNeeded(csv: string, dated: ExportRecord[], dateNeeded: ExportRecord[]): string {
  const summary = summarizeDateNeeded(dateNeeded);
  const yearTotal = sumRecordedAmounts(dated);
  const amountCol = TRANSACTION_CSV_HEADERS.findIndex(header => header.startsWith('Signed Amount'));
  const dateCol = TRANSACTION_CSV_HEADERS.indexOf('Tax Date');
  const recordedCol = TRANSACTION_CSV_HEADERS.indexOf('Recorded Date');
  const merchantCol = TRANSACTION_CSV_HEADERS.indexOf('Merchant');
  const reviewCol = TRANSACTION_CSV_HEADERS.indexOf('Data Review');
  const label = blankCsvCells();
  label[0] = 'Year total';
  label[amountCol] = yearTotal.toFixed(2);
  label[reviewCol] = summary.label;
  const lines = [label.map(csvCell).join(',')];
  for (const record of dateNeeded) {
    const row = blankCsvCells();
    const amount = transactionAmount(record);
    row[0] = String(record.exportReference ?? record.trans_id ?? record.id ?? '');
    row[dateCol] = '';
    row[recordedCol] = '';
    row[amountCol] = amount === null ? '' : amount.toFixed(2);
    row[merchantCol] = exportMerchant(record);
    row[reviewCol] = 'Date needed';
    lines.push(row.map(csvCell).join(','));
  }
  return `${csv}\r\n${lines.join('\r\n')}`;
}
export function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Quotes do not prevent spreadsheet formulas. Keep true numeric negatives numeric.
  const safe = typeof value !== 'number' && /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? `'${text}` : text;
  return /[,"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const categoryText = (value: unknown) => Array.isArray(value) ? value.join(' > ') : typeof value === 'string' ? value : '';
export function transactionAmount(record: ExportRecord): number | null {
  const value = record.amount;
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null;
}
export function recordedDeductibility(record: ExportRecord): boolean | null {
  const value = record.is_deductible ?? record.deductible;
  return typeof value === 'boolean' ? value : null;
}
export const TRANSACTION_CSV_HEADERS = [
  'Transaction Reference', 'Account Reference', 'Tax Date', 'Recorded Date',
  'Signed Amount (+ outflow / - inflow)', 'Cash Direction (not tax classification)', 'Recorded Type', 'Currency',
  'Merchant', 'Description', 'Recorded Category', 'Recorded Deductibility (not filing eligibility)', 'Pending',
  'Recorded Schedule C Line', 'Category Mapping (preparer review)', 'Business Purpose', 'User Review Notes',
  'AI Reason (unverified)', 'AI Confidence (0 to 1)', 'Receipt Filename', 'Private Receipt Path (sign-in required)',
  'Notes', 'Recorded Business-use Fields (not applied)', 'Recorded Deduction Adjustments (not applied)', 'Data Review',
];
export function convertTransactionsToCSV(records: ExportRecord[]): string {
  return [TRANSACTION_CSV_HEADERS.map(csvCell).join(','), ...records.map(record => {
    const amount = transactionAmount(record), date = exportDate(record.date ?? record.datetime), deductible = recordedDeductibility(record);
    const category = categoryText(record.category);
    const rawPath = record.receipt_url;
    const businessUse = Object.fromEntries(['business_percent', 'business_use_percent', 'business_use_percentage', 'businessUsePercent'].filter(key => record[key] !== undefined).map(key => [key, record[key]]));
    const equipment = record.equipment_details;
    if (equipment && typeof equipment === 'object' && 'business_use_percentage' in equipment) businessUse['equipment_details.business_use_percentage'] = equipment.business_use_percentage;
    const adjustments = Object.fromEntries(['deduction_override', 'deductible_amount', 'deduction_amount', 'deductible_amount_override', 'deduction_percentage'].filter(key => record[key] !== undefined).map(key => [key, record[key]]));
    const receiptPath = typeof rawPath === 'string' ? validateReceiptPreviewPath(rawPath) : null;
    const review = [!date && 'Missing/invalid date', amount === null && 'Missing/invalid amount',
      !record.iso_currency_code && !record.unofficial_currency_code && 'Currency not recorded',
      record.pending === true && 'Pending record; reconcile posted transaction',
      isSupersededRecord(record) && 'Superseded duplicate of an earlier bank record; excluded from WriteOff totals',
      deductible === null && 'Classification unreviewed',
      record.tax_review_required === true && 'Tax treatment unresolved; exclude from confirmed deduction totals',
      amount !== null && amount > 0 && deductible !== false && !Object.keys(businessUse).length && 'Business-use percentage not recorded; confirm allocation',
      rawPath && !receiptPath && 'Receipt link unavailable in private export',
    ].filter(Boolean).join('; ');
    return [record.exportReference ?? record.trans_id ?? record.id, record.accountReference ?? record.account_id ?? record.accountId,
      date, record.date ?? record.datetime, amount, amount === null ? 'Unknown' : amount > 0 ? 'Outflow' : amount < 0 ? 'Inflow' : 'Zero',
      record.type, record.iso_currency_code ?? record.unofficial_currency_code ?? 'Not recorded', record.merchant_name ?? record.name ?? record.merchant,
      record.description, category, deductible === true ? 'Yes' : deductible === false ? 'No' : 'Unreviewed',
      record.pending === true ? 'Yes' : record.pending === false ? 'No' : 'Not recorded',
      record.schedule_c_line ?? record.scheduleC_line, CATEGORY_MAP[category]?.line ?? '', record.business_purpose,
      record.user_classification_reason, record.deductible_reason ?? record.deduction_reason, record.deduction_score ?? record.ai_confidence,
      record.receipt_filename, receiptPath, record.notes, Object.keys(businessUse).length ? businessUse : '', Object.keys(adjustments).length ? adjustments : '', review,
    ].map(csvCell).join(',');
  })].join('\r\n');
}
