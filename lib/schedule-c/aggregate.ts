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

  // ── Line 18: Office expense ──────────────────────────────────────────
  'GENERAL_MERCHANDISE_COMPUTERS_AND_ELECTRONICS': { line: '18', name: 'Office expense', code: '18' },
  'GENERAL_MERCHANDISE_HOME_IMPROVEMENT': { line: '18', name: 'Office expense', code: '18' },
  'GENERAL_MERCHANDISE_PHARMACY': { line: '18', name: 'Office expense', code: '18' },
  'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE': { line: '18', name: 'Office expense', code: '18' },
  'SERVICE_STORAGE': { line: '18', name: 'Office expense', code: '18' },
  'SERVICE_SUBSCRIPTION': { line: '18', name: 'Office expense', code: '18' },

  // ── Line 20a: Rent (vehicles, machinery, equipment) ──────────────────
  'TRANSPORTATION_RENTAL_CAR': { line: '20a', name: 'Rent (vehicles/equipment)', code: '20a' },

  // ── Line 20b: Rent (other business property) ─────────────────────────
  'RENT_RENT': { line: '20b', name: 'Rent (other business property)', code: '20b' },
  'RENT_COWORKING': { line: '20b', name: 'Rent (other business property)', code: '20b' },

  // ── Line 21: Repairs and maintenance ─────────────────────────────────
  'SERVICE_REPAIRS_AND_MAINTENANCE': { line: '21', name: 'Repairs and maintenance', code: '21' },

  // ── Line 22: Supplies ────────────────────────────────────────────────
  'GENERAL_MERCHANDISE_OFFICE_SUPPLIES': { line: '22', name: 'Supplies', code: '22' },
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
  [key: string]: unknown;
}

/** Normalized amount for expense totals (refunds not counted as positive expense). */
export function normalizeAmount(tx: ScheduleCTransactionLike): number {
  return Math.abs(tx.amount);
}

/** True if transaction counts as a business/deductible expense: confirmed or potential (business category + positive amount). */
export function isBusinessExpense(tx: ScheduleCTransactionLike): boolean {
  if (tx.is_deductible === true) return true;
  if (tx.is_deductible == null && BUSINESS_CATEGORY_KEYS.has(tx.category) && tx.amount > 0) return true;
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

/** Fallback bucket when the category is not in the map. 2018-2024 stay 27a. 2025 and later use 27b. Earlier years keep the internal 27a key and print no line number. */
function otherExpensesLineKey(year: number | null): string {
  const print = otherExpensesYearPrint(year);
  return print.status === 'line' ? print.code : '27a';
}

function addReviewItem(lineItems: Record<string, LineItemSummary>, tx: ScheduleCTransactionLike) {
  const key = 'review';
  if (!lineItems[key]) {
    lineItems[key] = { lineCode: '', lineName: NEEDS_MORE_INFORMATION, total: 0, deductible: 0, transactionCount: 0, transactions: [] };
  }
  lineItems[key].transactionCount += 1;
  lineItems[key].transactions.push({ ...tx, deductionStatus: NEEDS_MORE_INFORMATION, reasoning: NEEDS_MORE_INFORMATION });
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
    const info = rawCategory ? categoryMap[rawCategory] : undefined;
    const categoryLine = info ? info.line : rawCategory ? '27a' : null;
    const chargeYear = safeTaxYear(tx.date);
    const label = savedScheduleCLabel(tx);
    const decision = resolveScheduleCPrint({ categoryLine, label });
    if (decision.kind === 'needs-more-information' || (decision.kind === 'passthrough' && !info && !rawCategory && label)) {
      addReviewItem(lineItems, tx);
      continue;
    }
    // Mapped categories keep their internal line. An unmapped or label-only Other expenses row follows the charge year.
    const lineKey = info ? info.line : otherExpensesLineKey(chargeYear);
    const lineName = info ? info.name : 'Other expenses';
    const otherBucket = decision.kind === 'other-expenses' || lineKey === '27a' || lineKey === '27b';
    if (otherBucket && otherExpensesYearPrint(chargeYear).status === 'withhold') {
      addReviewItem(lineItems, tx);
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
    lineItems[lineKey].transactions.push(lineItemTransaction(tx));
  }

  // The year filter above still drops an undated or impossible charge. Surface it so the row is not silent.
  for (const tx of transactions) {
    if (isSupersededRecord(tx) || safeTaxYear(tx.date) !== null) continue;
    const included = mode === 'confirmed-only' ? isConfirmedScheduleCExpense(tx) : isBusinessExpense(tx);
    if (!included) continue;
    addReviewItem(lineItems, tx);
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
    counts: { deductible: deductibleTransactions.length, year: yearTransactions.length },
  };
}
