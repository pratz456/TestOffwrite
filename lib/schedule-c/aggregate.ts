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
import { reviewCategory } from '@/lib/transactions/ai-review-contract';
import {
  BUSINESS_SHARE_ONLY_NOTE,
  PART_V_AND_SUPPLIES_CAP_CENTS,
  REFUND_MATCH_DAYS,
  answeredPersonal,
  cappedLine,
  dayNumber,
  fuelDecision,
  hasExpenseDescription,
  isIncomeLike,
  isProcessorOrPlatformFee,
  isTransferLike,
  markedBusiness,
  merchantKey,
  possibleRefundNotice,
  ruledCategory,
  transferPurposeLine,
  type FuelProfile,
  type RuledCategory,
} from './category-rules';
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
  'TRANSPORTATION_TOLLS': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_PARKING': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_PARKING_AND_TOLLS': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_PUBLIC_TRANSIT': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_CAR_WASH': { line: '9', name: 'Car and truck expenses', code: '9' },
  'VEHICLE_ACTUAL_EXPENSE': { line: '9', name: 'Car and truck expenses', code: '9' },
  'VEHICLE_PROPERTY_TAX': { line: '23', name: 'Taxes and licenses', code: '23' },

  // ── Line 10: Commissions and fees (processor and platform fees only) ─
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
  'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE': { line: '18', name: 'Office expense', code: '18' },
  'SERVICE_STORAGE': { line: '18', name: 'Office expense', code: '18' },

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
  'GENERAL_MERCHANDISE_SPORTING_GOODS': { line: '27a', name: 'Other expenses', code: '27a' },
  'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS': { line: '27a', name: 'Other expenses', code: '27a' },
  'COMMUNITY_EDUCATION': { line: '27a', name: 'Other expenses', code: '27a' },
  'SERVICE_SUBSCRIPTION': { line: '27a', name: 'Other expenses', code: '27a' },
  'COMMUNITY_RELIGIOUS': { line: '27a', name: 'Other expenses', code: '27a' },
  'SERVICE_CLEANING_AND_MAINTENANCE': { line: '27a', name: 'Other expenses', code: '27a' },
  'SERVICE_PROFESSIONAL_DUES': { line: '27a', name: 'Other expenses', code: '27a' },
  'SERVICE_MEMBERSHIPS': { line: '27a', name: 'Other expenses', code: '27a' },
  'SERVICE_EDUCATION': { line: '27a', name: 'Other expenses', code: '27a' },
  'HIRED_LOCAL_TRANSPORT': { line: '27a', name: 'Other expenses', code: '27a' },
  'FOOD_AND_DRINK_COFFEE': { line: '24b', name: 'Meals', code: '24b' },
  'FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR': { line: '24b', name: 'Meals', code: '24b' },
  'meals_50': { line: '24b', name: 'Meals', code: '24b' },
  'Food & Drink': { line: '24b', name: 'Meals', code: '24b' },
  'Advertising': { line: '8', name: 'Advertising', code: '8' },
  'GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING': { line: '17', name: 'Legal and professional services', code: '17' },
  'GENERAL_SERVICES_CONSULTING_AND_LEGAL': { line: '17', name: 'Legal and professional services', code: '17' },
  'Professional Services': { line: '17', name: 'Legal and professional services', code: '17' },
  'GENERAL_SERVICES_STORAGE': { line: '20b', name: 'Rent (other business property)', code: '20b' },
  'GENERAL_MERCHANDISE_DEPARTMENT_STORES': { line: '22', name: 'Supplies', code: '22' },
  'GENERAL_MERCHANDISE_DISCOUNT_STORES': { line: '22', name: 'Supplies', code: '22' },
  'GENERAL_MERCHANDISE_SUPERSTORES': { line: '22', name: 'Supplies', code: '22' },
  'HOME_IMPROVEMENT_HARDWARE': { line: '22', name: 'Supplies', code: '22' },
  'GENERAL_SERVICES_POSTAGE_AND_SHIPPING': { line: '22', name: 'Supplies', code: '22' },
  'office_supplies': { line: '22', name: 'Supplies', code: '22' },
  'Office Supplies': { line: '22', name: 'Supplies', code: '22' },
  'TRAVEL_RENTAL_CARS': { line: '24a', name: 'Travel', code: '24a' },
  'travel': { line: '24a', name: 'Travel', code: '24a' },
  'Travel': { line: '24a', name: 'Travel', code: '24a' },
  'RENT_AND_UTILITIES_INTERNET_AND_CABLE': { line: '25', name: 'Utilities', code: '25' },
  'RENT_AND_UTILITIES_TELEPHONE': { line: '25', name: 'Utilities', code: '25' },
  'utilities_phone_internet': { line: '25', name: 'Utilities', code: '25' },
  'BANK_FEES_ATM_FEES': { line: '27a', name: 'Other expenses', code: '27a' },
  'BANK_FEES_FOREIGN_TRANSACTION_FEES': { line: '27a', name: 'Other expenses', code: '27a' },
  'BANK_FEES_INSUFFICIENT_FUNDS': { line: '27a', name: 'Other expenses', code: '27a' },
  'BANK_FEES_OVERDRAFT_FEES': { line: '27a', name: 'Other expenses', code: '27a' },
  'BANK_FEES': { line: '27a', name: 'Other expenses', code: '27a' },
  'BANK_FEES_OTHER_BANK_FEES': { line: '27a', name: 'Other expenses', code: '27a' },
  'SOFTWARE': { line: '27a', name: 'Other expenses', code: '27a' },
  'software_subscriptions': { line: '27a', name: 'Other expenses', code: '27a' },
  'Software': { line: '27a', name: 'Other expenses', code: '27a' },
  'GENERAL_SERVICES_EDUCATION': { line: '27a', name: 'Other expenses', code: '27a' },
  'GENERAL_SERVICES_OTHER_GENERAL_SERVICES': { line: '27a', name: 'Other expenses', code: '27a' },
  'BANK_FEES_LATE_FEES': { line: '16b', name: 'Interest: other', code: '16b' },
  'BANK_FEES_INTEREST_CHARGE': { line: '16b', name: 'Interest: other', code: '16b' },
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
  /** Saved Schedule C label. Energy-named 27a/27b labels stay out of totals. */
  schedule_c_line?: string | null;
  scheduleC_line?: string | null;
  /** Signed deductible dollars for this row after meals, fuel share, and a tied refund. */
  confirmedContribution?: number;
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

export interface FuelSummary {
  vehicleKey: string;
  taxYear: number;
  /** Fuel charges for the vehicle and year after tied refunds, in dollars. */
  total: number;
  /** Vehicle business-use percentage. Null when it was missing or the two fields disagreed. */
  percentage: number | null;
  businessShare: number;
  note: string | null;
  disposition: 'line' | 'zero';
  charges: ScheduleCTransactionLike[];
}

interface OpenCharge {
  tx: ScheduleCTransactionLike;
  id: string;
  merchant: string;
  day: number | null;
  remainingGross: number;
  remainingDeductible: number;
  lineKey: string | null;
  fuelKey: string | null;
}

export interface PossibleRefund {
  amount: number;
  merchant: string;
  date: string;
  category: string;
}

export interface AggregateScheduleCResult {
  totalExpenses: number;
  totalDeductible: number;
  lineItems: Record<string, LineItemSummary>;
  lineItemsArray: LineItemSummary[];
  /** Confirmed rows withheld from every Schedule C line. Not a line item and not part of either total. */
  needsMoreInformation: ScheduleCTransactionLike[];
  /** One row per vehicle per year. Individual fuel charges are marked included in this line. */
  fuelSummaries: FuelSummary[];
  possibleRefunds: PossibleRefund[];
  possibleRefundsTotal: number;
  /** Placeholder beside the totals. Null when the list is empty. */
  refundNotice: string | null;
  exportNotes: string[];
  counts: { deductible: number; year: number };
}

export type AggregateScheduleCMode = 'default' | 'confirmed-only';
export interface AggregateScheduleCOptions {
  mode?: AggregateScheduleCMode;
  /** Profile vehicle method and percentage. Fuel ignores the charge and the account percentage. */
  fuelProfile?: FuelProfile | null;
}

const REVIEW_EXCEPTIONS = new Set([
  'EQUIPMENT_REVIEW_REQUIRED',
  'VEHICLE_REVIEW_REQUIRED',
  'HOME_OFFICE_REVIEW_REQUIRED',
  'OTHER_REVIEW_REQUIRED',
]);

/** True when a live category has a line, a zero, or a Needs more information rule. The four review placeholders stay exceptions. */
export function hasCategoryRule(category: string): boolean {
  if (REVIEW_EXCEPTIONS.has(category)) return false;
  if (ruledCategory(category)) return true;
  if (Object.prototype.hasOwnProperty.call(CATEGORY_MAP, category)) return true;
  const recorded = reviewCategory(category)?.recordedCategory;
  if (recorded && recorded !== category) return hasCategoryRule(recorded);
  return false;
}

/**
 * Line shown on a row export. Unknown categories are withheld.
 * The four review placeholders stay exceptions. Fuel keeps line 9 here; the vehicle method is applied in aggregateScheduleC.
 */
export function exportCategoryDecision(category: string, record: { [key: string]: unknown } = {}): { line: string | null; withhold: boolean } {
  const raw = category.trim();
  if (REVIEW_EXCEPTIONS.has(raw)) return { line: null, withhold: false };
  const alias = reviewCategory(raw)?.recordedCategory;
  const ruled = ruledCategory(raw) ?? (alias && alias !== raw ? ruledCategory(alias) : undefined);
  const info = CATEGORY_MAP[raw] ?? (alias && alias !== raw ? CATEGORY_MAP[alias] : undefined);
  const amountCents = typeof record.amount === 'number' && Number.isFinite(record.amount) ? Math.abs(Math.round(record.amount * 100)) : null;
  const overCap = amountCents !== null && amountCents > PART_V_AND_SUPPLIES_CAP_CENTS;
  const finish = (line: string | null): { line: string | null; withhold: boolean } => {
    if (line && cappedLine(line) && overCap) return { line: null, withhold: true };
    return { line, withhold: false };
  };
  if (!ruled && !info) return raw ? { line: null, withhold: true } : { line: null, withhold: false };
  if (ruled?.kind === 'zero' || ruled?.kind === 'inflow') return { line: null, withhold: false };
  if (ruled?.kind === 'personal') return markedBusiness(record) ? { line: null, withhold: true } : { line: null, withhold: false };
  if (ruled?.kind === 'nmi') return { line: null, withhold: true };
  if (ruled?.kind === 'described-other') return hasExpenseDescription(record) ? finish('27a') : { line: null, withhold: true };
  if (ruled?.kind === 'part-v') return finish(ruled.line || '27a');
  if (ruled?.kind === 'line') return finish(ruled.line || null);
  if (ruled?.kind === 'late-fee' || ruled?.kind === 'interest') return { line: '16b', withhold: false };
  if (ruled?.kind === 'bank-split') {
    if (answeredPersonal(record)) return { line: null, withhold: false };
    if (isProcessorOrPlatformFee(record)) return { line: '10', withhold: false };
    return finish('27a');
  }
  if (ruled?.kind === 'transfer') {
    const purpose = transferPurposeLine(record);
    return purpose ? { line: purpose, withhold: false } : { line: null, withhold: true };
  }
  if (ruled?.kind === 'fuel') return { line: '9', withhold: false };
  if (ruled?.kind === 'automotive') return overCap ? { line: null, withhold: true } : { line: '9', withhold: false };
  return finish(info?.line ?? null);
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

  const exportNotes = new Set<string>();
  const fuelGroups = new Map<string, { decision: ReturnType<typeof fuelDecision>; charges: OpenCharge[] }>();
  const openCharges: OpenCharge[] = [];
  const refunds: T[] = [];

  const ensureLine = (lineKey: string, lineName: string) => {
    if (!lineItems[lineKey]) {
      lineItems[lineKey] = { lineCode: lineKey, lineName, total: 0, deductible: 0, transactionCount: 0, transactions: [] };
    }
    return lineItems[lineKey];
  };

  const signedCents = (tx: ScheduleCTransactionLike) => Math.round((tx.amount ?? 0) * 100);

  const lookup = (raw: string): { ruled?: RuledCategory; info?: CategoryMapEntry } => {
    const alias = reviewCategory(raw)?.recordedCategory;
    const ruled = ruledCategory(raw) ?? (alias && alias !== raw ? ruledCategory(alias) : undefined);
    const info = categoryMap[raw] ?? (alias ? categoryMap[alias] : undefined);
    return { ruled, info };
  };

  const deductibleFor = (tx: ScheduleCTransactionLike, lineKey: string, cents: number) => {
    if (lineKey === '24b') return halfCentsAwayFromZero(cents);
    if (BUSINESS_USE_SHARE_CATEGORIES.has(tx.category)) {
      const share = finiteUsePercent(tx.business_use_percentage);
      return share === null ? 0 : Math.round(cents * share / 100);
    }
    return cents;
  };

  const withholdForYear = (lineKey: string, chargeYear: number | null) =>
    (lineKey === '27a' || lineKey === '27b') && otherExpensesYearPrint(chargeYear).status === 'withhold';

  /** Returns false when the row was withheld. */
  const placeOnLine = (tx: T, lineKey: string, lineName: string, cents: number, note?: string | null): OpenCharge | null => {
    const chargeYear = safeTaxYear(tx.date);
    const label = savedScheduleCLabel(tx);
    const decision = resolveScheduleCPrint({ categoryLine: lineKey, label });
    if (decision.kind === 'needs-more-information') {
      addReviewItem(needsMoreInformation, tx);
      return null;
    }
    if (withholdForYear(lineKey, chargeYear) || (decision.kind === 'other-expenses' && otherExpensesYearPrint(chargeYear).status === 'withhold')) {
      addReviewItem(needsMoreInformation, tx);
      return null;
    }
    if (cappedLine(lineKey) && Math.abs(cents) > PART_V_AND_SUPPLIES_CAP_CENTS) {
      addReviewItem(needsMoreInformation, tx);
      return null;
    }
    const deductibleCents = deductibleFor(tx, lineKey, cents);
    const line = ensureLine(lineKey, lineName);
    line.total += cents / 100;
    line.deductible += deductibleCents / 100;
    line.transactionCount += 1;
    tx.confirmedContribution = deductibleCents / 100;
    const shown = lineItemTransaction(tx);
    if (shown !== tx) shown.confirmedContribution = tx.confirmedContribution;
    line.transactions.push(shown);
    if (note) exportNotes.add(note);
    const placed: OpenCharge = {
      tx, id: typeof tx.id === 'string' ? tx.id : '', merchant: merchantKey(tx), day: dayNumber(tx.date),
      remainingGross: cents, remainingDeductible: deductibleCents, lineKey, fuelKey: null,
    };
    openCharges.push(placed);
    return placed;
  };

  const queueFuel = (tx: T, cents: number, ruledHint: string) => {
    const vehicleId = typeof tx.vehicleId === 'string' ? tx.vehicleId : typeof tx.vehicle_id === 'string' ? tx.vehicle_id : null;
    const decision = fuelDecision(options.fuelProfile, vehicleId);
    if (decision.kind === 'nmi') {
      addReviewItem(needsMoreInformation, tx);
      return;
    }
    const key = `${ruledHint}:${vehicleId || 'profile'}:${decision.kind}:${decision.kind === 'line' ? decision.percentage ?? 'full' : 'zero'}`;
    const group = fuelGroups.get(key) ?? { decision, charges: [] };
    const placed: OpenCharge = {
      tx, id: typeof tx.id === 'string' ? tx.id : '', merchant: merchantKey(tx), day: dayNumber(tx.date),
      remainingGross: cents, remainingDeductible: 0, lineKey: null, fuelKey: key,
    };
    group.charges.push(placed);
    fuelGroups.set(key, group);
    openCharges.push(placed);
  };

  for (const tx of deductibleTransactions) {
    const rawCategory = typeof tx.category === 'string' ? tx.category.trim() : '';
    if (isIncomeLike(tx, rawCategory) || isTransferLike(tx, rawCategory)) continue;
    if (mode === 'confirmed-only' && signedCents(tx) < 0) {
      refunds.push(tx);
      continue;
    }
    const cents = mode === 'confirmed-only' ? signedCents(tx) : Math.round(Math.abs(tx.amount ?? 0) * 100);
    const { ruled, info } = rawCategory ? lookup(rawCategory) : {};
    if (ruled?.kind === 'inflow' || ruled?.kind === 'zero') continue;
    if (ruled?.kind === 'personal') {
      if (markedBusiness(tx)) addReviewItem(needsMoreInformation, tx);
      continue;
    }
    if (ruled?.kind === 'nmi') {
      addReviewItem(needsMoreInformation, tx);
      continue;
    }
    if (ruled?.kind === 'described-other') {
      if (!hasExpenseDescription(tx)) addReviewItem(needsMoreInformation, tx);
      else placeOnLine(tx, '27a', 'Other expenses', cents);
      continue;
    }
    if (ruled?.kind === 'bank-split') {
      if (answeredPersonal(tx)) continue;
      if (isProcessorOrPlatformFee(tx)) placeOnLine(tx, '10', 'Commissions and fees', cents);
      else placeOnLine(tx, '27a', 'Other expenses', cents);
      continue;
    }
    if (ruled?.kind === 'late-fee') {
      if (!answeredPersonal(tx)) placeOnLine(tx, '16b', 'Interest: other', cents);
      continue;
    }
    if (ruled?.kind === 'interest') {
      if (answeredPersonal(tx)) continue;
      const share = finiteUsePercent(tx.business_use_percentage);
      if (share === null) addReviewItem(needsMoreInformation, tx);
      else placeOnLine(tx, '16b', 'Interest: other', Math.round(cents * share / 100));
      continue;
    }
    if (ruled?.kind === 'transfer') {
      const purpose = transferPurposeLine(tx);
      if (purpose === '11') placeOnLine(tx, '11', 'Contract labor', cents);
      else if (purpose === '20b') placeOnLine(tx, '20b', 'Rent (other business property)', cents);
      else addReviewItem(needsMoreInformation, tx);
      continue;
    }
    if (ruled?.kind === 'fuel' || ruled?.kind === 'automotive') {
      if (ruled.kind === 'automotive' && Math.abs(cents) > PART_V_AND_SUPPLIES_CAP_CENTS) addReviewItem(needsMoreInformation, tx);
      else queueFuel(tx, cents, ruled.kind);
      continue;
    }
    if (ruled?.kind === 'part-v' || ruled?.kind === 'line') {
      placeOnLine(tx, ruled.line || '27a', ruled.name || 'Other expenses', cents, ruled.businessShareNote ? BUSINESS_SHARE_ONLY_NOTE : null);
      continue;
    }
    if (!rawCategory) {
      // A missing category is not an unknown live value. It stays Other expenses by charge year.
      // A saved label that is not Other expenses is withheld, the same as before the alias head.
      const label = savedScheduleCLabel(tx);
      const decision = resolveScheduleCPrint({ categoryLine: null, label });
      if (decision.kind === 'needs-more-information' || (decision.kind === 'passthrough' && label)) addReviewItem(needsMoreInformation, tx);
      else placeOnLine(tx, '27a', 'Other expenses', cents);
      continue;
    }
    if (info) {
      const note = ruledCategory(rawCategory)?.businessShareNote ? BUSINESS_SHARE_ONLY_NOTE : null;
      placeOnLine(tx, info.line, info.name, cents, note);
      continue;
    }
    // Unknown categories are withheld. They are not Other expenses.
    addReviewItem(needsMoreInformation, tx);
  }

  if (mode === 'confirmed-only') {
    for (const refund of refunds) {
      // Automatic tie only: same merchant, this tax year, within 90 days, and no more than each charge still has.
      // A hand-picked charge is a later item and is not read here.
      let left = Math.abs(signedCents(refund));
      const merchant = merchantKey(refund);
      const day = dayNumber(refund.date);
      let tiedDeductible = 0;
      const slices = new Map<string, { gross: number; deductible: number }>();
      if (merchant && day !== null) {
        for (const charge of openCharges) {
          if (left <= 0) break;
          if (charge.remainingGross <= 0 || charge.merchant !== merchant || charge.day === null) continue;
          if (Math.abs(charge.day - day) > REFUND_MATCH_DAYS) continue;
          const line = charge.lineKey ? lineItems[charge.lineKey] : null;
          const lineRoom = line ? Math.max(0, Math.round(line.total * 100)) : charge.remainingGross;
          const grossTake = Math.min(left, charge.remainingGross, lineRoom);
          if (grossTake <= 0) continue;
          const proportional = grossTake === charge.remainingGross
            ? charge.remainingDeductible
            : Math.round(charge.remainingDeductible * grossTake / charge.remainingGross);
          const dedRoom = line ? Math.max(0, Math.round(line.deductible * 100)) : 0;
          const dedTake = line ? Math.min(proportional, dedRoom) : 0;
          charge.remainingGross -= grossTake;
          charge.remainingDeductible = Math.max(0, charge.remainingDeductible - dedTake);
          if (line && charge.lineKey) {
            const grossCents = Math.round(line.total * 100);
            const dedCents = Math.round(line.deductible * 100);
            line.total = Math.max(0, grossCents - grossTake) / 100;
            line.deductible = Math.max(0, dedCents - dedTake) / 100;
            const prior = slices.get(charge.lineKey) ?? { gross: 0, deductible: 0 };
            slices.set(charge.lineKey, { gross: prior.gross + grossTake, deductible: prior.deductible + dedTake });
          }
          left -= grossTake;
          tiedDeductible += dedTake;
        }
      }
      if (slices.size > 0) refund.confirmedContribution = -(tiedDeductible / 100);
      for (const [lineKey, slice] of slices) {
        const line = lineItems[lineKey];
        if (!line) continue;
        line.transactions.push({
          ...refund,
          amount: -(slice.gross / 100),
          confirmedContribution: -(slice.deductible / 100),
        });
      }
      if (left > 0) {
        const untied = { ...refund, amount: -(left / 100) };
        delete untied.confirmedContribution;
        addReviewItem(needsMoreInformation, untied);
      }
    }
  }

  const fuelSummaries: FuelSummary[] = [];
  for (const [key, group] of fuelGroups) {
    const netCents = group.charges.reduce((sum, charge) => sum + Math.max(0, charge.remainingGross), 0);
    const decision = group.decision;
    if (decision.kind === 'nmi') continue;
    const businessShareCents = decision.kind === 'zero' ? 0 : decision.percentage === null ? netCents : Math.round(netCents * decision.percentage / 100);
    const first = group.charges[0]?.tx;
    const vehicleId = typeof first?.vehicleId === 'string' && first.vehicleId
      ? first.vehicleId
      : typeof first?.vehicle_id === 'string' && first.vehicle_id ? first.vehicle_id : '';
    const summary: FuelSummary = {
      vehicleKey: vehicleId || 'vehicle',
      taxYear: Number(yearStr),
      total: netCents / 100,
      percentage: decision.kind === 'line' ? decision.percentage : null,
      businessShare: businessShareCents / 100,
      note: decision.kind === 'line' ? decision.note : null,
      disposition: decision.kind === 'zero' ? 'zero' : 'line',
      charges: group.charges.map(charge => ({ ...charge.tx, fuelIncludedInSummary: true })),
    };
    fuelSummaries.push(summary);
    if (decision.kind === 'line' && decision.note) exportNotes.add(decision.note);
    if (decision.kind === 'zero' || businessShareCents === 0 && netCents === 0) {
      continue;
    }
    if (decision.kind === 'line') {
      const line = ensureLine('9', 'Car and truck expenses');
      line.total += businessShareCents / 100;
      line.deductible += businessShareCents / 100;
      const gross = group.charges.reduce((sum, charge) => sum + Math.max(0, charge.remainingGross), 0);
      let remainingShare = businessShareCents;
      group.charges.forEach((charge, index) => {
        const last = index === group.charges.length - 1;
        const share = gross <= 0 ? 0 : last ? remainingShare : Math.round(businessShareCents * Math.max(0, charge.remainingGross) / gross);
        remainingShare -= share;
        charge.tx.confirmedContribution = share / 100;
        line.transactions.push({ ...charge.tx, fuelIncludedInSummary: true, confirmedContribution: 0 });
        line.transactionCount += 1;
      });
    }
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
  const possibleRefunds: PossibleRefund[] = needsMoreInformation
    .filter(tx => signedCents(tx) < 0)
    .map(tx => ({
      amount: Math.abs(tx.amount ?? 0),
      merchant: typeof tx.merchant_name === 'string' ? tx.merchant_name : '',
      date: typeof tx.date === 'string' ? tx.date : '',
      category: typeof tx.category === 'string' ? tx.category : '',
    }));
  const possibleRefundsTotal = possibleRefunds.reduce((sum, row) => sum + row.amount, 0);

  return {
    totalExpenses,
    totalDeductible,
    lineItems,
    lineItemsArray,
    needsMoreInformation,
    fuelSummaries,
    possibleRefunds,
    possibleRefundsTotal,
    refundNotice: possibleRefundsTotal > 0 ? possibleRefundNotice(possibleRefundsTotal) : null,
    exportNotes: [...exportNotes],
    counts: { deductible: deductibleTransactions.length, year: yearTransactions.length },
  };
}
