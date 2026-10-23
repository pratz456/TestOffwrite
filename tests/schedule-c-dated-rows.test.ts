import { afterEach, describe, expect, it, vi } from 'vitest';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { chargeDay, chargeYear, safeTaxYear } from '@/lib/schedule-c/taxDate';
import { convertTransactionsToCSV, exportDate, selectExportYear } from '@/lib/reports/transaction-export';
import { normalizeDoc } from '@/lib/firebase/transactions-server';
import { taxYearOf, vehicleMethodForCharge } from '@/lib/transactions/review';
import { buildMonthlySavings } from '@/lib/tax/savings-summary';
import { summarizeConfirmedDeductions } from '@/lib/tax/display-deductions';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: { doc: () => ({}) } }));

const confirmed = (facts: Record<string, unknown> = {}) => ({
  id: 'row', amount: 100, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', iso_currency_code: 'USD',
  is_deductible: true, review_status: 'confirmed', ...facts,
});

describe('charge day shared by Schedule C totals and the export', () => {
  const rows = [
    confirmed({ id: 'date-only', date: '2024-06-01' }),
    confirmed({ id: 'datetime-only', date: undefined, datetime: '2024-12-31T15:00:00Z' }),
    confirmed({ id: 'date-object', date: new Date(Date.UTC(2025, 5, 15)) }),
    confirmed({ id: 'timestamp', date: { toDate: () => new Date('2025-03-02T15:00:00Z') } }),
    confirmed({ id: 'empty-date', date: '', datetime: '2024-07-04T12:00:00Z' }),
    confirmed({ id: 'impossible-month', date: '2025-13-40', datetime: '2024-01-15T12:00:00Z' }),
    confirmed({ id: 'impossible-day', date: '2025-02-30' }),
    confirmed({ id: 'junk', date: 'not-a-date', datetime: '2024-08-01T12:00:00Z' }),
    confirmed({ id: 'missing' }),
  ];

  it('counts a real charge day in that year and lists every other row as undated', () => {
    const year2024 = aggregateScheduleC(rows, '2024', CATEGORY_MAP, { mode: 'confirmed-only' });
    const year2025 = aggregateScheduleC(rows, '2025', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(year2024.totalDeductible).toBe(200);
    expect(year2024.lineItemsArray.flatMap(item => item.transactions).map(row => row.id).sort()).toEqual(['date-only', 'datetime-only']);
    expect(year2025.totalDeductible).toBe(200);
    expect(year2025.lineItemsArray.flatMap(item => item.transactions).map(row => row.id).sort()).toEqual(['date-object', 'timestamp']);
    expect(year2024.undated.map(row => row.id).sort()).toEqual(['empty-date', 'impossible-day', 'impossible-month', 'junk', 'missing']);
    expect(chargeDay({ datetime: '2024-12-31T15:00:00Z' })).toBe('2024-12-31');
    expect(safeTaxYear('2025-13-40')).toBeNull();
    expect(safeTaxYear('2025-02-30')).toBeNull();
  });

  it('uses the same charge day for the export tax date as for the year total', () => {
    const dated = rows.filter(row => chargeYear(row) !== null);
    const undated = rows.filter(row => chargeYear(row) === null);
    let exported2024: ReturnType<typeof selectExportYear> = [];
    expect(() => { exported2024 = selectExportYear(dated, 2024); }).not.toThrow();
    expect(exported2024.map(row => row.id).sort()).toEqual(['date-only', 'datetime-only']);
    expect(selectExportYear(dated, 2025).map(row => row.id).sort()).toEqual(['date-object', 'timestamp']);
    for (const row of dated) {
      const day = chargeDay(row);
      expect(exportDate(row.date ?? row.datetime)).toBe(day);
      expect(convertTransactionsToCSV([row])).toContain(`,${day},`);
      const counted = aggregateScheduleC([row], String(chargeYear(row)), CATEGORY_MAP, { mode: 'confirmed-only' });
      expect(counted.totalDeductible).toBe(100);
      expect(counted.undated).toEqual([]);
    }
    for (const row of undated) {
      expect(chargeDay(row)).toBeNull();
      expect(convertTransactionsToCSV([row]).split('\r\n')[1].split(',')[2]).toBe('');
      expect(aggregateScheduleC([row], '2024', CATEGORY_MAP).totalDeductible).toBe(0);
      expect(aggregateScheduleC([row], '2025', CATEGORY_MAP).totalDeductible).toBe(0);
    }
    expect(() => selectExportYear(rows, 2024)).toThrow(/missing or invalid dates/);
  });
});

describe('normalizeDoc charge day', () => {
  const doc = (data: Record<string, unknown>) => ({ id: 'saved', data: () => ({
    trans_id: 'saved', amount: 100, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', iso_currency_code: 'USD',
    is_deductible: true, review_status: 'confirmed', ...data,
  }) });

  it('leaves a save timestamp out of the charge date', () => {
    const row = normalizeDoc(doc({
      created_at: '2025-06-15T18:00:00.000Z', updated_at: '2026-06-15T18:00:00.000Z',
    }));
    expect(row.date).toBe('');
    expect(row.created_at).toBe('2025-06-15T18:00:00.000Z');
    expect(chargeYear(row)).toBeNull();
    expect(summarizeConfirmedDeductions([confirmed(row)]).reviewMessage).toBe('Review missing or invalid transaction dates before showing confirmed deduction totals.');
    expect(() => buildMonthlySavings([confirmed(row)], 2025, 0.2, new Date('2026-09-23T12:00:00Z'))).toThrow(/Review missing or invalid transaction dates/);
    expect(() => buildMonthlySavings([confirmed(row)], 2026, 0.2, new Date('2026-09-23T12:00:00Z'))).toThrow(/Review missing or invalid transaction dates/);
  });

  it('keeps a December charge in 2024 when the row was saved in January', () => {
    const row = normalizeDoc(doc({
      date: '2024-12-31', created_at: '2025-01-02T08:00:00.000Z', updated_at: '2025-01-02T08:00:00.000Z',
    }));
    expect(row.date).toBe('2024-12-31');
    const savings = buildMonthlySavings([confirmed(row)], 2024, 0.2, new Date('2026-09-23T12:00:00Z'));
    expect(savings.summary.deductionBasis).toBe(100);
    expect(savings.monthlyData[11].deductionBasis).toBe(100);
    expect(buildMonthlySavings([confirmed(row)], 2025, 0.2, new Date('2026-09-23T12:00:00Z')).summary.deductionBasis).toBe(0);
  });

  it('counts a datetime-only charge on that calendar day', () => {
    const row = normalizeDoc(doc({ datetime: '2024-12-31T15:00:00Z' }));
    expect(row.date).toBe('2024-12-31');
    expect(chargeYear(row)).toBe(2024);
  });
});

describe('vehicle method follows the charge year only', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('gives an undated row no year and no vehicle method while the clock reads 2099', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-06-15T12:00:00Z'));
    expect(new Date().getFullYear()).toBe(2099);
    expect(taxYearOf({ created_at: '2099-06-15T12:00:00Z', updated_at: '2099-06-15T12:00:00Z' })).toBeNull();
    expect(taxYearOf({})).toBeNull();
    expect(vehicleMethodForCharge({ created_at: '2026-06-15T12:00:00Z' }, 'standard_mileage')).toEqual({
      taxYear: null, method: null, needsMoreInformation: true,
    });
    expect(vehicleMethodForCharge({ date: '', datetime: '2024-12-31T15:00:00Z' }, 'actual_expense')).toEqual({
      taxYear: null, method: null, needsMoreInformation: true,
    });
    expect(vehicleMethodForCharge({ datetime: '2024-12-31T15:00:00Z' }, 'standard_mileage')).toEqual({
      taxYear: 2024, method: 'standard_mileage', needsMoreInformation: false,
    });
    expect(vehicleMethodForCharge({ date: '2024-06-01' }, 'not-a-method').method).toBeNull();
    expect(vehicleMethodForCharge({ date: '2024-06-01' }, 'not-a-method').needsMoreInformation).toBe(true);
  });
});
