import { describe, expect, it } from 'vitest';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { safeTaxYear } from '@/lib/schedule-c/taxDate';
import { isLegacyConfirmedRecord, isServerConfirmedDeduction, LEGACY_CONFIRMATION_CUTOFF, recordTimestampMs } from '@/lib/transactions/confirmed-deduction';
import { transactionNeedsTaxReview } from '@/lib/utils/transaction-tax-review';
import { dashboardRecordStatus } from '@/lib/dashboard/record-summary';

type Tx = {
  amount: number;
  date: string;
  category: string;
  is_deductible: boolean | null;
  pending?: boolean | null;
  [key: string]: unknown;
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

describe('confirmed-only trusts server-recorded decisions or documented legacy confirmations', () => {
  const cutoffMs = recordTimestampMs(LEGACY_CONFIRMATION_CUTOFF)!;
  const beforeCutoff = new Date(cutoffMs - 24 * 60 * 60 * 1000);
  const afterCutoff = new Date(cutoffMs + 60 * 1000);
  const confirmed = (extra: Record<string, unknown> = {}): Tx => ({
    amount: 100, date: '2026-03-01', category: 'TRANSPORTATION_FUEL', is_deductible: true, ...extra,
  });
  const total = (records: Tx[]) => aggregateScheduleC(records, '2026', CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible;

  it('documents the cutoff as an ISO instant the server-stamping release must not precede', () => {
    expect(LEGACY_CONFIRMATION_CUTOFF).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(cutoffMs).toBeGreaterThan(Date.parse('2026-09-17T00:00:00Z'));
  });

  it('counts a server-confirmed decision regardless of creation time', () => {
    const record = confirmed({ review_status: 'confirmed', review_source: 'user_decision', tax_review_required: false, created_at: afterCutoff });
    expect(isServerConfirmedDeduction(record)).toBe(true);
    expect(total([record])).toBe(100);
    expect(transactionNeedsTaxReview(record)).toBe(false);
    expect(dashboardRecordStatus(record)).toBe('deductible');
  });

  it.each([
    ['admin Timestamp', { toMillis: () => beforeCutoff.getTime(), toDate: () => beforeCutoff }],
    ['client Timestamp', { toDate: () => beforeCutoff }],
    ['serialized Timestamp', { _seconds: Math.floor(beforeCutoff.getTime() / 1000), _nanoseconds: 0 }],
    ['Date', beforeCutoff],
    ['ISO string', beforeCutoff.toISOString()],
  ])('keeps a legacy pre-cutoff confirmation with %s created_at and no review fields', (_label, created_at) => {
    const record = confirmed({ created_at });
    expect(isLegacyConfirmedRecord(record)).toBe(true);
    expect(total([record])).toBe(100);
    expect(transactionNeedsTaxReview(record)).toBe(false);
    expect(dashboardRecordStatus(record)).toBe('deductible');
  });

  it('falls back to the transaction date only when the server never recorded created_at', () => {
    expect(total([confirmed({ date: '2026-03-01' })])).toBe(100);
    expect(total([confirmed({ date: '2026-12-01' })])).toBe(0);
    expect(total([confirmed({ date: '2026-03-01', created_at: afterCutoff })])).toBe(0);
  });

  it('excludes an unstamped deduction flag on a record created after the cutoff and flags it for review', () => {
    const record = confirmed({ created_at: afterCutoff });
    expect(isServerConfirmedDeduction(record)).toBe(false);
    expect(total([record])).toBe(0);
    expect(transactionNeedsTaxReview(record)).toBe(true);
    expect(dashboardRecordStatus(record)).toBe('review');
  });

  it.each([
    { ai_suggestion: { id: 'suggestion', status: 'ok' } },
    { review_status: 'pending' },
    { review_status: 'rejected' },
    { review_source: 'ai_confirmed' },
    { reviewed_at: '2026-03-02T00:00:00.000Z' },
    { tax_review_required: true, review_status: 'confirmed' },
  ])('does not treat a pre-cutoff record with review pipeline fields %j as a legacy confirmation', fields => {
    const record = confirmed({ created_at: beforeCutoff, ...fields });
    expect(isLegacyConfirmedRecord(record)).toBe(false);
    expect(total([record])).toBe(0);
  });

  it('never counts false or unresolved decisions in either path', () => {
    expect(total([confirmed({ is_deductible: false, created_at: beforeCutoff })])).toBe(0);
    expect(total([confirmed({ is_deductible: null, created_at: beforeCutoff })])).toBe(0);
    expect(total([confirmed({ is_deductible: false, review_status: 'confirmed' })])).toBe(0);
  });
});

