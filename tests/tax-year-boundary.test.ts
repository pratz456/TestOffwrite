import { expect, it } from 'vitest';
import { listIncomeSourceCandidates, reconcileBusinessIncome, UTC_ZONE_ALIASES } from '@/lib/tax-rules/business-income';

/**
 * Tax year placement for a saved instant.
 * Vitest starts this file with TZ set to America/Los_Angeles, UTC, or Asia/Tokyo.
 * UTC is the backend zone, and that run must see a process offset of 0.
 * The 18 names below are the list this branch accepts. Importing the receipt
 * zone fixture follows after that change lands.
 */
const UTC_ZONE_NAMES = [
  'utc',
  'etc/utc',
  'etc/gmt',
  'gmt',
  'etc/universal',
  'universal',
  'etc/zulu',
  'zulu',
  'gmt0',
  'etc/gmt0',
  'etc/gmt+0',
  'gmt+0',
  'gmt-0',
  'etc/gmt-0',
  'uct',
  'etc/uct',
  'greenwich',
  'etc/greenwich',
];

const ADDED = 20000;
const NMI = /needs[\s_-]*more[\s_-]*info/i;
/** 2026-12-31 23:30 in America/Los_Angeles. */
const LOS_ANGELES_NEW_YEAR = '2027-01-01T07:30:00.000Z';
/** 2027-01-01 00:30 in Asia/Tokyo. Still 2026-12-31 in UTC. */
const TOKYO_NEW_YEAR = '2026-12-31T15:30:00.000Z';
/** UTC day disagrees with Pacific/Pago_Pago, so a refused zone cannot hide as UTC. */
const UTC_ALIAS_INSTANT = '2026-07-15T04:30:00.000Z';

const charge = (id: string, iso: string, zone?: string) => ({
  id,
  trans_id: id,
  account_id: 'bank-1',
  amount: -ADDED,
  category: 'income',
  merchant_name: 'Boundary Client',
  pending: false,
  iso_currency_code: 'USD',
  date: new Date(iso),
  ...(zone === undefined ? {} : { uploadTimeZone: zone }),
});

const reconcile = (year: number, row: ReturnType<typeof charge>) => reconcileBusinessIncome(year, [row], [], []);

const placedDay = (year: number, row: ReturnType<typeof charge>) => {
  const { candidates } = listIncomeSourceCandidates(year, [row], [], []);
  return candidates.find(candidate => candidate.id === row.id)?.date;
};

const namesRow = (result: ReturnType<typeof reconcile>) => result.needsMoreInformationRows.some(item => item.id === 'boundary-row' || item.name === 'Boundary Client');

it('process offset is 0 in the backend zone', () => {
  const zone = process.env.TZ;
  const offset = new Date().getTimezoneOffset();
  expect(zone).toMatch(/^(America\/Los_Angeles|UTC|Asia\/Tokyo)$/);
  if (zone === 'UTC') {
    expect(offset).toBe(0);
    return;
  }
  if (zone === 'Asia/Tokyo') {
    expect(offset).toBe(-540);
    return;
  }
  expect(offset === 420 || offset === 480).toBe(true);
});

it('keeps 2026-12-31 23:30 America/Los_Angeles in tax year 2026', () => {
  const row = charge('boundary-row', LOS_ANGELES_NEW_YEAR, 'America/Los_Angeles');
  const year2026 = reconcile(2026, row);
  expect(placedDay(2026, row)).toBe('2026-12-31');
  expect(year2026.grossReceipts).toBe(ADDED);
  expect(year2026.quarterlyGrossReceipts).toEqual([0, 0, 0, ADDED]);
  expect(year2026.needsMoreInformationRows).toEqual([]);
  const year2027 = reconcile(2027, row);
  expect(year2027.grossReceipts).toBe(0);
  expect(year2027.needsMoreInformationRows).toEqual([]);
  expect(placedDay(2027, row)).toBeUndefined();
});

it('keeps 2027-01-01 00:30 Asia/Tokyo in tax year 2027', () => {
  const row = charge('boundary-row', TOKYO_NEW_YEAR, 'Asia/Tokyo');
  const year2027 = reconcile(2027, row);
  expect(placedDay(2027, row)).toBe('2027-01-01');
  expect(year2027.grossReceipts).toBe(ADDED);
  expect(year2027.quarterlyGrossReceipts).toEqual([ADDED, 0, 0, 0]);
  expect(year2027.needsMoreInformationRows).toEqual([]);
  const year2026 = reconcile(2026, row);
  expect(year2026.grossReceipts).toBe(0);
  expect(year2026.needsMoreInformationRows).toEqual([]);
  expect(placedDay(2026, row)).toBeUndefined();
});

it.each([
  ['no saved zone', undefined],
  ['refused zone Z', 'Z'],
] as const)('2027-01-01T07:30Z with %s needs more information and has no tax year', (_label, zone) => {
  // Pago Pago reads 2026-12-31 and St Thomas reads 2027-01-01. They disagree, so the row is needs more information and is not in 2026 or 2027.
  const row = charge('boundary-row', LOS_ANGELES_NEW_YEAR, zone);
  for (const year of [2026, 2027]) {
    const result = reconcile(year, row);
    expect(result.grossReceipts).toBe(0);
    expect(placedDay(year, row)).toBeUndefined();
    expect(namesRow(result)).toBe(true);
    expect(result.warnings.join(' ')).toMatch(NMI);
    expect(result.quarterlyGrossReceipts).toEqual([0, 0, 0, 0]);
  }
});

it.each([
  ['no saved zone', undefined],
  ['refused zone Z', 'Z'],
] as const)('2026-12-31T15:30Z with %s lands in tax year 2026', (_label, zone) => {
  // Pago Pago and St Thomas both read 2026-12-31, so the row is in tax year 2026 and not in 2027.
  const row = charge('boundary-row', TOKYO_NEW_YEAR, zone);
  const year2026 = reconcile(2026, row);
  expect(placedDay(2026, row)).toBe('2026-12-31');
  expect(year2026.grossReceipts).toBe(ADDED);
  expect(year2026.quarterlyGrossReceipts).toEqual([0, 0, 0, ADDED]);
  expect(year2026.needsMoreInformationRows).toEqual([]);
  const year2027 = reconcile(2027, row);
  expect(year2027.grossReceipts).toBe(0);
  expect(year2027.needsMoreInformationRows).toEqual([]);
  expect(placedDay(2027, row)).toBeUndefined();
});

it('accepts every name in the 18 name list', () => {
  expect([...UTC_ZONE_ALIASES]).toEqual(UTC_ZONE_NAMES);
});

it.each(UTC_ZONE_NAMES)('accepts saved zone %s', zone => {
  const row = charge('boundary-row', UTC_ALIAS_INSTANT, zone);
  const result = reconcile(2026, row);
  expect(placedDay(2026, row)).toBe('2026-07-15');
  expect(result.grossReceipts).toBe(ADDED);
  expect(result.needsMoreInformationRows).toEqual([]);
  expect(result.quarterlyGrossReceipts).toEqual([0, 0, ADDED, 0]);
});
