import { expect, it } from 'vitest';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { listIncomeSourceCandidates, reconcileBusinessIncome } from '@/lib/tax-rules/business-income';

const ADDED = 20000;
/** 2024-05-06T12:53:20.000Z. Pago Pago and St Thomas both read that day. */
const VALID_SECONDS = 1715000000;
const DATETIME = '2026-06-15T12:00:00.000Z';

const row = (date: unknown, datetime?: string) => ({
  id: 'corrupt-row',
  trans_id: 'corrupt-row',
  account_id: 'bank-1',
  amount: -ADDED,
  category: 'income',
  merchant_name: 'Corrupt Seconds Client',
  pending: false,
  iso_currency_code: 'USD',
  date,
  ...(datetime === undefined ? {} : { datetime }),
});

const reconcile = (year: number, date: unknown, datetime?: string) => reconcileBusinessIncome(year, [row(date, datetime)], [], []);

const placedDay = (year: number, date: unknown) => {
  const { candidates } = listIncomeSourceCandidates(year, [row(date)], [], []);
  return candidates.find(candidate => candidate.id === 'corrupt-row')?.date;
};

const DATE_WARNING = 'Corrupt Seconds Client (corrupt-row) needs more information. This receipt cannot be placed on one calendar day, so it is left out of every year total and the quarter split.';

const holdsForReview = (date: unknown) => {
  for (const year of [2026, 2027, 2024, 2025]) {
    const result = reconcile(year, date, DATETIME);
    expect(result.grossReceipts).toBe(0);
    expect(result.quarterlyGrossReceipts).toEqual([0, 0, 0, 0]);
    expect(result.undatedIncome).toEqual({ count: 0, total: 0 });
    expect(result.needsMoreInformationRows).toEqual([
      { id: 'corrupt-row', name: 'Corrupt Seconds Client', reason: 'The saved date cannot be placed on one calendar day.' },
    ]);
    expect(result.warnings).toContain(DATE_WARNING);
    expect(result.unplaced).toEqual({ count: 1, total: ADDED });
  }
};

it.each([
  ['seconds NaN', { seconds: Number.NaN }],
  ['_seconds Infinity', { _seconds: Number.POSITIVE_INFINITY }],
  ['seconds string', { seconds: '1715000000' }],
  ['_seconds string', { _seconds: '1715000000' }],
] as const)('%s is needs more information with its date warning and is out of 2026 and 2027', (_label, date) => {
  holdsForReview(date);
});

it('uses finite _seconds when seconds is NaN', () => {
  const date = { seconds: Number.NaN, _seconds: VALID_SECONDS };
  const placed = reconcile(2024, date, DATETIME);
  expect(placedDay(2024, date)).toBe('2024-05-06');
  expect(placed.grossReceipts).toBe(ADDED);
  expect(placed.quarterlyGrossReceipts).toEqual([0, ADDED, 0, 0]);
  expect(placed.needsMoreInformationRows).toEqual([]);
  expect(placed.undatedIncome).toEqual({ count: 0, total: 0 });
  expect(placed.unplaced).toEqual({ count: 0, total: 0 });
  const otherYear = reconcile(2026, date, DATETIME);
  expect(otherYear.grossReceipts).toBe(0);
  expect(otherYear.needsMoreInformationRows).toEqual([]);
});

it('an object with neither seconds key follows datetime', () => {
  const date = { note: 'plain object' };
  const result = reconcile(2026, date, DATETIME);
  expect(result.grossReceipts).toBe(ADDED);
  expect(result.undatedIncome).toEqual({ count: 1, total: ADDED });
  expect(result.quarterlyGrossReceipts).toEqual([0, 0, 0, 0]);
  expect(result.needsMoreInformationRows).toEqual([]);
  expect(result.unplaced).toEqual({ count: 0, total: 0 });
  const otherYear = reconcile(2025, date, DATETIME);
  expect(otherYear.grossReceipts).toBe(0);
  expect(otherYear.needsMoreInformationRows).toEqual([]);
});

const DEPOSIT = 200;
const deposit = (date: unknown, datetime?: string) => ({
  id: 'blank-deposit',
  trans_id: 'blank-deposit',
  account_id: 'bank-1',
  amount: -DEPOSIT,
  category: 'income',
  merchant_name: 'Blank Date Client',
  pending: false,
  iso_currency_code: 'USD',
  date,
  ...(datetime === undefined ? {} : { datetime }),
});

it('a 200 dollar deposit with a blank date and no datetime is unplaced once', () => {
  for (const year of [2026, 2027]) {
    const result = reconcileBusinessIncome(year, [deposit('')], [], []);
    expect(result.grossReceipts).toBe(0);
    expect(result.quarterlyGrossReceipts).toEqual([0, 0, 0, 0]);
    expect(result.undatedIncome).toEqual({ count: 0, total: 0 });
    expect(result.needsMoreInformationRows).toEqual([
      { id: 'blank-deposit', name: 'Blank Date Client', reason: 'The saved date cannot be placed on one calendar day.' },
    ]);
    expect(result.unplaced).toEqual({ count: 1, total: DEPOSIT });
    expect(result.warnings).toContain('Blank Date Client (blank-deposit) needs more information. This receipt cannot be placed on one calendar day, so it is left out of every year total and the quarter split.');
  }
  const flagged = aggregateScheduleC([deposit('')], '2026', CATEGORY_MAP, { mode: 'confirmed-only' });
  expect(flagged.needsMoreInformation).toBe(1);
  const csv = generateScheduleCCSV(flagged.lineItemsArray, 2026, { count: 1, total: DEPOSIT });
  expect(csv.match(/Unplaced receipts/g)).toEqual(['Unplaced receipts']);
  expect(csv).toContain('200.00');
});

it('a blank date with a valid 2026 datetime is placed in 2026', () => {
  const datetime = '2026-06-15T12:00:00.000Z';
  const year2026 = reconcileBusinessIncome(2026, [deposit('', datetime)], [], []);
  expect(year2026.grossReceipts).toBe(DEPOSIT);
  expect(year2026.undatedIncome).toEqual({ count: 1, total: DEPOSIT });
  expect(year2026.quarterlyGrossReceipts).toEqual([0, 0, 0, 0]);
  expect(year2026.needsMoreInformationRows).toEqual([]);
  expect(year2026.unplaced).toEqual({ count: 0, total: 0 });
  const year2027 = reconcileBusinessIncome(2027, [deposit('', datetime)], [], []);
  expect(year2027.grossReceipts).toBe(0);
  expect(year2027.needsMoreInformationRows).toEqual([]);
  expect(year2027.unplaced).toEqual({ count: 0, total: 0 });
});
