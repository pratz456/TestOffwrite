import { describe, expect, it } from 'vitest';
import { aggregateQuarterlyEstimatesForYear, getLocalTransactionDate, sumIncomeForQuarter, sumExpensesForQuarter, sumPotentialExpensesForQuarter } from '@/lib/tax-provider/quarterly-estimates';

const baseOptions = { filingStatus: 'single' as const, w2Income: 0, otherIncome: 0 };
function calendarSummary(transactions: Parameters<typeof sumIncomeForQuarter>[0], year: number, timezone: string, _options: unknown) {
  return { quarters: ([1, 2, 3, 4] as const).map(quarter => {
    const gross = sumIncomeForQuarter(transactions, year, quarter, timezone).grossIncome;
    const expense = sumExpensesForQuarter(transactions, year, quarter, timezone).confirmed_deductible_expenses;
    return { quarter, gross_income: gross, confirmed_deductible_expenses: expense,
      potential_deductions_needing_review: sumPotentialExpensesForQuarter(transactions, year, quarter, timezone).potential_deductions_needing_review,
      net_profit: gross - expense };
  }) };
}

describe('Quarterly estimated tax helpers', () => {
  it('quarter boundary uses user-local date (Tokyo: Apr1 falls in Q2)', () => {
    const tx = {
      id: 't1',
      trans_id: 't1',
      account_id: 'a1',
      amount: -100,
      category: 'revenue',
      datetime: '2024-03-31T16:30:00.000Z',
      pending: false,
      is_deductible: null,
    };

    const tokyo = calendarSummary([tx], 2024, 'Asia/Tokyo', baseOptions);
    const q1 = tokyo.quarters.find((q) => q.quarter === 1)!;
    const q2 = tokyo.quarters.find((q) => q.quarter === 2)!;

    expect(getLocalTransactionDate(tx as any, 'Asia/Tokyo')?.ymd).toBe('2024-04-01');
    expect(q1.gross_income).toBe(0);
    expect(q2.gross_income).toBe(100);
  });

  it('quarter boundary flips across timezones (Phoenix: same UTC time stays in Q1)', () => {
    const tx = {
      id: 't1',
      trans_id: 't1',
      account_id: 'a1',
      amount: -100,
      category: 'revenue',
      datetime: '2024-03-31T16:30:00.000Z',
      pending: false,
      is_deductible: null,
    };

    const phoenix = calendarSummary([tx], 2024, 'America/Phoenix', baseOptions);
    const q1 = phoenix.quarters.find((q) => q.quarter === 1)!;
    const q2 = phoenix.quarters.find((q) => q.quarter === 2)!;

    expect(getLocalTransactionDate(tx as any, 'America/Phoenix')?.ymd).toBe('2024-03-31');
    expect(q1.gross_income).toBe(100);
    expect(q2.gross_income).toBe(0);
  });

  it('year boundary uses user-local year (Tokyo: 2023-12-31Z becomes 2024-01-01 local)', () => {
    const tx = {
      id: 't2',
      trans_id: 't2',
      account_id: 'a1',
      amount: -50,
      category: 'revenue',
      datetime: '2023-12-31T23:30:00.000Z',
      pending: false,
      is_deductible: null,
    };

    const tokyo2024 = calendarSummary([tx], 2024, 'Asia/Tokyo', baseOptions);
    const tokyo2023 = calendarSummary([tx], 2023, 'Asia/Tokyo', baseOptions);

    const q1_2024 = tokyo2024.quarters.find((q) => q.quarter === 1)!;
    const total2023 = tokyo2023.quarters.reduce((s, q) => s + q.gross_income, 0);

    expect(getLocalTransactionDate(tx as any, 'Asia/Tokyo')?.ymd).toBe('2024-01-01');
    expect(q1_2024.gross_income).toBe(50);
    expect(total2023).toBe(0);
  });

  it('pending transactions are excluded from quarter totals', () => {
    const tx = {
      id: 'e1',
      trans_id: 'e1',
      account_id: 'a1',
      amount: 123.45,
      category: 'TRANSPORTATION_FUEL',
      date: '2024-05-10',
      pending: true,
      is_deductible: true,
    };

    const res = calendarSummary([tx], 2024, 'America/Phoenix', baseOptions);
    const q2 = res.quarters.find((q) => q.quarter === 2)!; // May is Q2
    expect(q2.confirmed_deductible_expenses).toBe(0);
    expect(q2.potential_deductions_needing_review).toBe(0);
  });

  it('duplicate transactions dedupe by (account_id, trans_id)', () => {
    const a = {
      id: 'dup',
      trans_id: 'dup',
      account_id: 'acc',
      amount: -100,
      category: 'revenue',
      datetime: '2024-04-10T10:00:00.000Z',
      pending: false,
      is_deductible: null,
    };

    const b = { ...a, id: 'dup-2' };

    const res = calendarSummary([a, b], 2024, 'America/Phoenix', baseOptions);
    const q2 = res.quarters.find((q) => q.quarter === 2)!;
    expect(q2.gross_income).toBe(100);
  });

  it('null deductible is excluded from confirmed totals but included in needs-review bucket', () => {
    const confirmed = {
      id: 'c1',
      trans_id: 'c1',
      account_id: 'a1',
      amount: 10.01, // 1001 cents -> half meal -> 501 cents => 5.01
      category: 'FOOD_AND_DRINK_RESTAURANT',
      date: '2024-02-05',
      pending: false,
      is_deductible: true,
    };
    const potential = {
      id: 'p1',
      trans_id: 'p1',
      account_id: 'a1',
      amount: 10.01,
      category: 'FOOD_AND_DRINK_RESTAURANT',
      date: '2024-02-06',
      pending: false,
      is_deductible: null,
    };

    const res = calendarSummary([confirmed, potential], 2024, 'America/Phoenix', baseOptions);
    const q1 = res.quarters.find((q) => q.quarter === 1)!;

    expect(q1.confirmed_deductible_expenses).toBeCloseTo(5.01, 2);
    expect(q1.potential_deductions_needing_review).toBeCloseTo(5.01, 2);
    expect(q1.gross_income).toBe(0);
    expect(q1.net_profit).toBeCloseTo(-5.01, 2);
  });

  it('cents math for meal 50% rounding works with odd cents and credits', () => {
    const mealExpense = {
      id: 'm1',
      trans_id: 'm1',
      account_id: 'a1',
      amount: 10.01, // 5.01
      category: 'FOOD_AND_DRINK_RESTAURANT',
      date: '2024-06-15',
      pending: false,
      is_deductible: true,
    };
    const mealCredit = {
      id: 'm2',
      trans_id: 'm2',
      account_id: 'a1',
      amount: -10.01, // -5.01
      category: 'FOOD_AND_DRINK_RESTAURANT',
      date: '2024-06-16',
      pending: false,
      is_deductible: true,
    };

    const res = calendarSummary([mealExpense, mealCredit], 2024, 'America/Phoenix', baseOptions);
    const q2 = res.quarters.find((q) => q.quarter === 2)!;

    // Net should be exactly 0.00.
    expect(q2.confirmed_deductible_expenses).toBeCloseTo(0, 2);
    expect(q2.net_profit).toBeCloseTo(0, 2);
  });
});


it('legacy quarterly projection requires reviewed full-year and timing facts', () => {
  expect(() => aggregateQuarterlyEstimatesForYear([], 2026, 'UTC', baseOptions)).toThrow('Review your full-year');
});
