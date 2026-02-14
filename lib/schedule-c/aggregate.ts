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

export type CategoryMapEntry = { line: string; name: string; code: string };

export const CATEGORY_MAP: Record<string, CategoryMapEntry> = {
  'FOOD_AND_DRINK_COFFEE_SHOP': { line: '24b', name: 'Meals', code: '24b' },
  'FOOD_AND_DRINK_FAST_FOOD': { line: '24b', name: 'Meals', code: '24b' },
  'FOOD_AND_DRINK_RESTAURANT': { line: '24b', name: 'Meals', code: '24b' },
  'FOOD_AND_DRINK_ALCOHOL_AND_BARS': { line: '24b', name: 'Meals', code: '24b' },

  'GENERAL_MERCHANDISE_OFFICE_SUPPLIES': { line: '18', name: 'Office expense', code: '18' },
  'GENERAL_MERCHANDISE_COMPUTERS_AND_ELECTRONICS': { line: '18', name: 'Office expense', code: '18' },
  'GENERAL_MERCHANDISE_HOME_IMPROVEMENT': { line: '18', name: 'Office expense', code: '18' },
  'GENERAL_MERCHANDISE_PHARMACY': { line: '18', name: 'Office expense', code: '18' },
  'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE': { line: '18', name: 'Office expense', code: '18' },
  'SERVICE_SHIPPING': { line: '18', name: 'Office expense', code: '18' },
  'SERVICE_UTILITIES': { line: '18', name: 'Office expense', code: '18' },
  'SERVICE_STORAGE': { line: '18', name: 'Office expense', code: '18' },

  'SERVICE_ACCOUNTING': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_CONSULTING': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_LEGAL': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_MARKETING': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_ADVERTISING': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_SECURITY': { line: '17', name: 'Legal and professional services', code: '17' },
  'SERVICE_INSURANCE': { line: '17', name: 'Legal and professional services', code: '17' },

  'TRANSPORTATION_RIDESHARE': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_AUTO_PARKING': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_AUTO_REPAIR': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_AUTO_SERVICE': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_FUEL': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_TOLLS': { line: '9', name: 'Car and truck expenses', code: '9' },
  'TRANSPORTATION_AUTO_INSURANCE': { line: '9', name: 'Car and truck expenses', code: '9' },

  'TRAVEL_FLIGHTS': { line: '24a', name: 'Travel', code: '24a' },
  'TRAVEL_LODGING': { line: '24a', name: 'Travel', code: '24a' },
  'TRAVEL_OTHER_TRAVEL': { line: '24a', name: 'Travel', code: '24a' },

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
};

const BUSINESS_CATEGORY_KEYS = new Set(Object.keys(CATEGORY_MAP));

export interface ScheduleCTransactionLike {
  amount: number;
  date: string;
  category: string;
  is_deductible?: boolean | null;
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

/**
 * Filter by year, then by isBusinessExpense; group by Schedule C line; apply 50% for meals (24b).
 */
export function aggregateScheduleC<T extends ScheduleCTransactionLike>(
  transactions: T[],
  year: string,
  categoryMap: Record<string, CategoryMapEntry> = CATEGORY_MAP
): AggregateScheduleCResult {
  const yearStr = year.toString();
  const yearTransactions = transactions.filter((t) => new Date(t.date).getFullYear().toString() === yearStr);
  const deductibleTransactions = yearTransactions.filter(isBusinessExpense);

  const lineItems: Record<string, LineItemSummary> = {};

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

    const amount = normalizeAmount(tx);
    lineItems[lineKey].total += amount;
    lineItems[lineKey].transactionCount += 1;
    lineItems[lineKey].transactions.push(tx);

    if (lineKey === '24b') {
      lineItems[lineKey].deductible += amount * 0.5;
    } else {
      lineItems[lineKey].deductible += amount;
    }
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
