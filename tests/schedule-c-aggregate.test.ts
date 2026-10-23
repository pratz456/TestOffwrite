import { describe, expect, it } from 'vitest';
import { ACTUAL_EXPENSE_BUSINESS_SHARE } from '@/lib/ai/actual-expense-share';
import { SEPARATE_VEHICLE_COST_SHARE } from '@/lib/ai/vehicle-separate-costs';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { scheduleCExportLine } from '@/lib/schedule-c/export-lines';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
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
        category: 'SERVICE_ADVERTISING',
        merchant_name: 'Print shop',
        is_deductible: true,
      },
      // potentially deductible (must be excluded in confirmed-only)
      {
        amount: 50,
        date: '2024-05-02',
        category: 'SERVICE_ADVERTISING',
        is_deductible: null,
      },
      // tied refund: same merchant, smaller amount, within 90 days, same year
      {
        amount: -20,
        date: '2024-05-03',
        category: 'SERVICE_ADVERTISING',
        merchant_name: 'Print shop',
        is_deductible: true,
      },
    ];

    const res = aggregateScheduleC(txs, '2024', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(cents(res.totalDeductible)).toBe(8000); // 100 - 20 = 80.00
    expect(res.counts.deductible).toBe(2);

    const line8 = res.lineItemsArray.find((li) => li.lineCode === '8');
    expect(line8).toBeTruthy();
    expect(cents(line8!.deductible)).toBe(8000);
    expect(line8!.transactionCount).toBe(1);
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
          amount: -10.01,
          date: '2024-06-02',
          category: 'FOOD_AND_DRINK_RESTAURANT',
          merchant_name: 'Cafe',
          is_deductible: true,
        },
      ],
      '2024',
      CATEGORY_MAP,
      { mode: 'confirmed-only' }
    );
    expect(resCredit.lineItems['24b']).toBeUndefined();
    expect(resCredit.totalDeductible).toBe(0);
    expect(resCredit.possibleRefunds).toHaveLength(1);
  });

  it('net reconciliation: sum(line deductible by line) == totalDeductible', () => {
    const res = aggregateScheduleC(
      [
        // car/truck: 100 - 20 = 80
        { amount: 100, date: '2024-05-01', category: 'SERVICE_ADVERTISING', merchant_name: 'Print shop', is_deductible: true },
        { amount: -20, date: '2024-05-03', category: 'SERVICE_ADVERTISING', merchant_name: 'Print shop', is_deductible: true },

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
    amount: 100, date: '2026-03-01', category: 'SERVICE_ADVERTISING', is_deductible: true, ...extra,
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

describe('vehicle costs count only a business use percent from 0 through 100', () => {
  const categories = [
    ['VEHICLE_ACTUAL_EXPENSE', '9', 100, ACTUAL_EXPENSE_BUSINESS_SHARE.reason],
    ['VEHICLE_LOAN_INTEREST', '16b', 200, SEPARATE_VEHICLE_COST_SHARE.reason],
    ['VEHICLE_PROPERTY_TAX', '23', 90, SEPARATE_VEHICLE_COST_SHARE.reason],
  ] as const;
  const shares = [
    ['missing', 'omit', 0, true],
    ['NaN', 'nan', 0, true],
    ['75 string', 'string', 0, true],
    ['0', 'zero', 0, false],
    ['40', 'partial', 0.4, false],
    ['100', 'full', 1, false],
    ['150', 'high', 0, true],
    ['-5', 'negative', 0, true],
  ] as const;

  function vehicle(category: string, amount: number, share: 'omit' | 'nan' | 'string' | 'zero' | 'partial' | 'full' | 'high' | 'negative'): Tx {
    const row: Tx = {
      amount,
      date: '2026-09-15',
      category,
      is_deductible: true,
      review_status: 'confirmed',
      tax_review_required: false,
      deductionStatus: 'Likely Deductible',
      reasoning: 'Saved reason',
    };
    if (share === 'nan') row.business_use_percentage = Number.NaN;
    if (share === 'string') row.business_use_percentage = '75';
    if (share === 'zero') row.business_use_percentage = 0;
    if (share === 'partial') row.business_use_percentage = 40;
    if (share === 'full') row.business_use_percentage = 100;
    if (share === 'high') row.business_use_percentage = 150;
    if (share === 'negative') row.business_use_percentage = -5;
    return row;
  }

  it.each(categories.flatMap(([category, line, amount, reason]) =>
    shares.flatMap(([label, share, fraction, needsInfo]) =>
      (['confirmed-only', 'default'] as const).map(mode => [category, label, mode, line, amount, reason, share, fraction, needsInfo] as const),
    ),
  ))('%s with a %s business use percent in %s mode', (category, _label, mode, line, amount, reason, share, fraction, needsInfo) => {
    const tx = vehicle(category, amount, share);
    const res = aggregateScheduleC([tx], '2026', CATEGORY_MAP, { mode });
    const item = res.lineItems[line];
    expect(item).toBeTruthy();
    expect(cents(item.total)).toBe(cents(amount));
    expect(cents(item.deductible)).toBe(cents(amount * fraction));
    expect(cents(res.totalDeductible)).toBe(cents(amount * fraction));
    expect(item.transactions).toHaveLength(1);
    const stored = item.transactions[0];
    if (needsInfo) {
      expect(stored).not.toBe(tx);
      expect(stored.deductionStatus).toBe('Needs more information');
      expect(stored.reasoning).toBe(reason);
      expect(res.needsMoreInformation).toEqual([]);
      expect(tx.deductionStatus).toBe('Likely Deductible');
      expect(tx.reasoning).toBe('Saved reason');
    } else {
      expect(stored).toBe(tx);
      expect(stored.deductionStatus).toBe('Likely Deductible');
      expect(stored.reasoning).toBe('Saved reason');
    }
  });
});

describe('Other expenses year print and energy labels', () => {
  const confirmed = (fields: Record<string, unknown>) => ({
    amount: 80,
    is_deductible: true,
    review_status: 'confirmed',
    tax_review_required: false,
    merchant_name: 'Synthetic payee',
    ...fields,
  });

  it('puts eight confirmed energy rows in the review bucket and in no total', () => {
    const rows = [
      confirmed({ id: 'dues-179d-2024', date: '2024-06-15', category: 'SERVICE_PROFESSIONAL_DUES', schedule_c_line: '27a (179D)' }),
      confirmed({ id: 'dues-179d-2025', date: '2025-06-15', category: 'SERVICE_PROFESSIONAL_DUES', schedule_c_line: '27a (179D)' }),
      confirmed({ id: 'dues-7205-2024', date: '2024-07-15', category: 'SERVICE_PROFESSIONAL_DUES', schedule_c_line: 'Line 27a (Form 7205)' }),
      confirmed({ id: 'dues-7205-2025', date: '2025-07-15', category: 'SERVICE_PROFESSIONAL_DUES', schedule_c_line: 'Line 27a (Form 7205)' }),
      confirmed({ id: 'dues-energy-2024', date: '2024-08-15', category: 'SERVICE_PROFESSIONAL_DUES', schedule_c_line: '27a (Energy efficient commercial buildings)' }),
      confirmed({ id: 'dues-energy-2025', date: '2025-08-15', category: 'SERVICE_PROFESSIONAL_DUES', schedule_c_line: '27a (Energy efficient commercial buildings)' }),
      confirmed({ id: 'unmapped-179d-2024', date: '2024-09-15', category: 'SYNTHETIC_UNMAPPED', schedule_c_line: '27a (179D)' }),
      confirmed({ id: 'unmapped-energy-2025', date: '2025-09-15', category: 'SYNTHETIC_UNMAPPED', schedule_c_line: '27a (Energy efficient commercial buildings)' }),
    ];
    expect(rows).toHaveLength(8);
    for (const year of ['2024', '2025']) {
      const expected = rows.filter(row => String(row.date).startsWith(year));
      for (const mode of ['confirmed-only', 'default'] as const) {
        const totals = aggregateScheduleC(expected, year, CATEGORY_MAP, { mode });
        expect(totals.lineItems.review).toBeUndefined();
        expect(Object.values(totals.lineItems).some(item => item.lineName === 'Needs more information' || item.lineCode === 'review')).toBe(false);
        expect(totals.needsMoreInformation).toHaveLength(expected.length);
        expect(totals.needsMoreInformation.map(tx => tx.id).sort()).toEqual(expected.map(tx => tx.id).sort());
        expect(totals.needsMoreInformation.every(tx => tx.deductionStatus === 'Needs more information')).toBe(true);
        expect(totals.totalDeductible).toBe(0);
        expect(totals.totalExpenses).toBe(0);
        expect(totals.lineItems['27a']).toBeUndefined();
        expect(totals.lineItems['27b']).toBeUndefined();
      }
    }
  });

  it('keeps a label-free dues row on summary line 27a and prints 27b for 2025 and 27a for 2024', () => {
    for (const [year, printed] of [[2024, '27a'], [2025, '27b']] as const) {
      const row = confirmed({ id: `dues-${year}`, date: `${year}-06-15`, category: 'SERVICE_PROFESSIONAL_DUES', amount: 120 });
      const totals = aggregateScheduleC([row], String(year), CATEGORY_MAP, { mode: 'confirmed-only' });
      const summary = totals.lineItems['27a'];
      expect(summary?.lineCode).toBe('27a');
      expect(totals.lineItems['27b']).toBeUndefined();
      expect(totals.totalDeductible).toBe(120);
      expect(scheduleCExportLine(summary.lineCode, year)).toBe(printed);
      const csv = generateScheduleCCSV([summary], year);
      const cells = csv.split('\r\n')[1].split(',');
      expect(cells[3]).toBe(`${printed} (Other expenses)`);
    }
  });
});

