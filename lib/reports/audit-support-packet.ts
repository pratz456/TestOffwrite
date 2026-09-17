import { adminDb } from '@/lib/firebase/admin';
import { validateReceiptPreviewPath } from '@/lib/receipts/preview-path';
import { CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { BUSINESS_STANDARD_MILEAGE_RATES, businessMileageRateForDate, summarizeBusinessMileage } from '@/lib/tax-rules/mileage-rates';
import { isServerConfirmedDeduction } from '@/lib/transactions/confirmed-deduction';
import { ExportDataUnavailableError, exportReference, ownedExportRecord, readOwnedTransactions } from './export-records';
import { createPlanningPDF, formatExportMoney as money } from './planning-pdf';
import { csvCell, exportDate, selectExportYear, transactionAmount, ExportReviewRequiredError, type ExportRecord } from './transaction-export';

/**
 * Audit support records packet: the confirmed deductions of one tax year, each paired with
 * the records on file and the substantiation elements that are still missing. It is a records
 * packet for the owner and their preparer. It is not audit representation, a legal opinion or a
 * guarantee that a deduction will be allowed (see the claims policy in the product roadmap).
 */
export const AUDIT_SUPPORT_TITLE = 'Audit support records';
/** Reg. §1.274-5(c)(2)(iii): documentary evidence for lodging at any amount and other §274(d) expenses of $75 or more. */
export const RECEIPT_THRESHOLD = 75;
const DEFAULT_REVIEW_REASON = 'Category reviewed and corrected by user.';

export type SubstantiationCategory = 'meal' | 'lodging' | 'travel' | 'vehicle' | 'local_transportation' | 'gift' | 'general';
export type SubstantiationStatus = 'complete' | 'needs_records';
export type ReviewSource = 'ai_confirmed' | 'user_corrected' | 'unknown';
type PurposeSource = 'business_purpose' | 'mileage_details' | 'meeting_notes' | 'owner_review_note';

export const SUBSTANTIATION_RULES: Record<SubstantiationCategory, { label: string; strict: boolean; standard: string }> = {
  meal: { label: 'Business meal', strict: true, standard: 'Amount, date, place, business purpose and the business relationship of each attendee (IRC §274(k), Reg. §1.274-12, Pub 463 Table 5-1). Meals while traveling away from home fall under §274(d). Receipt required at $75 or more; generally limited to 50%.' },
  lodging: { label: 'Lodging while traveling', strict: true, standard: '§274(d) travel: amount, dates of departure and return, destination and business purpose. A receipt is required for lodging at any amount. Estimates are not accepted.' },
  travel: { label: 'Travel away from home', strict: true, standard: '§274(d) travel: amount, dates of departure and return, destination and business purpose. Receipt required at $75 or more. Estimates are not accepted.' },
  vehicle: { label: 'Vehicle', strict: true, standard: '§274(d) listed property: date, business miles for each use, total miles for the year, destination and business purpose, plus the cost and in-service date of the vehicle. Receipt required at $75 or more. Estimates are not accepted.' },
  local_transportation: { label: 'Local transportation', strict: false, standard: 'Pub 463 transportation records: amount, date, destination and business purpose. Receipt required at $75 or more.' },
  gift: { label: 'Business gift', strict: true, standard: '§274(d) gifts: amount, date, description, business purpose and the business relationship of the recipient; limited to $25 per recipient per year. Estimates are not accepted.' },
  general: { label: 'Ordinary business expense', strict: false, standard: 'IRC §6001 records: proof of payment and of the business connection. §274(d) does not apply; keep receipts or invoices, especially at $75 or more.' },
};

/** Private, sign-in-only API path plus metadata; never storage paths or bytes. */
export interface ReceiptReference { path: string | null; filename: string | null; uploadedAt: string | null; mimeType: string | null; source: 'uploaded' | 'legacy_link' }
export interface AuditEvidenceRecord {
  /** Stable hashed reference shared with the owner archive; carries no provider identifier. */
  reference: string;
  /** Owner-only navigation to the saved transaction. */
  transactionId: string;
  detailPath: string;
  date: string;
  merchant: string;
  /** Recorded sign: positive is an outflow. Credits are netted, never treated as new deductions. */
  amount: number;
  direction: 'expense' | 'credit';
  currency: 'USD';
  category: string;
  categoryLabel: string;
  scheduleCLine: string | null;
  substantiation: { category: SubstantiationCategory; label: string; strict: boolean; status: SubstantiationStatus; missing: string[]; advisories: string[] };
  businessPurpose: { text: string | null; source: PurposeSource | null };
  attendees: string[];
  clientProject: string | null;
  travel: { destination: string | null; datesRecorded: boolean };
  mileage: { startLocation: string | null; endLocation: string | null; miles: number | null; businessPurpose: string | null } | null;
  /** Trips in the mileage log dated the same day as this expense. */
  linkedTrips: number;
  receipts: ReceiptReference[];
  receiptDeclaredOutsideApp: boolean;
  review: { status: 'confirmed'; source: ReviewSource; label: string; reviewedAt: string | null; note: string | null };
  businessUsePercent: number | null;
}
export interface MileageLogEntry {
  reference: string; date: string; startLocation: string; endLocation: string; miles: number; roundTrip: boolean; businessPurpose: string | null;
  ratePerMile: number | null; rateSource: string | null; standardMileageAmount: number | null;
  substantiation: { status: SubstantiationStatus; missing: string[] };
}
export interface RetentionNote {
  taxYear: number; returnDueDate: string;
  rows: Array<{ situation: string; period: string; keepUntil: string }>;
  notes: string[]; source: string;
}
export interface AuditSupportPacket {
  packetInfo: { title: string; taxYear: number; generatedAt: string; version: string; purpose: string; receiptBinariesIncluded: false; owner: string };
  coverNote: string[];
  deductions: AuditEvidenceRecord[];
  mileageLog: { trips: MileageLogEntry[]; undatedTrips: number; notes: string[] };
  summary: {
    deductionCount: number; recordedAmount: number;
    byStatus: Record<SubstantiationStatus, { count: number; amount: number }>;
    byCategory: Array<{ category: SubstantiationCategory; label: string; count: number; amount: number; complete: number; needsRecords: number }>;
    missingItems: Array<{ item: string; count: number }>;
    excluded: { notConfirmed: number; reviewRequired: number; pending: number; bankRemoved: number };
    mileage: { tripCount: number; ratedMiles: number; unratedMiles: number; unratedTrips: number; standardMileageAmount: number; ratesApplied: number[]; tripsNeedingRecords: number };
  };
  retention: RetentionNote;
  standards: Array<{ category: SubstantiationCategory; label: string; standard: string }>;
  sources: string[];
}
export interface AuditSupportInputs { transactions: ExportRecord[]; trips: ExportRecord[]; receipts: ExportRecord[] }

const VEHICLE_OPERATING = new Set(['TRANSPORTATION_FUEL', 'TRANSPORTATION_AUTO_REPAIR', 'TRANSPORTATION_AUTO_SERVICE', 'TRANSPORTATION_CAR_WASH', 'TRANSPORTATION_AUTO_INSURANCE']);
const VEHICLE_TRIP_COSTS = new Set(['TRANSPORTATION_AUTO_PARKING', 'TRANSPORTATION_TOLLS']);
const LOCAL_TRANSPORTATION = new Set(['TRANSPORTATION_RIDESHARE', 'TRANSPORTATION_PUBLIC_TRANSIT', 'TRAVEL_TAXI']);

/** Recorded categories map to the §274(d) family they must be substantiated under; legacy free-text categories use keyword fallbacks. */
export function substantiationCategory(category: unknown): SubstantiationCategory {
  const key = (Array.isArray(category) ? category.join('_') : typeof category === 'string' ? category : '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  if (!key) return 'general';
  if (key === 'TRAVEL_LODGING' || /LODGING|HOTEL/.test(key)) return 'lodging';
  if (/GIFT/.test(key)) return 'gift';
  if (CATEGORY_MAP[key]?.line === '24b' || /MEAL|RESTAURANT|FOOD|COFFEE|DINING/.test(key)) return 'meal';
  if (LOCAL_TRANSPORTATION.has(key) || /RIDESHARE|TAXI|TRANSIT|UBER|LYFT/.test(key)) return 'local_transportation';
  if (key === 'TRANSPORTATION_RENTAL_CAR' || CATEGORY_MAP[key]?.line === '24a' || /TRAVEL|FLIGHT|AIRLINE|AIRFARE|RENTAL_CAR/.test(key)) return 'travel';
  if (VEHICLE_OPERATING.has(key) || VEHICLE_TRIP_COSTS.has(key) || /VEHICLE|AUTO|FUEL|GAS_STATION|PARKING|TOLL|MILEAGE|CAR_/.test(key)) return 'vehicle';
  return 'general';
}
const vehicleOperating = (category: string) => VEHICLE_OPERATING.has(category.toUpperCase()) || (!VEHICLE_TRIP_COSTS.has(category.toUpperCase()) && !/PARKING|TOLL/.test(category.toUpperCase()));

const DATE_TOKEN = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i;
const text = (value: unknown, max = 2000): string | null => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
const iso = (value: unknown): string | null => {
  try {
    if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') value = value.toDate();
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    if (typeof value === 'number') return Number.isFinite(value) ? new Date(value).toISOString() : null;
    if (typeof value === 'string' && value.trim()) { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : value.trim(); }
  } catch { /* unreadable timestamp is reported as absent */ }
  return null;
};
const humanize = (category: string) => CATEGORY_MAP[category]?.name ?? category.replace(/_/g, ' ').toLowerCase().replace(/^\w/, char => char.toUpperCase());
const round2 = (value: number) => Math.round(value * 100) / 100;

function businessPurpose(record: ExportRecord): AuditEvidenceRecord['businessPurpose'] {
  const mileage = record.mileage_details && typeof record.mileage_details === 'object' ? record.mileage_details as Record<string, unknown> : null;
  const candidates: Array<[PurposeSource, unknown]> = [['business_purpose', record.business_purpose], ['mileage_details', mileage?.business_purpose], ['meeting_notes', record.meeting_notes]];
  if (record.review_source === 'user_corrected' && record.user_classification_reason !== DEFAULT_REVIEW_REASON) candidates.push(['owner_review_note', record.user_classification_reason]);
  for (const [source, value] of candidates) { const candidate = text(value); if (candidate && candidate.length >= 3) return { text: candidate, source }; }
  return { text: null, source: null };
}
/** No structured trip-date field exists yet, so dates written into the destination, purpose or notes count. */
function travelDatesRecorded(record: ExportRecord, purpose: string | null): boolean {
  if ([record.travel_dates, record.trip_dates].some(value => text(value))) return true;
  if (text(record.travel_start_date) && text(record.travel_end_date)) return true;
  return [record.travel_destination, record.business_purpose, record.meeting_notes, record.notes, purpose].some(value => typeof value === 'string' && DATE_TOKEN.test(value));
}
function receiptReferences(record: ExportRecord, identity: string, uploaded: Map<string, ExportRecord[]>): ReceiptReference[] {
  const references = new Map<string, ReceiptReference>();
  for (const receipt of uploaded.get(identity) ?? []) {
    const path = validateReceiptPreviewPath(`/api/receipts/${receipt.id}`);
    if (path) references.set(path, { path, filename: text(receipt.originalName ?? receipt.filename, 300), uploadedAt: iso(receipt.uploadedAt), mimeType: text(receipt.mimeType, 100), source: 'uploaded' });
  }
  const legacy = validateReceiptPreviewPath(record.receipt_url);
  if (legacy && !references.has(legacy)) references.set(legacy, { path: legacy, filename: text(record.receipt_filename, 300), uploadedAt: null, mimeType: null, source: 'legacy_link' });
  // A saved filename without a private link still records that a receipt was kept; external links are never exported.
  else if (!legacy && text(record.receipt_filename) && !references.size) references.set(`filename:${record.receipt_filename}`, { path: null, filename: text(record.receipt_filename, 300), uploadedAt: null, mimeType: null, source: 'legacy_link' });
  return [...references.values()];
}
function businessUsePercent(record: ExportRecord): number | null {
  const equipment = record.equipment_details && typeof record.equipment_details === 'object' ? (record.equipment_details as Record<string, unknown>).business_use_percentage : undefined;
  const value = [record.business_percent, record.business_use_percent, record.business_use_percentage, record.businessUsePercent, equipment].find(entry => entry !== undefined && entry !== null);
  return typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
}

/** One confirmed deduction paired with the records on file and the §274(d) elements still missing. */
export function buildEvidenceRecord(record: ExportRecord, context: { uid: string; tripsByDate: Map<string, number>; yearTripCount: number; receiptsByTransaction: Map<string, ExportRecord[]> }): AuditEvidenceRecord {
  const identity = String(record.trans_id ?? record.id ?? '');
  const date = exportDate(record.date ?? record.datetime)!;
  const amount = transactionAmount(record)!;
  const category = Array.isArray(record.category) ? record.category.join(' > ') : typeof record.category === 'string' ? record.category : '';
  const type = substantiationCategory(category);
  const rule = SUBSTANTIATION_RULES[type];
  const purpose = businessPurpose(record);
  const attendees = Array.isArray(record.attendees) ? record.attendees.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map(entry => entry.trim().slice(0, 300)) : [];
  const destination = text(record.travel_destination);
  const datesRecorded = travelDatesRecorded(record, purpose.text);
  const details = record.mileage_details && typeof record.mileage_details === 'object' ? record.mileage_details as Record<string, unknown> : null;
  const mileage = details ? { startLocation: text(details.start_location), endLocation: text(details.end_location), miles: typeof details.miles === 'number' && Number.isFinite(details.miles) && details.miles > 0 ? details.miles : null, businessPurpose: text(details.business_purpose) } : null;
  const hasMileageDetails = Boolean(mileage && (mileage.miles || (mileage.startLocation && mileage.endLocation)));
  const linkedTrips = context.tripsByDate.get(date) ?? 0;
  const receipts = receiptReferences(record, identity, context.receiptsByTransaction);
  const declared = record.documentation_status === 'complete' && receipts.length === 0;
  const hasReceipt = receipts.length > 0 || declared;
  const clientProject = text(record.client_project, 300);
  const businessUse = businessUsePercent(record);
  const missing: string[] = [], advisories: string[] = [];
  const direction: AuditEvidenceRecord['direction'] = amount < 0 ? 'credit' : 'expense';
  const absolute = Math.abs(amount);
  if (direction === 'credit') advisories.push('Credit or refund netted against this category. Keep the original expense record it offsets.');
  else {
    const receiptRequired = type === 'lodging' || (type !== 'general' && absolute >= RECEIPT_THRESHOLD);
    if (receiptRequired && !hasReceipt) missing.push(type === 'lodging' ? 'receipt (required for lodging at any amount)' : `receipt (${rule.label.toLowerCase()} of $75 or more)`);
    if (type === 'general' && absolute >= RECEIPT_THRESHOLD && !hasReceipt) advisories.push('Receipt or invoice recommended for an expense of $75 or more.');
    const operating = type === 'vehicle' && vehicleOperating(category);
    if (!purpose.text) {
      if (type === 'general') advisories.push('No business-purpose note. §274(d) does not apply, but add one when the purpose is not evident from the merchant and category.');
      else if (!operating) missing.push('business purpose');
    }
    if (type === 'meal') {
      if (!attendees.length && !destination) missing.push('attendees and business relationship (or the travel destination for a meal while traveling)');
      advisories.push('Business meals are generally limited to 50% of the recorded amount.');
    }
    if (type === 'travel' || type === 'lodging') {
      if (!destination) missing.push('travel destination');
      if (!datesRecorded) missing.push('travel dates (departure and return)');
    }
    if (type === 'local_transportation' && !destination) advisories.push('Record the destination of each ride; Pub 463 treats it as an element of the transportation record.');
    if (type === 'vehicle') {
      if (operating) {
        if (!hasMileageDetails && context.yearTripCount === 0) missing.push(`mileage log for ${date.slice(0, 4)} (business miles for each use and total miles for the year)`);
        advisories.push('Actual vehicle costs are not deductible in addition to the standard mileage rate, except parking and tolls. Keep odometer readings for total miles.');
      } else if (!hasMileageDetails && linkedTrips === 0) missing.push('mileage log entry for this trip (date, destination, miles)');
    }
    if (type === 'gift') {
      if (!attendees.length && !clientProject) missing.push('recipient and business relationship');
      advisories.push('Business gifts are limited to $25 per recipient per year.');
    }
    if (declared) advisories.push('Owner marked documentation complete; the receipt is kept outside WriteOff and is not attached.');
    if (record.documentation_status === 'partial' || record.documentation_status === 'missing') advisories.push(`Owner marked documentation as ${record.documentation_status}.`);
    if (businessUse !== null && businessUse !== 100) advisories.push(`Mixed-use allocation of ${businessUse}% recorded. Keep the basis for the allocation.`);
  }
  const source: ReviewSource = record.review_source === 'ai_confirmed' || record.review_source === 'user_corrected' ? record.review_source : 'unknown';
  return {
    reference: String(record.exportReference ?? exportReference('transaction', `${context.uid}/${record.recordPath ?? identity}`)),
    transactionId: identity,
    detailPath: `/protected?screen=transaction-detail&transactionId=${encodeURIComponent(identity)}&from=reports`,
    date, merchant: text(record.merchant_name ?? record.merchant ?? record.name, 300) ?? 'Unnamed record', amount, direction, currency: 'USD',
    category, categoryLabel: humanize(category), scheduleCLine: CATEGORY_MAP[category]?.line ?? null,
    substantiation: { category: type, label: rule.label, strict: rule.strict, status: missing.length ? 'needs_records' : 'complete', missing, advisories },
    businessPurpose: purpose, attendees, clientProject,
    travel: { destination, datesRecorded }, mileage, linkedTrips, receipts, receiptDeclaredOutsideApp: declared,
    review: { status: 'confirmed', source, label: source === 'ai_confirmed' ? 'AI suggestion confirmed by owner' : source === 'user_corrected' ? 'Owner classification' : 'Owner confirmation (source not recorded)',
      reviewedAt: iso(record.reviewed_at), note: text(record.user_classification_reason) },
    businessUsePercent: businessUse,
  };
}

/** Pub 583 Table 3, anchored to the statutory due date of the selected year's return. */
export function retentionNote(taxYear: number): RetentionNote {
  const april = (year: number) => `${year}-04-15`;
  return {
    taxYear, returnDueDate: april(taxYear + 1),
    rows: [
      { situation: 'You owe additional tax and none of the situations below apply', period: '3 years', keepUntil: april(taxYear + 4) },
      { situation: 'You did not report income that is more than 25% of the gross income shown on the return', period: '6 years', keepUntil: april(taxYear + 7) },
      { situation: 'You claim a loss from worthless securities or a bad-debt deduction', period: '7 years', keepUntil: april(taxYear + 8) },
      { situation: 'You file a claim for credit or refund after filing', period: 'Later of 3 years from filing or 2 years from payment', keepUntil: 'Depends on the claim' },
      { situation: 'You do not file a return, or you file a fraudulent return', period: 'No limit', keepUntil: 'Indefinitely' },
      { situation: 'Employment tax records', period: 'At least 4 years after the tax is due or paid', keepUntil: 'At least 4 years' },
      { situation: 'Property and asset records (basis, depreciation)', period: 'Until the limitations period expires for the year of disposition', keepUntil: 'Disposition year plus its period' },
    ],
    notes: [
      `Periods run from the later of the return due date (${april(taxYear + 1)} before weekend, holiday or extension shifts) or the date you actually filed; a return filed early counts as filed on the due date.`,
      'WriteOff suggests keeping Schedule C support for at least 7 years and asset, prior-return and carryover records indefinitely. Some states use longer periods.',
      'Adequate records for §274(d) items are made at or near the time of the expense; reconstructed records need corroborating evidence. Estimates (the Cohan rule) are not accepted for travel, vehicle and gift expenses.',
    ],
    source: 'https://www.irs.gov/publications/p583',
  };
}

function mileageEntries(uid: string, year: number, trips: ExportRecord[]) {
  const entries: MileageLogEntry[] = [];
  let undated = 0;
  for (const trip of trips) {
    const date = exportDate(trip.date);
    if (!date) { undated += 1; continue; }
    if (!date.startsWith(`${year}-`)) continue;
    const miles = typeof trip.miles === 'number' && Number.isFinite(trip.miles) ? trip.miles : typeof trip.miles === 'string' && Number.isFinite(Number(trip.miles)) ? Number(trip.miles) : 0;
    const period = businessMileageRateForDate(date);
    const start = text(trip.startLocation, 500) ?? '', end = text(trip.endLocation, 500) ?? '';
    const purpose = text(trip.businessPurpose);
    const missing = [!(miles > 0) && 'miles', (!start || !end) && 'destination (start and end locations)', !purpose && 'business purpose'].filter((item): item is string => Boolean(item));
    entries.push({ reference: exportReference('trip', `${uid}/${trip.recordPath ?? trip.id}`), date, startLocation: start, endLocation: end, miles, roundTrip: trip.roundTrip === true, businessPurpose: purpose,
      ratePerMile: period?.ratePerMile ?? null, rateSource: period?.source ?? null, standardMileageAmount: period && miles > 0 ? round2(miles * period.ratePerMile) : null,
      substantiation: { status: missing.length ? 'needs_records' : 'complete', missing } });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
  return { entries, undated };
}

/** Pure assembly over owner-verified records. Throws ExportReviewRequiredError when records need reconciliation first. */
export function assembleAuditSupportPacket(uid: string, year: number, inputs: AuditSupportInputs, generatedAt = new Date()): AuditSupportPacket {
  const inYear = selectExportYear(inputs.transactions, year);
  const excluded = { notConfirmed: 0, reviewRequired: 0, pending: 0, bankRemoved: 0 };
  const confirmed: ExportRecord[] = [];
  for (const record of inYear) {
    if (record.is_deductible !== true) continue;
    if (record.pending === true) excluded.pending += 1;
    else if (record.bank_removed === true) excluded.bankRemoved += 1;
    else if (record.tax_review_required === true || (typeof record.category === 'string' && record.category.endsWith('_REVIEW_REQUIRED'))) excluded.reviewRequired += 1;
    // Same confirmation contract as Schedule C totals, so the packet never lists fewer
    // deductions than the estimate counts (legacy pre-cutoff confirmations included).
    else if (!isServerConfirmedDeduction(record)) excluded.notConfirmed += 1;
    else confirmed.push(record);
  }
  const seen = new Set<string>();
  for (const record of confirmed) {
    const identity = String(record.trans_id ?? record.id ?? '');
    if (identity) {
      if (seen.has(identity)) throw new ExportReviewRequiredError('Duplicate transaction identifiers exist in confirmed records. Reconcile duplicate imports before assembling the records packet.');
      seen.add(identity);
    }
    if (transactionAmount(record) === null) throw new ExportReviewRequiredError('A confirmed deduction has an invalid amount. Correct it before assembling the records packet.');
    if ((record.iso_currency_code && record.iso_currency_code !== 'USD') || record.unofficial_currency_code) throw new ExportReviewRequiredError('Non-USD confirmed deductions require reviewed U.S. dollar conversion before assembling the records packet.');
  }
  const { entries: trips, undated } = mileageEntries(uid, year, inputs.trips);
  const tripsByDate = new Map<string, number>();
  for (const trip of trips) tripsByDate.set(trip.date, (tripsByDate.get(trip.date) ?? 0) + 1);
  const receiptsByTransaction = new Map<string, ExportRecord[]>();
  for (const receipt of inputs.receipts) {
    const key = text(receipt.transactionId, 600); if (!key) continue;
    receiptsByTransaction.set(key, [...(receiptsByTransaction.get(key) ?? []), receipt]);
  }
  const deductions = confirmed.map(record => buildEvidenceRecord(record, { uid, tripsByDate, yearTripCount: trips.length, receiptsByTransaction }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
  const byStatus: AuditSupportPacket['summary']['byStatus'] = { complete: { count: 0, amount: 0 }, needs_records: { count: 0, amount: 0 } };
  const categories = new Map<SubstantiationCategory, AuditSupportPacket['summary']['byCategory'][number]>();
  const missingItems = new Map<string, number>();
  for (const record of deductions) {
    const status = record.substantiation.status;
    byStatus[status].count += 1; byStatus[status].amount = round2(byStatus[status].amount + record.amount);
    const type = record.substantiation.category;
    const entry = categories.get(type) ?? { category: type, label: SUBSTANTIATION_RULES[type].label, count: 0, amount: 0, complete: 0, needsRecords: 0 };
    entry.count += 1; entry.amount = round2(entry.amount + record.amount); if (status === 'complete') entry.complete += 1; else entry.needsRecords += 1;
    categories.set(type, entry);
    for (const item of record.substantiation.missing) missingItems.set(item, (missingItems.get(item) ?? 0) + 1);
  }
  const mileage = summarizeBusinessMileage(trips);
  const mileageNotes = [
    'Standard mileage amounts use the IRS rate in effect on each trip date; trips dated in a period without a published rate are listed without an amount.',
    'The mileage log records business trips only. Total miles for the year (all use) are not tracked in WriteOff; keep odometer readings at the start and end of the year.',
  ];
  if (undated) mileageNotes.push(`${undated} saved trip(s) have an unreadable date and are not included. Correct them in the mileage tracker.`);
  const usedRateSources = BUSINESS_STANDARD_MILEAGE_RATES.filter(period => mileage.ratesApplied.includes(period.ratePerMile)).map(period => period.source);
  return {
    packetInfo: { title: `${AUDIT_SUPPORT_TITLE} - Tax year ${year}`, taxYear: year, generatedAt: generatedAt.toISOString(), version: '1.0',
      purpose: 'Owner records packet organizing confirmed deductions with the records on file and the substantiation elements still missing. Not audit representation, tax advice or a guarantee that any deduction will be allowed.',
      receiptBinariesIncluded: false, owner: uid },
    coverNote: [
      `This packet lists the deductions you confirmed in WriteOff for tax year ${year}, the records on file for each one, and the substantiation elements the IRS asks for that are still missing.`,
      'It is a records packet, not audit representation, legal or tax advice, or a guarantee that any deduction will be allowed. Only a credentialed practitioner (attorney, CPA or enrolled agent) can represent you before the IRS. Review this packet with your preparer.',
      'Only confirmed deductions are included. Pending, bank-removed and review-required records and unconfirmed AI suggestions are excluded; AI analysis is never treated as evidence.',
      'Receipts are referenced by private, sign-in-only links and filenames. Receipt images and PDFs are not attached. Amounts are recorded amounts, not calculated deductions.',
    ],
    deductions,
    mileageLog: { trips, undatedTrips: undated, notes: mileageNotes },
    summary: {
      deductionCount: deductions.length, recordedAmount: round2(deductions.reduce((sum, record) => sum + record.amount, 0)),
      byStatus, byCategory: [...categories.values()].sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label)),
      missingItems: [...missingItems].map(([item, count]) => ({ item, count })).sort((a, b) => b.count - a.count || a.item.localeCompare(b.item)),
      excluded,
      mileage: { tripCount: trips.length, ratedMiles: round2(mileage.ratedMiles), unratedMiles: round2(mileage.unratedMiles), unratedTrips: mileage.unratedTrips, standardMileageAmount: mileage.deduction, ratesApplied: mileage.ratesApplied, tripsNeedingRecords: trips.filter(trip => trip.substantiation.status === 'needs_records').length },
    },
    retention: retentionNote(year),
    standards: (Object.keys(SUBSTANTIATION_RULES) as SubstantiationCategory[]).map(category => ({ category, label: SUBSTANTIATION_RULES[category].label, standard: SUBSTANTIATION_RULES[category].standard })),
    sources: ['https://www.irs.gov/publications/p463', 'https://www.law.cornell.edu/cfr/text/26/1.274-5T', 'https://www.irs.gov/publications/p583', ...usedRateSources],
  };
}

/** Owner-scoped loader. Transactions, mileage trips and receipt metadata are all ownership-checked before assembly. */
export async function readAuditSupportPacket(uid: string, year: number): Promise<AuditSupportPacket> {
  const transactions = await readOwnedTransactions(uid);
  let trips: ExportRecord[], receipts: ExportRecord[];
  try {
    const [tripSnapshot, ...receiptSnapshots] = await Promise.all([
      adminDb.collection(`user_profiles/${uid}/mileage_trips`).get(),
      ...['userId', 'user_id'].map(field => adminDb.collection('receipts').where(field, '==', uid).get()),
    ]);
    trips = tripSnapshot.docs.map(doc => ownedExportRecord(doc, uid, true));
    receipts = [...new Map(receiptSnapshots.flatMap(snapshot => snapshot.docs.map(doc => [doc.ref.path, doc] as const))).values()].map(doc => ownedExportRecord(doc, uid));
  } catch { throw new ExportDataUnavailableError(); }
  return assembleAuditSupportPacket(uid, year, { transactions, trips, receipts });
}

export const AUDIT_SUPPORT_CSV_HEADERS = [
  'Record Type', 'Reference', 'Date', 'Merchant / Trip', 'Recorded Amount (USD, + outflow)', 'Recorded Category', 'Schedule C Line',
  'Substantiation Category', 'Substantiation Status', 'Missing Records', 'Advisories', 'Business Purpose', 'Purpose Source', 'Attendees / Recipient',
  'Travel Destination', 'Travel Dates Recorded', 'Mileage Details', 'Receipt Filenames', 'Private Receipt Paths (sign-in required)', 'Receipt Declared Outside App',
  'Reviewed At', 'Review Source', 'Business-use %',
];
/** Deductions and mileage trips in one owner CSV; the hashed reference is the only identifier. */
export function auditSupportPacketCSV(packet: AuditSupportPacket): string {
  const rows = packet.deductions.map(record => ['Confirmed deduction', record.reference, record.date, record.merchant, record.amount, record.category, record.scheduleCLine ?? '',
    record.substantiation.label, record.substantiation.status === 'complete' ? 'Complete' : 'Needs records', record.substantiation.missing.join('; '), record.substantiation.advisories.join(' '),
    record.businessPurpose.text ?? '', record.businessPurpose.source ?? '', record.attendees.length ? record.attendees.join('; ') : record.clientProject ?? '',
    record.travel.destination ?? '', record.travel.datesRecorded ? 'Yes' : 'No',
    record.mileage ? [record.mileage.startLocation, record.mileage.endLocation].filter(Boolean).join(' -> ') + (record.mileage.miles ? ` (${record.mileage.miles} miles)` : '') : record.linkedTrips ? `${record.linkedTrips} logged trip(s) on this date` : '',
    record.receipts.map(receipt => receipt.filename ?? '').filter(Boolean).join('; '), record.receipts.map(receipt => receipt.path).filter(Boolean).join('; '), record.receiptDeclaredOutsideApp ? 'Yes' : 'No',
    record.review.reviewedAt ?? '', record.review.label, record.businessUsePercent ?? '']);
  for (const trip of packet.mileageLog.trips) {
    rows.push(['Mileage trip', trip.reference, trip.date, `${trip.startLocation} -> ${trip.endLocation}${trip.roundTrip ? ' (round trip)' : ''}`, trip.standardMileageAmount ?? '', 'Mileage log', '9',
      SUBSTANTIATION_RULES.vehicle.label, trip.substantiation.status === 'complete' ? 'Complete' : 'Needs records', trip.substantiation.missing.join('; '),
      trip.ratePerMile === null ? 'No IRS rate published for this trip date; amount not calculated.' : '', trip.businessPurpose ?? '', trip.businessPurpose ? 'mileage_log' : '', '', '', '',
      `${trip.miles} miles${trip.ratePerMile !== null ? ` @ $${trip.ratePerMile}/mile` : ''}`, '', '', '', '', 'Mileage tracker', '']);
  }
  return [AUDIT_SUPPORT_CSV_HEADERS.map(csvCell).join(','), ...rows.map(row => row.map(csvCell).join(','))].join('\r\n');
}

/** Premium PDF in the shared preparer-records style. Every claim stays a records statement. */
export async function generateAuditSupportPDF(packet: AuditSupportPacket): Promise<Uint8Array> {
  const year = packet.packetInfo.taxYear;
  const pdf = await createPlanningPDF(`${AUDIT_SUPPORT_TITLE} - Tax year ${year}`, year);
  pdf.paragraph(packet.coverNote[0], true);
  for (const note of packet.coverNote.slice(1)) pdf.paragraph(note);
  pdf.paragraph(`Generated ${packet.packetInfo.generatedAt.slice(0, 10)}. Confirmed deductions: ${packet.summary.deductionCount}. Mileage log trips: ${packet.summary.mileage.tripCount}. Excluded: ${packet.summary.excluded.notConfirmed} deductible records not yet confirmed through review, ${packet.summary.excluded.reviewRequired} awaiting tax review, ${packet.summary.excluded.pending} pending, ${packet.summary.excluded.bankRemoved} removed by the bank.`);
  pdf.section('Substantiation summary');
  pdf.table(['Status', 'Records', 'Recorded amount'], [
    ['Complete - every element required for the category is on file', String(packet.summary.byStatus.complete.count), money(packet.summary.byStatus.complete.amount)],
    ['Needs records - one or more elements are missing', String(packet.summary.byStatus.needs_records.count), money(packet.summary.byStatus.needs_records.amount)],
    ['All confirmed deductions', String(packet.summary.deductionCount), money(packet.summary.recordedAmount)],
  ], [318, 90, 120]);
  pdf.table(['Substantiation category', 'Records', 'Complete', 'Need records', 'Recorded amount'],
    packet.summary.byCategory.length ? packet.summary.byCategory.map(row => [row.label, String(row.count), String(row.complete), String(row.needsRecords), money(row.amount)]) : [['No confirmed deductions in this year', '0', '0', '0', money(0)]],
    [228, 70, 70, 80, 80]);
  if (packet.summary.missingItems.length) pdf.paragraph(`Most common missing records: ${packet.summary.missingItems.slice(0, 5).map(item => `${item.item} (${item.count})`).join('; ')}.`);
  pdf.section('Confirmed deductions and records on file');
  const recordsOnFile = (record: AuditEvidenceRecord) => [
    record.businessPurpose.text ? `Purpose: ${record.businessPurpose.text}` : 'Purpose: not recorded',
    record.attendees.length ? `Attendees: ${record.attendees.join(', ')}` : '', record.clientProject ? `Client/project: ${record.clientProject}` : '',
    record.travel.destination ? `Destination: ${record.travel.destination}` : '',
    record.mileage ? `Mileage: ${[record.mileage.startLocation, record.mileage.endLocation].filter(Boolean).join(' -> ')}${record.mileage.miles ? ` ${record.mileage.miles} mi` : ''}` : record.linkedTrips ? `Logged trips this date: ${record.linkedTrips}` : '',
    record.receipts.length ? `Receipt: ${record.receipts.map(receipt => receipt.filename ?? 'file').join(', ')} (private link)` : record.receiptDeclaredOutsideApp ? 'Receipt: kept outside WriteOff (declared)' : 'Receipt: none on file',
    `Reviewed: ${record.review.reviewedAt ? record.review.reviewedAt.slice(0, 10) : 'date not recorded'} - ${record.review.label}`,
  ].filter(Boolean).join('\n');
  pdf.table(['Date', 'Merchant / reference', 'Amount', 'Category', 'Status and missing records', 'Records on file'],
    packet.deductions.length ? packet.deductions.map(record => [record.date, `${record.merchant}\n${record.reference}`, money(record.amount), `${record.substantiation.label}\n${record.categoryLabel}`,
      record.substantiation.status === 'complete' ? 'Complete' : `Needs records: ${record.substantiation.missing.join('; ')}`, recordsOnFile(record)])
      : [['', 'No confirmed deductions in this year', money(0), '', '', '']],
    [56, 132, 62, 76, 116, 86]);
  pdf.section('Mileage log');
  pdf.paragraph(`${packet.summary.mileage.tripCount} trips, ${packet.summary.mileage.ratedMiles} rated miles, standard mileage amount ${money(packet.summary.mileage.standardMileageAmount)}${packet.summary.mileage.unratedTrips ? `, ${packet.summary.mileage.unratedTrips} trip(s) without a published rate` : ''}. Trips needing records: ${packet.summary.mileage.tripsNeedingRecords}.`);
  pdf.table(['Date', 'Trip', 'Miles', 'Rate', 'Amount', 'Purpose / missing records'],
    packet.mileageLog.trips.length ? packet.mileageLog.trips.map(trip => [trip.date, `${trip.startLocation} -> ${trip.endLocation}${trip.roundTrip ? ' (round trip)' : ''}`, String(trip.miles), trip.ratePerMile === null ? 'Pending' : `$${trip.ratePerMile.toFixed(3)}`,
      trip.standardMileageAmount === null ? 'Not calculated' : money(trip.standardMileageAmount), trip.substantiation.status === 'complete' ? trip.businessPurpose ?? '' : `${trip.businessPurpose ?? ''}\nMissing: ${trip.substantiation.missing.join('; ')}`])
      : [['', 'No mileage trips recorded for this year', '0', '', money(0), '']],
    [56, 150, 50, 50, 70, 152]);
  for (const note of packet.mileageLog.notes) pdf.paragraph(note);
  pdf.section('How long to keep these records (IRS Publication 583, Table 3)');
  pdf.table(['Situation', 'Keep records', 'Keep at least until'], packet.retention.rows.map(row => [row.situation, row.period, row.keepUntil]), [268, 110, 150]);
  for (const note of packet.retention.notes) pdf.paragraph(note);
  pdf.section('Standards applied');
  for (const standard of packet.standards) pdf.paragraph(`${standard.label}: ${standard.standard}`);
  pdf.paragraph(`Sources: ${packet.sources.join(' ; ')}. Unsupported font characters are preserved as U+codepoints.`);
  return pdf.save();
}
