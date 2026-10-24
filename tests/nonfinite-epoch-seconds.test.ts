import { expect, it } from 'vitest';
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

const holdsForReview = (date: unknown) => {
  for (const year of [2024, 2025, 2026]) {
    const result = reconcile(year, date, DATETIME);
    expect(result.grossReceipts).toBe(0);
    expect(result.quarterlyGrossReceipts).toEqual([0, 0, 0, 0]);
    expect(result.undatedIncome).toEqual({ count: 0, total: 0 });
    expect(result.needsMoreInformationRows.some(item => item.id === 'corrupt-row' || item.name === 'Corrupt Seconds Client')).toBe(true);
  }
};

it.each([
  ['seconds NaN', { seconds: Number.NaN }],
  ['_seconds Infinity', { _seconds: Number.POSITIVE_INFINITY }],
  ['seconds string', { seconds: '1715000000' }],
] as const)('%s is needs more information and is out of every year total', (_label, date) => {
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
  const otherYear = reconcile(2025, date, DATETIME);
  expect(otherYear.grossReceipts).toBe(0);
  expect(otherYear.needsMoreInformationRows).toEqual([]);
});
