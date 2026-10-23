import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PDFPage } from 'pdf-lib';
import { CATEGORY_MAP, aggregateScheduleC, type ScheduleCTransactionLike } from '@/lib/schedule-c/aggregate';
import { safeTaxYear } from '@/lib/schedule-c/taxDate';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { generateScheduleCPlanningPDF } from '@/lib/reports/schedule-c-pdf';
import { POST as scheduleCExport } from '@/app/api/tax/schedule-c/export/route';
import { GET as transactionsCsv } from '@/app/api/transactions/export-csv/route';
import { resetRateLimitStore } from './fixtures/rate-limit-store';

const harness = vi.hoisted(() => ({
  failWrites: false,
  uid: 'owner',
  authed: true,
  transactions: [] as ScheduleCTransactionLike[],
  csvTransactions: [] as Record<string, unknown>[],
  db: null as null | {
    records: Map<string, Record<string, unknown>>;
    collection: (name: string) => { add: (data: Record<string, unknown>) => Promise<unknown> };
  },
}));

vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('@/lib/firebase/api-auth', () => ({
  getAuthenticatedUser: async () => harness.authed
    ? { user: { uid: harness.uid }, error: null }
    : { user: null, error: 'Unauthorized' },
}));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => null }));
vi.mock('@/lib/firebase/profiles-server', () => ({
  getUserProfileServer: async () => ({ data: { name: 'Synthetic Taxpayer' }, error: null }),
}));
vi.mock('@/lib/reports/tax-export-transactions', () => ({
  readTaxExportTransactions: async () => harness.transactions,
}));
vi.mock('@/lib/reports/export-records', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/reports/export-records')>();
  return { ...actual, readOwnedTransactions: async () => harness.csvTransactions };
});
vi.mock('@/lib/firebase/admin', async () => {
  const { createFakeFirestore } = await import('./fixtures/fake-firestore');
  const db = createFakeFirestore();
  harness.db = db;
  return {
    adminDb: {
      collection(name: string) {
        const column = db.collection(name);
        const add = column.add.bind(column);
        column.add = async (data: Record<string, unknown>) => {
          if (harness.failWrites && name === 'user_export_records') throw new Error('export record store unavailable');
          return add(data);
        };
        return column;
      },
      doc: (path: string) => db.doc(path),
    },
  };
});

const CLOCK = new Date('2026-07-15T15:00:00.000Z');
const clock = () => CLOCK;

type GuardModule = {
  shouldHoldYear: (uid: string, year: number) => boolean;
  comparisonScreenWording: (year: number) => string;
  setScheduleCClockForTests: (next: (() => Date) | null) => void;
  setCurrentScheduleCRulesForTests: (rules: RuleSet | null) => void;
  decideScheduleCExport: (input: {
    uid: string;
    year: number;
    transactions: ScheduleCTransactionLike[];
    prior: { rulesVersion: string; lineTotals: { line: string; amount: number }[]; totalDeductible: number; charges: { id: string; line: string; amount: number }[] } | null;
    confirmedRulesVersion: string | null;
  }) => { held: boolean; totalDeductible: number; comparison: { notice: string; loweringRules: { reason: string; amount: number }[]; movedCharges: { id: string; reason: string }[]; lineChanges: { line: string; oldAmount: number; newAmount: number; change: number }[] } | null };
  frozenScheduleCRules: () => RuleSet;
  currentScheduleCRules: () => RuleSet;
  registerScheduleCRules: (rules: RuleSet) => void;
};

type RuleSet = {
  version: string;
  categoryMap: typeof CATEGORY_MAP;
  readDate: (value: unknown) => string | null;
  readYear: (value: unknown) => number | null;
  aggregate: typeof aggregateScheduleC;
};

async function loadGuard(): Promise<GuardModule> {
  const mod = await import('@/lib/schedule-c/export-lines');
  expect(typeof mod.shouldHoldYear).toBe('function');
  expect(typeof mod.setScheduleCClockForTests).toBe('function');
  expect(typeof mod.setCurrentScheduleCRulesForTests).toBe('function');
  expect(typeof mod.decideScheduleCExport).toBe('function');
  expect(typeof mod.frozenScheduleCRules).toBe('function');
  expect(typeof mod.currentScheduleCRules).toBe('function');
  expect(typeof mod.registerScheduleCRules).toBe('function');
  return mod as GuardModule;
}

const confirmed = (fields: ScheduleCTransactionLike): ScheduleCTransactionLike => ({
  review_status: 'confirmed', is_deductible: true, tax_review_required: false, merchant_name: 'Secret Merchant', ...fields,
});
const exportBody = (body: unknown) => new NextRequest('http://localhost/api/tax/schedule-c/export', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function savedExports(): Record<string, unknown>[] {
  const db = harness.db;
  expect(db).toBeTruthy();
  return [...db!.records.entries()].filter(([key]) => key.startsWith('user_export_records/')).map(([, value]) => value);
}
function capturePdf() {
  const spy = vi.spyOn(PDFPage.prototype, 'drawText');
  return {
    text: () => spy.mock.calls.map(call => String(call[0])).join('\n'),
    flat: () => spy.mock.calls.map(call => String(call[0])).join(' '),
  };
}
function subtotal(text: string): string {
  const lines = text.split('\n');
  const index = lines.indexOf('Confirmed expense subtotal only');
  expect(index).toBeGreaterThan(-1);
  return lines[index + 1];
}
function project(result: ReturnType<typeof aggregateScheduleC>) {
  return {
    totalExpenses: result.totalExpenses,
    totalDeductible: result.totalDeductible,
    counts: result.counts,
    lines: result.lineItemsArray.map(line => ({
      line: line.lineCode, name: line.lineName, total: line.total, deductible: line.deductible, count: line.transactionCount,
      charges: line.transactions.map(tx => ({ id: tx.id, amount: tx.amount, date: tx.date, category: tx.category })),
    })),
  };
}
function mealsRules(guard: GuardModule): RuleSet {
  const frozen = guard.frozenScheduleCRules();
  const categoryMap = { ...frozen.categoryMap, SERVICE_ADVERTISING: { line: '24b', name: 'Meals', code: '24b' } };
  return {
    version: 'v1', categoryMap, readDate: frozen.readDate, readYear: frozen.readYear,
    aggregate: (txs, year, map = categoryMap, options) => frozen.aggregate(txs, year, map, options),
  };
}
function shiftedDateRules(guard: GuardModule): RuleSet {
  const frozen = guard.frozenScheduleCRules();
  const readDate = (value: unknown) => {
    if (value === '1 January 2025') {
      const original = frozen.readDate(value);
      return original && original.startsWith('2024') ? '2025-01-01' : '2024-12-31';
    }
    return frozen.readDate(value);
  };
  const readYear = (value: unknown) => {
    const ymd = readDate(value);
    return ymd ? Number(ymd.slice(0, 4)) : null;
  };
  return {
    version: 'v1', categoryMap: frozen.categoryMap, readDate, readYear,
    aggregate: (txs, year, map = frozen.categoryMap, options) => frozen.aggregate(txs.map(tx => {
      const ymd = readDate(tx.date);
      return ymd ? { ...tx, date: ymd } : tx;
    }), year, map, options),
  };
}

beforeEach(async () => {
  resetRateLimitStore();
  harness.failWrites = false;
  harness.authed = true;
  harness.uid = 'owner';
  harness.transactions = [];
  harness.csvTransactions = [];
  harness.db?.records.clear();
  const mod = await import('@/lib/schedule-c/export-lines');
  if (typeof mod.setScheduleCClockForTests === 'function') mod.setScheduleCClockForTests(clock);
  if (typeof mod.setCurrentScheduleCRulesForTests === 'function') mod.setCurrentScheduleCRulesForTests(null);
});

describe('filed year guard', () => {
  const sample = (): ScheduleCTransactionLike[] => [
    confirmed({ id: 'fuel2024', amount: 10, date: '2024-06-01', category: 'TRANSPORTATION_FUEL' }),
    confirmed({ id: 'ad2025', amount: 100, date: '2025-06-01', category: 'SERVICE_ADVERTISING' }),
    confirmed({ id: 'meal2025', amount: 10.01, date: '2025-08-01', category: 'FOOD_AND_DRINK_RESTAURANT' }),
    confirmed({ id: 'refund2025', amount: -20, date: '2025-09-01', category: 'SERVICE_ADVERTISING' }),
    confirmed({ id: 'boundary', amount: 7, date: '1 January 2025', category: 'TRANSPORTATION_FUEL' }),
    confirmed({ id: 'office2026', amount: 40, date: '2026-03-01', category: 'SERVICE_SUBSCRIPTION' }),
  ];

  it('A. v0 and current rules match for 2024, 2025 and 2026', async () => {
    const guard = await loadGuard();
    expect(guard.shouldHoldYear('owner', 2025)).toBe(true);
    expect(() => guard.registerScheduleCRules({ ...guard.frozenScheduleCRules(), version: 'v0' })).toThrow(/frozen/);
    const frozen = guard.frozenScheduleCRules();
    const current = guard.currentScheduleCRules();
    expect(current.version).toBe('v0');
    expect(frozen.categoryMap).toEqual(CATEGORY_MAP);
    expect(current.categoryMap).toEqual(CATEGORY_MAP);
    for (const date of ['2024-01-01', '2025-12-31', '2026-01-01', '1 January 2025', '']) {
      expect(frozen.readYear(date)).toBe(current.readYear(date));
      expect(frozen.readDate(date)).toBe(current.readDate(date));
      expect(frozen.readYear(date)).toBe(safeTaxYear(date));
    }
    const transactions = sample();
    for (const year of [2024, 2025, 2026]) {
      const oldResult = frozen.aggregate(transactions, String(year), frozen.categoryMap, { mode: 'confirmed-only' });
      const newResult = current.aggregate(transactions, String(year), current.categoryMap, { mode: 'confirmed-only' });
      expect(project(oldResult)).toEqual(project(newResult));
      const oldCsv = generateScheduleCCSV(oldResult.lineItemsArray, year);
      const newCsv = generateScheduleCCSV(newResult.lineItemsArray, year);
      expect(oldCsv).toBe(newCsv);
      const shared = { taxYear: year, grossReceipts: 1000, name: 'Synthetic Taxpayer', includeAppendix: true, generatedAt: CLOCK };
      const oldPdf = await generateScheduleCPlanningPDF({ ...shared, lineItems: oldResult.lineItemsArray });
      const newPdf = await generateScheduleCPlanningPDF({ ...shared, lineItems: newResult.lineItemsArray });
      expect(Buffer.from(oldPdf).equals(Buffer.from(newPdf))).toBe(true);
    }
  });

  it('B. holds 2025 on v0 until the year is confirmed', async () => {
    const guard = await loadGuard();
    guard.setCurrentScheduleCRulesForTests(mealsRules(guard));
    harness.transactions = [confirmed({ id: 'ad1', amount: 100, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    const view = capturePdf();
    const response = await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }));
    expect(response.status).toBe(200);
    const text = view.flat();
    expect(subtotal(view.text())).toBe('$100.00');
    expect(text).toContain('your 2025 total under the rules at the time, on your current data');
    expect(text).toContain('awaiting copy approval');
    expect(text).toContain('line changed');
    expect(text).toContain('ad1');
    expect(text.toLowerCase()).not.toContain('what you filed');
    expect(text.slice(text.indexOf('awaiting copy approval'), text.indexOf('1 charge changed') + '1 charge changed because its line changed.'.length)).not.toMatch(/[-–—]/);
    const csvResponse = await scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
    const csv = await csvResponse.text();
    expect(csv).toContain('8,100.00,0.00,down 100.00');
    expect(csv).toContain('24b,0.00,50.00,up 50.00');
    expect(csv).toContain('ad1,line changed');
    const route = await import('@/app/api/tax/schedule-c/export/route');
    expect(typeof route.confirmTaxYear).toBe('function');
    const confirmedYear = await route.confirmTaxYear(exportBody({ uid: 'owner', year: 2025 }));
    expect(confirmedYear.status).toBe(200);
    expect(harness.db!.records.get('user_tax_year_confirmations/owner_2025')).toMatchObject({ uid: 'owner', year: 2025, rulesVersion: 'v1' });
    const after = capturePdf();
    const next = await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }));
    expect(next.status).toBe(200);
    expect(subtotal(after.text())).toBe('$50.00');
    expect(after.flat()).toContain('Meals');
    expect(after.flat()).not.toContain('awaiting copy approval');
  });

  it('C. keeps printed 2024 and 2025 totals until a moved date is confirmed', async () => {
    const guard = await loadGuard();
    const frozen = guard.frozenScheduleCRules();
    if (process.env.TZ === 'Asia/Tokyo') expect(safeTaxYear('1 January 2025')).toBe(2024);
    if (process.env.TZ === 'America/Los_Angeles') expect(safeTaxYear('1 January 2025')).toBe(2025);
    guard.setCurrentScheduleCRulesForTests(shiftedDateRules(guard));
    const current = guard.currentScheduleCRules();
    expect(frozen.readYear('1 January 2025')).not.toBe(current.readYear('1 January 2025'));
    harness.transactions = [
      confirmed({ id: 'y2024', amount: 10, date: '2024-06-01', category: 'TRANSPORTATION_FUEL' }),
      confirmed({ id: 'y2025', amount: 20, date: '2025-06-01', category: 'TRANSPORTATION_FUEL' }),
      confirmed({ id: 'boundary', amount: 80, date: '1 January 2025', category: 'SERVICE_ADVERTISING' }),
    ];
    for (const year of [2024, 2025]) {
      const expected = frozen.aggregate(harness.transactions, String(year), frozen.categoryMap, { mode: 'confirmed-only' }).totalDeductible;
      const shifted = current.aggregate(harness.transactions, String(year), current.categoryMap, { mode: 'confirmed-only' }).totalDeductible;
      expect(expected).not.toBe(shifted);
      const view = capturePdf();
      const response = await scheduleCExport(exportBody({ year, format: 'pdf', includeAppendix: false }));
      expect(response.status).toBe(200);
      expect(subtotal(view.text())).toBe(`$${expected.toFixed(2)}`);
      expect(view.flat()).toContain('boundary');
      expect(view.flat()).toContain('date read differently');
      expect(view.flat()).not.toContain('what you filed');
    }
    const route = await import('@/app/api/tax/schedule-c/export/route');
    expect(typeof route.confirmTaxYear).toBe('function');
    for (const year of [2024, 2025]) {
      expect((await route.confirmTaxYear(exportBody({ year }))).status).toBe(200);
      const expected = current.aggregate(harness.transactions, String(year), current.categoryMap, { mode: 'confirmed-only' }).totalDeductible;
      const view = capturePdf();
      expect((await scheduleCExport(exportBody({ year, format: 'pdf', includeAppendix: false }))).status).toBe(200);
      expect(subtotal(view.text())).toBe(`$${expected.toFixed(2)}`);
    }
  });

  it('D. a 2026 export uses the current rules with no hold', async () => {
    const guard = await loadGuard();
    expect(guard.shouldHoldYear('owner', 2026)).toBe(true);
    guard.setCurrentScheduleCRulesForTests(mealsRules(guard));
    harness.transactions = [confirmed({ id: 'now1', amount: 100, date: '2026-03-01', category: 'SERVICE_ADVERTISING' })];
    const view = capturePdf();
    const response = await scheduleCExport(exportBody({ year: 2026, format: 'pdf', includeAppendix: false }));
    expect(response.status).toBe(200);
    expect(subtotal(view.text())).toBe('$50.00');
    expect(view.flat()).toContain('Meals');
    expect(view.flat()).not.toContain('awaiting copy approval');
    expect(view.flat()).not.toContain('line changed');
  });

  it('E. records each download once, survives a failed write, and confirms only the signed in user', async () => {
    const guard = await loadGuard();
    expect(existsSync(new URL('../app/api/tax/schedule-c/confirm/route.ts', import.meta.url))).toBe(true);
    const route = await import('@/app/api/tax/schedule-c/export/route');
    expect(typeof route.confirmTaxYear).toBe('function');
    harness.transactions = [confirmed({ id: 'fee1', amount: 30, date: '2025-04-01', category: 'BANK_FEES_ATM_FEES' })];
    harness.csvTransactions = [{ id: 'fee1', amount: 30, date: '2025-04-01', category: 'BANK_FEES_ATM_FEES', is_deductible: true, merchant_name: 'Secret Merchant' }];
    const pdf = await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }));
    expect(pdf.status).toBe(200);
    const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
    expect(savedExports()).toHaveLength(1);
    expect(savedExports()[0]).toMatchObject({
      uid: 'owner', kind: 'schedule-c-pdf', taxYear: 2025, rulesVersion: 'v0', totalDeductible: 30,
      exportedAt: CLOCK.toISOString(), sha256: hash(pdfBytes),
      lineTotals: [{ line: '10', amount: 30 }], charges: [{ id: 'fee1', line: '10', amount: 30 }],
    });
    expect(JSON.stringify(savedExports()[0])).not.toContain('Secret Merchant');
    expect(Object.keys((savedExports()[0].charges as Record<string, unknown>[])[0]).sort()).toEqual(['amount', 'id', 'line']);
    const csv = await scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
    expect(csv.status).toBe(200);
    const csvText = await csv.text();
    expect(savedExports()).toHaveLength(2);
    expect(savedExports()[1]).toMatchObject({ kind: 'schedule-c-csv', sha256: hash(csvText), charges: [{ id: 'fee1', line: '10', amount: 30 }] });
    const transactions = await transactionsCsv(new NextRequest('http://localhost/api/transactions/export-csv?year=2025'));
    expect(transactions.status).toBe(200);
    const transactionsText = await transactions.text();
    expect(savedExports()).toHaveLength(3);
    expect(savedExports()[2]).toMatchObject({
      uid: 'owner', kind: 'transactions-csv', taxYear: 2025, sha256: hash(transactionsText),
      charges: [{ id: 'fee1', line: '10', amount: 30 }],
    });
    expect(JSON.stringify(savedExports()[2])).not.toContain('Secret Merchant');
    harness.failWrites = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
    expect(failed.status).toBe(200);
    expect(await failed.text()).toContain('BANK_FEES_ATM_FEES');
    expect(savedExports()).toHaveLength(3);
    expect(error).toHaveBeenCalledWith('Export record write failed', expect.any(Error));
    harness.failWrites = false;
    harness.authed = false;
    expect((await route.confirmTaxYear(exportBody({ year: 2025 }))).status).toBe(401);
    harness.authed = true;
    const rejected = await route.confirmTaxYear(exportBody({ uid: 'someone-else', year: 2025 }));
    expect(rejected.status).toBe(403);
    expect([...harness.db!.records.keys()].some(key => key.startsWith('user_tax_year_confirmations/'))).toBe(false);
    const accepted = await route.confirmTaxYear(exportBody({ uid: 'owner', year: 2025 }));
    expect(accepted.status).toBe(200);
    expect(harness.db!.records.get('user_tax_year_confirmations/owner_2025')).toEqual({
      uid: 'owner', year: 2025, rulesVersion: guard.currentScheduleCRules().version, confirmedAt: CLOCK.toISOString(),
    });
  });

  it('F. compares a later download with the stored export after a charge changes', async () => {
    const guard = await loadGuard();
    const charge = confirmed({ id: 'resync', amount: 100, date: '2025-05-01', category: 'SERVICE_ADVERTISING' });
    harness.transactions = [charge];
    const first = capturePdf();
    expect((await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }))).status).toBe(200);
    expect(subtotal(first.text())).toBe('$100.00');
    expect(savedExports()[0]).toMatchObject({ totalDeductible: 100, charges: [{ id: 'resync', line: '8', amount: 100 }] });
    charge.amount = 250;
    const recomputed = guard.frozenScheduleCRules().aggregate(harness.transactions, '2025', CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible;
    expect(recomputed).toBe(250);
    const second = capturePdf();
    const response = await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }));
    expect(response.status).toBe(200);
    const flat = second.flat();
    expect(subtotal(second.text())).toBe('$100.00');
    expect(flat).toContain('resync');
    expect(flat).toContain('amount changed');
    expect(flat).toContain('changed since export');
    expect(flat).toContain('That total was $100.00');
    expect(flat).toContain('The total under the current rules is $250.00');
    expect(flat).not.toContain('your 2025 total under the rules at the time, on your current data');
    expect(flat.toLowerCase()).not.toContain('what you filed');
    expect(flat).toContain('awaiting copy approval');
  });

  it('names a charge moved to Needs more information once', async () => {
    const guard = await loadGuard();
    const frozen = guard.frozenScheduleCRules();
    const categoryMap = { ...frozen.categoryMap, SERVICE_ADVERTISING: { line: 'Needs more information', name: 'Needs more information', code: 'Needs more information' } };
    guard.setCurrentScheduleCRulesForTests({
      version: 'v1', categoryMap, readDate: frozen.readDate, readYear: frozen.readYear,
      aggregate: (txs, year, map = categoryMap, options) => frozen.aggregate(txs, year, map, options),
    });
    const decision = guard.decideScheduleCExport({
      uid: 'owner', year: 2025, confirmedRulesVersion: null, prior: null,
      transactions: [confirmed({ id: 'inflow1', amount: -40, date: '2025-02-01', category: 'SERVICE_ADVERTISING' })],
    });
    expect(decision.comparison?.movedCharges).toEqual([{ id: 'inflow1', reason: 'moved to Needs more information' }]);
    expect(decision.comparison?.notice).toContain('awaiting copy approval');
    expect(decision.comparison?.notice).not.toContain('what you filed');
    expect(decision.comparison?.notice).not.toMatch(/[-–—]/);
  });

  it('lists each rule that lowers 2025 on its own line', async () => {
    const guard = await loadGuard();
    expect(typeof guard.comparisonScreenWording).toBe('function');
    expect(guard.comparisonScreenWording(2025)).toBe('your 2025 total under the rules at the time, on your current data');
    const frozen = guard.frozenScheduleCRules();
    const categoryMap = { ...frozen.categoryMap, SERVICE_ADVERTISING: { line: '24b', name: 'Meals', code: '24b' } };
    const readDate = (value: unknown) => value === '2025-04-01' ? '2024-04-01' : frozen.readDate(value);
    const readYear = (value: unknown) => {
      const ymd = readDate(value);
      return ymd ? Number(ymd.slice(0, 4)) : null;
    };
    guard.setCurrentScheduleCRulesForTests({
      version: 'v1', categoryMap, readDate, readYear,
      aggregate: (txs, year, map = categoryMap, options) => frozen.aggregate(txs.map(tx => (
        tx.date === '2025-04-01' ? { ...tx, date: '2024-04-01' } : tx
      )), year, map, options),
    });
    harness.transactions = [
      confirmed({ id: 'ad', amount: 100, date: '2025-06-01', category: 'SERVICE_ADVERTISING' }),
      confirmed({ id: 'fuel', amount: 30, date: '2025-04-01', category: 'TRANSPORTATION_FUEL' }),
    ];
    const decision = guard.decideScheduleCExport({
      uid: 'owner', year: 2025, confirmedRulesVersion: null, prior: null, transactions: harness.transactions,
    });
    expect(decision.comparison?.loweringRules).toEqual([
      { reason: 'line changed', amount: 50 },
      { reason: 'date read differently', amount: 30 },
    ]);
    const notice = decision.comparison?.notice ?? '';
    expect(notice).toContain('draft, awaiting copy approval');
    expect(notice).toContain('your 2025 total under the rules at the time, on your current data');
    expect(notice).toContain('Line changed lowered the total by $50.00.');
    expect(notice).toContain('Date read differently lowered the total by $30.00.');
    expect(notice).not.toContain('lowered the total by $80.00');
    expect(notice.toLowerCase()).not.toContain('what you filed');
    expect(notice.toLowerCase()).not.toContain('amend');
    const view = capturePdf();
    expect((await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }))).status).toBe(200);
    const flat = view.flat();
    expect(flat).toContain('draft, awaiting copy approval');
    expect(flat).toContain('Line changed lowered the total by $50.00.');
    expect(flat).toContain('Date read differently lowered the total by $30.00.');
    expect(flat).not.toContain('lowered the total by $80.00');
    expect(flat.toLowerCase()).not.toContain('what you filed');
    expect(flat.toLowerCase()).not.toContain('amend');
  });

  it('G. a 2025 export keeps the old total and the moved charge list until confirm', async () => {
    const guard = await loadGuard();
    expect(savedExports()).toHaveLength(0);
    expect(guard.shouldHoldYear('owner', 2025)).toBe(true);
    const frozen = guard.frozenScheduleCRules();
    const categoryMap = { ...frozen.categoryMap, SERVICE_ADVERTISING: { line: '24b', name: 'Meals', code: '24b' } };
    guard.setCurrentScheduleCRulesForTests({
      version: 'v1', categoryMap, readDate: frozen.readDate, readYear: frozen.readYear,
      aggregate: (txs, year, map = categoryMap, options) => frozen.aggregate(txs, year, map, options),
    });
    harness.transactions = [confirmed({ id: 'ad1', amount: 100, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    const first = capturePdf();
    expect((await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }))).status).toBe(200);
    expect(subtotal(first.text())).toBe('$100.00');
    expect(first.flat()).toContain('ad1');
    expect(first.flat()).toContain('line changed');
    expect(savedExports()).toHaveLength(1);
    expect(guard.shouldHoldYear('owner', 2025)).toBe(true);
    const prior = {
      rulesVersion: String(savedExports()[0].rulesVersion),
      lineTotals: savedExports()[0].lineTotals as { line: string; amount: number }[],
      totalDeductible: Number(savedExports()[0].totalDeductible),
      charges: savedExports()[0].charges as { id: string; line: string; amount: number }[],
    };
    const stillHeld = guard.decideScheduleCExport({
      uid: 'owner', year: 2025, transactions: harness.transactions, prior, confirmedRulesVersion: null,
    });
    expect(stillHeld.held).toBe(true);
    expect(stillHeld.totalDeductible).toBe(100);
    expect(stillHeld.comparison?.movedCharges).toEqual([{ id: 'ad1', reason: 'line changed' }]);
    const second = capturePdf();
    expect((await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }))).status).toBe(200);
    expect(subtotal(second.text())).toBe('$100.00');
    expect(second.flat()).toContain('ad1');
    expect(second.flat()).toContain('line changed');
    expect(savedExports()).toHaveLength(2);
    expect(guard.shouldHoldYear('owner', 2025)).toBe(true);
    const route = await import('@/app/api/tax/schedule-c/export/route');
    expect((await route.confirmTaxYear(exportBody({ uid: 'owner', year: 2025 }))).status).toBe(200);
    const confirmedView = capturePdf();
    expect((await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }))).status).toBe(200);
    expect(subtotal(confirmedView.text())).toBe('$50.00');
    expect(confirmedView.flat()).not.toContain('awaiting copy approval');
  });
});
