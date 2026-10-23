import { describe, expect, it } from 'vitest';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
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

async function dateReview(rows: QuarterlyTransactionLike[], zone: string, year?: number) {
  const api = await import('@/lib/tax-provider/quarterly-estimates');
  return api.reviewEstimateDates(rows, zone, year);
}

function yearIncome(rows: QuarterlyTransactionLike[], year: number, zone: string) {
  const summary = calendarSummary(rows, year, zone, baseOptions);
  return summary.quarters.reduce((sum, item) => sum + item.gross_income, 0);
}

describe('Quarterly estimated tax helpers', () => {
  it('adds datetime-only income to the estimate year total and leaves the written day blank', async () => {
    const row: QuarterlyTransactionLike = {
      id: 'income-only',
      trans_id: 'income-only',
      account_id: 'a1',
      amount: -1000,
      category: 'income',
      datetime: '2024-07-15T12:00:00.000Z',
      pending: false,
      is_deductible: null,
    };
    for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
      expect(getLocalTransactionDate(row, zone)).toBeNull();
      expect(yearIncome([row], 2024, zone)).toBe(1000);
      expect(quarterIncome(calendarSummary([row], 2024, zone, baseOptions), 3)).toBe(1000);
      expect(yearIncome([row], 2023, zone)).toBe(0);
      expect(yearIncome([row], 2025, zone)).toBe(0);
      const review = await dateReview([row], zone);
      expect(review.incomeNeedsDateCount).toBe(1);
      expect(review.incomeNeedsDateAmount).toBe(1000);
      expect(review.expenseNeedsDateCount).toBe(0);
      expect(review.needsDateCopy).toContain('1 income rows need a date. Amount kept: $1,000.00.');
      expect(() => calendarSummary([row], 2024, zone, baseOptions)).not.toThrow();
    }
    expect(row.amount).toBe(-1000);
    expect(row.datetime).toBe('2024-07-15T12:00:00.000Z');
  });

  it('places epoch 1735716600 income in the 2024 estimate and in no Schedule C year', async () => {
    const row: QuarterlyTransactionLike = {
      id: 'boundary',
      trans_id: 'boundary',
      account_id: 'a1',
      amount: -75,
      category: 'income',
      datetime: 1735716600,
      pending: false,
      is_deductible: null,
    };
    for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
      expect(getLocalTransactionDate(row, zone)).toBeNull();
      expect(yearIncome([row], 2024, zone)).toBe(75);
      expect(quarterIncome(calendarSummary([row], 2024, zone, baseOptions), 4)).toBe(75);
      expect(yearIncome([row], 2025, zone)).toBe(0);
      const review = await dateReview([row], zone);
      expect(review.incomeNeedsDateCount).toBe(1);
      expect(review.incomeNeedsDateAmount).toBe(75);
      expect(review.needsDateCopy).toContain('flagged');
      for (const year of ['2024', '2025']) {
        const scheduleC = aggregateScheduleC([row], year, CATEGORY_MAP, { mode: 'confirmed-only' });
        expect(scheduleC.totalDeductible).toBe(0);
        expect(scheduleC.counts.year).toBe(0);
        expect(scheduleC.lineItemsArray).toEqual([]);
        expect(scheduleC.needsMoreInformation).toBe(1);
        expect(scheduleC.undated[0].amount).toBe(-75);
      }
    }
  });

  it('uses the 2024 estimate for epoch 1735727400 because UTC-12 is Dec 31 and US zones are Jan 1', async () => {
    // 1735727400 is 2025-01-01T10:30:00.000Z: 10:30 PM on Dec 31, 2024 at UTC-12.
    // The same instant is Jan 1, 2025 in Honolulu, Anchorage, Los Angeles, Denver, Chicago, and New York.
    const instant = new Date(1735727400 * 1000);
    expect(instant.toISOString()).toBe('2025-01-01T10:30:00.000Z');
    const utc12 = new Date(instant.getTime() - 12 * 60 * 60 * 1000);
    expect(utc12.toISOString().slice(0, 10)).toBe('2024-12-31');
    for (const offsetHours of [-10, -9, -8, -7, -6, -5]) {
      expect(new Date(instant.getTime() + offsetHours * 60 * 60 * 1000).toISOString().slice(0, 10)).toBe('2025-01-01');
    }
    const row: QuarterlyTransactionLike = {
      id: 'ten-thirty',
      trans_id: 'ten-thirty',
      account_id: 'a1',
      amount: -40,
      category: 'revenue',
      datetime: 1735727400,
      pending: false,
      is_deductible: null,
    };
    for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
      expect(getLocalTransactionDate(row, zone)).toBeNull();
      expect(yearIncome([row], 2024, zone)).toBe(40);
      expect(quarterIncome(calendarSummary([row], 2024, zone, baseOptions), 4)).toBe(40);
      expect(yearIncome([row], 2025, zone)).toBe(0);
      const scheduleC2024 = aggregateScheduleC([row], '2024', CATEGORY_MAP, { mode: 'confirmed-only' });
      expect(scheduleC2024.needsMoreInformation).toBe(1);
      expect(scheduleC2024.totalDeductible).toBe(0);
      expect(scheduleC2024.counts.year).toBe(0);
      expect((await dateReview([row], zone)).incomeNeedsDateCount).toBe(1);
    }
  });

  it('leaves an undated expense out of the estimate and Schedule C and counts it as needing a date', async () => {
    const row: QuarterlyTransactionLike = {
      id: 'expense',
      trans_id: 'expense',
      account_id: 'a1',
      amount: 42.5,
      category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES',
      datetime: '2024-06-15T18:00:00.000Z',
      pending: false,
      is_deductible: true,
    };
    for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
      expect(getLocalTransactionDate(row, zone)).toBeNull();
      const summary = calendarSummary([row], 2024, zone, baseOptions);
      expect(summary.quarters.reduce((sum, item) => sum + item.confirmed_deductible_expenses, 0)).toBe(0);
      expect(summary.quarters.reduce((sum, item) => sum + item.potential_deductions_needing_review, 0)).toBe(0);
      expect(yearIncome([row], 2024, zone)).toBe(0);
      const review = await dateReview([row], zone);
      expect(review.expenseNeedsDateCount).toBe(1);
      expect(review.expenseNeedsDateAmount).toBe(42.5);
      expect(review.incomeNeedsDateCount).toBe(0);
      expect(review.needsDateCopy).toContain('1 expense rows need a date. Amount kept: $42.50.');
      expect(await dateReview([row], zone)).toEqual(expect.objectContaining({ expenseNeedsDateCount: 1 }));
      for (const year of ['2024', '2025']) {
        const scheduleC = aggregateScheduleC([row], year, CATEGORY_MAP, { mode: 'confirmed-only' });
        expect(scheduleC.totalDeductible).toBe(0);
        expect(scheduleC.counts.year).toBe(0);
        expect(scheduleC.lineItemsArray).toEqual([]);
        expect(scheduleC.needsMoreInformation).toBe(1);
        expect(scheduleC.undated[0].amount).toBe(42.5);
      }
    }
  });

  it('places March 31 UTC income in the earliest quarter when UTC+14 is already April', () => {
    const row: QuarterlyTransactionLike = {
      id: 'spring',
      trans_id: 'spring',
      account_id: 'a1',
      amount: -100,
      category: 'revenue',
      datetime: '2024-03-31T16:30:00.000Z',
      pending: false,
      is_deductible: null,
    };
    for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
      expect(getLocalTransactionDate(row, zone)).toBeNull();
      expect(quarterIncome(calendarSummary([row], 2024, zone, baseOptions), 1)).toBe(100);
      expect(quarterIncome(calendarSummary([row], 2024, zone, baseOptions), 2)).toBe(0);
      expect(row.amount).toBe(-100);
    }
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
