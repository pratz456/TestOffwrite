import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { aggregateScheduleC, AWAITING_SCHEDULE_C_LINE, CATEGORY_MAP, CATEGORY_MAP_EFFECTIVE_YEAR, CATEGORY_MAP_FROM_2026, categoryMapForTaxYear, isAwaitingScheduleCLine, isBusinessExpense, LEGACY_FOOD_CATEGORY_VALUES, PERSONAL_PLAID_CODES, PLAID_BANK_SYNC_MAP, REVIEW_REQUIRED_PLAID_CODES } from '@/lib/schedule-c/aggregate';
import { OTHER_EXPENSES_27B_FIRST_YEAR, otherExpensesLine, publishedOtherExpensesLine, resolveOtherExpensesYear } from '@/lib/schedule-c/other-expenses-line';
import { convertTransactionsToCSV } from '@/lib/reports/transaction-export';
import { buildFederalTaxSnapshot } from '@/lib/tax-rules/federal-tax-snapshot';
import { sumExpensesForQuarter, sumIncomeForQuarter, sumPotentialExpensesForQuarter } from '@/lib/tax-provider/quarterly-estimates';
import { isServerConfirmedDeduction } from '@/lib/transactions/confirmed-deduction';
import { transactionNeedsCategoryReview, transactionNeedsTaxReview } from '@/lib/utils/transaction-tax-review';
import { dashboardRecordStatus } from '@/lib/dashboard/record-summary';
import { prioritizeTransactionReview } from '@/lib/transactions/review-priority';
import { formatRecordedTransactionAmount } from '@/lib/transactions/amount-display';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';

const confirmed = (category: string, amount = 10, date = '2026-06-15') => ({
  amount,
  date,
  category,
  is_deductible: true as const,
  review_status: 'confirmed' as const,
  pending: false,
});

function confirmedLine(category: string, amount = 10, year = '2026') {
  return aggregateScheduleC([confirmed(category, amount, `${year}-06-15`)], year, CATEGORY_MAP, { mode: 'confirmed-only' });
}

function lineAndDeductible(category: string, year: string) {
  const result = confirmedLine(category, 10, year);
  return {
    line: result.lineItemsArray.map(item => item.lineCode),
    deductible: result.totalDeductible,
  };
}

const REQUIRED_LEGACY_FOOD = [
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
];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some(value => value.length > 0)) rows.push(row);
  }
  return rows;
}

function plaidDetailedCodes() {
  const source = readFileSync(new URL('./fixtures/plaid/SOURCE.txt', import.meta.url), 'utf8');
  const v1Rows = parseCsv(readFileSync(new URL('./fixtures/plaid/transactions-personal-finance-category-taxonomy.csv', import.meta.url), 'utf8'));
  const v2Rows = parseCsv(readFileSync(new URL('./fixtures/plaid/pfc-taxonomy-all.csv', import.meta.url), 'utf8'));
  const v1 = v1Rows.slice(1).map(record => record[1]).filter(code => code.length > 0);
  const v2 = v2Rows.slice(1).map(record => record[1]).filter(code => code.length > 0);
  return { source, v1, v2, union: new Set([...v1, ...v2]) };
}

/** Keys on the 2026 map that are not v1 or v2 detailed codes. Adding one fails this list. */
const KNOWN_NON_PLAID_KEYS = [
  'BANK_FEES_FOREIGN_TRANSACTION',
  'BANK_FEES_OVERDRAFT',
  'COMMUNITY_CHARITY',
  'COMMUNITY_EDUCATION',
  'COMMUNITY_RELIGIOUS',
  'Cafe',
  'Coffee Shop',
  'ENTERTAINMENT_ARTS',
  'ENTERTAINMENT_MOVIES_AND_DVDS',
  'ENTERTAINMENT_MUSIC',
  'ENTERTAINMENT_SPORTS_AND_OUTDOORS',
  'ENTERTAINMENT_THEATER',
  'FOOD_AND_DRINK_ALCOHOL_AND_BARS',
  'FOOD_AND_DRINK_COFFEE_SHOP',
  'Fast Food',
  'Food & Drink',
  'Food Truck',
  'Food and Drink',
  'GENERAL_MERCHANDISE_COMPUTERS_AND_ELECTRONICS',
  'GENERAL_MERCHANDISE_HARDWARE_STORE',
  'GENERAL_MERCHANDISE_HOME_IMPROVEMENT',
  'GENERAL_MERCHANDISE_PHARMACY',
  'GOVERNMENT_TAXES_AND_LICENSES',
  'Internet Cafes',
  'Jazz and Blues Cafe',
  'LOAN_INTEREST',
  'LOAN_INTEREST_MORTGAGE',
  'RENT_COWORKING',
  'RENT_RENT',
  'Restaurants',
  'SERVICE_ACCOUNTING',
  'SERVICE_ADVERTISING',
  'SERVICE_CLEANING_AND_MAINTENANCE',
  'SERVICE_CONSULTING',
  'SERVICE_EDUCATION',
  'SERVICE_ELECTRICITY',
  'SERVICE_FREELANCE_SERVICES',
  'SERVICE_GAS',
  'SERVICE_INSURANCE',
  'SERVICE_INTERNET_AND_CABLE',
  'SERVICE_LEGAL',
  'SERVICE_LEGAL_AND_PROFESSIONAL',
  'SERVICE_MARKETING',
  'SERVICE_MEMBERSHIPS',
  'SERVICE_PHONE',
  'SERVICE_PRINTING_AND_COPYING',
  'SERVICE_PROFESSIONAL_DUES',
  'SERVICE_REPAIRS_AND_MAINTENANCE',
  'SERVICE_SECURITY',
  'SERVICE_SHIPPING',
  'SERVICE_STORAGE',
  'SERVICE_SUBSCRIPTION',
  'SERVICE_TAX_PREPARATION',
  'SERVICE_UTILITIES',
  'SERVICE_WATER',
  'Seafood',
  'TRANSPORTATION_AUTO_INSURANCE',
  'TRANSPORTATION_AUTO_PARKING',
  'TRANSPORTATION_AUTO_REPAIR',
  'TRANSPORTATION_AUTO_SERVICE',
  'TRANSPORTATION_CAR_WASH',
  'TRANSPORTATION_FUEL',
  'TRANSPORTATION_PARKING_AND_TOLLS',
  'TRANSPORTATION_RENTAL_CAR',
  'TRANSPORTATION_RIDESHARE',
  'TRAVEL_TAXI',
];

function plaidBucket(code: string): string[] {
  return [
    Object.hasOwn(CATEGORY_MAP_FROM_2026, code) ? 'mapped' : '',
    REVIEW_REQUIRED_PLAID_CODES.has(code) ? 'review' : '',
    PERSONAL_PLAID_CODES.has(code) ? 'personal' : '',
  ].filter(bucket => bucket.length > 0);
}

describe('Plaid category codes on Schedule C', () => {
  it('fails when a bank sync key is not a v1 or v2 code or a key that is not a Plaid code is outside the known list', () => {
    const { source, v1, v2, union } = plaidDetailedCodes();
    expect(source).toContain('Retrieved: 2026-10-23');
    expect(source).toContain('https://plaid.com/documents/transactions-personal-finance-category-taxonomy.csv');
    expect(source).toContain('https://plaid.com/documents/pfc-taxonomy-all.csv');
    expect(source).toContain('https://plaid.com/docs/api/products/transactions/');
    expect(v1).toHaveLength(104);
    expect(new Set(v1).size).toBe(104);
    expect(v2).toHaveLength(127);
    expect(new Set(v2).size).toBe(127);

    const bankKeys = Object.keys(PLAID_BANK_SYNC_MAP);
    const notInTaxonomy = bankKeys.filter(code => !union.has(code)).sort();
    const nonPlaidKeys = Object.keys(CATEGORY_MAP_FROM_2026).filter(code => !union.has(code)).sort();
    const overlap = [...union].filter(code => plaidBucket(code).length > 1).sort();
    const missing = [...union].filter(code => plaidBucket(code).length === 0).sort();
    expect({ notInTaxonomy, nonPlaidKeys, overlap, missing }).toEqual({
      notInTaxonomy: [],
      nonPlaidKeys: KNOWN_NON_PLAID_KEYS,
      overlap: [],
      missing: [],
    });

    for (const value of REQUIRED_LEGACY_FOOD) {
      expect(CATEGORY_MAP_FROM_2026[value]?.line, value).toBe('24b');
      expect(Object.hasOwn(PLAID_BANK_SYNC_MAP, value), value).toBe(false);
      expect(union.has(value), value).toBe(false);
    }
    expect([...LEGACY_FOOD_CATEGORY_VALUES]).toEqual(REQUIRED_LEGACY_FOOD);

    const renames = [
      ['INCOME_WAGES', 'INCOME_SALARY'],
      ['INCOME_OTHER_INCOME', 'INCOME_OTHER'],
      ['TRANSFER_IN_CASH_ADVANCES_AND_LOANS', 'LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT'],
    ] as const;
    for (const [v1Code, v2Code] of renames) {
      expect(v1, v1Code).toContain(v1Code);
      expect(v2, v2Code).toContain(v2Code);
      expect(plaidBucket(v1Code), v1Code).toEqual(['personal']);
      expect(plaidBucket(v2Code), v2Code).toEqual(plaidBucket(v1Code));
      expect(PLAID_BANK_SYNC_MAP[v1Code]?.line).toBe(PLAID_BANK_SYNC_MAP[v2Code]?.line);
    }
  });

  it('review codes stay off the 2026 map and only the no-line review codes have no line', () => {
    const noLine = new Set([
      'LOAN_PAYMENTS_CAR_PAYMENT',
      'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
      'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT',
      'LOAN_PAYMENTS_MORTGAGE_PAYMENT',
      'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT',
      'LOAN_PAYMENTS_OTHER_PAYMENT',
      'LOAN_PAYMENTS_BNPL',
      'LOAN_PAYMENTS_CASH_ADVANCES',
      'LOAN_PAYMENTS_EWA',
      'GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT',
      'GENERAL_SERVICES_INSURANCE',
      'SERVICE_FINANCIAL_PLANNING_AND_INVESTMENTS',
    ]);
    expect([...AWAITING_SCHEDULE_C_LINE].sort()).toEqual([...noLine].sort());
    for (const code of REVIEW_REQUIRED_PLAID_CODES) {
      expect(PLAID_BANK_SYNC_MAP[code], code).toBeUndefined();
      expect(CATEGORY_MAP_FROM_2026[code], code).toBeUndefined();
      const result = confirmedLine(code, 10);
      if (noLine.has(code)) {
        expect(result.lineItemsArray, code).toEqual([]);
        expect(result.totalDeductible, code).toBe(0);
      } else {
        expect(result.lineItems['27b']?.lineCode, code).toBe('27b');
        expect(result.lineItems['27a'], code).toBeUndefined();
        expect(result.totalDeductible, code).toBe(10);
      }
    }
  });

  it('confirmed 2023 and 2024 meals stay on the old line and 2021 restaurant meals stay at 100 percent', () => {
    for (const year of ['2023', '2024']) {
      expect(lineAndDeductible('FOOD_AND_DRINK_COFFEE', year), year).toEqual({ line: ['27a'], deductible: 10 });
      expect(lineAndDeductible('Food and Drink', year), year).toEqual({ line: ['27a'], deductible: 10 });
      expect(lineAndDeductible('FOOD_AND_DRINK_RESTAURANT', year), year).toEqual({ line: ['24b'], deductible: 5 });
      expect(lineAndDeductible('FOOD_AND_DRINK_FAST_FOOD', year), year).toEqual({ line: ['24b'], deductible: 5 });
      expect(lineAndDeductible('FOOD_AND_DRINK_VENDING_MACHINES', year), year).toEqual({ line: ['24b'], deductible: 5 });
    }
    expect(lineAndDeductible('FOOD_AND_DRINK_RESTAURANT', '2021')).toEqual({ line: ['24b'], deductible: 10 });
    expect(lineAndDeductible('FOOD_AND_DRINK_RESTAURANT', '2022')).toEqual({ line: ['24b'], deductible: 10 });
    expect(sumExpensesForQuarter(
      [confirmed('FOOD_AND_DRINK_RESTAURANT', 10, '2022-06-15')],
      2022,
      2,
      'UTC',
    ).confirmed_deductible_expenses).toBe(10);
    expect(sumExpensesForQuarter(
      [confirmed('FOOD_AND_DRINK_RESTAURANT', 10, '2023-06-15')],
      2023,
      2,
      'UTC',
    ).confirmed_deductible_expenses).toBe(5);
  });

  it('meal year comes from a strict transaction date', () => {
    const iso = aggregateScheduleC(
      [{ ...confirmed('FOOD_AND_DRINK_COFFEE', 10, '2025-06-15T00:00:00.000Z'), authorized_date: '2024-12-31', tax_year: 2024 }],
      '2025',
      CATEGORY_MAP,
      { mode: 'confirmed-only' },
    );
    expect(iso.totalDeductible).toBe(10);
    expect(iso.lineItemsArray.map(item => item.lineCode)).toEqual(['27b']);
    const invalid = aggregateScheduleC(
      [confirmed('FOOD_AND_DRINK_COFFEE', 10, '2025-02-31')],
      '2025',
      CATEGORY_MAP,
      { mode: 'confirmed-only' },
    );
    expect(invalid.lineItemsArray.map(item => item.lineCode)).toEqual([]);
    expect(invalid.totalDeductible).toBe(0);
    const priorYear = aggregateScheduleC(
      [{ ...confirmed('FOOD_AND_DRINK_COFFEE', 10, '2024-06-15'), authorized_date: '2025-06-15', tax_year: 2025 }],
      '2024',
      CATEGORY_MAP_FROM_2026,
      { mode: 'confirmed-only' },
    );
    expect(priorYear.lineItemsArray.map(item => item.lineCode)).toEqual(['27a']);
    expect(priorYear.totalDeductible).toBe(10);
  });

  it('confirmed 2024 coffee record stays at 100 percent on the catch all', () => {
    const result = confirmedLine('FOOD_AND_DRINK_COFFEE', 10, '2024');
    expect(categoryMapForTaxYear(2024)).toBe(CATEGORY_MAP);
    expect({
      line: result.lineItemsArray.map(item => item.lineCode),
      name: result.lineItemsArray.map(item => item.lineName),
      deductible: result.totalDeductible,
    }).toEqual({ line: ['27a'], name: ['Other expenses'], deductible: 10 });
  });

  it('confirmed 2025 meal keeps its amount', () => {
    expect(OTHER_EXPENSES_27B_FIRST_YEAR).toBe(2025);
    expect(otherExpensesLine(2023)).toBe('27a');
    expect(otherExpensesLine(2024)).toBe('27a');
    expect(otherExpensesLine(2025)).toBe('27b');
    expect(otherExpensesLine(2026)).toBe('27b');
    expect(lineAndDeductible('FOOD_AND_DRINK_COFFEE', '2025')).toEqual({ line: ['27b'], deductible: 10 });
    expect(lineAndDeductible('Food and Drink', '2025')).toEqual({ line: ['27b'], deductible: 10 });
    expect(lineAndDeductible('FOOD_AND_DRINK_FAST_FOOD', '2025')).toEqual({ line: ['24b'], deductible: 5 });
    expect(lineAndDeductible('FOOD_AND_DRINK_RESTAURANT', '2025')).toEqual({ line: ['24b'], deductible: 5 });
    expect(lineAndDeductible('FOOD_AND_DRINK_VENDING_MACHINES', '2025')).toEqual({ line: ['24b'], deductible: 5 });
  });

  it('confirmed 2026 coffee record moves to 50 percent on line 24b', () => {
    expect(lineAndDeductible('FOOD_AND_DRINK_COFFEE', '2026')).toEqual({ line: ['24b'], deductible: 5 });
    expect(lineAndDeductible('FOOD_AND_DRINK_COFFEE', '2027')).toEqual({ line: ['24b'], deductible: 5 });
  });

  it('unconfirmed 2026 restaurant and coffee add nothing and stay unconfirmed', () => {
    const restaurant = {
      amount: 10,
      date: '2026-06-15',
      category: 'FOOD_AND_DRINK_RESTAURANT',
      is_deductible: null as null,
      pending: false,
    };
    const coffee = {
      amount: 10,
      date: '2026-06-15',
      category: 'FOOD_AND_DRINK_COFFEE',
      is_deductible: null as null,
      pending: false,
    };
    // No mode argument. The default is confirmed-only.
    const result = aggregateScheduleC([restaurant, coffee], '2026', CATEGORY_MAP);
    expect({
      deductible: result.totalDeductible,
      expenses: result.totalExpenses,
      count: result.counts.deductible,
      lines: result.lineItemsArray.map(item => item.lineCode),
    }).toEqual({ deductible: 0, expenses: 0, count: 0, lines: [] });
    expect(isServerConfirmedDeduction(restaurant)).toBe(false);
    expect(isServerConfirmedDeduction(coffee)).toBe(false);
    expect(restaurant.is_deductible).toBeNull();
    expect(coffee.is_deductible).toBeNull();
    expect(restaurant).not.toHaveProperty('review_status');
    expect(coffee).not.toHaveProperty('review_status');
  });

  it('confirmed coffee lines stay on the transaction year when the clock is January 2 2027', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-02T12:00:00.000Z'));
    try {
      expect(new Date().toISOString().slice(0, 10)).toBe('2027-01-02');
      expect(CATEGORY_MAP_EFFECTIVE_YEAR).toBe(2026);
      expect(lineAndDeductible('FOOD_AND_DRINK_COFFEE', '2026')).toEqual({ line: ['24b'], deductible: 5 });
      expect(lineAndDeductible('FOOD_AND_DRINK_COFFEE', '2025')).toEqual({ line: ['27b'], deductible: 10 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('confirmed 2025 Food and Drink record keeps the other expenses amount', () => {
    expect(lineAndDeductible('Food and Drink', '2025')).toEqual({ line: ['27b'], deductible: 10 });
  });

  it('confirmed 2026 Food and Drink record moves to line 24b', () => {
    expect(lineAndDeductible('Food and Drink', '2026')).toEqual({ line: ['24b'], deductible: 5 });
  });

  it('confirmed 2025 coffee keeps the old amount and unconfirmed coffee is 50 percent', () => {
    const coffee = confirmed('FOOD_AND_DRINK_COFFEE', 10, '2025-06-15');
    const restaurant = confirmed('FOOD_AND_DRINK_RESTAURANT', 10, '2025-06-15');
    const undecidedCoffee = {
      amount: 10,
      date: '2025-06-15',
      category: 'FOOD_AND_DRINK_COFFEE',
      is_deductible: null as null,
      pending: false,
    };
    const undecidedRestaurant = {
      amount: 10,
      date: '2025-06-15',
      category: 'FOOD_AND_DRINK_RESTAURANT',
      is_deductible: null as null,
      pending: false,
    };

    // BUSINESS_CATEGORY_KEYS was the key set of CATEGORY_MAP. Quarterly used that same set.
    const oldBusiness = (tx: { category: string; is_deductible?: boolean | null; amount: number }) => {
      if (tx.is_deductible === true) return true;
      return tx.is_deductible == null && Object.hasOwn(CATEGORY_MAP, tx.category) && tx.amount > 0;
    };
    const halfCentsAwayFromZero = (cents: number) => {
      const abs = Math.abs(cents);
      const rounded = Math.floor(abs / 2) + (abs % 2);
      return cents < 0 ? -rounded : rounded;
    };
    const oldQuarterlyCents = (
      rows: Array<{ category: string; amount: number; is_deductible?: boolean | null; pending?: boolean | null; tax_review_required?: boolean; review_status?: string }>,
      mode: 'confirmed' | 'potential',
    ) => rows.reduce((total, tx) => {
      if (tx.pending === true || !Object.hasOwn(CATEGORY_MAP, tx.category)) return total;
      const confirmedDecision = tx.is_deductible === true && !transactionNeedsTaxReview(tx);
      if (mode === 'confirmed' && !confirmedDecision) return total;
      if (mode === 'potential' && !transactionNeedsTaxReview(tx)) return total;
      const cents = Math.round(tx.amount * 100);
      const line = CATEGORY_MAP[tx.category].line;
      return total + (line === '24b' ? halfCentsAwayFromZero(cents) : cents);
    }, 0);

    const storedLine = CATEGORY_MAP[coffee.category]?.line;
    const publishedLine = storedLine === '24b' ? '24b' : '27b';
    const old = {
      business: oldBusiness(undecidedCoffee),
      confirmedBusiness: oldBusiness(coffee),
      line: [publishedLine],
      deductible: storedLine === '24b' ? 5 : 10,
      quarterlyConfirmedCents: oldQuarterlyCents([coffee, restaurant], 'confirmed'),
      quarterlyPotentialCents: oldQuarterlyCents([undecidedCoffee], 'potential'),
      businessCount: [undecidedCoffee, undecidedRestaurant].filter(oldBusiness).length,
    };
    expect(old).toEqual({
      business: false,
      confirmedBusiness: true,
      line: ['27b'],
      deductible: 10,
      quarterlyConfirmedCents: 500,
      quarterlyPotentialCents: 0,
      businessCount: 1,
    });

    const schedule = aggregateScheduleC([coffee], '2025', CATEGORY_MAP, { mode: 'confirmed-only' });
    const quarterlyConfirmed = sumExpensesForQuarter([coffee, restaurant], 2025, 2, 'UTC');
    const quarterlyPotential = sumPotentialExpensesForQuarter([undecidedCoffee], 2025, 2, 'UTC');
    const businessCount = aggregateScheduleC(
      [undecidedCoffee, undecidedRestaurant],
      '2025',
      CATEGORY_MAP,
      { mode: 'default' },
    ).counts.deductible;
    expect({
      business: isBusinessExpense(undecidedCoffee),
      confirmedBusiness: isBusinessExpense(coffee),
      line: schedule.lineItemsArray.map(item => item.lineCode),
      deductible: schedule.totalDeductible,
      quarterlyConfirmedCents: quarterlyConfirmed.confirmed_deductible_expenses_cents,
      quarterlyPotentialCents: quarterlyPotential.potential_deductions_needing_review_cents,
      businessCount,
    }).toEqual({
      business: true,
      confirmedBusiness: true,
      line: ['27b'],
      deductible: 10,
      quarterlyConfirmedCents: 500,
      quarterlyPotentialCents: 500,
      businessCount: 2,
    });
    expect(schedule.totalDeductible).toBe(old.deductible);
    expect(quarterlyConfirmed.confirmed_deductible_expenses_cents).toBe(old.quarterlyConfirmedCents);
  });

  it('a passed 2026 map does not change a 2025 coffee record', () => {
    const result = aggregateScheduleC(
      [confirmed('FOOD_AND_DRINK_COFFEE', 10, '2025-06-15')],
      '2025',
      CATEGORY_MAP_FROM_2026,
      { mode: 'confirmed-only' },
    );
    expect(result.lineItems['27b']?.lineCode).toBe('27b');
    expect(result.lineItems['24b']).toBeUndefined();
    expect(result.totalDeductible).toBe(10);
  });

  it('federal snapshot deductible follows the transaction tax year for coffee', () => {
    const snap = (year: number) => buildFederalTaxSnapshot({
      taxYear: year,
      profile: { filing_status: 'single' },
      organizer: reviewedPersonalDeductionOrganizer(year),
      transactions: [confirmed('FOOD_AND_DRINK_COFFEE', 10, `${year}-06-15`)],
      grossReceipts: [{ amount: 100000 }],
      forms1099: [],
      w2Entries: [],
      deductions: {},
      assets: [],
      estimatedPayments: 0,
    });
    expect(snap(2025).income.totalDeductible).toBe(10);
    expect(snap(2026).income.totalDeductible).toBe(5);
  });

  it('unconfirmed 2024 coffee lands at 50 percent', () => {
    const potential = (year: string) => aggregateScheduleC(
      [{ amount: 10, date: `${year}-06-15`, category: 'FOOD_AND_DRINK_COFFEE', is_deductible: null, pending: false }],
      year,
      CATEGORY_MAP,
      { mode: 'default' },
    );
    expect(potential('2023').totalDeductible).toBe(5);
    expect(potential('2024').totalDeductible).toBe(5);
    expect(potential('2025').totalDeductible).toBe(5);
    expect(potential('2026').totalDeductible).toBe(5);
    expect(potential('2022').totalDeductible).toBe(0);
    const row = (year: number, deductible: boolean | null) => ({
      id: `coffee-${year}`,
      amount: 10,
      category: 'FOOD_AND_DRINK_COFFEE',
      date: `${year}-06-15`,
      pending: false,
      is_deductible: deductible,
      review_status: deductible === true ? 'confirmed' as const : undefined,
      tax_review_required: false,
    });
    expect(sumPotentialExpensesForQuarter([row(2024, null)], 2024, 2, 'UTC').potential_deductions_needing_review).toBe(5);
    expect(sumPotentialExpensesForQuarter([row(2025, null)], 2025, 2, 'UTC').potential_deductions_needing_review).toBe(5);
    expect(sumPotentialExpensesForQuarter([row(2026, null)], 2026, 2, 'UTC').potential_deductions_needing_review).toBe(5);
    expect(sumExpensesForQuarter([row(2025, true)], 2025, 2, 'UTC').confirmed_deductible_expenses).toBe(0);
    expect(sumExpensesForQuarter([row(2026, true)], 2026, 2, 'UTC').confirmed_deductible_expenses).toBe(5);
  });

  it('confirmed 2026 meal lands at 50 percent', () => {
    const before = confirmedLine('FOOD_AND_DRINK_COFFEE', 10, '2025');
    const after = confirmedLine('FOOD_AND_DRINK_COFFEE', 10, '2026');
    expect(before.lineItems['27b']?.lineCode).toBe('27b');
    expect(before.totalDeductible).toBe(10);
    expect(after.lineItems['24b']?.lineCode).toBe('24b');
    expect(after.totalDeductible).toBe(5);
    expect(lineAndDeductible('FOOD_AND_DRINK_RESTAURANT', '2026')).toEqual({ line: ['24b'], deductible: 5 });
    expect(lineAndDeductible('FOOD_AND_DRINK_FAST_FOOD', '2026')).toEqual({ line: ['24b'], deductible: 5 });
    expect(lineAndDeductible('FOOD_AND_DRINK_VENDING_MACHINES', '2026')).toEqual({ line: ['24b'], deductible: 5 });
    expect(lineAndDeductible('Food and Drink', '2026')).toEqual({ line: ['24b'], deductible: 5 });
  });

  it('confirmed 10.00 coffee charge lands on line 24b with 5.00 deductible', () => {
    const result = confirmedLine('FOOD_AND_DRINK_COFFEE', 10);
    expect({
      line: result.lineItemsArray.map(item => item.lineCode),
      total: result.lineItemsArray.map(item => item.total),
      deductible: result.totalDeductible,
    }).toEqual({ line: ['24b'], total: [10], deductible: 5 });
  });

  it('simple meal codes are on both Plaid lists at 50 percent', () => {
    const { v1, v2 } = plaidDetailedCodes();
    for (const code of [
      'FOOD_AND_DRINK_COFFEE',
      'FOOD_AND_DRINK_FAST_FOOD',
      'FOOD_AND_DRINK_RESTAURANT',
      'FOOD_AND_DRINK_VENDING_MACHINES',
    ]) {
      expect(v1, code).toContain(code);
      expect(v2, code).toContain(code);
      expect(PLAID_BANK_SYNC_MAP[code]?.line, code).toBe('24b');
      expect(lineAndDeductible(code, '2026'), code).toEqual({ line: ['24b'], deductible: 5 });
    }
    expect(lineAndDeductible('FOOD_AND_DRINK_FAST_FOOD', '2024')).toEqual({ line: ['24b'], deductible: 5 });
    expect(lineAndDeductible('FOOD_AND_DRINK_RESTAURANT', '2024')).toEqual({ line: ['24b'], deductible: 5 });
    expect(lineAndDeductible('FOOD_AND_DRINK_VENDING_MACHINES', '2024')).toEqual({ line: ['24b'], deductible: 5 });
    expect(v1).toContain('FOOD_AND_DRINK_GROCERIES');
    expect(v2).toContain('FOOD_AND_DRINK_GROCERIES');
    expect(v1).toContain('FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR');
    expect(v2).toContain('FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR');
    expect(v1).toContain('FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK');
    expect(PLAID_BANK_SYNC_MAP.FOOD_AND_DRINK_GROCERIES).toBeUndefined();
    expect(PLAID_BANK_SYNC_MAP.FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR).toBeUndefined();
    expect(PLAID_BANK_SYNC_MAP.FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK).toBeUndefined();
    expect(CATEGORY_MAP.FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK.line).toBe('24b');
    expect(PERSONAL_PLAID_CODES.has('FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR')).toBe(true);
  });

  it('insurance stays on the old keys', () => {
    expect(lineAndDeductible('SERVICE_INSURANCE', '2025')).toEqual({ line: ['15'], deductible: 10 });
    expect(lineAndDeductible('SERVICE_INSURANCE', '2026')).toEqual({ line: ['15'], deductible: 10 });
    expect(lineAndDeductible('TRANSPORTATION_AUTO_INSURANCE', '2026')).toEqual({ line: ['15'], deductible: 10 });
    expect(Object.hasOwn(PLAID_BANK_SYNC_MAP, 'GENERAL_SERVICES_INSURANCE')).toBe(false);
    expect(Object.hasOwn(CATEGORY_MAP_FROM_2026, 'GENERAL_SERVICES_INSURANCE')).toBe(false);
    for (const year of ['2024', '2025', '2026']) {
      const result = confirmedLine('GENERAL_SERVICES_INSURANCE', 10, year);
      expect(result.lineItemsArray, year).toEqual([]);
      expect(result.totalDeductible, year).toBe(0);
      expect(result.lineItems['27a'], year).toBeUndefined();
      expect(result.lineItems['27b'], year).toBeUndefined();
    }
    expect(REVIEW_REQUIRED_PLAID_CODES.has('SERVICE_FINANCIAL_PLANNING_AND_INVESTMENTS')).toBe(true);
    expect(Object.hasOwn(CATEGORY_MAP, 'SERVICE_FINANCIAL_PLANNING_AND_INVESTMENTS')).toBe(false);
    expect(Object.hasOwn(CATEGORY_MAP_FROM_2026, 'SERVICE_FINANCIAL_PLANNING_AND_INVESTMENTS')).toBe(false);
    for (const year of ['2024', '2025', '2026']) {
      const result = confirmedLine('SERVICE_FINANCIAL_PLANNING_AND_INVESTMENTS', 10, year);
      expect(result.lineItemsArray, year).toEqual([]);
      expect(result.totalDeductible, year).toBe(0);
      expect(result.lineItems['10'], year).toBeUndefined();
    }
  });

  it.each([
    ['LOAN_PAYMENTS_CAR_PAYMENT', 21],
    ['LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', 22],
    ['LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT', 23],
    ['LOAN_PAYMENTS_MORTGAGE_PAYMENT', 24],
    ['LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT', 25],
    ['LOAN_PAYMENTS_OTHER_PAYMENT', 26],
    ['LOAN_PAYMENTS_BNPL', 27],
    ['LOAN_PAYMENTS_CASH_ADVANCES', 28],
    ['LOAN_PAYMENTS_EWA', 29],
    ['GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT', 30],
    ['GENERAL_SERVICES_INSURANCE', 18],
    ['SERVICE_FINANCIAL_PLANNING_AND_INVESTMENTS', 42.5],
  ] as const)('%s has no Schedule C line and stays on the review list with its amount', (category, amount) => {
    const record = { ...confirmed(category, amount, '2026-06-15'), iso_currency_code: 'USD' };
    const priorYear = { ...confirmed(category, amount, '2024-06-15'), iso_currency_code: 'USD' };
    const schedule = aggregateScheduleC([record], '2026', CATEGORY_MAP, { mode: 'confirmed-only' });
    const schedule2024 = aggregateScheduleC([priorYear], '2024', CATEGORY_MAP, { mode: 'confirmed-only' });
    const reviewList = prioritizeTransactionReview([record].filter(transactionNeedsCategoryReview));
    const shown = formatRecordedTransactionAmount(record);
    expect(reviewList).toEqual([record]);
    expect(reviewList[0]?.amount).toBe(amount);
    expect(transactionNeedsTaxReview(record)).toBe(true);
    expect(dashboardRecordStatus(record)).toBe('review');
    expect(schedule.lineItemsArray).toEqual([]);
    expect(schedule.lineItems['27a']).toBeUndefined();
    expect(schedule.lineItems['27b']).toBeUndefined();
    expect(schedule.totalDeductible).toBe(0);
    expect(schedule.totalExpenses).toBe(0);
    expect(schedule2024.lineItemsArray).toEqual([]);
    expect(schedule2024.lineItems['27a']).toBeUndefined();
    expect(schedule2024.totalDeductible).toBe(0);
    expect(sumExpensesForQuarter([record], 2026, 2, 'UTC').confirmed_deductible_expenses).toBe(0);
    const printed = { category, line: 'none', deductible: schedule.totalDeductible, reviewAmount: amount, shown };
    console.log(`NO_LINE ${JSON.stringify(printed)}`);
    expect(printed.reviewAmount).toBe(amount);
    expect(printed.deductible).toBe(0);
  });

  it('GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING keeps the other expenses year line', () => {
    expect(isAwaitingScheduleCLine('GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING')).toBe(false);
    const printed = {
      category: 'GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING',
      y2024: lineAndDeductible('GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING', '2024'),
      y2025: lineAndDeductible('GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING', '2025'),
      y2026: lineAndDeductible('GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING', '2026'),
    };
    console.log(`ACCOUNTING_LINE ${JSON.stringify(printed)}`);
    expect(printed.y2024).toEqual({ line: ['27a'], deductible: 10 });
    expect(printed.y2025).toEqual({ line: ['27b'], deductible: 10 });
    expect(printed.y2026).toEqual({ line: ['27b'], deductible: 10 });
  });

  it('financial planning stays on the review list with its amount and no line', () => {
    expect(CATEGORY_MAP.SERVICE_FINANCIAL_PLANNING_AND_INVESTMENTS).toBeUndefined();
    const financial = confirmed('SERVICE_FINANCIAL_PLANNING_AND_INVESTMENTS', 42.5, '2026-06-15');
    const insurance = confirmed('GENERAL_SERVICES_INSURANCE', 18, '2026-06-15');
    const reviewList = [financial, insurance].filter(record => REVIEW_REQUIRED_PLAID_CODES.has(record.category));
    expect(reviewList.map(record => ({ category: record.category, amount: record.amount }))).toEqual([
      { category: 'SERVICE_FINANCIAL_PLANNING_AND_INVESTMENTS', amount: 42.5 },
      { category: 'GENERAL_SERVICES_INSURANCE', amount: 18 },
    ]);
    for (const record of reviewList) {
      const result = aggregateScheduleC([record], '2026', CATEGORY_MAP, { mode: 'confirmed-only' });
      expect(result.lineItemsArray, record.category).toEqual([]);
      expect(result.totalDeductible, record.category).toBe(0);
      expect(result.totalExpenses, record.category).toBe(0);
      expect(record.amount, record.category).toBeGreaterThan(0);
      expect(isBusinessExpense(record), record.category).toBe(false);
      expect(sumExpensesForQuarter([record], 2026, 2, 'UTC').confirmed_deductible_expenses, record.category).toBe(0);
    }
  });

  it('gas rent utilities insurance fees rides and review codes keep their old keys', () => {
    const unchanged: Array<[string, string]> = [
      ['TRANSPORTATION_FUEL', '9'],
      ['RENT_RENT', '20b'],
      ['RENT_COWORKING', '20b'],
      ['SERVICE_UTILITIES', '25'],
      ['SERVICE_ELECTRICITY', '25'],
      ['SERVICE_GAS', '25'],
      ['SERVICE_WATER', '25'],
      ['SERVICE_PHONE', '25'],
      ['SERVICE_INTERNET_AND_CABLE', '25'],
      ['SERVICE_INSURANCE', '15'],
      ['TRANSPORTATION_AUTO_INSURANCE', '15'],
      ['BANK_FEES_ATM_FEES', '10'],
      ['BANK_FEES_FOREIGN_TRANSACTION', '10'],
      ['BANK_FEES_OVERDRAFT', '10'],
      ['BANK_FEES_OTHER_BANK_FEES', '10'],
      ['TRANSPORTATION_RIDESHARE', '9'],
      ['TRANSPORTATION_AUTO_PARKING', '9'],
      ['SERVICE_ACCOUNTING', '17'],
      ['SERVICE_LEGAL', '17'],
      ['SERVICE_SHIPPING', '22'],
      ['SERVICE_STORAGE', '18'],
      ['SERVICE_REPAIRS_AND_MAINTENANCE', '21'],
      ['SERVICE_EDUCATION', '27a'],
      ['SERVICE_SECURITY', '17'],
    ];
    for (const [code, line] of unchanged) {
      const published = (year: number) => (line === '27a' || line === '27b' ? otherExpensesLine(year) : line);
      expect(lineAndDeductible(code, '2024'), code).toEqual({ line: [published(2024)], deductible: 10 });
      expect(lineAndDeductible(code, '2025'), code).toEqual({ line: [published(2025)], deductible: 10 });
      expect(lineAndDeductible(code, '2026'), code).toEqual({ line: [published(2026)], deductible: 10 });
      expect(CATEGORY_MAP_FROM_2026[code]?.line, code).toBe(line);
      expect(Object.hasOwn(PLAID_BANK_SYNC_MAP, code), code).toBe(false);
    }
    for (const code of [
      'TRANSPORTATION_GAS',
      'RENT_AND_UTILITIES_RENT',
      'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY',
      'RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT',
      'RENT_AND_UTILITIES_WATER',
      'RENT_AND_UTILITIES_OTHER_UTILITIES',
      'RENT_AND_UTILITIES_TELEPHONE',
      'RENT_AND_UTILITIES_INTERNET_AND_CABLE',
      'BANK_FEES_FOREIGN_TRANSACTION_FEES',
      'BANK_FEES_INSUFFICIENT_FUNDS',
      'BANK_FEES_OVERDRAFT_FEES',
      'BANK_FEES_LATE_FEES',
      'BANK_FEES_CASH_ADVANCE',
      'TRANSPORTATION_TAXIS_AND_RIDE_SHARES',
      'TRANSPORTATION_PARKING',
      'GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING',
      'GENERAL_SERVICES_CONSULTING_AND_LEGAL',
      'GENERAL_SERVICES_POSTAGE_AND_SHIPPING',
      'GENERAL_SERVICES_STORAGE',
      'HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE',
      'GENERAL_SERVICES_EDUCATION',
      'GENERAL_SERVICES_OTHER_GENERAL_SERVICES',
      'HOME_IMPROVEMENT_SECURITY',
    ]) {
      expect(Object.hasOwn(CATEGORY_MAP, code), code).toBe(false);
      expect(Object.hasOwn(CATEGORY_MAP_FROM_2026, code), code).toBe(false);
      expect(Object.hasOwn(PLAID_BANK_SYNC_MAP, code), code).toBe(false);
      expect(REVIEW_REQUIRED_PLAID_CODES.has(code), code).toBe(true);
      expect(lineAndDeductible(code, '2022'), code).toEqual({ line: ['27a'], deductible: 10 });
      expect(lineAndDeductible(code, '2023'), code).toEqual({ line: ['27a'], deductible: 10 });
      expect(lineAndDeductible(code, '2024'), code).toEqual({ line: ['27a'], deductible: 10 });
      expect(lineAndDeductible(code, '2025'), code).toEqual({ line: ['27b'], deductible: 10 });
      expect(lineAndDeductible(code, '2026'), code).toEqual({ line: ['27b'], deductible: 10 });
      expect(isBusinessExpense({ amount: 10, date: '2026-06-15', category: code, is_deductible: null, pending: false }), code).toBe(false);
    }
  });

  it('a coffee posted Jan 2 2026 lands in 2026 when the charge date is Dec 31 2025', () => {
    const posted = {
      ...confirmed('FOOD_AND_DRINK_COFFEE', 10, '2026-01-02'),
      authorized_date: '2025-12-31',
    };
    const snap = (year: number) => buildFederalTaxSnapshot({
      taxYear: year,
      profile: { filing_status: 'single' },
      organizer: reviewedPersonalDeductionOrganizer(year),
      transactions: [posted],
      grossReceipts: [{ amount: 100000 }],
      forms1099: [],
      w2Entries: [],
      deductions: {},
      assets: [],
      estimatedPayments: 0,
    });
    // The caller passes the other year's map. The record date still selects the line.
    const in2026 = aggregateScheduleC([posted], '2026', CATEGORY_MAP, { mode: 'confirmed-only' });
    const in2025 = aggregateScheduleC([posted], '2025', CATEGORY_MAP_FROM_2026, { mode: 'confirmed-only' });
    expect({
      line: in2026.lineItemsArray.map(item => item.lineCode),
      deductible: in2026.totalDeductible,
      priorYearDeductible: in2025.totalDeductible,
      quarterly: sumExpensesForQuarter([posted], 2026, 1, 'UTC').confirmed_deductible_expenses,
      priorQuarter: sumExpensesForQuarter([posted], 2025, 4, 'UTC').confirmed_deductible_expenses,
      snapshot: snap(2026).income.totalDeductible,
      priorSnapshot: snap(2025).income.totalDeductible,
    }).toEqual({
      line: ['24b'],
      deductible: 5,
      priorYearDeductible: 0,
      quarterly: 5,
      priorQuarter: 0,
      snapshot: 5,
      priorSnapshot: 0,
    });
  });

  it('the 10 dollar sample quarterly total matches the meals deduction in 2025 and 2026', () => {
    const categories = [
      'FOOD_AND_DRINK_COFFEE',
      'FOOD_AND_DRINK_RESTAURANT',
      'BANK_FEES_ATM_FEES',
      'TRANSPORTATION_PARKING',
    ] as const;
    const quarter = (category: string, year: number) => sumExpensesForQuarter(
      [confirmed(category, 10, `${year}-06-15`)],
      year,
      2,
      'UTC',
    ).confirmed_deductible_expenses;
    const schedule = (year: number) => aggregateScheduleC(
      categories.map(category => confirmed(category, 10, `${year}-06-15`)),
      String(year),
      CATEGORY_MAP,
      { mode: 'confirmed-only' },
    ).totalDeductible;
    const quarterly = (year: number) => sumExpensesForQuarter(
      categories.map(category => confirmed(category, 10, `${year}-06-15`)),
      year,
      2,
      'UTC',
    ).confirmed_deductible_expenses;
    const undecidedCount = (year: number) => categories.filter(category => isBusinessExpense({
      amount: 10,
      date: `${year}-06-15`,
      category,
      is_deductible: null,
      pending: false,
    })).length;

    expect({
      coffee: quarter('FOOD_AND_DRINK_COFFEE', 2025),
      restaurant: quarter('FOOD_AND_DRINK_RESTAURANT', 2025),
      atm: quarter('BANK_FEES_ATM_FEES', 2025),
      parking: quarter('TRANSPORTATION_PARKING', 2025),
    }).toEqual({ coffee: 0, restaurant: 5, atm: 10, parking: 0 });
    expect({
      coffee: quarter('FOOD_AND_DRINK_COFFEE', 2026),
      restaurant: quarter('FOOD_AND_DRINK_RESTAURANT', 2026),
      atm: quarter('BANK_FEES_ATM_FEES', 2026),
      parking: quarter('TRANSPORTATION_PARKING', 2026),
    }).toEqual({ coffee: 5, restaurant: 5, atm: 10, parking: 0 });
    expect({
      coffee: quarter('FOOD_AND_DRINK_COFFEE', 2024),
      restaurant: quarter('FOOD_AND_DRINK_RESTAURANT', 2024),
      atm: quarter('BANK_FEES_ATM_FEES', 2024),
      parking: quarter('TRANSPORTATION_PARKING', 2024),
    }).toEqual({ coffee: 0, restaurant: 5, atm: 10, parking: 0 });
    expect({ schedule: schedule(2025), quarterly: quarterly(2025), undecided: undecidedCount(2025) }).toEqual({
      schedule: 35,
      quarterly: 15,
      undecided: 3,
    });
    expect({ schedule: schedule(2026), quarterly: quarterly(2026), undecided: undecidedCount(2026) }).toEqual({
      schedule: 30,
      quarterly: 20,
      undecided: 3,
    });
    expect({ schedule: schedule(2024), quarterly: quarterly(2024), undecided: undecidedCount(2024) }).toEqual({
      schedule: 35,
      quarterly: 15,
      undecided: 3,
    });
    expect(sumExpensesForQuarter(
      categories.map(category => ({
        amount: 10,
        date: '2026-06-15',
        category,
        is_deductible: null as null,
        pending: false,
      })),
      2026,
      2,
      'UTC',
    ).confirmed_deductible_expenses).toBe(0);
  });

  it('a 2026 10.00 coffee charge lowers profit by 5.00 in the schedule c summary and the quarterly estimate', () => {
    const coffee = confirmed('FOOD_AND_DRINK_COFFEE', 10, '2026-06-15');
    const income = { id: 'income-1', amount: -100, category: 'income', date: '2026-06-15', pending: false, is_deductible: null as null };
    const schedule = aggregateScheduleC([coffee], '2026', CATEGORY_MAP, { mode: 'confirmed-only' });
    const gross = sumIncomeForQuarter([income], 2026, 2, 'UTC').grossIncome;
    const quarterly = sumExpensesForQuarter([coffee], 2026, 2, 'UTC').confirmed_deductible_expenses;
    expect({
      line: schedule.lineItemsArray.map(item => item.lineCode),
      scheduleDeductible: schedule.totalDeductible,
      quarterlyDeductible: quarterly,
      scheduleProfit: gross - schedule.totalDeductible,
      quarterlyProfit: gross - quarterly,
    }).toEqual({
      line: ['24b'],
      scheduleDeductible: 5,
      quarterlyDeductible: 5,
      scheduleProfit: 95,
      quarterlyProfit: 95,
    });
  });

  it('groceries car payments government charges bank interest and department stores stay off the business keys', () => {
    for (const code of [
      'FOOD_AND_DRINK_GROCERIES',
      'LOAN_PAYMENTS_CAR_PAYMENT',
      'GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES',
      'GOVERNMENT_AND_NON_PROFIT_OTHER_GOVERNMENT_AND_NON_PROFIT',
      'BANK_FEES_INTEREST_CHARGE',
      'GENERAL_MERCHANDISE_DEPARTMENT_STORES',
    ]) {
      expect(REVIEW_REQUIRED_PLAID_CODES.has(code), code).toBe(true);
      expect(Object.hasOwn(CATEGORY_MAP, code), code).toBe(false);
      expect(Object.hasOwn(CATEGORY_MAP_FROM_2026, code), code).toBe(false);
      expect(isBusinessExpense({ amount: 10, date: '2025-06-15', category: code, is_deductible: null, pending: false }), code).toBe(false);
      expect(isBusinessExpense({ amount: 10, date: '2026-06-15', category: code, is_deductible: null, pending: false }), code).toBe(false);
    }
  });

  it('2024 and 2025 keep the old map and fuel stays on line 9 in 2026', () => {
    expect(categoryMapForTaxYear(2024)).toBe(CATEGORY_MAP);
    expect(categoryMapForTaxYear(2025)).toBe(CATEGORY_MAP);
    expect(categoryMapForTaxYear(2026)).toBe(CATEGORY_MAP_FROM_2026);
    expect(lineAndDeductible('TRANSPORTATION_FUEL', '2024')).toEqual({ line: ['9'], deductible: 10 });
    expect(lineAndDeductible('TRANSPORTATION_FUEL', '2025')).toEqual({ line: ['9'], deductible: 10 });
    expect(lineAndDeductible('TRANSPORTATION_FUEL', '2026')).toEqual({ line: ['9'], deductible: 10 });
    expect(Object.hasOwn(PLAID_BANK_SYNC_MAP, 'TRANSPORTATION_FUEL')).toBe(false);
    expect(lineAndDeductible('BANK_FEES_OTHER_BANK_FEES', '2025')).toEqual({ line: ['10'], deductible: 10 });
    expect(lineAndDeductible('BANK_FEES_OTHER_BANK_FEES', '2026')).toEqual({ line: ['10'], deductible: 10 });
    expect(lineAndDeductible('BANK_FEES_ATM_FEES', '2025')).toEqual({ line: ['10'], deductible: 10 });
    expect(lineAndDeductible('BANK_FEES_ATM_FEES', '2026')).toEqual({ line: ['10'], deductible: 10 });
  });

  it('coffee uses the real Plaid code and the old coffee shop key keeps line 24b', () => {
    expect(PLAID_BANK_SYNC_MAP.FOOD_AND_DRINK_COFFEE.line).toBe('24b');
    expect(Object.hasOwn(PLAID_BANK_SYNC_MAP, 'FOOD_AND_DRINK_COFFEE_SHOP')).toBe(false);
    expect(lineAndDeductible('FOOD_AND_DRINK_COFFEE', '2025')).toEqual({ line: ['27b'], deductible: 10 });
    expect(lineAndDeductible('FOOD_AND_DRINK_COFFEE', '2026')).toEqual({ line: ['24b'], deductible: 5 });
    expect(lineAndDeductible('FOOD_AND_DRINK_COFFEE_SHOP', '2025')).toEqual({ line: ['24b'], deductible: 5 });
    expect(lineAndDeductible('FOOD_AND_DRINK_COFFEE_SHOP', '2026')).toEqual({ line: ['24b'], deductible: 5 });
    expect(REVIEW_REQUIRED_PLAID_CODES.has('TRANSPORTATION_GAS')).toBe(true);
    expect(lineAndDeductible('TRANSPORTATION_GAS', '2026')).toEqual({ line: ['27b'], deductible: 10 });
    expect(isBusinessExpense({ amount: 10, date: '2026-06-15', category: 'TRANSPORTATION_GAS', is_deductible: null, pending: false })).toBe(false);
  });

  it('SERVICE_EDUCATION gives 27a for a 2024 date and 27b for a 2025 date', () => {
    for (const code of ['SERVICE_EDUCATION', 'GENERAL_SERVICES_EDUCATION']) {
      expect(lineAndDeductible(code, '2023'), code).toEqual({ line: ['27a'], deductible: 10 });
      expect(lineAndDeductible(code, '2024'), code).toEqual({ line: ['27a'], deductible: 10 });
      expect(lineAndDeductible(code, '2025'), code).toEqual({ line: ['27b'], deductible: 10 });
      expect(lineAndDeductible(code, '2026'), code).toEqual({ line: ['27b'], deductible: 10 });
    }
    expect(publishedOtherExpensesLine('27a', 2022)).toEqual({ line: '27a', needsReview: true });
    expect(lineAndDeductible('SERVICE_EDUCATION', '2022')).toEqual({ line: ['27a'], deductible: 10 });
    const invalid = confirmed('SERVICE_EDUCATION', 10, '2024-13-45');
    const grouped = aggregateScheduleC([invalid], '2024', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(grouped.lineItemsArray).toEqual([]);
    expect(grouped.totalDeductible).toBe(0);
    expect(publishedOtherExpensesLine('27a', resolveOtherExpensesYear(invalid))).toEqual({ line: null, needsReview: true });
    const flagged = convertTransactionsToCSV([{
      ...confirmed('TRANSPORTATION_GAS', 10, '2022-06-15'),
      schedule_c_line: '27a',
    }]);
    const blank = convertTransactionsToCSV([{
      ...invalid,
      schedule_c_line: '27a',
    }]);
    expect(flagged).toContain('27a');
    expect(flagged).toContain('Tax treatment unresolved; exclude from confirmed deduction totals');
    expect(blank).toContain('Tax treatment unresolved; exclude from confirmed deduction totals');
    expect(blank.split('\n')[1]?.split(',')[13]).toBe('');
  });

  it('prints the federal snapshot for a single filer with 50000 receipts', () => {
    const categories = [
      'FOOD_AND_DRINK_COFFEE',
      'FOOD_AND_DRINK_RESTAURANT',
      'BANK_FEES_ATM_FEES',
      'TRANSPORTATION_PARKING',
    ] as const;
    const rows = (year: number) => categories.map(category => confirmed(category, 10, `${year}-06-15`));
    const snap = (year: number, transactions: ReturnType<typeof rows>) => buildFederalTaxSnapshot({
      taxYear: year,
      profile: { filing_status: 'single' },
      organizer: reviewedPersonalDeductionOrganizer(year),
      transactions,
      grossReceipts: [{ amount: 50000 }],
      forms1099: [],
      w2Entries: [],
      deductions: {},
      assets: [],
      estimatedPayments: 0,
    });
    const pack = (year: number) => {
      const sample = rows(year);
      const withSample = snap(year, sample);
      const baseline = snap(year, []);
      // Prior amount for this sample: confirmed 2026 coffee was other expenses at 100 percent.
      // Confirmed 2024 and 2025 coffee already keep that amount. Parking stays other expenses at 100 percent.
      const priorRows = [
        year >= 2026 ? confirmed('SERVICE_MEMBERSHIPS', 10, `${year}-06-15`) : sample[0],
        sample[1],
        sample[2],
        sample[3],
      ];
      const prior = snap(year, priorRows);
      const perRecord = sample.map(record => {
        const result = aggregateScheduleC([record], String(year), CATEGORY_MAP, { mode: 'confirmed-only' });
        return {
          category: record.category,
          line: result.lineItemsArray.map(item => item.lineCode).join('') || 'none',
          deductible: result.totalDeductible,
          quarterly: sumExpensesForQuarter([record], year, 2, 'UTC').confirmed_deductible_expenses,
          reviewAmount: 0,
        };
      });
      return {
        year,
        perRecord,
        deductible: withSample.income.totalDeductible,
        priorDeductible: prior.income.totalDeductible,
        baselineDeductible: baseline.income.totalDeductible,
        totalTax: withSample.result.totalTax,
        priorTotalTax: prior.result.totalTax,
        baselineTotalTax: baseline.result.totalTax,
        incomeTax: withSample.result.incomeTax,
        priorIncomeTax: prior.result.incomeTax,
        seTax: withSample.seCalc.totalSETax,
        priorSeTax: prior.seCalc.totalSETax,
        taxChange: Math.round((withSample.result.totalTax - prior.result.totalTax) * 100) / 100,
      };
    };
    const printed = { y2024: pack(2024), y2025: pack(2025), y2026: pack(2026) };
    console.log(`FEDERAL_SNAPSHOT ${JSON.stringify(printed)}`);
    expect(printed.y2024.deductible).toBe(35);
    expect(printed.y2024.priorDeductible).toBe(35);
    expect(printed.y2025.deductible).toBe(35);
    expect(printed.y2025.priorDeductible).toBe(35);
    expect(printed.y2026.deductible).toBe(30);
    expect(printed.y2026.priorDeductible).toBe(35);
    expect(printed.y2025.perRecord.map(row => row.deductible)).toEqual([10, 5, 10, 10]);
    expect(printed.y2026.perRecord.map(row => row.deductible)).toEqual([5, 5, 10, 10]);
    expect(printed.y2024.perRecord.map(row => row.reviewAmount)).toEqual([0, 0, 0, 0]);
    expect(printed.y2025.perRecord.map(row => row.reviewAmount)).toEqual([0, 0, 0, 0]);
    expect(printed.y2026.perRecord.map(row => row.reviewAmount)).toEqual([0, 0, 0, 0]);
  });

  it('every old map key keeps its line on the 2026 map', () => {
    for (const [code, entry] of Object.entries(CATEGORY_MAP)) {
      expect(CATEGORY_MAP_FROM_2026[code]?.line, code).toBe(entry.line);
      expect(CATEGORY_MAP_FROM_2026[code]?.name, code).toBe(entry.name);
    }
    for (const code of Object.keys(PLAID_BANK_SYNC_MAP)) {
      const previous = CATEGORY_MAP[code];
      if (previous) expect(PLAID_BANK_SYNC_MAP[code].line, code).toBe(previous.line);
      else expect(code).toBe('FOOD_AND_DRINK_COFFEE');
    }
  });
});
