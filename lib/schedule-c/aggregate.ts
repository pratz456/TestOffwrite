/**
 * Schedule C aggregation — single source of truth for expense/deductible totals and line items.
 * Used by: Schedule C Export API (PDF), and optionally UI preview.
 *
 * Rules:
 * - Expenses: outflows only (amount > 0, or type === 'expense' when present). Use Math.abs(amount) for line totals.
 * - Deductible: is_deductible === true OR (is_deductible == null AND category in business list AND amount > 0). Refunds (negative) excluded.
 * - Meals (line 24b): 50% deductible.
 * - Year filter: transaction date year === selected year.
 * - confirmed-only: posted records whose deduction the server confirmed
 *   (review_status === 'confirmed', or a legacy pre-cutoff decision; see
 *   lib/transactions/confirmed-deduction.ts), excluding tax-method placeholders.
 * - Superseded records (`superseded_by`, set by historical-overlap reconciliation)
 *   are excluded in both modes; see lib/transactions/record-scope.ts.
 *
 * PDF generation path: route → getTransactionsServer(uid) → aggregateScheduleC → pdf-lib.
 */

import { otherExpensesLine, resolveOtherExpensesYear } from './other-expenses-line';
import { isServerConfirmedDeduction } from '@/lib/transactions/confirmed-deduction';
import { isCountableRecord, isSupersededRecord } from '@/lib/transactions/record-scope';

export type CategoryMapEntry = { line: string; name: string; code: string };

/** Legacy food, restaurant, and coffee labels. Sync stores the first Plaid label. Statement import can store "Food & Drink". */
export const LEGACY_FOOD_CATEGORY_VALUES = [
  'Food and Drink',
  'Food & Drink',
  'Restaurants',
  'Fast Food',
  'Food Truck',
  'Seafood',
  'Coffee Shop',
  'Cafe',
  'Internet Cafes',
  'Jazz and Blues Cafe',
] as const;

/** Category lines for a tax year before CATEGORY_MAP_EFFECTIVE_YEAR. */
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

  // ── Line 10: Commissions and fees ────────────────────────────────────
  'BANK_FEES_ATM_FEES': { line: '10', name: 'Commissions and fees', code: '10' },
  'BANK_FEES_FOREIGN_TRANSACTION': { line: '10', name: 'Commissions and fees', code: '10' },
  'BANK_FEES_OVERDRAFT': { line: '10', name: 'Commissions and fees', code: '10' },
  'BANK_FEES_OTHER_BANK_FEES': { line: '10', name: 'Commissions and fees', code: '10' },

  // ── Line 11: Contract labor ──────────────────────────────────────────
  'SERVICE_FREELANCE_SERVICES': { line: '11', name: 'Contract labor', code: '11' },

  // ── Line 15: Insurance ───────────────────────────────────────────────
  'SERVICE_INSURANCE': { line: '15', name: 'Insurance', code: '15' },
  'TRANSPORTATION_AUTO_INSURANCE': { line: '15', name: 'Insurance', code: '15' },

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
};

/**
 * Real Plaid detailed codes with no Schedule C line until the user picks one.
 * isAwaitingScheduleCLine reads this set. These codes are not map keys.
 */
export const REVIEW_REQUIRED_PLAID_CODES: ReadonlySet<string> = new Set([
  // Loan principal is never deductible. v2 adds buy now pay later, cash advances, and earned wage access.
  'LOAN_PAYMENTS_CAR_PAYMENT',
  'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
  'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT',
  'LOAN_PAYMENTS_MORTGAGE_PAYMENT',
  'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT',
  'LOAN_PAYMENTS_OTHER_PAYMENT',
  'LOAN_PAYMENTS_BNPL',
  'LOAN_PAYMENTS_CASH_ADVANCES',
  'LOAN_PAYMENTS_EWA',
  // Line 9 applies only under actual vehicle expenses and would double count the standard mileage rate.
  'TRANSPORTATION_GAS',
  // Line 9 applies only under actual vehicle expenses and would double count the standard mileage rate.
  'GENERAL_SERVICES_AUTOMOTIVE',
  // Home rent belongs on the home office flow, Form 8829.
  'RENT_AND_UTILITIES_RENT',
  // Home utilities belong on the home office flow, Form 8829.
  'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY',
  // Home utilities belong on the home office flow, Form 8829.
  'RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT',
  // Home utilities belong on the home office flow, Form 8829.
  'RENT_AND_UTILITIES_WATER',
  // Home utilities belong on the home office flow, Form 8829.
  'RENT_AND_UTILITIES_OTHER_UTILITIES',
  // Cell phone and telephone charges need a business use percent, and the first home landline is never deductible.
  'RENT_AND_UTILITIES_TELEPHONE',
  // Internet and cable need a business use percent.
  'RENT_AND_UTILITIES_INTERNET_AND_CABLE',
  // Only licenses are deductible. Fines and taxes are not.
  'GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES',
  // Only licenses are deductible. Fines and taxes are not.
  'GOVERNMENT_AND_NON_PROFIT_OTHER_GOVERNMENT_AND_NON_PROFIT',
  // Tax payments are not assigned a line here.
  'GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT',
  // Bank interest is personal unless the charge is on a business card.
  'BANK_FEES_INTEREST_CHARGE',
  // Department store purchases are not assigned a line here.
  'GENERAL_MERCHANDISE_DEPARTMENT_STORES',
  // Discount store purchases are not assigned a line here.
  'GENERAL_MERCHANDISE_DISCOUNT_STORES',
  // Superstore purchases are not assigned a line here.
  'GENERAL_MERCHANDISE_SUPERSTORES',
  // Groceries are personal by default.
  'FOOD_AND_DRINK_GROCERIES',
  // Electronics may need the $2,500 safe harbor before a line is chosen.
  'GENERAL_MERCHANDISE_ELECTRONICS',
  // Furniture may need the $2,500 safe harbor before a line is chosen.
  'HOME_IMPROVEMENT_FURNITURE',
  // Business gifts are limited to $25 per recipient.
  'GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES',
  // Rental cars depend on travel away from home.
  'TRAVEL_RENTAL_CARS',
  // Rideshare and taxi charges depend on travel away from home.
  'TRANSPORTATION_TAXIS_AND_RIDE_SHARES',
  // Bikes and scooters depend on travel away from home.
  'TRANSPORTATION_BIKES_AND_SCOOTERS',
  // Hardware store purchases can be supplies, repairs, or personal home projects.
  'HOME_IMPROVEMENT_HARDWARE',
  // Other transportation can be commuting or a business trip.
  'TRANSPORTATION_OTHER_TRANSPORTATION',
  // Convenience stores mix fuel, food, and personal items.
  'GENERAL_MERCHANDISE_CONVENIENCE_STORES',
  // Other home improvement includes pool installation and pest control.
  'HOME_IMPROVEMENT_OTHER_HOME_IMPROVEMENT',
  // Insurance stays on SERVICE_INSURANCE and TRANSPORTATION_AUTO_INSURANCE.
  'GENERAL_SERVICES_INSURANCE',
  // Legacy financial planning has no line until the user picks one.
  'SERVICE_FINANCIAL_PLANNING_AND_INVESTMENTS',
  // Bank fees stay on the keys already in CATEGORY_MAP.
  'BANK_FEES_FOREIGN_TRANSACTION_FEES',
  'BANK_FEES_INSUFFICIENT_FUNDS',
  'BANK_FEES_OVERDRAFT_FEES',
  'BANK_FEES_LATE_FEES',
  'BANK_FEES_CASH_ADVANCE',
  // Parking, professional services, postage, storage, repairs, education, and security stay on the keys already in CATEGORY_MAP.
  'TRANSPORTATION_PARKING',
  'GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING',
  'GENERAL_SERVICES_CONSULTING_AND_LEGAL',
  'GENERAL_SERVICES_POSTAGE_AND_SHIPPING',
  'GENERAL_SERVICES_STORAGE',
  'HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE',
  'GENERAL_SERVICES_EDUCATION',
  'GENERAL_SERVICES_OTHER_GENERAL_SERVICES',
  'HOME_IMPROVEMENT_SECURITY',
]);

/**
 * Real Plaid detailed codes that are not business expenses.
 * Aggregation does not read this set. Income, transfers, and personal spending stay off both maps.
 * v1 and v2 names of the three renamed codes are both listed.
 */
export const PERSONAL_PLAID_CODES: ReadonlySet<string> = new Set([
  'INCOME_CHILD_SUPPORT',
  'INCOME_CONTRACTOR',
  'INCOME_DIVIDENDS',
  'INCOME_GIG_ECONOMY',
  'INCOME_INTEREST_EARNED',
  'INCOME_LONG_TERM_DISABILITY',
  'INCOME_MILITARY',
  'INCOME_OTHER',
  'INCOME_OTHER_INCOME',
  'INCOME_RENTAL',
  'INCOME_RETIREMENT_PENSION',
  'INCOME_SALARY',
  'INCOME_TAX_REFUND',
  'INCOME_UNEMPLOYMENT',
  'INCOME_WAGES',
  'LOAN_DISBURSEMENTS_AUTO',
  'LOAN_DISBURSEMENTS_CASH_ADVANCES',
  'LOAN_DISBURSEMENTS_EWA',
  'LOAN_DISBURSEMENTS_MORTGAGE',
  'LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT',
  'LOAN_DISBURSEMENTS_PERSONAL',
  'LOAN_DISBURSEMENTS_STUDENT',
  'TRANSFER_IN_CASH_ADVANCES_AND_LOANS',
  'TRANSFER_IN_ACCOUNT_TRANSFER',
  'TRANSFER_IN_DEPOSIT',
  'TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS',
  'TRANSFER_IN_OTHER_TRANSFER_IN',
  'TRANSFER_IN_SAVINGS',
  'TRANSFER_IN_TRANSFER_IN_FROM_APPS',
  'TRANSFER_IN_WIRE',
  'TRANSFER_OUT_ACCOUNT_TRANSFER',
  'TRANSFER_OUT_CRYPTO',
  'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
  'TRANSFER_OUT_OTHER_TRANSFER_OUT',
  'TRANSFER_OUT_SAVINGS',
  'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS',
  'TRANSFER_OUT_WIRE',
  'TRANSFER_OUT_WITHDRAWAL',
  'ENTERTAINMENT_CASINOS_AND_GAMBLING',
  'ENTERTAINMENT_MUSIC_AND_AUDIO',
  'ENTERTAINMENT_OTHER_ENTERTAINMENT',
  'ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS',
  'ENTERTAINMENT_TV_AND_MOVIES',
  'ENTERTAINMENT_VIDEO_GAMES',
  'MEDICAL_DENTAL_CARE',
  'MEDICAL_EYE_CARE',
  'MEDICAL_NURSING_CARE',
  'MEDICAL_OTHER_MEDICAL',
  'MEDICAL_PHARMACIES_AND_SUPPLEMENTS',
  'MEDICAL_PRIMARY_CARE',
  'MEDICAL_VETERINARY_SERVICES',
  'PERSONAL_CARE_HAIR_AND_BEAUTY',
  'PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING',
  'PERSONAL_CARE_OTHER_PERSONAL_CARE',
  'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES',
  'GENERAL_MERCHANDISE_PET_SUPPLIES',
  'GENERAL_MERCHANDISE_TOBACCO_AND_VAPE',
  'GENERAL_SERVICES_CHILDCARE',
  'FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR',
  'GOVERNMENT_AND_NON_PROFIT_DONATIONS',
  'OTHER_OTHER',
]);

/** First tax year that uses the added category lines. 2027 and later use that map too. */
export const CATEGORY_MAP_EFFECTIVE_YEAR = 2026;

const MEALS_LINE: CategoryMapEntry = { line: '24b', name: 'Meals', code: '24b' };

/** Unconfirmed meals use line 24b at 50% from this year. The year is the transaction date, not the clock. */
export const UNCONFIRMED_MEALS_50_FIRST_YEAR = 2023;

/** Confirmed meals use line 24b at 50% from CATEGORY_MAP_EFFECTIVE_YEAR. 2023, 2024, and 2025 keep the current amount. */
export const CONFIRMED_MEALS_50_FIRST_YEAR = CATEGORY_MAP_EFFECTIVE_YEAR;

/** Meal categories. Coffee and the generic Food and Drink label are not on CATEGORY_MAP. */
export const CONFIRMED_MEAL_CATEGORIES: ReadonlySet<string> = new Set([
  'FOOD_AND_DRINK_COFFEE',
  'FOOD_AND_DRINK_RESTAURANT',
  'FOOD_AND_DRINK_FAST_FOOD',
  'FOOD_AND_DRINK_VENDING_MACHINES',
  'Food and Drink',
]);

export function isMealAt50Percent(category: string, taxYear: number | null, confirmed: boolean): boolean {
  if (taxYear == null || !CONFIRMED_MEAL_CATEGORIES.has(category)) return false;
  return taxYear >= (confirmed ? CONFIRMED_MEALS_50_FIRST_YEAR : UNCONFIRMED_MEALS_50_FIRST_YEAR);
}

/** Restaurant meals in 2021 and 2022 stay fully deductible. 2023 and later use the meals limit. */
export function isRestaurantMealAt100Percent(category: string, taxYear: number | null): boolean {
  return category === 'FOOD_AND_DRINK_RESTAURANT' && (taxYear === 2021 || taxYear === 2022);
}

/** Moved off the map into review. SERVICE_EDUCATION is not a Plaid code, so it is not in REVIEW_REQUIRED_PLAID_CODES. */
const MOVED_AWAITING_SCHEDULE_C_LINE = new Set([
  'SERVICE_EDUCATION',
  'SERVICE_FINANCIAL_PLANNING_AND_INVESTMENTS',
]);

/** Review codes and the two moved categories have no Schedule C line until the user picks one. */
export function isAwaitingScheduleCLine(category: string): boolean {
  return REVIEW_REQUIRED_PLAID_CODES.has(category) || MOVED_AWAITING_SCHEDULE_C_LINE.has(category);
}

/**
 * Real Plaid meal codes for tax year CATEGORY_MAP_EFFECTIVE_YEAR and later.
 * Keys are v1 and v2 detailed codes. Sync does not request personal_finance_category_version
 * (lib/plaid/sync-helper.ts), so either list can arrive.
 * Restaurant, fast food, and vending machines are already on CATEGORY_MAP at this same line.
 * Every other category keeps the key and line it already has.
 */
export const PLAID_BANK_SYNC_MAP: Record<string, CategoryMapEntry> = {
  'FOOD_AND_DRINK_COFFEE': MEALS_LINE,
  'FOOD_AND_DRINK_FAST_FOOD': MEALS_LINE,
  'FOOD_AND_DRINK_RESTAURANT': MEALS_LINE,
  'FOOD_AND_DRINK_VENDING_MACHINES': MEALS_LINE,
};

/** Category lines for tax year CATEGORY_MAP_EFFECTIVE_YEAR and later. Earlier years keep CATEGORY_MAP. */
export const CATEGORY_MAP_FROM_2026: Record<string, CategoryMapEntry> = {
  ...CATEGORY_MAP,
  ...PLAID_BANK_SYNC_MAP,
  ...Object.fromEntries(LEGACY_FOOD_CATEGORY_VALUES.map(value => [value, MEALS_LINE])),
};

/** Map for a tax year taken from the transaction date. A missing year keeps the earlier map. */
export function categoryMapForTaxYear(year: number | null | undefined): Record<string, CategoryMapEntry> {
  if (typeof year === 'number' && Number.isFinite(year) && year >= CATEGORY_MAP_EFFECTIVE_YEAR) return CATEGORY_MAP_FROM_2026;
  return CATEGORY_MAP;
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
  [key: string]: unknown;
}

/** Normalized amount for expense totals (refunds not counted as positive expense). */
export function normalizeAmount(tx: ScheduleCTransactionLike): number {
  return Math.abs(tx.amount);
}

/** True if transaction counts as a business/deductible expense: confirmed or potential (business category + positive amount). */
export function isBusinessExpense(tx: ScheduleCTransactionLike): boolean {
  if (isAwaitingScheduleCLine(tx.category)) return false;
  if (tx.is_deductible === true) return true;
  const taxYear = resolveOtherExpensesYear(tx);
  const onMap = isMealAt50Percent(tx.category, taxYear, false) || Object.hasOwn(categoryMapForTaxYear(taxYear), tx.category);
  if (tx.is_deductible == null && onMap && tx.amount > 0) return true;
  return false;
}

/** confirmed-only filter: countable (posted, not superseded), server-confirmed, and not a tax-method placeholder category. */
export function isConfirmedScheduleCExpense(tx: ScheduleCTransactionLike): boolean {
  return isCountableRecord(tx)
    && !isAwaitingScheduleCLine(tx.category)
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
    const y = resolveOtherExpensesYear(t);
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
    // Callers pass a year map. The transaction date still selects the line.
    const recordYear = resolveOtherExpensesYear(tx);
    if (recordYear == null || isAwaitingScheduleCLine(tx.category)) continue;
    const fromDate = categoryMapForTaxYear(recordYear);
    const activeMap = categoryMap === fromDate ? categoryMap : fromDate;
    const meal = isMealAt50Percent(tx.category, recordYear, isServerConfirmedDeduction(tx)) ? MEALS_LINE : undefined;
    const info = meal ?? activeMap[tx.category];
    // A missing category is other expenses. 27a and 27b in the map are the same line.
    // The transaction date selects the published code. From 2025 on that code is 27b. Line 27a is Form 7205.
    const rawLine = info ? info.line : '27a';
    const otherExpenses = !meal && (rawLine === '27a' || rawLine === '27b');
    const lineKey = otherExpenses ? otherExpensesLine(recordYear) : rawLine;
    const lineName = info && !otherExpenses ? info.name : 'Other expenses';

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
      const deductibleCents = lineKey === '24b' && !isRestaurantMealAt100Percent(tx.category, recordYear)
        ? halfCentsAwayFromZero(cents)
        : cents;
      lineItems[lineKey].total += cents / 100;
      lineItems[lineKey].deductible += deductibleCents / 100;
    } else {
      const amount = normalizeAmount(tx);
      lineItems[lineKey].total += amount;

      if (lineKey === '24b' && !isRestaurantMealAt100Percent(tx.category, recordYear)) {
        lineItems[lineKey].deductible += amount * 0.5;
      } else {
        lineItems[lineKey].deductible += amount;
      }
    }
    lineItems[lineKey].transactionCount += 1;
    lineItems[lineKey].transactions.push(tx);
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
