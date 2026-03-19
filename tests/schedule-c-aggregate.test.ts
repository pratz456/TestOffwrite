import { describe, expect, it } from 'vitest';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { safeTaxYear } from '@/lib/schedule-c/taxDate';

type Tx = {
  amount: number;
  date: string;
  category: string;
  is_deductible: boolean | null;
  pending?: boolean | null;
};

const cents = (n: number) => Math.round(n * 100);

describe('Schedule C aggregation (confirmed-only)', () => {
  it('timezone-safe year filtering: 2024-01-01 stays in 2024', () => {
    // This is the core behavior we need: year grouping must not shift
    // due to local timezone interpreting YYYY-MM-DD at UTC midnight.
    expect(safeTaxYear('2024-01-01')).toBe(2024);
    expect(safeTaxYear('2023-12-31')).toBe(2023);

    const res2024 = aggregateScheduleC(
      [
        {
          amount: 10,
          date: '2024-01-01',
          category: 'TRANSPORTATION_FUEL',
          is_deductible: true,
        },
      ],
      '2024',
      CATEGORY_MAP,
      { mode: 'confirmed-only' }
    );
    expect(res2024.counts.year).toBe(1);
    expect(res2024.counts.deductible).toBe(1);

    const res2023 = aggregateScheduleC(
      [
        {
          amount: 10,
          date: '2024-01-01',
          category: 'TRANSPORTATION_FUEL',
          is_deductible: true,
        },
      ],
      '2023',
      CATEGORY_MAP,
      { mode: 'confirmed-only' }
    );
    expect(res2023.counts.year).toBe(0);
    expect(res2023.counts.deductible).toBe(0);
  });

  it('confirmed-only excludes is_deductible=null and nets confirmed credits/refunds', () => {
    const txs: Tx[] = [
      // confirmed expense
      {
        amount: 100,
        date: '2024-05-01',
        category: 'TRANSPORTATION_FUEL',
        is_deductible: true,
      },
      // potentially deductible (must be excluded in confirmed-only)
      {
        amount: 50,
        date: '2024-05-02',
        category: 'TRANSPORTATION_FUEL',
        is_deductible: null,
      },
      // confirmed credit/refund: negative amount must offset totals
      {
        amount: -20,
        date: '2024-05-03',
        category: 'TRANSPORTATION_FUEL',
        is_deductible: true,
      },
    ];

    const res = aggregateScheduleC(txs, '2024', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(cents(res.totalDeductible)).toBe(8000); // 100 - 20 = 80.00
    expect(res.counts.deductible).toBe(2);

    const line9 = res.lineItemsArray.find((li) => li.lineCode === '9');
    expect(line9).toBeTruthy();
    expect(cents(line9!.deductible)).toBe(8000);
    expect(line9!.transactionCount).toBe(2);
  });

  it('meals 50% rounding is deterministic on odd cents (half away from zero)', () => {
    const res = aggregateScheduleC(
      [
        {
          amount: 10.01, // 1001 cents -> half = 501 cents => 5.01
          date: '2024-06-01',
          category: 'FOOD_AND_DRINK_RESTAURANT',
          is_deductible: true,
        },
      ],
      '2024',
      CATEGORY_MAP,
      { mode: 'confirmed-only' }
    );

    const mealLine = res.lineItemsArray.find((li) => li.lineCode === '24b');
    expect(mealLine).toBeTruthy();
    expect(cents(mealLine!.deductible)).toBe(501);
    expect(mealLine!.deductible).toBeCloseTo(5.01, 2);

    const resCredit = aggregateScheduleC(
      [
        {
          amount: -10.01, // -1001 cents -> half = -501 cents => -5.01
          date: '2024-06-02',
          category: 'FOOD_AND_DRINK_RESTAURANT',
          is_deductible: true,
        },
      ],
      '2024',
      CATEGORY_MAP,
      { mode: 'confirmed-only' }
    );
    const mealCreditLine = resCredit.lineItemsArray.find((li) => li.lineCode === '24b');
    expect(mealCreditLine).toBeTruthy();
    expect(cents(mealCreditLine!.deductible)).toBe(-501);
    expect(mealCreditLine!.deductible).toBeCloseTo(-5.01, 2);
  });

  it('net reconciliation: sum(line deductible by line) == totalDeductible', () => {
    const res = aggregateScheduleC(
      [
        // car/truck: 100 - 20 = 80
        { amount: 100, date: '2024-05-01', category: 'TRANSPORTATION_FUEL', is_deductible: true },
        { amount: -20, date: '2024-05-03', category: 'TRANSPORTATION_FUEL', is_deductible: true },

        // meals: 10.01 -> 5.01
        { amount: 10.01, date: '2024-06-01', category: 'FOOD_AND_DRINK_RESTAURANT', is_deductible: true },

        // excluded potential item
        { amount: 999, date: '2024-06-02', category: 'FOOD_AND_DRINK_RESTAURANT', is_deductible: null },
      ],
      '2024',
      CATEGORY_MAP,
      { mode: 'confirmed-only' }
    );

    const perLineCents = res.lineItemsArray.reduce((sum, li) => sum + cents(li.deductible), 0);
    expect(perLineCents).toBe(cents(res.totalDeductible));

    // Exact expected: 80.00 + 5.01 = 85.01
    expect(perLineCents).toBe(8501);
  });
});

