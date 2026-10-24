// Product probe v2 for PR #75: undated and instant dated income on the LIVE estimate path (base 52f5788d).
// v1 is kept beside this file as pr75-live-path-income-probe.v1.test.ts.
// Live path: components/quarterly-tax-calculator.tsx -> GET /api/tax/quarterly-reminders (app/api/tax/quarterly-reminders/route.ts)
//   -> GET app/api/tax/compute-1040/route.ts -> readTaxExportTransactions + buildFederalTaxSnapshot (lib/tax-rules/federal-tax-snapshot.ts)
//   -> reconcileBusinessIncome (lib/tax-rules/business-income.ts); its warnings join calculationWarnings (federal-tax-snapshot.ts:155).
// lib/tax-provider/quarterly-estimates.ts is NOT imported here: it has no production importer at 52f5788d.
// Rule (Product with Tax Watch, IRC 6654(d)(1), amended by Coach and Tax Watch 4:25 PM PT):
//   * Blank, empty string or unreadable `date` with no usable datetime: needs more information, in no year total, shown once as unplaced.
//   * A blank or unreadable date with a valid datetime is placed by that datetime for the year only.
//   * An impossible calendar date such as '2026-02-30': Needs more information, in no year's total.
//   * Firestore Timestamp, JS Date or {seconds,nanoseconds}: DATED. Day read in the row's uploadTimeZone; with no zone, read in
//     Pacific/Pago_Pago and America/St_Thomas: agree -> that day; disagree -> Needs more information (in no year's total). Never the server zone.
//   * reconcileBusinessIncome never throws for an undated or Needs more information row.
// Contract names (Product's call; nothing else is accepted):
//   result.needsMoreInformationRows: Array<{ id | name, reason }>, and the same row is named in result.warnings.
//   result.undatedIncome: { count, total } for undated income rows kept in the annual total.
//   result.quarterlyGrossReceipts: [q1, q2, q3, q4] numbers; undated rows excluded; each dated row in exactly one quarter.
// Copy into tests/ of a plain `git archive` export to run (see pr75-live-path-income-probe.README.md). Run under TZ=America/Los_Angeles, Asia/Tokyo and UTC.
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';

const state = vi.hoisted(() => ({
  uid: 'probe-owner' as string | null,
  records: {} as Record<string, Record<string, unknown>[]>,
  tx: [] as Record<string, unknown>[],
}));
// Same mocking pattern as tests/quarterly-planner-route.test.ts. readOwnedTransactions is the Firestore read; the real
// readTaxExportTransactions, compute-1040 route, snapshot and reconciliation all run unmocked.
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: state.uid ? { uid: state.uid } : null }) }));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => null }));
vi.mock('@/lib/reports/export-records', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/reports/export-records')>(), readOwnedTransactions: async () => state.tx }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: async () => ({ data: state.tx, error: null }) }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: async () => ({ data: { filing_status: 'Single' }, error: null }) }));
vi.mock('@/lib/firebase/settings-server', () => ({ getAssetsSettings: async () => ({ data: [], error: null }), getScheduleCSettings: async () => ({ data: { assets: [], homeOffice: null, depreciationElections: { deMinimisSafeHarborYears: [] } }, error: null }) }));
vi.mock('@/lib/firebase/quarterly-payments-server', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/firebase/quarterly-payments-server')>(),
  getRecordedQuarterlyPayments: async () => ([1, 2, 3, 4] as const).map(quarter => ({ quarter, paidAmount: 0, record: null })),
}));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => ({ where() { return this; }, limit() { return this; }, get: async () => ({ empty: !state.records[name]?.length, docs: (state.records[name] || []).map((data, id) => ({ id: String(id), data: () => data })) }) }) } }));

import * as businessIncome from '@/lib/tax-rules/business-income';
import * as snapshotModule from '@/lib/tax-rules/federal-tax-snapshot';
import { GET as quarterly } from '../app/api/tax/quarterly-reminders/route';

type Row = Record<string, unknown>;
type Result = Record<string, any>;
const reconcile = (year: number, rows: Row[]) => businessIncome.reconcileBusinessIncome(year, rows, [], []) as unknown as Result;
const snapshot = (year: number, rows: Row[]) => snapshotModule.buildFederalTaxSnapshot({
  taxYear: year, transactions: rows, grossReceipts: [], forms1099: [], reconciliationDecisions: [], w2Entries: [],
  profile: { filing_status: 'single' }, organizer: reviewedPersonalDeductionOrganizer(year), deductions: {}, assets: [], estimatedPayments: 0,
});
const PRIOR_YEAR_FACTS = { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '10000', priorYearAGI: '100000' };
const routeGet = async (rows: Row[]) => {
  state.tx = rows;
  const response = await quarterly(new NextRequest('http://localhost/api/tax/quarterly-reminders?year=2026&asOf=2026-09-01'));
  return { status: response.status, body: await response.json() };
};

console.info(`[probe live-path v2] TZ=${process.env.TZ ?? '(unset)'} resolved=${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

// Fixtures. Amounts are signed bank amounts in dollars: an inflow is negative, reconcileBusinessIncome counts -amount.
// Amounts are large enough that the QBI minimum and EITC review gates do not fire on the route.
const CTRL = 100000, PRB = 20000;
const CONTROL_NAME = 'Dated Control Client';
const PROBE_ID = 'probe-1', PROBE_NAME = 'Probe Client LLC';
const DATED2_ID = 'probe-2', DATED2_NAME = 'Dated Instant Client';
const control = (date = '2026-03-10') => ({ id: 'control-1', trans_id: 'control-1', account_id: 'bank-1', amount: -CTRL, category: 'income', merchant_name: CONTROL_NAME, pending: false, iso_currency_code: 'USD', date });
const probe = (fields: Row) => ({ id: PROBE_ID, trans_id: PROBE_ID, account_id: 'bank-1', amount: -PRB, category: 'income', merchant_name: PROBE_NAME, pending: false, iso_currency_code: 'USD', ...fields });
/** A second dated instant income row (the dated instant control), 20000, distinct id and name. */
const dated2 = (fields: Row) => ({ ...probe(fields), id: DATED2_ID, trans_id: DATED2_ID, merchant_name: DATED2_NAME });
const withoutDate = () => { const { date: _d, ...rest } = probe({ date: 'x' }); return rest; };

// Undated shapes (rule 1). Each row carries no datetime, so nothing else can date it.
const UNDATED: Array<[string, () => Row]> = [
  ['date missing', withoutDate],
  ['date null', () => probe({ date: null })],
  ["date ''", () => probe({ date: '' })],
  ["date '   '", () => probe({ date: '   ' })],
  ["date 'not-a-date'", () => probe({ date: 'not-a-date' })],
];
// Instant shapes (dated under the 4:25 PM correction).
const INSTANT: Array<[string, (ms: number) => unknown]> = [
  ['Firestore Timestamp', ms => Timestamp.fromMillis(ms)],
  ['JS Date', ms => new Date(ms)],
  ['{seconds,nanoseconds}', ms => ({ seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1e6 })],
];
const JUNE_2025 = Date.UTC(2025, 5, 15, 12, 0);         // Jun 15 2025 everywhere from UTC-11 to UTC-4
const MAY_2025 = Date.UTC(2025, 4, 15, 12, 0);          // May 15 2025 everywhere from UTC-11 to UTC-4
const MAY_2026 = Date.UTC(2026, 4, 15, 12, 0);          // May 15 2026 everywhere from UTC-11 to UTC-4
const AUG_2026 = Date.UTC(2026, 7, 15, 12, 0);          // Aug 15 2026 everywhere from UTC-11 to UTC-4
const OCT_2026 = Date.UTC(2026, 9, 15, 12, 0);          // Oct 15 2026 everywhere from UTC-11 to UTC-4
const JST_NYE_2026 = Date.UTC(2026, 11, 31, 14, 30);    // 2026-12-31 23:30 in Asia/Tokyo
const JST_NY_2027 = Date.UTC(2026, 11, 31, 15, 30);     // 2027-01-01 00:30 in Asia/Tokyo; Dec 31 2026 in UTC, Pago Pago and St Thomas
const JAN1_2026_02Z = Date.UTC(2026, 0, 1, 2, 0);       // Dec 31 2025 in Pago Pago (15:00) AND St Thomas (22:00); Jan 1 2026 in UTC
const JAN1_2026_05Z = Date.UTC(2026, 0, 1, 5, 0);       // Dec 31 2025 18:00 Pago Pago, Jan 1 2026 01:00 St Thomas
const B = 1735716600;                                    // 2025-01-01 07:30Z: Dec 31 2024 Pago Pago, Jan 1 2025 St Thomas
const C = 1735727400;                                    // 2025-01-01 10:30Z: Dec 31 2024 23:30 Pago Pago, Jan 1 2025 St Thomas
const NOON = Date.UTC(2025, 5, 15, 12) / 1000, THREE = Date.UTC(2025, 5, 15, 15) / 1000, SIX = Date.UTC(2025, 5, 15, 18) / 1000;

const NMI_TEXT = /needs more information/i;
const safeJson = (value: unknown) => { try { return JSON.stringify(value) ?? ''; } catch { return String(value); } };
const names = (w: unknown, id: string, name: string) => typeof w === 'string' && (w.includes(name) || w.includes(id));
const warningNaming = (warnings: unknown, id = PROBE_ID, name = PROBE_NAME) => Array.isArray(warnings) ? warnings.find(w => names(w, id, name)) : undefined;
const nmiWarningNaming = (warnings: unknown, id = PROBE_ID, name = PROBE_NAME) => Array.isArray(warnings) ? warnings.find(w => names(w, id, name) && NMI_TEXT.test(w as string)) : undefined;

/** Calls reconcileBusinessIncome; it must not throw. */
function run(year: number, rows: Row[], label: string): Result {
  let result: Result | undefined, error: unknown;
  try { result = reconcile(year, rows); } catch (e) { error = e; }
  expect(error, `${label}: reconcileBusinessIncome(${year}) must not throw; threw ${(error as Error)?.message}`).toBeUndefined();
  expect(typeof result!.grossReceipts, `${label}: grossReceipts must be computed`).toBe('number');
  return result!;
}
function expectGross(year: number, rows: Row[], expected: number, label: string): Result {
  const result = run(year, rows, label);
  expect(result.grossReceipts, `${label}: grossReceipts for ${year}`).toBe(expected);
  return result;
}
/** needsMoreInformationRows contract: an array with an entry naming the row (id or name) with a reason, and a warning naming the row. */
function expectNmiEntry(result: Result, label: string, id = PROBE_ID, name = PROBE_NAME) {
  const list = result.needsMoreInformationRows;
  expect(Array.isArray(list), `${label}: result.needsMoreInformationRows must be an array; got ${safeJson(list)}`).toBe(true);
  const entry = (list as any[]).find(e => e && typeof e === 'object' && (e.id === id || e.name === name));
  expect(entry, `${label}: no needsMoreInformationRows entry with id "${id}" or name "${name}": ${safeJson(list)}`).toBeDefined();
  expect(typeof entry.reason === 'string' && entry.reason.trim().length > 0, `${label}: needsMoreInformationRows entry has no reason: ${safeJson(entry)}`).toBe(true);
  expect(warningNaming(result.warnings, id, name), `${label}: no warning names the row; warnings: ${safeJson(result.warnings)}`).toBeDefined();
}
function expectNoNmiEntry(result: Result, label: string, id = PROBE_ID, name = PROBE_NAME) {
  const list = result.needsMoreInformationRows;
  expect(Array.isArray(list), `${label}: result.needsMoreInformationRows must be an array; got ${safeJson(list)}`).toBe(true);
  expect((list as any[]).some(e => e && (e.id === id || e.name === name)), `${label}: the dated row must not be in needsMoreInformationRows: ${safeJson(list)}`).toBe(false);
}
/** quarterlyGrossReceipts contract: exactly 4 finite numbers. */
function expectQuarters(result: Result, expected: [number, number, number, number], label: string) {
  const q = result.quarterlyGrossReceipts;
  expect(Array.isArray(q) && q.length === 4 && q.every((n: unknown) => typeof n === 'number' && Number.isFinite(n)), `${label}: result.quarterlyGrossReceipts must be an array of 4 numbers; got ${safeJson(q)}`).toBe(true);
  expect(Math.round(q.reduce((s: number, n: number) => s + n, 0) * 100) / 100, `${label}: quarterlyGrossReceipts must add up to the dated total`).toBe(expected.reduce((s, n) => s + n, 0));
  expect(q, `${label}: each dated row in exactly one quarter`).toEqual(expected);
}
function expectUndated(result: Result, count: number, total: number, label: string) {
  const u = result.undatedIncome;
  expect(u && typeof u === 'object', `${label}: result.undatedIncome must be an object { count, total }; got ${safeJson(u)}`).toBe(true);
  expect(u.count, `${label}: undatedIncome.count`).toBe(count);
  expect(u.total, `${label}: undatedIncome.total`).toBe(total);
}

beforeEach(() => {
  state.uid = 'probe-owner';
  state.records = { tax_organizers: [reviewedPersonalDeductionOrganizer(2026, {}, PRIOR_YEAR_FACTS)] };
  state.tx = [];
});

describe('P0 fixture pins: day in Pago Pago (UTC-11) versus St Thomas (UTC-4)', () => {
  const ymd = (ms: number, zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  it.each([
    { label: '1735716600', ms: B * 1000, isBoundary: true }, { label: '1735727400', ms: C * 1000, isBoundary: true },
    { label: '05:00Z Jan 1 2026', ms: JAN1_2026_05Z, isBoundary: true },
    { label: '02:00Z Jan 1 2026 (both Dec 31 2025)', ms: JAN1_2026_02Z, isBoundary: false },
    { label: '15:30Z Dec 31 2026 (both Dec 31 2026)', ms: JST_NY_2027, isBoundary: false },
    { label: '12:00Z Jun 15 2025', ms: NOON * 1000, isBoundary: false }, { label: '15:00Z Jun 15 2025', ms: THREE * 1000, isBoundary: false }, { label: '18:00Z Jun 15 2025', ms: SIX * 1000, isBoundary: false },
  ])('$label is a boundary case: $isBoundary', ({ ms, isBoundary }) => {
    expect(ymd(ms, 'Pacific/Pago_Pago') !== ymd(ms, 'America/St_Thomas')).toBe(isBoundary);
  });
  it('02:00Z Jan 1 2026 is Dec 31 2025 in both zones; 15:30Z Dec 31 2026 is Jan 1 2027 in Asia/Tokyo', () => {
    expect(ymd(JAN1_2026_02Z, 'Pacific/Pago_Pago')).toBe('2025-12-31');
    expect(ymd(JAN1_2026_02Z, 'America/St_Thomas')).toBe('2025-12-31');
    expect(ymd(JST_NY_2027, 'Asia/Tokyo')).toBe('2027-01-01');
  });
});

describe('Controls on reconcileBusinessIncome (business-income.ts:33-41)', () => {
  it('C1 a dated string income row counts exactly once, in its own year only', () => {
    expectGross(2026, [control()], CTRL, 'C1');
    expectGross(2025, [control()], 0, 'C1');
  });
  it('C2 a non-income category inflow never counts, dated or undated', () => {
    const other = { ...control(), id: 'other-1', trans_id: 'other-1', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' };
    expectGross(2026, [control(), other], CTRL, 'C2 dated');
    expectGross(2026, [control(), { ...other, date: '' }], CTRL, 'C2 undated');
  });
});

describe('Rule 1: blank, empty or unreadable date with nothing usable is needs more information', () => {
  for (const [label, make] of UNDATED) {
    it(`R1 ${label}: 2026 grossReceipts is 100000, the row is needs more information, and unplaced is 20000`, () => {
      const result = expectGross(2026, [control(), make()], CTRL, `R1 ${label}`);
      expectUndated(result, 0, 0, `R1 ${label}`);
      expectNmiEntry(result, `R1 ${label}`);
      expect(result.unplaced).toEqual({ count: 1, total: PRB });
    });
    it(`R1 ${label}: no throw, and a reconciliation warning names the row ("${PROBE_NAME}" or ${PROBE_ID})`, () => {
      const result = run(2026, [control(), make()], `R1 ${label}`);
      expect(warningNaming(result.warnings), `no warning names the row; warnings: ${safeJson(result.warnings)}`).toBeDefined();
    });
  }
  it("R1 date '2026-02-30' goes to Needs more information: not in 2026 grossReceipts, needsMoreInformationRows entry and warning name it", () => {
    const result = expectGross(2026, [control(), probe({ date: '2026-02-30' })], CTRL, "R1 '2026-02-30'");
    expectNmiEntry(result, "R1 '2026-02-30'");
  });
});

describe('Rule 2: quarterlyGrossReceipts excludes undated rows and puts each dated row in exactly one quarter', () => {
  // Dates are chosen so the quarter index is the same for calendar quarters and the 6654 periods (Jan-Mar, Apr-May, Jun-Aug, Sep-Dec).
  it('R2 rows with nothing usable are excluded: quarterlyGrossReceipts is [100000, 0, 0, 0]', () => {
    for (const [label, make] of UNDATED) {
      const result = expectGross(2026, [control(), make()], CTRL, `R2 ${label}`);
      expectQuarters(result, [CTRL, 0, 0, 0], `R2 ${label}`);
    }
  });
  it('R2 a dated Timestamp row (May 15 2025, no zone) is counted and sits in quarter 2: [100000, 20000, 0, 0]', () => {
    const result = expectGross(2025, [control('2025-03-10'), probe({ date: Timestamp.fromMillis(MAY_2025) })], CTRL + PRB, 'R2 dated');
    expectQuarters(result, [CTRL, PRB, 0, 0], 'R2 dated');
  });
  it('R2 string, Timestamp, JS Date and {seconds,nanoseconds} rows each land in exactly one quarter: [100000, 20000, 20000, 20000]', () => {
    const rows = [
      control(),
      probe({ date: Timestamp.fromMillis(MAY_2026) }),
      { ...probe({ date: new Date(AUG_2026) }), id: 'probe-3', trans_id: 'probe-3', merchant_name: 'August Client' },
      { ...probe({ date: { seconds: OCT_2026 / 1000, nanoseconds: 0 } }), id: 'probe-4', trans_id: 'probe-4', merchant_name: 'October Client' },
    ];
    const result = expectGross(2026, rows, CTRL + 3 * PRB, 'R2 four quarters');
    expectQuarters(result, [CTRL, PRB, PRB, PRB], 'R2 four quarters');
  });
});

describe('Dated instants (4:25 PM correction): Timestamp, JS Date, {seconds,nanoseconds}', () => {
  for (const [label, make] of INSTANT) {
    it(`D1 ${label} on 2025-06-15 does NOT count toward 2026, while a ${label} control on 2026-05-15 does (120000)`, () => {
      expectGross(2026, [control(), probe({ date: make(JUNE_2025) }), dated2({ date: make(MAY_2026) })], CTRL + PRB, `D1 ${label}`);
    });
    it(`D2 ${label} on 2025-06-15 counts exactly once in 2025`, () => {
      expectGross(2025, [control('2025-03-10'), probe({ date: make(JUNE_2025) })], CTRL + PRB, `D2 ${label}`);
    });
    it(`D3 ${label} at 2026-12-31 23:30 JST with uploadTimeZone Asia/Tokyo counts in 2026`, () => {
      expectGross(2026, [control(), probe({ date: make(JST_NYE_2026), uploadTimeZone: 'Asia/Tokyo' })], CTRL + PRB, `D3 ${label}`);
    });
    it(`D4 ${label} at 05:00Z Jan 1 2026 with no zone is in neither the 2025 nor the 2026 total, while a dated ${label} control in the same call counts`, () => {
      expectGross(2025, [control('2025-03-10'), probe({ date: make(JAN1_2026_05Z) }), dated2({ date: make(MAY_2025) })], CTRL + PRB, `D4 ${label} 2025`);
      expectGross(2026, [control(), probe({ date: make(JAN1_2026_05Z) }), dated2({ date: make(MAY_2026) })], CTRL + PRB, `D4 ${label} 2026`);
    });
    it(`D5 ${label} at 05:00Z Jan 1 2026 with no zone: no throw, total computed, needsMoreInformationRows entry and warning name the row (2025 and 2026)`, () => {
      for (const year of [2025, 2026]) {
        const result = expectGross(year, [control(`${year}-03-10`), probe({ date: make(JAN1_2026_05Z) })], CTRL, `D5 ${label} ${year}`);
        expectNmiEntry(result, `D5 ${label} ${year}`);
      }
    });
    it(`D7 ${label} at 02:00Z Jan 1 2026 with no zone (Pago Pago and St Thomas agree on Dec 31 2025) counts in 2025, not 2026, and is not Needs more information`, () => {
      const r25 = expectGross(2025, [probe({ date: make(JAN1_2026_02Z) })], PRB, `D7 ${label} 2025`);
      expectNoNmiEntry(r25, `D7 ${label} 2025`);
      expectGross(2026, [control(), probe({ date: make(JAN1_2026_02Z) })], CTRL, `D7 ${label} 2026`);
    });
  }
  it('D6 stored zone wins: Timestamp at 2027-01-01 00:30 JST with uploadTimeZone Asia/Tokyo is out of 2026 and in 2027; the 2026-12-31 23:30 JST one is in 2026', () => {
    const rows = [control(), probe({ date: Timestamp.fromMillis(JST_NY_2027), uploadTimeZone: 'Asia/Tokyo' }), dated2({ date: Timestamp.fromMillis(JST_NYE_2026), uploadTimeZone: 'Asia/Tokyo' })];
    expectGross(2026, rows, CTRL + PRB, 'D6 2026');
    expectGross(2027, rows, PRB, 'D6 2027');
  });
});

describe('Rule 3: boundary pins, range UTC-11 (Pago Pago) to UTC-4 (St Thomas)', () => {
  it.each([['1735716600', B], ['1735727400', C]])('R3 %s with no zone goes to Needs more information, in neither 2024 nor 2025', (_l, s) => {
    for (const year of [2024, 2025]) {
      const result = expectGross(year, [probe({ date: Timestamp.fromMillis((s as number) * 1000) })], 0, `R3 ${_l} ${year}`);
      expectNmiEntry(result, `R3 ${_l} ${year}`);
    }
  });
  it.each([{ label: '1735716600', s: B, yes: 2024, no: 2025 }, { label: '1735727400', s: C, yes: 2025, no: 2024 }])('R3 $label with uploadTimeZone America/Los_Angeles counts in $yes only, not $no', ({ label, s, yes, no }) => {
    const rows = [probe({ date: Timestamp.fromMillis(s * 1000), uploadTimeZone: 'America/Los_Angeles' })];
    expectGross(yes, rows, PRB, `R3 ${label} in ${yes}`);
    expectGross(no, rows, 0, `R3 ${label} in ${no}`);
  });
  it.each([['12:00Z', NOON], ['15:00Z', THREE], ['18:00Z', SIX]])('R3 %s Jun 15 2025 with no zone is not a boundary: counts once in 2025, no needsMoreInformationRows entry', (_l, s) => {
    const rows = [probe({ date: Timestamp.fromMillis((s as number) * 1000) })];
    const result = expectGross(2025, rows, PRB, `R3 ${_l}`);
    expectNoNmiEntry(result, `R3 ${_l}`);
    expectGross(2026, rows, 0, `R3 ${_l} in 2026`);
  });
});

describe('Through buildFederalTaxSnapshot (income.grossReceipts and result.calculationWarnings, federal-tax-snapshot.ts:155)', () => {
  const build = (rows: Row[], label: string) => {
    let value: ReturnType<typeof snapshot> | undefined, error: unknown;
    try { value = snapshot(2026, rows); } catch (e) { error = e; }
    expect(error, `${label}: buildFederalTaxSnapshot must not throw; threw ${(error as Error)?.message}`).toBeUndefined();
    return value!;
  };
  it('S1 control: a dated string row only gives grossReceipts 100000', () => {
    expect(build([control()], 'S1').income.grossReceipts).toBe(CTRL);
  });
  it.each([["date ''", () => probe({ date: '' })], ['date missing', withoutDate]])('S2 %s: grossReceipts 100000, calculationWarnings names the row, unplaced is 20000', (_l, make) => {
    const v = build([control(), (make as () => Row)()], `S2 ${_l}`);
    expect(v.income.grossReceipts).toBe(CTRL);
    expect(nmiWarningNaming(v.result.calculationWarnings), `calculationWarnings: ${safeJson(v.result.calculationWarnings)}`).toBeDefined();
    expect(v.reconciliation.unplaced).toEqual({ count: 1, total: PRB });
  });
  it('S3 uploadTimeZone Asia/Tokyo: 2026-12-31 23:30 JST counts and 2027-01-01 00:30 JST does not: grossReceipts 120000', () => {
    const v = build([control(), probe({ date: Timestamp.fromMillis(JST_NYE_2026), uploadTimeZone: 'Asia/Tokyo' }), dated2({ date: Timestamp.fromMillis(JST_NY_2027), uploadTimeZone: 'Asia/Tokyo' })], 'S3');
    expect(v.income.grossReceipts).toBe(CTRL + PRB);
  });
  it('S4 Timestamp from 2025-06-15 is not in 2026, while a 2026-05-15 Timestamp control is: grossReceipts 120000', () => {
    const v = build([control(), probe({ date: Timestamp.fromMillis(JUNE_2025) }), dated2({ date: Timestamp.fromMillis(MAY_2026) })], 'S4');
    expect(v.income.grossReceipts).toBe(CTRL + PRB);
  });
  it('S5 no-zone Timestamp at 05:00Z Jan 1 2026: no throw, not in grossReceipts, a calculationWarnings string says Needs more information and names the row', () => {
    const v = build([control(), probe({ date: Timestamp.fromMillis(JAN1_2026_05Z) })], 'S5');
    expect(v.income.grossReceipts).toBe(CTRL);
    expect(nmiWarningNaming(v.result.calculationWarnings), `calculationWarnings: ${safeJson(v.result.calculationWarnings)}`).toBeDefined();
  });
});

describe('Through GET /api/tax/quarterly-reminders (what the quarterly calculator screen reads)', () => {
  /** Every route test: status 200 (anything else fails, including 422) and a numeric estimate (totalEstimatedTax). */
  const expectEstimate = (status: number, body: any, label: string) => {
    expect(status, `${label}: status ${status}: ${safeJson(body).slice(0, 300)}`).toBe(200);
    expect(typeof body.totalEstimatedTax === 'number' && Number.isFinite(body.totalEstimatedTax), `${label}: totalEstimatedTax must be a number: ${safeJson(body.totalEstimatedTax)}`).toBe(true);
    expect(typeof body.grossReceipts, `${label}: grossReceipts must be a number`).toBe('number');
  };
  it('Q1 control: 200, a numeric estimate and grossReceipts 100000', async () => {
    const { status, body } = await routeGet([control()]);
    expectEstimate(status, body, 'Q1');
    expect(body.grossReceipts).toBe(CTRL);
  });
  it.each([["date ''", () => probe({ date: '' })], ['date missing', withoutDate]])('Q2 %s: 200, a numeric estimate, grossReceipts 100000, unplaced 20000, a calculationWarnings string names the row', async (_l, make) => {
    const { status, body } = await routeGet([control(), (make as () => Row)()]);
    expectEstimate(status, body, `Q2 ${_l}`);
    expect(body.grossReceipts).toBe(CTRL);
    expect(body.unplaced).toEqual({ count: 1, total: PRB });
    expect(nmiWarningNaming(body.calculationWarnings), `calculationWarnings: ${safeJson(body.calculationWarnings)}`).toBeDefined();
  });
  it('Q3 uploadTimeZone Asia/Tokyo: 2026-12-31 23:30 JST counts, 2027-01-01 00:30 JST does not: 200, estimate, grossReceipts 120000', async () => {
    const { status, body } = await routeGet([control(), probe({ date: Timestamp.fromMillis(JST_NYE_2026), uploadTimeZone: 'Asia/Tokyo' }), dated2({ date: Timestamp.fromMillis(JST_NY_2027), uploadTimeZone: 'Asia/Tokyo' })]);
    expectEstimate(status, body, 'Q3');
    expect(body.grossReceipts).toBe(CTRL + PRB);
  });
  it('Q4 no-zone Timestamp at 02:00Z Jan 1 2026 (Dec 31 2025 in Pago Pago and St Thomas) is not in 2026: 200, estimate, grossReceipts 100000', async () => {
    const { status, body } = await routeGet([control(), probe({ date: Timestamp.fromMillis(JAN1_2026_02Z) })]);
    expectEstimate(status, body, 'Q4');
    expect(body.grossReceipts, 'the row is dated Dec 31 2025, not its UTC day').toBe(CTRL);
  });
  it('Q5 no-zone Timestamp at 05:00Z Jan 1 2026: 200, estimate, not in grossReceipts, a calculationWarnings string says Needs more information and names the row', async () => {
    const { status, body } = await routeGet([control(), probe({ date: Timestamp.fromMillis(JAN1_2026_05Z) })]);
    expectEstimate(status, body, 'Q5');
    expect(body.grossReceipts, 'the Needs more information row must not be in grossReceipts').toBe(CTRL);
    expect(nmiWarningNaming(body.calculationWarnings), `calculationWarnings: ${safeJson(body.calculationWarnings)}`).toBeDefined();
  });
  it("Q6 date '2026-02-30': 200, estimate, not in grossReceipts, a calculationWarnings string says Needs more information and names the row", async () => {
    const { status, body } = await routeGet([control(), probe({ date: '2026-02-30' })]);
    expectEstimate(status, body, 'Q6');
    expect(body.grossReceipts, 'the Needs more information row must not be in grossReceipts').toBe(CTRL);
    expect(nmiWarningNaming(body.calculationWarnings), `calculationWarnings: ${safeJson(body.calculationWarnings)}`).toBeDefined();
  });
});
