import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { reconcileBusinessIncome } from '@/lib/tax-rules/business-income';
import { buildFederalTaxSnapshot } from '@/lib/tax-rules/federal-tax-snapshot';

const state = vi.hoisted(() => ({
  uid: 'live-path-owner' as string | null,
  records: {} as Record<string, Record<string, unknown>[]>,
  tx: [] as Record<string, unknown>[],
}));
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

import { GET as quarterly } from '../app/api/tax/quarterly-reminders/route';

const DATED = 100000;
const ADDED = 20000;
const MERCHANT = 'Probe Client LLC';
const NMI = /needs[\s_-]*more[\s_-]*info/i;
const JUNE_2025 = Date.UTC(2025, 5, 15, 12, 0);
const JST_NYE_2026 = Date.UTC(2026, 11, 31, 14, 30);
const JST_NY_2027 = Date.UTC(2026, 11, 31, 15, 30);
const JAN1_2026_02Z = Date.UTC(2026, 0, 1, 2, 0);
const JAN1_2026_05Z = Date.UTC(2026, 0, 1, 5, 0);
const BOUNDARY_A = 1735716600;
const BOUNDARY_B = 1735727400;
const NOON = Date.UTC(2025, 5, 15, 12) / 1000;
const THREE = Date.UTC(2025, 5, 15, 15) / 1000;
const SIX = Date.UTC(2025, 5, 15, 18) / 1000;

const control = (date = '2026-03-10') => ({
  id: 'control-1', trans_id: 'control-1', account_id: 'bank-1', amount: -DATED, category: 'income',
  merchant_name: 'Dated Control Client', pending: false, iso_currency_code: 'USD', date,
});
const added = (fields: Record<string, unknown>) => ({
  id: 'probe-1', trans_id: 'probe-1', account_id: 'bank-1', amount: -ADDED, category: 'income',
  merchant_name: MERCHANT, pending: false, iso_currency_code: 'USD', ...fields,
});
const missingDate = () => {
  const row = added({ date: 'x' });
  delete row.date;
  return row;
};

type Instant = (ms: number) => unknown;
const INSTANTS: Array<[string, Instant]> = [
  ['Firestore Timestamp', ms => Timestamp.fromMillis(ms)],
  ['JS Date', ms => new Date(ms)],
  ['{seconds, nanoseconds}', ms => ({ seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1e6 })],
];
const UNREADABLE: Array<[string, () => Record<string, unknown>]> = [
  ['date missing', missingDate],
  ['date null', () => added({ date: null })],
  ["date ''", () => added({ date: '' })],
  ["date '   '", () => added({ date: '   ' })],
  ["date 'not-a-date'", () => added({ date: 'not-a-date' })],
];

const reconcile = (year: number, rows: Record<string, unknown>[]) => reconcileBusinessIncome(year, rows, [], []);
const namesRow = (warnings: string[]) => warnings.some(warning => warning.includes(MERCHANT) || warning.includes('probe-1'));
const quarterAmounts = (result: { quarterlyGrossReceipts: number[] }) => {
  expect(result.quarterlyGrossReceipts).toEqual([expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)]);
  return result.quarterlyGrossReceipts;
};
const nmiIds = (result: { needsMoreInformationRows: Array<{ id?: string; name?: string; reason: string }> }) => {
  expect(Array.isArray(result.needsMoreInformationRows)).toBe(true);
  return result.needsMoreInformationRows;
};

function snapshot(rows: Record<string, unknown>[]) {
  return buildFederalTaxSnapshot({
    taxYear: 2026, transactions: rows, grossReceipts: [], forms1099: [], reconciliationDecisions: [], w2Entries: [],
    profile: { filing_status: 'single' }, organizer: reviewedPersonalDeductionOrganizer(2026), deductions: {}, assets: [], estimatedPayments: 0,
  });
}

beforeEach(() => {
  state.uid = 'live-path-owner';
  state.tx = [];
  state.records = {
    tax_organizers: [reviewedPersonalDeductionOrganizer(2026, {}, { priorReturnCoveredTwelveMonths: 'yes', priorYearTax: '10000', priorYearAGI: '100000' })],
  };
});

describe('live path income dates', () => {
  it('counts a dated income row once, in its own year', () => {
    const result = reconcile(2026, [control()]);
    expect(result.grossReceipts).toBe(DATED);
    expect(reconcile(2025, [control()]).grossReceipts).toBe(0);
    expect(quarterAmounts(result).reduce((sum, amount) => sum + amount, 0)).toBe(DATED);
  });

  it('leaves wages and supply inflows out of receipts', () => {
    const other = { ...control(), id: 'other-1', trans_id: 'other-1', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' };
    expect(reconcile(2026, [control(), other]).grossReceipts).toBe(DATED);
    expect(reconcile(2026, [control(), { ...other, date: '' }]).grossReceipts).toBe(DATED);
  });

  it.each(UNREADABLE)('keeps %s in the 2026 annual total, names it, and leaves it out of the quarter split', (_label, make) => {
    const result = reconcile(2026, [control(), make()]);
    expect(result.grossReceipts).toBe(DATED + ADDED);
    expect(namesRow(result.warnings)).toBe(true);
    expect(result.undatedIncome).toEqual({ count: 1, total: ADDED });
    expect(nmiIds(result)).toEqual([]);
    expect(quarterAmounts(result)).toEqual([DATED, 0, 0, 0]);
  });

  it("leaves 2026-02-30 out of every total and records needsMoreInformationRows", () => {
    const result = reconcile(2026, [control(), added({ date: '2026-02-30' })]);
    expect(result.grossReceipts).toBe(DATED);
    expect(result.undatedIncome).toEqual({ count: 0, total: 0 });
    expect(nmiIds(result)).toEqual([expect.objectContaining({ id: 'probe-1', reason: expect.any(String) })]);
    expect(result.warnings.join(' ')).toMatch(NMI);
    expect(namesRow(result.warnings)).toBe(true);
    expect(quarterAmounts(result)).toEqual([DATED, 0, 0, 0]);
  });

  it('puts a dated June 2025 Timestamp into that year quarter split', () => {
    const rows = [control('2025-03-10'), added({ date: Timestamp.fromMillis(JUNE_2025) })];
    const result = reconcile(2025, rows);
    expect(result.grossReceipts).toBe(DATED + ADDED);
    expect(quarterAmounts(result)).toEqual([DATED, ADDED, 0, 0]);
  });

  describe.each(INSTANTS)('%s', (_label, make) => {
    it('does not count 15 June 2025 toward 2026, and counts it once in 2025', () => {
      expect(reconcile(2026, [control(), added({ date: make(JUNE_2025) })]).grossReceipts).toBe(DATED);
      expect(reconcile(2025, [control('2025-03-10'), added({ date: make(JUNE_2025) })]).grossReceipts).toBe(DATED + ADDED);
    });

    it('counts 31 December 2026 23:30 in Asia/Tokyo toward 2026', () => {
      const rows = [control(), added({ date: make(JST_NYE_2026), uploadTimeZone: 'Asia/Tokyo' })];
      const result = reconcile(2026, rows);
      expect(result.grossReceipts).toBe(DATED + ADDED);
      expect(quarterAmounts(result)[3]).toBe(ADDED);
    });

    it('leaves 1 January 2026 05:00Z with no zone out of 2025 and 2026 and says needs more information', () => {
      for (const year of [2025, 2026]) {
        const result = reconcile(year, [control(`${year}-03-10`), added({ date: make(JAN1_2026_05Z) })]);
        expect(result.grossReceipts).toBe(DATED);
        expect(namesRow(result.warnings)).toBe(true);
        expect(result.warnings.join(' ')).toMatch(NMI);
        expect(nmiIds(result).some(row => row.id === 'probe-1' && row.reason.trim().length > 0)).toBe(true);
        expect(quarterAmounts(result).reduce((sum, amount) => sum + amount, 0)).toBe(DATED);
      }
      const alone = reconcile(2026, [added({ date: make(JAN1_2026_05Z) })]);
      expect(alone.grossReceipts).toBe(0);
      expect(namesRow(alone.warnings)).toBe(true);
    });

    it('counts 1 January 2026 02:00Z in 2025 when both zones agree, and not in 2026', () => {
      const row = [added({ date: make(JAN1_2026_02Z) })];
      const placed = reconcile(2025, row);
      expect(placed.grossReceipts).toBe(ADDED);
      expect(nmiIds(placed)).toEqual([]);
      expect(reconcile(2026, [control(), ...row]).grossReceipts).toBe(DATED);
    });

    it('does not count 1 January 2027 00:30 Asia/Tokyo toward 2026', () => {
      const rows = [control(), added({ date: make(JST_NY_2027), uploadTimeZone: 'Asia/Tokyo' })];
      const result = reconcile(2026, rows);
      expect(result.grossReceipts).toBe(DATED);
      expect(quarterAmounts(result).reduce((sum, amount) => sum + amount, 0)).toBe(DATED);
    });
  });

  it.each([['1735716600', BOUNDARY_A], ['1735727400', BOUNDARY_B]] as const)('sends %s with no zone to needs more information in 2024 and 2025', (_label, seconds) => {
    const rows = [added({ date: Timestamp.fromMillis(seconds * 1000) })];
    for (const year of [2024, 2025]) {
      const result = reconcile(year, rows);
      expect(result.grossReceipts).toBe(0);
      expect(namesRow(result.warnings)).toBe(true);
      expect(result.warnings.join(' ')).toMatch(NMI);
      expect(nmiIds(result).some(row => row.id === 'probe-1')).toBe(true);
    }
  });

  it('uses America/Los_Angeles when that zone is saved on the row', () => {
    const early = [added({ date: Timestamp.fromMillis(BOUNDARY_A * 1000), uploadTimeZone: 'America/Los_Angeles' })];
    expect(reconcile(2024, early).grossReceipts).toBe(ADDED);
    expect(reconcile(2025, early).grossReceipts).toBe(0);
    const later = [added({ date: Timestamp.fromMillis(BOUNDARY_B * 1000), uploadTimeZone: 'America/Los_Angeles' })];
    expect(reconcile(2025, later).grossReceipts).toBe(ADDED);
    expect(reconcile(2024, later).grossReceipts).toBe(0);
    expect(nmiIds(reconcile(2025, later))).toEqual([]);
  });

  it.each([['12:00Z', NOON], ['15:00Z', THREE], ['18:00Z', SIX]] as const)('counts %s on 15 June 2025 once, with no needs more information signal', (_label, seconds) => {
    const rows = [added({ date: Timestamp.fromMillis(seconds * 1000) })];
    const result = reconcile(2025, rows);
    expect(result.grossReceipts).toBe(ADDED);
    expect(nmiIds(result)).toEqual([]);
    expect(reconcile(2026, rows).grossReceipts).toBe(0);
    expect(quarterAmounts(result).reduce((sum, amount) => sum + amount, 0)).toBe(ADDED);
  });
});

describe('live path through the federal snapshot and quarterly reminders', () => {
  it('keeps the dated control at 100000', () => {
    expect(snapshot([control()]).income.grossReceipts).toBe(DATED);
  });

  it.each([["date ''", () => added({ date: '' })], ['date missing', missingDate]] as const)('names %s in calculation warnings and keeps 120000', (_label, make) => {
    const result = snapshot([control(), make()]);
    expect(result.income.grossReceipts).toBe(DATED + ADDED);
    expect(namesRow(result.result.calculationWarnings)).toBe(true);
    expect(quarterAmounts(result.reconciliation).reduce((sum, amount) => sum + amount, 0)).toBe(DATED);
  });

  it('counts the Tokyo new year eve Timestamp and leaves June 2025 and the no zone instant out', () => {
    expect(snapshot([control(), added({ date: Timestamp.fromMillis(JST_NYE_2026), uploadTimeZone: 'Asia/Tokyo' })]).income.grossReceipts).toBe(DATED + ADDED);
    expect(snapshot([control(), added({ date: Timestamp.fromMillis(JUNE_2025) })]).income.grossReceipts).toBe(DATED);
    const disputed = snapshot([control(), added({ date: Timestamp.fromMillis(JAN1_2026_05Z) })]);
    expect(disputed.income.grossReceipts).toBe(DATED);
    expect(JSON.stringify({ warnings: disputed.result.calculationWarnings, reconciliation: disputed.reconciliation })).toMatch(NMI);
  });

  it('returns an estimate from quarterly reminders for a missing date and does not put that amount in an annualized split', async () => {
    const ask = async (rows: Record<string, unknown>[]) => {
      state.tx = rows;
      const response = await quarterly(new NextRequest('http://localhost/api/tax/quarterly-reminders?year=2026&asOf=2026-09-01'));
      return { status: response.status, body: await response.json() };
    };
    const dated = await ask([control()]);
    expect(dated.status).toBe(200);
    expect(dated.body.grossReceipts).toBe(DATED);

    for (const make of [() => added({ date: '' }), missingDate]) {
      const undated = await ask([control(), make()]);
      expect(undated.status).toBe(200);
      expect(undated.body.grossReceipts).toBe(DATED + ADDED);
      expect(namesRow(undated.body.calculationWarnings)).toBe(true);
      expect(undated.body.planner?.annualizedIncomeMethod?.available).not.toBe(true);
    }

    const tokyo = await ask([control(), added({ date: Timestamp.fromMillis(JST_NYE_2026), uploadTimeZone: 'Asia/Tokyo' })]);
    expect(tokyo.status).toBe(200);
    expect(tokyo.body.grossReceipts).toBe(DATED + ADDED);

    const prior = await ask([control(), added({ date: Timestamp.fromMillis(JUNE_2025) })]);
    expect(prior.status).toBe(200);
    expect(prior.body.grossReceipts).toBe(DATED);

    const disputed = await ask([control(), added({ date: Timestamp.fromMillis(JAN1_2026_05Z) })]);
    expect(disputed.status).toBe(200);
    expect(disputed.body.grossReceipts).toBe(DATED);
    expect(JSON.stringify(disputed.body.calculationWarnings)).toMatch(NMI);
  });
});
