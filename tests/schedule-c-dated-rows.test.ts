import { afterEach, describe, expect, it, vi } from 'vitest';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { scheduleCExportLine } from '@/lib/schedule-c/export-lines';
import * as taxDate from '@/lib/schedule-c/taxDate';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { convertTransactionsToCSV, exportDate, selectExportYear } from '@/lib/reports/transaction-export';
import * as transactionServer from '@/lib/firebase/transactions-server';
import * as reviewApi from '@/lib/transactions/review';

const { safeTaxYear, safeYMD } = taxDate;

function chargeSource(record: { date?: unknown; datetime?: unknown } | null | undefined): unknown {
  if (record == null || typeof record !== 'object') return undefined;
  return record.date !== undefined && record.date !== null ? record.date : record.datetime;
}

/** Return value of chargeDay, which matches safeYMD on the same source. */
function chargeDay(record: { date?: unknown; datetime?: unknown } | null | undefined) {
  const day = typeof taxDate.chargeDay === 'function' ? taxDate.chargeDay(record) : undefined;
  expect(day).toBe(safeYMD(chargeSource(record)));
  return day;
}

/** Return value of chargeYear, which matches safeTaxYear on the same source. */
function chargeYear(record: { date?: unknown; datetime?: unknown } | null | undefined) {
  const year = typeof taxDate.chargeYear === 'function' ? taxDate.chargeYear(record) : undefined;
  expect(year).toBe(safeTaxYear(chargeSource(record)));
  return year;
}

function normalizeDoc(doc: { id: string; data(): Record<string, any> }) {
  const read = transactionServer.normalizeDoc;
  if (typeof read !== 'function') return { date: undefined, created_at: undefined, updated_at: undefined };
  return read(doc);
}
function taxYearOf(record: { date?: unknown; datetime?: unknown; created_at?: unknown; updated_at?: unknown } | null | undefined) {
  const read = reviewApi.taxYearOf;
  return typeof read === 'function' ? read(record as never) : undefined;
}
function vehicleMethodForCharge(record: { date?: unknown; datetime?: unknown; created_at?: unknown } | null | undefined, saved: unknown) {
  const read = reviewApi.vehicleMethodForCharge;
  if (typeof read !== 'function') return { taxYear: undefined, method: undefined, needsMoreInformation: undefined };
  return read(record as never, saved);
}
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
    expect(year2024.needsMoreInformation).toBe(5);
    expect(year2025.needsMoreInformation).toBe(5);
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
    const saved = { created_at: '2025-06-15T18:00:00.000Z', updated_at: '2026-06-15T18:00:00.000Z' };
    expect(chargeDay(saved)).toBeNull();
    expect(chargeYear(saved)).toBeNull();
    const row = normalizeDoc(doc(saved));
    expect(row.date).toBe('');
    expect(row.created_at).toBe('2025-06-15T18:00:00.000Z');
    expect(chargeYear(row)).toBeNull();
    expect(summarizeConfirmedDeductions([confirmed(row)]).reviewMessage).toBe('Review missing or invalid transaction dates before showing confirmed deduction totals.');
    expect(() => buildMonthlySavings([confirmed(row)], 2025, 0.2, new Date('2026-09-23T12:00:00Z'))).toThrow(/Review missing or invalid transaction dates/);
    expect(() => buildMonthlySavings([confirmed(row)], 2026, 0.2, new Date('2026-09-23T12:00:00Z'))).toThrow(/Review missing or invalid transaction dates/);
  });

  it('keeps a December charge in 2024 when the row was saved in January', () => {
    const saved = { date: '2024-12-31', created_at: '2025-01-02T08:00:00.000Z', updated_at: '2025-01-02T08:00:00.000Z' };
    expect(chargeDay(saved)).toBe('2024-12-31');
    expect(chargeYear(saved)).toBe(2024);
    const row = normalizeDoc(doc(saved));
    expect(row.date).toBe('2024-12-31');
    const savings = buildMonthlySavings([confirmed(row)], 2024, 0.2, new Date('2026-09-23T12:00:00Z'));
    expect(savings.summary.deductionBasis).toBe(100);
    expect(savings.monthlyData[11].deductionBasis).toBe(100);
    expect(buildMonthlySavings([confirmed(row)], 2025, 0.2, new Date('2026-09-23T12:00:00Z')).summary.deductionBasis).toBe(0);
  });

  it('counts a datetime-only charge on that calendar day', () => {
    const saved = { datetime: '2024-12-31T15:00:00Z' };
    expect(chargeDay(saved)).toBe('2024-12-31');
    expect(chargeYear(saved)).toBe(2024);
    const row = normalizeDoc(doc(saved));
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
    expect(chargeDay({ created_at: '2099-06-15T12:00:00Z', updated_at: '2099-06-15T12:00:00Z' })).toBeNull();
    expect(chargeYear({ created_at: '2099-06-15T12:00:00Z', updated_at: '2099-06-15T12:00:00Z' })).toBeNull();
    expect(chargeDay({ datetime: '2024-12-31T15:00:00Z' })).toBe('2024-12-31');
    expect(chargeYear({ datetime: '2024-12-31T15:00:00Z' })).toBe(2024);
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

describe('offset timestamps keep the date written in the string', () => {
  it('lands 2024-12-31T20:00:00-08:00 in tax year 2024 and prints 27a (Other expenses)', () => {
    const row = confirmed({ id: 'offset', date: '2024-12-31T20:00:00-08:00', category: 'SERVICE_MEMBERSHIPS', amount: 80 });
    expect(chargeDay(row)).toBe('2024-12-31');
    expect(chargeYear(row)).toBe(2024);
    const year2024 = aggregateScheduleC([row], '2024', CATEGORY_MAP, { mode: 'confirmed-only' });
    const year2025 = aggregateScheduleC([row], '2025', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(year2024.totalDeductible).toBe(80);
    expect(year2024.needsMoreInformation).toBe(0);
    expect(year2025.totalDeductible).toBe(0);
    expect(year2025.counts.year).toBe(0);
    const line = year2024.lineItems['27a'];
    expect(line).toMatchObject({ lineCode: '27a', lineName: 'Other expenses', transactionCount: 1 });
    expect(`${scheduleCExportLine(line.lineCode, chargeYear(row)!)} (${line.lineName})`).toBe('27a (Other expenses)');
    const csv = generateScheduleCCSV(year2024.lineItemsArray, 2024);
    expect(csv).toContain('27a');
    expect(csv).not.toContain('27b');
    expect(selectExportYear([row], 2024)).toHaveLength(1);
    expect(selectExportYear([row], 2025)).toHaveLength(0);
  });
});

describe('a space and a time, a trailing Z, or an English month keeps the written day', () => {
  it.each([
    '2025-01-05 10:00:00',
    '2025-01-05 10:00',
    '2025-01-05Z',
    'Jan 5, 2025',
    'January 5, 2025',
    'jan 5 2025',
    'JANUARY 5, 2025',
    '5 January 2025',
    'Sun Jan 05 2025',
    'Sept 5, 2025',
    'Sept. 5, 2025',
    'Jan 5, 2025 10:00 AM',
    'January 5 2025 10:00',
    ' 2025-01-05',
    '2025-01-05 ',
    '2025/01/05',
  ])('counts %s on the written day in the 2025 total', (date) => {
    const row = confirmed({ id: 'written-day', date, amount: 55 });
    const written = date.includes('Sept') ? '2025-09-05' : '2025-01-05';
    expect(chargeDay(row)).toBe(written);
    expect(chargeYear(row)).toBe(2025);
    const year2025 = aggregateScheduleC([row], '2025', CATEGORY_MAP, { mode: 'confirmed-only' });
    const year2024 = aggregateScheduleC([row], '2024', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(year2025.totalDeductible).toBe(55);
    expect(year2025.needsMoreInformation).toBe(0);
    expect(year2025.undated).toEqual([]);
    expect(year2024.totalDeductible).toBe(0);
    expect(year2024.counts.year).toBe(0);
  });
});

describe('chargeDay and chargeYear match safeYMD and safeTaxYear', () => {
  const timestamp = (iso: string) => ({ toDate: () => new Date(iso) });

  it.each([
    ['a date string', '2025-01-05', '2025-01-05', 2025],
    ['a written month string', 'Jan 5, 2025', '2025-01-05', 2025],
    ['an offset timestamp string', '2024-12-31T20:00:00-08:00', '2024-12-31', 2024],
    ['a Date', new Date('2025-06-15T00:00:00.000Z'), '2025-06-15', 2025],
    ['a Firestore Timestamp', timestamp('2025-03-02T15:00:00.000Z'), '2025-03-02', 2025],
  ])('reads %s', (_label, value, day, year) => {
    expect(chargeDay({ date: value })).toBe(day);
    expect(chargeYear({ date: value })).toBe(year);
    expect(chargeDay({ date: value })).toBe(safeYMD(value));
    expect(chargeYear({ date: value })).toBe(safeTaxYear(value));
    expect(chargeDay({ datetime: value })).toBe(safeYMD(value));
    expect(chargeYear({ datetime: value })).toBe(safeTaxYear(value));
  });

  it.each(['31/2/2025', '2/30/2025', '29/2/2025', '13/45/2025', '0/12/2025'])('%s comes back null', (value) => {
    expect(chargeDay({ date: value })).toBeNull();
    expect(chargeYear({ date: value })).toBeNull();
    expect(safeYMD(value)).toBeNull();
    expect(safeTaxYear(value)).toBeNull();
    expect(chargeDay({ date: value })).toBe(safeYMD(value));
    expect(chargeYear({ date: value })).toBe(safeTaxYear(value));
  });

  it.each(['29/2/2024', '2/29/2024'])('%s is 2024-02-29', (value) => {
    expect(chargeDay({ date: value })).toBe('2024-02-29');
    expect(chargeYear({ date: value })).toBe(2024);
    expect(safeYMD(value)).toBe('2024-02-29');
    expect(safeTaxYear(value)).toBe(2024);
    expect(chargeDay({ date: value })).toBe(safeYMD(value));
    expect(chargeYear({ date: value })).toBe(safeTaxYear(value));
  });
});
