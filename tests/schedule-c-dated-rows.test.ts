import { afterEach, describe, expect, it, vi } from 'vitest';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { scheduleCExportLine } from '@/lib/schedule-c/export-lines';
import { chargeDay, chargeYear, safeTaxYear, safeYMD } from '@/lib/schedule-c/taxDate';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { convertTransactionsToCSV, exportDate, selectExportYear } from '@/lib/reports/transaction-export';
import * as transactionServer from '@/lib/firebase/transactions-server';
import * as reviewApi from '@/lib/transactions/review';

function normalizeDoc(doc: { id: string; data(): Record<string, any> }) {
  return transactionServer.normalizeDoc(doc);
}
function taxYearOf(record: { date?: unknown; datetime?: unknown; created_at?: unknown; updated_at?: unknown } | null | undefined) {
  return reviewApi.taxYearOf(record);
}
function vehicleMethodForCharge(record: { date?: unknown; datetime?: unknown; created_at?: unknown } | null | undefined, saved: unknown) {
  return reviewApi.vehicleMethodForCharge(record, saved);
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
    expect(year2024.totalDeductible).toBe(100);
    expect(year2024.lineItemsArray.flatMap(item => item.transactions).map(row => row.id).sort()).toEqual(['date-only']);
    expect(year2025.totalDeductible).toBe(0);
    expect(year2025.lineItemsArray.flatMap(item => item.transactions)).toEqual([]);
    expect(year2024.undated.map(row => row.id).sort()).toEqual(['date-object', 'datetime-only', 'empty-date', 'impossible-day', 'impossible-month', 'junk', 'missing', 'timestamp']);
    expect(year2024.needsMoreInformation).toBe(8);
    expect(year2025.needsMoreInformation).toBe(8);
    const kept = year2024.undated.find(row => row.id === 'datetime-only');
    expect(kept).toMatchObject({ id: 'datetime-only', amount: 100 });
    expect(chargeDay({ datetime: '2024-12-31T15:00:00Z' })).toBeNull();
    expect(safeTaxYear('2025-13-40')).toBeNull();
    expect(safeTaxYear('2025-02-30')).toBeNull();
  });

  it('uses the same charge day for the export tax date as for the year total', () => {
    const dated = rows.filter(row => chargeYear(row) !== null);
    const undated = rows.filter(row => chargeYear(row) === null);
    const exported2024 = selectExportYear(dated, 2024);
    expect(exported2024.map(row => row.id).sort()).toEqual(['date-only']);
    expect(selectExportYear(dated, 2025).map(row => row.id)).toEqual([]);
    for (const row of dated) {
      const day = chargeDay(row);
      expect(exportDate(row.date)).toBe(day);
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

  it('leaves a datetime-only row undated and keeps the amount', () => {
    const saved = { datetime: '2024-12-31T15:00:00Z', amount: 100 };
    expect(chargeDay(saved)).toBeNull();
    expect(chargeYear(saved)).toBeNull();
    const row = normalizeDoc(doc(saved));
    expect(row.date).toBe('');
    expect(row.datetime).toBe('2024-12-31T15:00:00Z');
    expect(row.amount).toBe(100);
    expect(chargeYear(row)).toBeNull();
    const totals = aggregateScheduleC([confirmed(row)], '2024', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(totals.totalDeductible).toBe(0);
    expect(totals.needsMoreInformation).toBe(1);
    expect(totals.undated.map(item => item.amount)).toEqual([100]);
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
    expect(chargeDay({ datetime: '2024-12-31T15:00:00Z' })).toBeNull();
    expect(chargeYear({ datetime: '2024-12-31T15:00:00Z' })).toBeNull();
    expect(taxYearOf({ created_at: '2099-06-15T12:00:00Z', updated_at: '2099-06-15T12:00:00Z' })).toBeNull();
    expect(taxYearOf({})).toBeNull();
    expect(vehicleMethodForCharge({ created_at: '2026-06-15T12:00:00Z' }, 'standard_mileage')).toEqual({
      taxYear: null, method: null, needsMoreInformation: true,
    });
    expect(vehicleMethodForCharge({ date: '', datetime: '2024-12-31T15:00:00Z' }, 'actual_expense')).toEqual({
      taxYear: null, method: null, needsMoreInformation: true,
    });
    expect(vehicleMethodForCharge({ datetime: '2024-12-31T15:00:00Z' }, 'standard_mileage')).toEqual({
      taxYear: null, method: null, needsMoreInformation: true,
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
    expect(chargeYear(row)).toBe(2024);
    expect(`${scheduleCExportLine(line.lineCode, 2024)} (${line.lineName})`).toBe('27a (Other expenses)');
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

describe('chargeDay and chargeYear match safeYMD and safeTaxYear for a string date', () => {
  it.each([
    ['a date string', '2025-01-05', '2025-01-05', 2025],
    ['a written month string', 'Jan 5, 2025', '2025-01-05', 2025],
    ['an offset timestamp string', '2024-12-31T20:00:00-08:00', '2024-12-31', 2024],
    ['December 31', '2025-12-31', '2025-12-31', 2025],
    ['January 1', '2026-01-01', '2026-01-01', 2026],
  ])('reads %s', (_label, value, day, year) => {
    expect(chargeDay({ date: value })).toBe(day);
    expect(chargeYear({ date: value })).toBe(year);
    expect(chargeDay({ date: value })).toBe(safeYMD(value));
    expect(chargeYear({ date: value })).toBe(safeTaxYear(value));
    const row = confirmed({ date: value, amount: 40 });
    expect(aggregateScheduleC([row], String(year), CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible).toBe(40);
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

describe('a Date, a Timestamp, or a datetime-only row is undated', () => {
  // 11:30 PM on Dec 31 in America/Los_Angeles (PST, UTC-8).
  const losAngelesDec31 = new Date('2025-01-01T07:30:00.000Z');
  // 12:30 AM on Jan 1 in Asia/Tokyo (JST, UTC+9).
  const tokyoJan1 = new Date('2024-12-31T15:30:00.000Z');
  const timestamp = (date: Date) => ({ toDate: () => date });

  it.each([
    ['a Date at 11:30 PM Dec 31 in Los Angeles', losAngelesDec31],
    ['a Timestamp at 11:30 PM Dec 31 in Los Angeles', timestamp(losAngelesDec31)],
    ['a Date at 12:30 AM Jan 1 in Tokyo', tokyoJan1],
    ['a Timestamp at 12:30 AM Jan 1 in Tokyo', timestamp(tokyoJan1)],
  ])('%s is undated and counted in neither year', (_label, value) => {
    const row = confirmed({ id: 'instant', date: value, amount: 40 });
    expect(chargeDay(row)).toBeNull();
    expect(chargeYear(row)).toBeNull();
    expect(safeYMD(value)).toBeNull();
    expect(safeTaxYear(value)).toBeNull();
    for (const year of ['2024', '2025']) {
      const totals = aggregateScheduleC([row], year, CATEGORY_MAP, { mode: 'confirmed-only' });
      expect(totals.totalDeductible).toBe(0);
      expect(totals.needsMoreInformation).toBe(1);
      expect(totals.undated).toEqual([row]);
      expect(totals.undated[0].amount).toBe(40);
    }
  });

  it.each([
    ['2024-12-31', 2024, 2025],
    ['2025-01-01', 2025, 2024],
    ['2025-12-31', 2025, 2026],
    ['2026-01-01', 2026, 2025],
  ])('string %s counts in the written year', (date, year, other) => {
    const row = confirmed({ date, amount: 40 });
    expect(chargeDay(row)).toBe(date);
    expect(chargeYear(row)).toBe(year);
    expect(aggregateScheduleC([row], String(year), CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible).toBe(40);
    expect(aggregateScheduleC([row], String(other), CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible).toBe(0);
  });

  it('keeps a datetime-only amount out of every year total', () => {
    const row = confirmed({ id: 'datetime-only', datetime: '2024-12-31T15:00:00Z', amount: 80 });
    expect(chargeDay(row)).toBeNull();
    expect(chargeYear(row)).toBeNull();
    expect(exportDate(row)).toBeNull();
    expect(safeYMD('2024-12-31T15:00:00Z')).toBe('2024-12-31');
    for (const year of ['2024', '2025']) {
      const totals = aggregateScheduleC([row], year, CATEGORY_MAP, { mode: 'confirmed-only' });
      expect(totals.totalDeductible).toBe(0);
      expect(totals.needsMoreInformation).toBe(1);
      expect(totals.undated[0].amount).toBe(80);
      expect(totals.undated[0].datetime).toBe('2024-12-31T15:00:00Z');
    }
  });

  it.each([
    ['seconds and nanoseconds', { seconds: 1735689600, nanoseconds: 0 }],
    ['_seconds and _nanoseconds', { _seconds: 1735689600, _nanoseconds: 0 }],
    ['type, seconds, and nanoseconds', { type: 'firestore/timestamp/1.0', seconds: 1735689600, nanoseconds: 0 }],
    ['an epoch number', Date.UTC(2025, 0, 5)],
    ['a millisecond epoch', 1735689600000],
    ['String(ts)', String({ seconds: 1735689600, nanoseconds: 0 })],
  ])('%s is undated', (_label, value) => {
    const row = confirmed({ date: value, amount: 15 });
    expect(chargeDay(row)).toBeNull();
    expect(chargeYear(row)).toBeNull();
    expect(safeYMD(value)).toBeNull();
    expect(safeTaxYear(value)).toBeNull();
    const totals = aggregateScheduleC([row], '2025', CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(totals.totalDeductible).toBe(0);
    expect(totals.needsMoreInformation).toBe(1);
    expect(totals.undated[0].amount).toBe(15);
  });
});
