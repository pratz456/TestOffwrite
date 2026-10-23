import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { chargeDay } from '@/lib/schedule-c/taxDate';
import { selectExportYear } from '@/lib/reports/transaction-export';
import {
  getLocalTransactionDate,
  sumIncomeForQuarter,
  ROW_FLAG_FIELD,
  type QuarterlyTransactionLike,
} from '@/lib/tax-provider/quarterly-estimates';

const zones = ['America/Los_Angeles', 'Asia/Tokyo'] as const;
const quarters = [1, 2, 3, 4] as const;

type DateShape = 'absent' | 'timestamp' | 'blank';

type ProbeRow = QuarterlyTransactionLike & {
  id: string;
  trans_id: string;
  account_id: 'a1';
  amount: -1000;
  category: 'revenue';
  pending: false;
  is_deductible: null;
  iso_currency_code: 'USD';
  datetime: string;
  placedWithoutDate?: true;
};

function isoFromSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** Income row with no written day. `absent` omits `date`. `timestamp` and `blank` are the shapes production stores. */
function incomeRow(id: string, datetime: string, shape: DateShape): ProbeRow {
  const row: ProbeRow = {
    id,
    trans_id: id,
    account_id: 'a1',
    amount: -1000,
    category: 'revenue',
    pending: false,
    is_deductible: null,
    iso_currency_code: 'USD',
    datetime,
  };
  if (shape === 'timestamp') row.date = Timestamp.fromMillis(Date.parse(datetime));
  if (shape === 'blank') row.date = '';
  return row;
}

function yearTotal(rows: QuarterlyTransactionLike[], year: number, zone: string): number {
  return quarters.reduce((sum, quarter) => sum + sumIncomeForQuarter(rows, year, quarter, zone).grossIncome, 0);
}

function quarterResults(rows: QuarterlyTransactionLike[], year: number, zone: string) {
  return quarters.map(quarter => sumIncomeForQuarter(rows, year, quarter, zone));
}

function expectScheduleCNeedsDate(row: ProbeRow) {
  for (const year of ['2024', '2025']) {
    const scheduleC = aggregateScheduleC([row], year, CATEGORY_MAP, { mode: 'confirmed-only' });
    expect(scheduleC.totalDeductible).toBe(0);
    expect(scheduleC.counts.year).toBe(0);
    expect(scheduleC.lineItemsArray).toEqual([]);
    expect(scheduleC.needsMoreInformation).toBe(1);
    expect(scheduleC.undated[0].amount).toBe(-1000);
  }
}

function expectPlacedYear(
  row: ProbeRow,
  year: number,
  boundaryCount: number,
  zone: string,
) {
  expect(chargeDay(row)).toBeNull();
  expect(getLocalTransactionDate(row, zone)).toBeNull();
  const parts = quarterResults([row], year, zone);
  expect(parts.reduce((sum, part) => sum + part.grossIncome, 0)).toBe(1000);
  const holding = parts.filter(part => part.grossIncome !== 0);
  expect(holding).toHaveLength(1);
  expect(holding[0].undatedIncome).toEqual({ count: 1, total: 1000, boundaryCount });
  const rest = parts.filter(part => part.grossIncome === 0);
  expect(rest).toHaveLength(3);
  for (const part of rest) {
    expect(part.undatedIncome).toEqual({ count: 0, total: 0, boundaryCount: 0 });
  }
  expect(row[ROW_FLAG_FIELD]).toBe(true);
  expect(row.placedWithoutDate).toBe(true);
  expect(chargeDay(row)).toBeNull();
  expect(getLocalTransactionDate(row, zone)).toBeNull();
  const otherYear = year === 2024 ? 2025 : 2024;
  const other = quarterResults([row], otherYear, zone);
  expect(other.reduce((sum, part) => sum + part.grossIncome, 0)).toBe(0);
  for (const part of other) {
    expect(part.undatedIncome).toEqual({ count: 0, total: 0, boundaryCount: 0 });
  }
  expectScheduleCNeedsDate(row);
}

describe('undated income quarterly probe', () => {
  it.each(['absent', 'timestamp', 'blank'] as const)(
    'places 2025-06-15T18:00Z income in 2025 when date is %s',
    (shape) => {
      for (const zone of zones) {
        const row = incomeRow(`june-${shape}`, '2025-06-15T18:00Z', shape);
        expect(Object.hasOwn(row, 'date')).toBe(shape !== 'absent');
        expectPlacedYear(row, 2025, 0, zone);
        const fresh = incomeRow(`june-export-${shape}-${zone}`, '2025-06-15T18:00Z', shape);
        const selected = selectExportYear([fresh], 2025);
        expect(selected).toHaveLength(1);
        expect(selected[0][ROW_FLAG_FIELD]).toBe(true);
        expect(selected[0].placedWithoutDate).toBe(true);
        expect(yearTotal(selected as QuarterlyTransactionLike[], 2025, zone)).toBe(1000);
        expect(yearTotal([fresh], 2024, zone)).toBe(0);
      }
    },
  );

  it.each(['absent', 'timestamp', 'blank'] as const)(
    'places datetime from 1735716600 in 2024 and flags the boundary when date is %s',
    (shape) => {
      const datetime = isoFromSeconds(1735716600);
      expect(datetime).toBe('2025-01-01T07:30:00.000Z');
      for (const zone of zones) {
        const row = incomeRow(`la-${shape}`, datetime, shape);
        expectPlacedYear(row, 2024, 1, zone);
        const fresh = incomeRow(`la-export-${shape}-${zone}`, datetime, shape);
        const selected = selectExportYear([fresh], 2024);
        expect(selected).toHaveLength(1);
        expect(yearTotal(selected as QuarterlyTransactionLike[], 2024, zone)).toBe(1000);
        expect(selectExportYear([incomeRow(`la-2025-${shape}-${zone}`, datetime, shape)], 2025)).toEqual([]);
      }
    },
  );

  it.each(['absent', 'timestamp', 'blank'] as const)(
    'places datetime from 1735727400 in 2024 and flags the boundary when date is %s',
    (shape) => {
      const datetime = isoFromSeconds(1735727400);
      expect(datetime).toBe('2025-01-01T10:30:00.000Z');
      for (const zone of zones) {
        const row = incomeRow(`utc12-${shape}`, datetime, shape);
        expectPlacedYear(row, 2024, 1, zone);
        const fresh = incomeRow(`utc12-export-${shape}-${zone}`, datetime, shape);
        const selected = selectExportYear([fresh], 2024);
        expect(selected).toHaveLength(1);
        expect(selected[0].placedWithoutDate).toBe(true);
        expect(yearTotal(selected as QuarterlyTransactionLike[], 2024, zone)).toBe(1000);
        expect(selectExportYear([incomeRow(`utc12-2025-${shape}-${zone}`, datetime, shape)], 2025)).toEqual([]);
        expect(chargeDay(fresh)).toBeNull();
      }
    },
  );
});
