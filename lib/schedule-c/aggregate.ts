/**
 * Schedule C aggregation — single source of truth for expense/deductible totals and line items.
 * Used by: Schedule C Export API (PDF), and optionally UI preview.
 *
 * Rules:
 * - Expenses: outflows only (amount > 0, or type === 'expense' when present). Use Math.abs(amount) for line totals.
 * - Deductible: is_deductible === true OR (is_deductible == null AND category in business list AND amount > 0). Refunds (negative) excluded.
 * - Meals (line 24b): 50% deductible.
 * - Vehicle actual expenses, loan interest, and vehicle property tax count only at a
 *   business_use_percentage from 0 through 100. A missing, non-numeric, NaN, or out-of-range
 *   share adds 0 to the deductible, keeps the bank amount in the line total, and returns that
 *   stored line-item row to deductionStatus "Needs more information" with the existing reason.
 * - Year filter: transaction date year === selected year.
 * - confirmed-only: posted records whose deduction the server confirmed
 *   (review_status === 'confirmed', or a legacy pre-cutoff decision; see
 *   lib/transactions/confirmed-deduction.ts), excluding tax-method placeholders.
 * - Superseded records (`superseded_by`, set by historical-overlap reconciliation)
 *   are excluded in both modes; see lib/transactions/record-scope.ts.
 *
 * PDF generation path: route → getTransactionsServer(uid) → aggregateScheduleC → pdf-lib.
 */

import { otherExpensesYearPrint } from './export-lines';
import { resolveScheduleCPrint } from './line-labels';
import { safeTaxYear } from './taxDate';
import { finiteUsePercent, ACTUAL_EXPENSE_BUSINESS_SHARE, VEHICLE_ACTUAL_EXPENSE_CATEGORY } from '@/lib/ai/actual-expense-share';
import { SEPARATE_VEHICLE_COST_SHARE } from '@/lib/ai/vehicle-separate-costs';
import { isServerConfirmedDeduction } from '@/lib/transactions/confirmed-deduction';
import { isCountableRecord, isSupersededRecord } from '@/lib/transactions/record-scope';

export type CategoryMapEntry = { line: string; name: string; code: string };

export const CATEGORY_MAP: Record<string, CategoryMapEntry> = {
  // ── Line 8: Advertising ──────────────────────────────────────────────
  'SERVICE_ADVERTISING': { line: '8', name: 'Advertising', code: '8' },
  'SERVICE_MARKETING': { line: '8', name: 'Advertising', code: '8' },
  'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES': { line: '8', name: 'Advertising', code: '8' },

  // ── Line 9: Car and truck expenses ───────────────────────────────────
  'TRANSPORTATION_RIDESHARE': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_AUTO_PARKING': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_AUTO_REPAIR': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_AUTO_SERVICE': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_FUEL': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_TOLLS': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_PARKING_AND_TOLLS': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_PUBLIC_TRANSIT': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_CAR_WASH': { line: '9', name: 'Car and truck expenses', code: '9' },
  'VEHICLE_ACTUAL_EXPENSE': { line: '9', name: 'Car and truck expenses', code: '9' },
  'VEHICLE_PROPERTY_TAX': { line: '23', name: 'Taxes and licenses', code: '23' },

  // ── Line 10: Commissions and fees ────────────────────────────────────
  'BANK_FEES_ATM_FEES': { line: '10', name: 'Commissions and fees', code: '10' },
  'BANK_FEES_FOREIGN_TRANSACTION': { line: '10', name: 'Commissions and fees', code: '10' },
  'BANK_FEES_OVERDRAFT': { line: '10', name: 'Commissions and fees', code: '10' },
  'BANK_FEES_OTHER_BANK_FEES': { line: '10', name: 'Commissions and fees', code: '10' },
  'SERVICE_FINANCIAL_PLANNING_AND_INVESTMENTS': { line: '10', name: 'Commissions and fees', code: '10' },

  // ── Line 11: Contract labor ──────────────────────────────────────────
  'SERVICE_FREELANCE_SERVICES': { line: '11', name: 'Contract labor', code: '11' },

  // ── Line 15: Insurance ───────────────────────────────────────────────
  'SERVICE_INSURANCE': { line: '15', name: 'Insurance', code: '15' },
  'TRANSPORTATION_AUTO_INSURANCE': { line: '15', name: 'Insurance', code: '15' },

  // ── Line 16b: Interest (other) ───────────────────────────────────────
  'VEHICLE_LOAN_INTEREST': { line: '16b', name: 'Interest: other', code: '16b' },

  // ── Line 16a: Interest (mortgage) ────────────────────────────────────
  'LOAN_INTEREST': { line: '16a', name: 'Interest (mortgage)', code: '16a' },
  'LOAN_INTEREST_MORTGAGE': { line: '16a', name: 'Interest (mortgage)', code: '16a' },

  // ── Line 17: Legal and professional services ─────────────────────────
  'SERVICE_ACCOUNTING': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_CONSULTING': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_LEGAL': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_LEGAL_AND_PROFESSIONAL': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_SECURITY': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_TAX_PREPARATION': { line: '17', name: 'Legal and professional services', code: '17' },

  // ── Line 18: Office expense (office supplies and postage) ────────────
  'GENERAL_MERCHANDISE_OFFICE_SUPPLIES': { line: '18', name: 'Office expense', code: '18' },

  // ── Line 20a: Rent (vehicles, machinery, equipment) ──────────────────
  'TRANSPORTATION_RENTAL_CAR': { line: '20a', name: 'Rent (vehicles/equipment)', code: '20a' },

  // ── Line 20b: Rent (other business property) ─────────────────────────
  'RENT_RENT': { line: '20b', name: 'Rent (other business property)', code: '20b' },
  'RENT_COWORKING': { line: '20b', name: 'Rent (other business property)', code: '20b' },
  'SERVICE_STORAGE': { line: '20b', name: 'Rent (other business property)', code: '20b' },

  // ── Line 21: Repairs and maintenance ─────────────────────────────────
  'SERVICE_REPAIRS_AND_MAINTENANCE': { line: '21', name: 'Repairs and maintenance', code: '21' },

  // ── Line 22: Supplies ────────────────────────────────────────────────
  'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE': { line: '22', name: 'Supplies', code: '22' },
  'SERVICE_SHIPPING': { line: '22', name: 'Supplies', code: '22' },
  'SERVICE_PRINTING_AND_COPYING': { line: '22', name: 'Supplies', code: '22' },
  'GENERAL_MERCHANDISE_HARDWARE_STORE': { line: '22', name: 'Supplies', code: '22' },
  'GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS': { line: '22', name: 'Supplies', code: '22' },

  // ── Line 23: Taxes and licenses ──────────────────────────────────────
  'GOVERNMENT_TAXES_AND_LICENSES': { line: '23', name: 'Taxes and licenses', code: '23' },

  // ── Line 24a: Travel ─────────────────────────────────────────────────
  'TRAVEL_FLIGHTS': { line: '24a', name: 'Travel', code: '24a' },
  'TRAVEL_LODGING': { line: '24a', name: 'Travel', code: '24a' },
  'TRAVEL_OTHER_TRAVEL': { line: '24a', name: 'Travel', code: '24a' },
  'TRAVEL_TAXI': { line: '24a', name: 'Travel', code: '24a' },

  // ── Line 24b: Meals (50% deductible) ─────────────────────────────────
  'FOOD_AND_DRINK_COFFEE_SHOP': { line: '24b', name: 'Meals', code: '24b' },
  'FOOD_AND_DRINK_FAST_FOOD': { line: '24b', name: 'Meals', code: '24b' },
  'FOOD_AND_DRINK_RESTAURANT': { line: '24b', name: 'Meals', code: '24b' },
  'FOOD_AND_DRINK_ALCOHOL_AND_BARS': { line: '24b', name: 'Meals', code: '24b' },
  'FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK': { line: '24b', name: 'Meals', code: '24b' },
  'FOOD_AND_DRINK_VENDING_MACHINES': { line: '24b', name: 'Meals', code: '24b' },

  // ── Line 25: Utilities ───────────────────────────────────────────────
  'SERVICE_UTILITIES': { line: '25', name: 'Utilities', code: '25' },
  'SERVICE_INTERNET_AND_CABLE': { line: '25', name: 'Utilities', code: '25' },
  'SERVICE_PHONE': { line: '25', name: 'Utilities', code: '25' },
  'SERVICE_ELECTRICITY': { line: '25', name: 'Utilities', code: '25' },
  'SERVICE_GAS': { line: '25', name: 'Utilities', code: '25' },
  'SERVICE_WATER': { line: '25', name: 'Utilities', code: '25' },

  // ── Line 27a: Other expenses ─────────────────────────────────────────
  'ENTERTAINMENT_SPORTS_AND_OUTDOORS': { line: '27a', name: 'Other expenses', code: '27a' },
  'ENTERTAINMENT_ARTS': { line: '27a', name: 'Other expenses', code: '27a' },
  'ENTERTAINMENT_THEATER': { line: '27a', name: 'Other expenses', code: '27a' },
  'ENTERTAINMENT_MUSIC': { line: '27a', name: 'Other expenses', code: '27a' },
  'ENTERTAINMENT_MOVIES_AND_DVDS': { line: '27a', name: 'Other expenses', code: '27a' },
  'GENERAL_MERCHANDISE_SPORTING_GOODS': { line: '27a', name: 'Other expenses', code: '27a' },
  'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS': { line: '27a', name: 'Other expenses', code: '27a' },
  'COMMUNITY_CHARITY': { line: '27a', name: 'Other expenses', code: '27a' },
  'COMMUNITY_EDUCATION': { line: '27a', name: 'Other expenses', code: '27a' },
  'COMMUNITY_RELIGIOUS': { line: '27a', name: 'Other expenses', code: '27a' },
  'SERVICE_CLEANING_AND_MAINTENANCE': { line: '27a', name: 'Other expenses', code: '27a' },
  'SERVICE_PROFESSIONAL_DUES': { line: '27a', name: 'Other expenses', code: '27a' },
  'SERVICE_MEMBERSHIPS': { line: '27a', name: 'Other expenses', code: '27a' },
  'SERVICE_EDUCATION': { line: '27a', name: 'Other expenses', code: '27a' },
  'HIRED_LOCAL_TRANSPORT': { line: '27a', name: 'Other expenses', code: '27a' },
};

const BUSINESS_CATEGORY_KEYS = new Set(Object.keys(CATEGORY_MAP));

/** $2,500.00 per invoice or item without an applicable financial statement. $2,500.01 does not qualify. */
export const DE_MINIMIS_SAFE_HARBOR_CENTS = 250_000;
export const DE_MINIMIS_ELECTION_NOTE =
  "The de minimis safe harbor election statement must be attached to that year's return.";

const MULTI_YEAR_OR_LIFETIME = /\b(?:multi[\s-]*year|lifetime)\b/i;

/** Categories whose line depends on the charge, not a static map entry. */
export const CONDITIONAL_BUSINESS_CATEGORIES = new Set([
  'GENERAL_MERCHANDISE_COMPUTERS_AND_ELECTRONICS',
  'GENERAL_MERCHANDISE_HOME_IMPROVEMENT',
  'SERVICE_SUBSCRIPTION',
]);

export type CategoryTreatment = {
  line: string | null;
  name: string | null;
  /** Personal by default. Contributes nothing and is not Needs more information. */
  personal: boolean;
  needsMoreInformation: boolean;
  exportNote: string | null;
  /**
   * True only for a category that is not in the map and is not a ruled category.
   * The aggregate loop then uses the base unmapped fallback. The alias head sends
   * those categories to Needs more information by changing unmappedCategoryTreatment.
   */
  unmapped: boolean;
};

const NEEDS_MORE: CategoryTreatment = { line: null, name: null, personal: false, needsMoreInformation: true, exportNote: null, unmapped: false };
const PERSONAL_ZERO: CategoryTreatment = { line: null, name: null, personal: true, needsMoreInformation: false, exportNote: null, unmapped: false };
const NO_LINE: CategoryTreatment = { line: null, name: null, personal: false, needsMoreInformation: false, exportNote: null, unmapped: false };

function partV(exportNote: string | null, unmapped = false): CategoryTreatment {
  return { line: '27a', name: 'Other expenses', personal: false, needsMoreInformation: false, exportNote, unmapped };
}

/**
 * Categories with no map entry and no ruling.
 * Today they print as Other expenses. The alias head changes this return to Needs more information.
 * Software, SERVICE_SUBSCRIPTION, and the $2,500 cap are ruled above this helper so that change does not move them.
 */
function unmappedCategoryTreatment(category: string): CategoryTreatment {
  if (!category) return NO_LINE;
  return partV(null, true);
}

export function merchantRecurrenceKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function chargeAmountCents(amount: unknown): number | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  return Math.round(Math.abs(amount) * 100);
}

type MerchantFields = { id?: unknown; merchant_name?: unknown; merchant?: unknown; name?: unknown };

function merchantOf(tx: MerchantFields): string {
  return merchantRecurrenceKey(tx.merchant_name ?? tx.merchant ?? tx.name);
}

/** True when another charge in the working set uses the same merchant. The row itself does not count. */
export function chargeRecursFromMerchant(tx: MerchantFields, peers: readonly MerchantFields[]): boolean {
  const key = merchantOf(tx);
  if (!key) return false;
  const selfId = typeof tx.id === 'string' && tx.id ? tx.id : '';
  for (const peer of peers) {
    if (peer === tx) continue;
    if (selfId && peer.id === selfId) continue;
    if (merchantOf(peer) === key) return true;
  }
  return false;
}

function descriptionOf(tx: ScheduleCTransactionLike): string {
  return typeof tx.description === 'string' ? tx.description : '';
}

/**
 * Software is guessed from the charge pattern. A recurring merchant, including every
 * SERVICE_SUBSCRIPTION charge that shares its merchant with another charge, is Part V.
 * A one-off at or under $2,500.00 is Part V with the de minimis election note.
 * A one-off over $2,500.00, or a description that says multi-year or lifetime, needs more information.
 */
function softwareTreatment(tx: ScheduleCTransactionLike, peers: readonly MerchantFields[]): CategoryTreatment {
  if (MULTI_YEAR_OR_LIFETIME.test(descriptionOf(tx))) return NEEDS_MORE;
  if (tx.schedule_c_recurring === true || chargeRecursFromMerchant(tx, peers)) return partV(null);
  const cents = chargeAmountCents(tx.amount);
  if (cents !== null && cents <= DE_MINIMIS_SAFE_HARBOR_CENTS) return partV(DE_MINIMIS_ELECTION_NOTE);
  return NEEDS_MORE;
}

/**
 * Shared Schedule C line for one charge. Card, totals, both CSVs, the PDF and the audit packet call this.
 * Year printing of Part V stays in otherExpensesYearPrint. A static map line is returned unchanged.
 * Ruled categories are pharmacy, home improvement, computers, and SERVICE_SUBSCRIPTION.
 */
export function resolveCategoryTreatment(tx: ScheduleCTransactionLike, peers: readonly MerchantFields[] = [], categoryMap: Record<string, CategoryMapEntry> = CATEGORY_MAP): CategoryTreatment {
  const category = typeof tx.category === 'string' ? tx.category.trim() : '';
  if (category === 'GENERAL_MERCHANDISE_PHARMACY') return tx.is_deductible === true ? NEEDS_MORE : PERSONAL_ZERO;
  if (category === 'GENERAL_MERCHANDISE_HOME_IMPROVEMENT') return NEEDS_MORE;
  if (category === 'GENERAL_MERCHANDISE_COMPUTERS_AND_ELECTRONICS') {
    const cents = chargeAmountCents(tx.amount);
    if (cents !== null && cents <= DE_MINIMIS_SAFE_HARBOR_CENTS) return partV(DE_MINIMIS_ELECTION_NOTE);
    return NEEDS_MORE;
  }
  if (category === 'SERVICE_SUBSCRIPTION') return softwareTreatment(tx, peers);
  const mapped = category ? categoryMap[category] : undefined;
  if (mapped) return { line: mapped.line, name: mapped.name, personal: false, needsMoreInformation: false, exportNote: null, unmapped: false };
  if (category.endsWith('_REVIEW_REQUIRED')) return NO_LINE;
  return unmappedCategoryTreatment(category);
}

export interface ScheduleCTransactionLike {
  amount: number;
  date: string;
  category: string;
  is_deductible?: boolean | null;
  pending?: boolean | null;
  tax_review_required?: boolean;
  /** Server-only: path of the earlier record this one duplicates; such records never count. */
  superseded_by?: string | null;
  merchant_name?: string;
  id?: string;
  /** Saved Schedule C label. Energy-named 27a/27b labels stay out of totals. */
  schedule_c_line?: string | null;
  scheduleC_line?: string | null;
  [key: string]: unknown;
}

/** Normalized amount for expense totals (refunds not counted as positive expense). */
export function normalizeAmount(tx: ScheduleCTransactionLike): number {
  return Math.abs(tx.amount);
}

/** True if transaction counts as a business/deductible expense: confirmed or potential (business category + positive amount). Pharmacy is personal unless the user marks it business. */
export function isBusinessExpense(tx: ScheduleCTransactionLike): boolean {
  if (tx.category === 'GENERAL_MERCHANDISE_PHARMACY' && tx.is_deductible !== true) return false;
  if (tx.is_deductible === true) return true;
  if (tx.is_deductible == null && tx.amount > 0 && (BUSINESS_CATEGORY_KEYS.has(tx.category) || CONDITIONAL_BUSINESS_CATEGORIES.has(tx.category))) return true;
  return false;
}

/** confirmed-only filter: countable (posted, not superseded), server-confirmed, and not a tax-method placeholder category. */
export function isConfirmedScheduleCExpense(tx: ScheduleCTransactionLike): boolean {
  return isCountableRecord(tx)
    && !(typeof tx.category === 'string' && tx.category.endsWith('_REVIEW_REQUIRED'))
    && isServerConfirmedDeduction(tx);
}

export interface LineItemSummary {
  lineCode: string;
  lineName: string;
  total: number;
  deductible: number;
  transactionCount: number;
  transactions: ScheduleCTransactionLike[];
}

export interface AggregateScheduleCResult {
  totalExpenses: number;
  totalDeductible: number;
  lineItems: Record<string, LineItemSummary>;
  lineItemsArray: LineItemSummary[];
  /** Confirmed rows withheld from every Schedule C line. Not a line item and not part of either total. */
  needsMoreInformation: ScheduleCTransactionLike[];
  counts: { deductible: number; year: number };
}

export type AggregateScheduleCMode = 'default' | 'confirmed-only';
export interface AggregateScheduleCOptions {
  mode?: AggregateScheduleCMode;
}

/**
 * Filter by year, then by isBusinessExpense; group by Schedule C line; apply 50% for meals (24b).
 */
const BUSINESS_USE_SHARE_CATEGORIES = new Set(['VEHICLE_ACTUAL_EXPENSE', 'VEHICLE_LOAN_INTEREST', 'VEHICLE_PROPERTY_TAX']);

/** Car costs saved at a business-use share. An unusable share contributes nothing. The bank amount stays the line total. */
function businessUseShareCents(tx: ScheduleCTransactionLike, cents: number): number {
  if (!BUSINESS_USE_SHARE_CATEGORIES.has(tx.category)) return cents;
  const share = finiteUsePercent(tx.business_use_percentage);
  if (share === null) return 0;
  return Math.round(cents * share / 100);
}

const NEEDS_MORE_INFORMATION = 'Needs more information';

function savedScheduleCLabel(tx: ScheduleCTransactionLike): string | null {
  const raw = tx.schedule_c_line ?? tx.scheduleC_line;
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

/** Fallback bucket when the category is not in the map. 2017-2024 stay 27a. 2025 and later use 27b. 2016 and earlier are withheld. */
function otherExpensesLineKey(year: number | null): string {
  const print = otherExpensesYearPrint(year);
  return print.status === 'line' ? print.code : '27a';
}

/** Withheld rows sit beside the line totals. They are not a Schedule C line and add nothing to a total. */
function addReviewItem(needsMoreInformation: ScheduleCTransactionLike[], tx: ScheduleCTransactionLike) {
  needsMoreInformation.push({ ...tx, deductionStatus: NEEDS_MORE_INFORMATION, reasoning: NEEDS_MORE_INFORMATION });
}

/** Existing analysis status. The reason is the one already shown when this percent is missing. */
function lineItemTransaction(tx: ScheduleCTransactionLike): ScheduleCTransactionLike {
  if (!BUSINESS_USE_SHARE_CATEGORIES.has(tx.category) || finiteUsePercent(tx.business_use_percentage) !== null) return tx;
  const reason = tx.category === VEHICLE_ACTUAL_EXPENSE_CATEGORY
    ? ACTUAL_EXPENSE_BUSINESS_SHARE.reason
    : SEPARATE_VEHICLE_COST_SHARE.reason;
  return { ...tx, deductionStatus: 'Needs more information', reasoning: reason };
}

export function aggregateScheduleC<T extends ScheduleCTransactionLike>(
  transactions: T[],
  year: string,
  categoryMap: Record<string, CategoryMapEntry> = CATEGORY_MAP,
  options: AggregateScheduleCOptions = {}
): AggregateScheduleCResult {
  const yearStr = year.toString();
  // Omitted mode fails closed to server-confirmed decisions. Callers must opt into
  // the legacy potential-category view explicitly; it is never a tax total.
  const mode: AggregateScheduleCMode = options.mode ?? 'confirmed-only';
  // Use timezone-safe year extraction (avoid local Date parsing shifting around year boundaries).
  // Superseded duplicates of an earlier reviewed record never reach either mode.
  const yearTransactions = transactions.filter((t) => {
    if (isSupersededRecord(t)) return false;
    const y = safeTaxYear(t.date);
    return y !== null && y.toString() === yearStr;
  });

  // CPA-grade logic:
  // - explicit default mode preserves the non-tax "confirmed or potential" preview
  // - confirmed-only counts only server-confirmed deductible transactions
  //   and nets credits/refunds (negative amounts) against their mapped lines
  // - pending transactions are excluded when present
  const deductibleTransactions =
    mode === 'confirmed-only'
      ? yearTransactions.filter(isConfirmedScheduleCExpense)
      : yearTransactions.filter(isBusinessExpense);

  const lineItems: Record<string, LineItemSummary> = {};
  const needsMoreInformation: ScheduleCTransactionLike[] = [];

  const halfCentsAwayFromZero = (cents: number): number => {
    // For odd cents, round 0.5 away from zero (deterministic for odd-cent meals).
    const abs = Math.abs(cents);
    const half = Math.floor(abs / 2);
    const extra = abs % 2;
    const rounded = half + extra;
    return cents < 0 ? -rounded : rounded;
  };

  for (const tx of deductibleTransactions) {
    const rawCategory = typeof tx.category === 'string' ? tx.category.trim() : '';
    const treatment = resolveCategoryTreatment(tx, transactions, categoryMap);
    if (treatment.personal) continue;
    if (treatment.needsMoreInformation) {
      addReviewItem(needsMoreInformation, tx);
      continue;
    }
    // Mapped and ruled lines keep their code as the summary key. Other expenses stays 27a there.
    // An unmapped row keeps the base fallback: category line 27a, summary key by charge year.
    // The alias head sends unknown categories to Needs more information in unmappedCategoryTreatment.
    const info = treatment.unmapped || !treatment.line
      ? undefined
      : { line: treatment.line, name: treatment.name ?? 'Other expenses', code: treatment.line };
    const categoryLine = info ? info.line : rawCategory ? '27a' : null;
    const chargeYear = safeTaxYear(tx.date);
    const label = savedScheduleCLabel(tx);
    const decision = resolveScheduleCPrint({ categoryLine, label });
    if (decision.kind === 'needs-more-information' || (decision.kind === 'passthrough' && !info && !rawCategory && label)) {
      addReviewItem(needsMoreInformation, tx);
      continue;
    }
    // Mapped categories keep info.line as the summary key. Other expenses stays 27a there.
    // scheduleCExportLine prints that key as 27a for 2017 through 2024 and 27b for 2025 and later.
    // An unmapped or label-only Other expenses row follows the charge year. 2016 and earlier are withheld.
    const lineKey = info ? info.line : otherExpensesLineKey(chargeYear);
    const lineName = info ? info.name : 'Other expenses';
    const otherBucket = decision.kind === 'other-expenses' || lineKey === '27a' || lineKey === '27b';
    if (otherBucket && otherExpensesYearPrint(chargeYear).status === 'withhold') {
      addReviewItem(needsMoreInformation, tx);
      continue;
    }

    if (!lineItems[lineKey]) {
      lineItems[lineKey] = {
        lineCode: lineKey,
        lineName,
        total: 0,
        deductible: 0,
        transactionCount: 0,
        transactions: [],
      };
    }

    if (mode === 'confirmed-only') {
      const cents = Math.round((tx.amount ?? 0) * 100); // signed cents
      const deductibleCents = lineKey === '24b' ? halfCentsAwayFromZero(cents) : businessUseShareCents(tx, cents);
      lineItems[lineKey].total += cents / 100;
      lineItems[lineKey].deductible += deductibleCents / 100;
    } else {
      const amount = normalizeAmount(tx);
      lineItems[lineKey].total += amount;

      if (lineKey === '24b') {
        lineItems[lineKey].deductible += amount * 0.5;
      } else if (BUSINESS_USE_SHARE_CATEGORIES.has(tx.category)) {
        const share = finiteUsePercent(tx.business_use_percentage);
        if (share !== null) lineItems[lineKey].deductible += amount * share / 100;
      } else {
        lineItems[lineKey].deductible += amount;
      }
    }
    lineItems[lineKey].transactionCount += 1;
    const baseRow = lineItemTransaction(tx);
    const stampNote = Boolean(treatment.exportNote);
    const stampRecurring = tx.category === 'SERVICE_SUBSCRIPTION' && treatment.line === '27a' && !treatment.exportNote;
    const stored = stampNote || stampRecurring ? { ...baseRow } : baseRow;
    if (stampNote) stored.schedule_c_export_note = treatment.exportNote;
    if (stampRecurring) stored.schedule_c_recurring = true;
    lineItems[lineKey].transactions.push(stored);
  }

  // The year filter above still drops an undated or impossible charge. Surface it so the row is not silent.
  for (const tx of transactions) {
    if (isSupersededRecord(tx) || safeTaxYear(tx.date) !== null) continue;
    const included = mode === 'confirmed-only' ? isConfirmedScheduleCExpense(tx) : isBusinessExpense(tx);
    if (!included) continue;
    addReviewItem(needsMoreInformation, tx);
  }

  const lineItemsArray = Object.values(lineItems).sort((a, b) => {
    const aNum = parseInt(a.lineCode.replace(/\D/g, ''), 10);
    const bNum = parseInt(b.lineCode.replace(/\D/g, ''), 10);
    return aNum - bNum;
  });

  const totalExpenses = lineItemsArray.reduce((sum, item) => sum + item.total, 0);
  const totalDeductible = lineItemsArray.reduce((sum, item) => sum + item.deductible, 0);

  return {
    totalExpenses,
    totalDeductible,
    lineItems,
    lineItemsArray,
    needsMoreInformation,
    counts: { deductible: deductibleTransactions.length, year: yearTransactions.length },
  };
}
