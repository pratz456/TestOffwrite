import { describe, expect, it } from 'vitest';
import { aggregateQuarterlyEstimatesForYear, getLocalTransactionDate, sumIncomeForQuarter, sumExpensesForQuarter, sumPotentialExpensesForQuarter, type QuarterlyTransactionLike } from '@/lib/tax-provider/quarterly-estimates';

const baseOptions = { filingStatus: 'single' as const, w2Income: 0, otherIncome: 0 };
function calendarSummary(transactions: QuarterlyTransactionLike[], year: number, timezone: string, _options: unknown) {
  return { quarters: ([1, 2, 3, 4] as const).map(quarter => {
    const gross = sumIncomeForQuarter(transactions, year, quarter, timezone).grossIncome;
    const expense = sumExpensesForQuarter(transactions, year, quarter, timezone).confirmed_deductible_expenses;
    return { quarter, gross_income: gross, confirmed_deductible_expenses: expense,
      potential_deductions_needing_review: sumPotentialExpensesForQuarter(transactions, year, quarter, timezone).potential_deductions_needing_review,
      net_profit: gross - expense };
  }) };
}

function quarterIncome(summary: { quarters: { quarter: number; gross_income: number }[] }, quarter: 1 | 2 | 3 | 4) {
  const found = summary.quarters.find((item) => item.quarter === quarter);
  expect(found).toEqual(expect.objectContaining({ quarter }));
  if (!found) throw new Error(`missing quarter ${quarter}`);
  return found.gross_income;
}

describe('Quarterly estimated tax helpers', () => {
  it('leaves a datetime-only row undated in both zones and keeps the amount', () => {
    const rows = [
      {
        id: 'spring',
        trans_id: 'spring',
        account_id: 'a1',
        amount: -100,
        category: 'revenue',
        datetime: '2024-03-31T16:30:00.000Z',
        pending: false,
        is_deductible: null,
      },
      {
        id: 'new-year',
        trans_id: 'new-year',
        account_id: 'a1',
        amount: -50,
        category: 'revenue',
        datetime: '2023-12-31T23:30:00.000Z',
        pending: false,
        is_deductible: null,
      },
    ];
    for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
      for (const tx of rows) expect(getLocalTransactionDate(tx, zone)).toBeNull();
      for (const year of [2023, 2024]) {
        const summary = calendarSummary(rows, year, zone, baseOptions);
        expect(summary.quarters.reduce((sum, item) => sum + item.gross_income, 0)).toBe(0);
      }
    }
    expect(rows.map((tx) => tx.amount)).toEqual([-100, -50]);
    expect(rows.map((tx) => tx.datetime)).toEqual(['2024-03-31T16:30:00.000Z', '2023-12-31T23:30:00.000Z']);
  });

  it('keeps the written day when date and datetime disagree across midnight', () => {
    const tx = {
      id: 'midnight',
      trans_id: 'midnight',
      account_id: 'a1',
      amount: -40,
      category: 'revenue',
      date: '2025-06-15',
      datetime: '2025-06-16T06:30:00.000Z',
      pending: false,
      is_deductible: null,
    };
    for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
      expect(getLocalTransactionDate(tx, zone)).toEqual({ year: 2025, month: 6, day: 15, ymd: '2025-06-15' });
      const summary = calendarSummary([tx], 2025, zone, baseOptions);
      expect(quarterIncome(summary, 2)).toBe(40);
      expect(summary.quarters.reduce((sum, item) => sum + item.gross_income, 0)).toBe(40);
    }
    expect(tx.amount).toBe(-40);
    expect(tx.datetime).toBe('2025-06-16T06:30:00.000Z');
  });

  it('keeps the written year when date and datetime disagree across New Year', () => {
    const dec31 = {
      id: 'dec31',
      trans_id: 'dec31',
      account_id: 'a1',
      amount: -80,
      category: 'revenue',
      date: '2024-12-31',
      datetime: '2025-01-01T07:30:00.000Z',
      pending: false,
      is_deductible: null,
    };
    const jan1 = {
      id: 'jan1',
      trans_id: 'jan1',
      account_id: 'a1',
      amount: -25,
      category: 'revenue',
      date: '2025-01-01',
      datetime: '2024-12-31T15:30:00.000Z',
      pending: false,
      is_deductible: null,
    };
    for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
      expect(getLocalTransactionDate(dec31, zone)).toEqual({ year: 2024, month: 12, day: 31, ymd: '2024-12-31' });
      expect(getLocalTransactionDate(jan1, zone)).toEqual({ year: 2025, month: 1, day: 1, ymd: '2025-01-01' });
      const year2024 = calendarSummary([dec31, jan1], 2024, zone, baseOptions);
      const year2025 = calendarSummary([dec31, jan1], 2025, zone, baseOptions);
      expect(quarterIncome(year2024, 4)).toBe(80);
      expect(year2024.quarters.reduce((sum, item) => sum + item.gross_income, 0)).toBe(80);
      expect(quarterIncome(year2025, 1)).toBe(25);
      expect(year2025.quarters.reduce((sum, item) => sum + item.gross_income, 0)).toBe(25);
    }
    expect(dec31.amount).toBe(-80);
    expect(jan1.amount).toBe(-25);
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
      date: '2024-04-10',
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
