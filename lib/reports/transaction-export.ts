import { CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { validateReceiptPreviewPath } from '@/lib/receipts/preview-path';

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
export function selectExportYear(records: ExportRecord[], year?: number): ExportRecord[] {
  if (year === undefined) return [...records];
  if (records.some(record => !exportDate(record.date ?? record.datetime))) {
    throw new ExportReviewRequiredError('Some saved transactions have missing or invalid dates. Correct them before exporting a selected year, or download all records for review.');
  }
  return records.filter(record => exportDate(record.date ?? record.datetime)?.startsWith(`${year}-`));
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
    const businessUse = Object.fromEntries(['business_percent', 'business_use_percent', 'business_use_percentage'].filter(key => record[key] !== undefined).map(key => [key, record[key]]));
    const equipment = record.equipment_details;
    if (equipment && typeof equipment === 'object' && 'business_use_percentage' in equipment) businessUse['equipment_details.business_use_percentage'] = equipment.business_use_percentage;
    const adjustments = Object.fromEntries(['deduction_override', 'deductible_amount', 'deduction_amount', 'deductible_amount_override', 'deduction_percentage'].filter(key => record[key] !== undefined).map(key => [key, record[key]]));
    const receiptPath = typeof rawPath === 'string' ? validateReceiptPreviewPath(rawPath) : null;
    const review = [!date && 'Missing/invalid date', amount === null && 'Missing/invalid amount',
      !record.iso_currency_code && !record.unofficial_currency_code && 'Currency not recorded',
      record.pending === true && 'Pending record; reconcile posted transaction',
      deductible === null && 'Classification unreviewed',
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
