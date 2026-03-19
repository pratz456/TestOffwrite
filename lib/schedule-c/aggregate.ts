/**
 * Schedule C aggregation — single source of truth for expense/deductible totals and line items.
 * Used by: Schedule C Export API (PDF), and optionally UI preview.
 *
 * Rules:
 * - Expenses: outflows only (amount > 0, or type === 'expense' when present). Use Math.abs(amount) for line totals.
 * - Deductible: is_deductible === true OR (is_deductible == null AND category in business list AND amount > 0). Refunds (negative) excluded.
 * - Meals (line 24b): 50% deductible.
 * - Year filter: transaction date year === selected year.
 *
 * PDF generation path: route → getTransactionsServer(uid) → aggregateScheduleC → pdf-lib.
 */

import { safeTaxYear } from './taxDate';

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
  'TRANSPORTATION_PUBLIC_TRANSIT': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_CAR_WASH': { line: '9', name: 'Car and truck expenses', code: '9' },

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

  // ── Line 16a: Interest (mortgage) ────────────────────────────────────
  'LOAN_INTEREST': { line: '16a', name: 'Interest (mortgage)', code: '16a' },
  'LOAN_INTEREST_MORTGAGE': { line: '16a', name: 'Interest (mortgage)', code: '16a' },

  // ── Line 17: Legal and professional services ─────────────────────────
  'SERVICE_ACCOUNTING': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_CONSULTING': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_LEGAL': { line: '17', name: 'Legal and professional services', code: '17' },
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

  // ── Line 22: Supplies ────────────────────────────────────────────────
  'GENERAL_MERCHANDISE_OFFICE_SUPPLIES': { line: '22', name: 'Supplies', code: '22' },
  'SERVICE_SHIPPING': { line: '22', name: 'Supplies', code: '22' },
  'SERVICE_PRINTING_AND_COPYING': { line: '22', name: 'Supplies', code: '22' },
  'GENERAL_MERCHANDISE_HARDWARE_STORE': { line: '22', name: 'Supplies', code: '22' },
  'GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS': { line: '22', name: 'Supplies', code: '22' },

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
};

const BUSINESS_CATEGORY_KEYS = new Set(Object.keys(CATEGORY_MAP));

export interface ScheduleCTransactionLike {
  amount: number;
  date: string;
  category: string;
  is_deductible?: boolean | null;
  pending?: boolean | null;
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
  const mode: AggregateScheduleCMode = options.mode ?? 'default';
  // Use timezone-safe year extraction (avoid local Date parsing shifting around year boundaries).
  const yearTransactions = transactions.filter((t) => {
    const y = safeTaxYear(t.date);
    return y !== null && y.toString() === yearStr;
  });

  // CPA-grade logic:
  // - default mode preserves current "confirmed or potential" behavior
  // - confirmed-only counts only explicitly confirmed deductible transactions
  //   and nets credits/refunds (negative amounts) against their mapped lines
  // - pending transactions are excluded when present
  const deductibleTransactions =
    mode === 'confirmed-only'
      ? yearTransactions.filter((t) => t.pending !== true && t.is_deductible === true)
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
    const info = categoryMap[tx.category];
    const lineKey = info ? info.line : '27a';
    const lineName = info ? info.name : 'Other expenses';

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
      const deductibleCents = lineKey === '24b' ? halfCentsAwayFromZero(cents) : cents;
      lineItems[lineKey].total += cents / 100;
      lineItems[lineKey].deductible += deductibleCents / 100;
    } else {
      const amount = normalizeAmount(tx);
      lineItems[lineKey].total += amount;

      if (lineKey === '24b') {
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
