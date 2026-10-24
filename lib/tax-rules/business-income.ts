import { calendarChargeDay } from '@/lib/schedule-c/taxDate';
import { isCountableRecord } from '@/lib/transactions/record-scope';
import { resolveIncomeSources, type FeeExpenseCandidate, type IncomeReconciliationConflict, type IncomeSourceCandidate } from './income-reconciliation';

export type IncomeRecord = Record<string, unknown>;

export class IncomeReconciliationRequiredError extends Error {
  readonly code = 'INCOME_RECONCILIATION_REQUIRED';
  /** Conflicting records by reference, for the reconciliation workflow. Empty for malformed/unsupported records. */
  readonly conflicts: IncomeReconciliationConflict[];
  constructor(detail: string, conflicts: IncomeReconciliationConflict[] = []) {
    super(`Review income sources before calculating tax: ${detail} No tax total has been calculated. Use Income → Reconcile to record how overlapping records relate, or review imported documents against your records. WriteOff never merges or deletes records automatically.`);
    this.conflicts = conflicts;
  }
}

const money = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new IncomeReconciliationRequiredError('An income record has an invalid amount.');
  }
  return Math.round(value * 100);
};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const recordId = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

/** No saved zone: these two civil days must agree. The process time zone is never used. */
const PAGO_PAGO = 'Pacific/Pago_Pago';
const ST_THOMAS = 'America/St_Thomas';

/**
 * The 18 UTC names copied exactly from PR #84 `lib/ocr/region-time-zone.ts`.
 * Comparison is lowercase. Z is not one of them. Etc/GMT with an hour other
 * than 0 is not one of them, because those signs are reversed.
 */
const UTC_ZONE_ALIASES = new Set([
  'utc',
  'etc/utc',
  'etc/gmt',
  'gmt',
  'etc/universal',
  'universal',
  'etc/zulu',
  'zulu',
  'gmt0',
  'etc/gmt0',
  'etc/gmt+0',
  'gmt+0',
  'gmt-0',
  'etc/gmt-0',
  'uct',
  'etc/uct',
  'greenwich',
  'etc/greenwich',
]);

type IncomePlacement =
  | { action: 'dated'; day: string }
  | { action: 'undated' }
  | { action: 'nmi' }
  | { action: 'skip' };

function rowLabel(tx: IncomeRecord): string {
  const name = text(tx.merchant_name) || text(tx.name);
  const id = recordId(tx.trans_id ?? tx.id);
  if (name && id) return `${name} (${id})`;
  return name || id || 'Bank deposit';
}

/** Epoch millis for a Date, Firestore Timestamp, {seconds, nanoseconds}, or finite number. Strings stay written days. */
function instantMillis(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      const date = (value as { toDate: () => Date }).toDate();
      if (date instanceof Date && !Number.isNaN(date.getTime())) return date.getTime();
    } catch {
      return null;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const seconds = (value as { seconds?: unknown }).seconds;
    if (typeof seconds === 'number' && Number.isFinite(seconds)) {
      const nanos = (value as { nanoseconds?: unknown }).nanoseconds;
      const extra = typeof nanos === 'number' && Number.isFinite(nanos) ? Math.trunc(nanos / 1e6) : 0;
      return seconds * 1000 + extra;
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value) < 1e11 ? value * 1000 : value;
  return null;
}

function holdsInstant(value: unknown): boolean {
  if (value instanceof Date || typeof value === 'number') return true;
  if (!value || typeof value !== 'object') return false;
  if (typeof (value as { toDate?: unknown }).toDate === 'function') return true;
  return typeof (value as { seconds?: unknown }).seconds === 'number';
}

function civilDay(millis: number, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(millis));
    const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
    const year = pick('year');
    const month = pick('month');
    const day = pick('day');
    if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return null;
    return `${year}-${month}-${day}`;
  } catch {
    return null;
  }
}

/**
 * Same acceptance rule as PR #84 `regionUploadTimeZone`. Padding is not trimmed.
 * A canonical UTC name counts only when the raw spelling is one of the 18 aliases.
 * A canonical Etc/ name, including Etc/GMT+N and Etc/GMT-N, is not a saved zone.
 * An unsaved zone uses the Pago Pago and St Thomas agreement below.
 */
function acceptedSavedZone(zone: unknown): string | null {
  if (typeof zone !== 'string' || zone.length === 0) return null;
  let canonical: string;
  try {
    canonical = new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  if (canonical === 'UTC') return UTC_ZONE_ALIASES.has(zone.toLowerCase()) ? 'UTC' : null;
  if (!canonical.includes('/') || canonical.startsWith('Etc/')) return null;
  if (!zone.includes('/') && zone.toLowerCase() !== canonical.toLowerCase()) return null;
  return canonical;
}

/** Day in an accepted uploadTimeZone, or the agreed Pago Pago and St Thomas day. Disagreement is unresolved. */
function dayInSavedZone(millis: number, zone: unknown): string | 'nmi' {
  const saved = acceptedSavedZone(zone);
  if (saved) return civilDay(millis, saved) ?? 'nmi';
  const pago = civilDay(millis, PAGO_PAGO);
  const thomas = civilDay(millis, ST_THOMAS);
  if (!pago || !thomas || pago !== thomas) return 'nmi';
  return pago;
}

function placedInstant(millis: number, zone: unknown, taxYear: number, inQuarter: boolean): IncomePlacement {
  const day = dayInSavedZone(millis, zone);
  if (day === 'nmi') return { action: 'nmi' };
  if (Number(day.slice(0, 4)) !== taxYear) return { action: 'skip' };
  return inQuarter ? { action: 'dated', day } : { action: 'undated' };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const WRITTEN_DAY_SHAPE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|Z$|T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$| \d{2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?$)/;

/** A string that has a year, month, and day, but that day is not on the calendar. Junk text is not this case. */
function impossibleCalendarDate(value: string): boolean {
  const trimmed = value.trim();
  const iso = WRITTEN_DAY_SHAPE.exec(trimmed);
  const parts = iso ?? /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(trimmed);
  if (!parts) return false;
  const day = `${parts[1]}-${pad2(Number(parts[2]))}-${pad2(Number(parts[3]))}`;
  return calendarChargeDay(day) !== day;
}

/**
 * Dated when `date` is a Timestamp, Date, or {seconds, nanoseconds}. A written
 * calendar day uses that day, including a full validity check. Blank and
 * unreadable dates stay with this tax year. A following datetime is used only
 * then, and only to decide the year. It does not invent a quarter.
 */
function placeIncomeDate(tx: IncomeRecord, taxYear: number): IncomePlacement {
  const zone = tx.uploadTimeZone;
  if (holdsInstant(tx.date)) {
    const millis = instantMillis(tx.date);
    if (millis === null) return { action: 'nmi' };
    return placedInstant(millis, zone, taxYear, true);
  }
  if (typeof tx.date === 'string') {
    if (impossibleCalendarDate(tx.date)) return { action: 'nmi' };
    const written = calendarChargeDay(tx.date);
    if (written) return Number(written.slice(0, 4)) === taxYear ? { action: 'dated', day: written } : { action: 'skip' };
  }
  const follow = instantMillis(tx.datetime);
  const followString = typeof tx.datetime === 'string' && tx.datetime.trim() ? Date.parse(tx.datetime.trim()) : Number.NaN;
  const followMillis = follow ?? (Number.isFinite(followString) ? followString : null);
  if (followMillis !== null) return placedInstant(followMillis, zone, taxYear, false);
  return { action: 'undated' };
}

function quarterIndex(day: string): number {
  return Math.floor((Number(day.slice(5, 7)) - 1) / 3);
}

/** The reconcilable records of a tax year, labelled only with what the owner already sees. */
export function listIncomeSourceCandidates(taxYear: number, transactions: ReadonlyArray<IncomeRecord>, receipts: ReadonlyArray<IncomeRecord>, forms: ReadonlyArray<IncomeRecord>) {
  const candidates: IncomeSourceCandidate[] = [];
  const txById = new Set<string>();
  const quarterCents = [0, 0, 0, 0];
  const dateWarnings: string[] = [];
  const needsMoreInformationRows: NeedsMoreInformationRow[] = [];
  const dateNeedsReview: DateNeedsReviewRow[] = [];
  let undatedCount = 0;
  let undatedCents = 0;
  let unclassifiedCreditCount = 0;
  for (const tx of transactions) {
    // Pending, bank-removed and superseded duplicate records are never income candidates.
    if (!isCountableRecord(tx)) continue;
    const category = typeof tx.category === 'string' ? tx.category.toLowerCase() : '';
    // Both transaction readers derive `type` from the amount sign, including
    // manual-account refunds. Require a recorded income category for every
    // account; otherwise an expense refund becomes receipts and nets expenses.
    const explicitIncome = category === 'income' || category === 'revenue';
    if (!explicitIncome) {
      if (typeof tx.date !== 'string' || Number(tx.date.slice(0, 4)) !== taxYear) continue;
      if (typeof tx.amount === 'number' && tx.amount < 0) unclassifiedCreditCount++;
      continue;
    }
    if (typeof tx.amount !== 'number' || !Number.isFinite(tx.amount) || tx.amount >= 0) {
      throw new IncomeReconciliationRequiredError('A transaction classified as business income must be a posted receipt; reversals require review.');
    }
    const id = recordId(tx.trans_id ?? tx.id);
    const key = id ? `${recordId(tx.account_id)}:${id}` : undefined;
    if (key && txById.has(key)) continue;
    if (key) txById.add(key);
    const placement = placeIncomeDate(tx, taxYear);
    const label = rowLabel(tx);
    if (placement.action === 'skip') continue;
    const name = text(tx.merchant_name) || text(tx.name);
    if (placement.action === 'nmi') {
      dateWarnings.push(`${label} needs more information. This receipt cannot be placed on one calendar day, so it is left out of every year total and the quarter split.`);
      needsMoreInformationRows.push({ ...(id ? { id } : {}), ...(name ? { name } : {}), reason: 'The saved date cannot be placed on one calendar day.' });
      continue;
    }
    const payer = name || 'Bank deposit';
    const cents = money(-tx.amount);
    if (placement.action === 'dated') {
      quarterCents[quarterIndex(placement.day)] += cents;
      candidates.push({ kind: 'transaction', id, amount: cents / 100, label: `Bank income · ${payer}`, date: placement.day });
      if (tx.dateOrderAssumed === 'month_day') {
        dateWarnings.push(`${label} was read as month then day and has not been reviewed.`);
        dateNeedsReview.push({ id, date: placement.day, amount: cents / 100 });
      }
      continue;
    }
    undatedCount += 1;
    undatedCents += cents;
    dateWarnings.push(`${label} has a blank or unreadable date, so this receipt stays in the ${taxYear} annual total and is left out of the quarter split.`);
    candidates.push({ kind: 'transaction', id, amount: cents / 100, label: `Bank income · ${payer}` });
  }

  const receiptsById = new Map<string, number>();
  for (const receipt of receipts) {
    if (receipt.type === 'rental' || receipt.type === 'interest_dividends') {
      throw new IncomeReconciliationRequiredError('Rental or investment income cannot be treated automatically as Schedule C business receipts.');
    }
    const cents = money(receipt.amount);
    const id = recordId(receipt.id);
    if (id) receiptsById.set(id, cents);
    candidates.push({ kind: 'gross_receipt', id, amount: cents / 100, label: `Direct income · ${text(receipt.source) || 'Unnamed payer'}`, ...(typeof receipt.date === 'string' ? { date: receipt.date.slice(0, 10) } : {}) });
  }

  // Every NEC/K amount documents receipts whether it stands alone, is linked to its imported
  // gross receipt, or is reconciled to a bank deposit by an owner decision; never additive.
  let form1099Cents = 0;
  let linkedForms = 0;
  for (const form of forms) {
    if (form.formType !== '1099-NEC' && form.formType !== '1099-K') {
      throw new IncomeReconciliationRequiredError('Confirm the tax treatment of this 1099. Only business NEC/K income is included automatically; MISC, interest, dividends and securities require separate review.');
    }
    const cents = money(form.amount);
    form1099Cents += cents;
    const candidate: IncomeSourceCandidate = { kind: 'form_1099', id: recordId(form.id), amount: cents / 100, formType: form.formType, label: `${form.formType} · ${text(form.payerName) || text(form.payer) || 'Unknown payer'}` };
    if (form.grossReceiptId !== undefined) {
      const receiptAmount = typeof form.grossReceiptId === 'string' ? receiptsById.get(form.grossReceiptId) : undefined;
      if (form.source !== 'document_import' || receiptAmount === undefined || receiptAmount !== cents) {
        throw new IncomeReconciliationRequiredError('A linked 1099 does not match its original gross receipt. Confirm gross versus net amounts and the original document.');
      }
      linkedForms++;
      candidate.linkedImport = true;
    }
    candidates.push(candidate);
  }
  return { candidates, unclassifiedCreditCount, linkedForms, form1099Cents, quarterCents, dateWarnings, needsMoreInformationRows, dateNeedsReview, undatedCount, undatedCents };
}

export interface NeedsMoreInformationRow {
  id?: string;
  name?: string;
  reason: string;
}

/** A real date read as month then day from an ambiguous receipt, still waiting for review. Amount is positive dollars counted in gross receipts. */
export interface DateNeedsReviewRow {
  id: string;
  date: string;
  amount: number;
}

export interface BusinessIncomeReconciliation {
  grossReceipts: number;
  source: 'transactions' | 'gross_receipts' | 'income_1099' | 'reconciled' | 'none';
  /** Receipts documented on NEC/K forms (standalone, linked or reconciled); a subset view, never added to grossReceipts. */
  form1099Receipts: number;
  linkedDocumentCount: number;
  unclassifiedCreditCount: number;
  reconciledDecisionCount: number;
  /** Platform fees recorded with a 1099-K decision: review candidates, not recorded expenses. */
  feeExpenseCandidates: FeeExpenseCandidate[];
  warnings: string[];
  /** Dated bank income by calendar quarter. Blank rows and rows that cannot be placed are not included. */
  quarterlyGrossReceipts: [number, number, number, number];
  /** Blank or unreadable income kept in grossReceipts and left out of the quarter split. */
  undatedIncome: { count: number; total: number };
  /** Rows that cannot be placed in any year. They are in no year total. */
  needsMoreInformationRows: NeedsMoreInformationRow[];
  /** Dated income whose month and day order was assumed and has not been reviewed. These rows stay in quarterlyGrossReceipts. */
  dateNeedsReview: DateNeedsReviewRow[];
}

/**
 * Receipts, bank entries and information returns are alternative evidence of
 * receipts, not automatically additive income. Existing records have no shared
 * payment ID. Never deduplicate by payer/amount or choose a source silently.
 * Only a server-created grossReceiptId or an owner-recorded reconciliation
 * decision can establish that two records describe the same payments.
 */
export function reconcileBusinessIncome(taxYear: number, transactions: ReadonlyArray<IncomeRecord>, receipts: ReadonlyArray<IncomeRecord>, forms: ReadonlyArray<IncomeRecord>, decisions: ReadonlyArray<IncomeRecord> = []): BusinessIncomeReconciliation {
  const { candidates, unclassifiedCreditCount, linkedForms, form1099Cents, quarterCents, dateWarnings, needsMoreInformationRows, dateNeedsReview, undatedCount, undatedCents } = listIncomeSourceCandidates(taxYear, transactions, receipts, forms);
  const resolution = resolveIncomeSources(taxYear, candidates, decisions);
  if (resolution.conflicts.length) {
    throw new IncomeReconciliationRequiredError(resolution.conflicts[0].message, resolution.conflicts);
  }
  const { unclaimedCents } = resolution;
  const warnings = unclassifiedCreditCount
    ? [`${unclassifiedCreditCount} posted inflow(s) are excluded from business receipts until classified as income/revenue. A bank credit alone may be a transfer, loan or refund.`]
    : [];
  for (const fee of resolution.feeExpenseCandidates) {
    warnings.push(`Platform fees of $${fee.amount.toFixed(2)} recorded with ${fee.label} are an expense candidate for your review. Gross receipts use the 1099-K gross amount; the fee is not recorded as a deductible expense until you add and confirm it.`);
  }
  warnings.push(...dateWarnings);
  const unclaimedTotal = unclaimedCents.transaction + unclaimedCents.gross_receipt + unclaimedCents.form_1099;
  return {
    grossReceipts: (resolution.reconciledCents + unclaimedTotal) / 100,
    source: resolution.appliedDecisionIds.length ? 'reconciled'
      : unclaimedCents.transaction > 0 ? 'transactions' : unclaimedCents.gross_receipt > 0 ? 'gross_receipts' : unclaimedCents.form_1099 > 0 ? 'income_1099' : 'none',
    form1099Receipts: form1099Cents / 100,
    linkedDocumentCount: linkedForms,
    unclassifiedCreditCount,
    reconciledDecisionCount: resolution.appliedDecisionIds.length,
    feeExpenseCandidates: resolution.feeExpenseCandidates,
    warnings,
    quarterlyGrossReceipts: [quarterCents[0] / 100, quarterCents[1] / 100, quarterCents[2] / 100, quarterCents[3] / 100],
    undatedIncome: { count: undatedCount, total: undatedCents / 100 },
    needsMoreInformationRows,
    dateNeedsReview,
  };
}
