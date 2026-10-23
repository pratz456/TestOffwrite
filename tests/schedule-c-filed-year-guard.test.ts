import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PDFPage } from 'pdf-lib';
import { CATEGORY_MAP, aggregateScheduleC, type ScheduleCTransactionLike } from '@/lib/schedule-c/aggregate';
import { safeTaxYear } from '@/lib/schedule-c/taxDate';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { generateScheduleCPlanningPDF } from '@/lib/reports/schedule-c-pdf';
import { confirmTaxYear, POST as scheduleCExport } from '@/app/api/tax/schedule-c/export/route';
import { GET as readFiledYear } from '@/app/api/tax/schedule-c/filed-year/route';
import { GET as transactionsCsv } from '@/app/api/transactions/export-csv/route';
import { POST as userDataExport } from '@/app/api/user/export/route';
import { GET as planningPdf } from '@/app/api/reports/profit-loss/route';
import {
  comparisonScreenWording,
  currentScheduleCRules,
  decideScheduleCExport,
  frozenScheduleCRules,
  registerScheduleCRules,
  setCurrentScheduleCRulesForTests,
  setScheduleCClockForTests,
  shouldHoldYear,
} from '@/lib/schedule-c/filed-year';
import { readHeldYearExport, readLatestExportRecord } from '@/lib/schedule-c/export-record';
import { resetRateLimitStore } from './fixtures/rate-limit-store';

const harness = vi.hoisted(() => ({
  failWrites: false,
  failPending: false,
  failReservation: false,
  throwBuild: false,
  recordWriteDelayMs: 0,
  recordWriteRejectAfterMs: 0,
  reservationDelayMs: 0,
  markerWriteDelayMs: 0,
  beforeRecordWrite: null as null | (() => Promise<void>),
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
vi.mock('@/lib/reports/schedule-c-csv', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/reports/schedule-c-csv')>();
  return {
    ...actual,
    generateScheduleCCSV: (...args: Parameters<typeof actual.generateScheduleCCSV>) => {
      if (harness.throwBuild) throw new Error('csv build failed');
      return actual.generateScheduleCCSV(...args);
    },
  };
});
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
        const open = column.doc.bind(column);
        column.doc = (id?: string) => {
          const document = open(id);
          const write = document.set.bind(document);
          document.set = async (data: Record<string, unknown>) => {
            if (name === 'user_export_pending' && harness.failPending) throw new Error('pending marker store unavailable');
            if (name === 'user_export_pending' && harness.markerWriteDelayMs > 0) {
              await new Promise(resolve => setTimeout(resolve, harness.markerWriteDelayMs));
            }
            return write(data);
          };
          return document;
        };
        return column;
      },
      doc: (path: string) => db.doc(path),
      runTransaction(work: (tx: unknown) => Promise<unknown>) {
        let delayedReservation = false;
        return db.runTransaction(async (tx: { get: (target: { path?: string }) => Promise<unknown>; set: (target: unknown, data: Record<string, unknown>, options?: { merge?: boolean }) => unknown; delete: (target: unknown) => unknown }) => {
          const wrapped = {
            get: async (target: { path?: string }) => {
              const path = typeof target?.path === 'string' ? target.path : '';
              if (path.startsWith('user_export_sequences/')) {
                if (harness.failReservation) throw new Error('export sequence reservation failed');
                if (harness.reservationDelayMs > 0 && !delayedReservation) {
                  delayedReservation = true;
                  await new Promise(resolve => setTimeout(resolve, harness.reservationDelayMs));
                }
              }
              if (path === 'user_export_pending') {
                if (harness.beforeRecordWrite) await harness.beforeRecordWrite();
                if (harness.recordWriteRejectAfterMs > 0) {
                  await new Promise(resolve => setTimeout(resolve, harness.recordWriteRejectAfterMs));
                  throw new Error('export record store unavailable');
                }
                if (harness.failWrites) throw new Error('export record store unavailable');
                if (harness.recordWriteDelayMs > 0) {
                  await new Promise(resolve => setTimeout(resolve, harness.recordWriteDelayMs));
                }
              }
              return tx.get(target);
            },
            set: (target: unknown, data: Record<string, unknown>, options?: { merge?: boolean }) => tx.set(target, data, options),
            delete: (target: unknown) => tx.delete(target),
          };
          return work(wrapped);
        });
      },
    },
  };
});

const CLOCK = new Date('2026-07-15T15:00:00.000Z');
const clock = () => CLOCK;

type RuleSet = {
  version: string;
  categoryMap: typeof CATEGORY_MAP;
  readDate: (value: unknown) => string | null;
  readYear: (value: unknown) => number | null;
  aggregate: typeof aggregateScheduleC;
};

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
function pendingMarkers(): Record<string, unknown>[] {
  const db = harness.db;
  expect(db).toBeTruthy();
  return [...db!.records.entries()].filter(([key]) => key.startsWith('user_export_pending/')).map(([, value]) => value);
}
function seedCounter(next: number, year = 2025, uid = 'owner') {
  const id = createHash('sha256').update(`${uid}\0${year}`).digest('hex');
  harness.db!.records.set(`user_export_sequences/${id}`, { uid, taxYear: year, next });
}
function counterNext(): unknown[] {
  return [...harness.db!.records.entries()].filter(([key]) => key.startsWith('user_export_sequences/')).map(([, value]) => value.next);
}
async function saveExportLog(id: string, kind: string, totalDeductible: number, chargeId: string, exportedAt = CLOCK.toISOString(), exportSequence?: number) {
  const { adminDb } = await import('@/lib/firebase/admin');
  await adminDb.collection('user_export_records').doc(id).set({
    uid: 'owner', kind, taxYear: 2025, rulesVersion: 'v0', exportedAt, sha256: id,
    lineTotals: [{ line: '8', amount: totalDeductible }],
    totalDeductible,
    charges: [{ id: chargeId, line: '8', amount: totalDeductible }],
    ...(exportSequence === undefined ? {} : { exportSequence }),
  });
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
function mealsRules(): RuleSet {
  const frozen = frozenScheduleCRules();
  const categoryMap = { ...frozen.categoryMap, SERVICE_ADVERTISING: { line: '24b', name: 'Meals', code: '24b' } };
  return {
    version: 'v1', categoryMap, readDate: frozen.readDate, readYear: frozen.readYear,
    aggregate: (txs, year, map = categoryMap, options) => frozen.aggregate(txs, year, map, options),
  };
}
function shiftedDateRules(): RuleSet {
  const frozen = frozenScheduleCRules();
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
  harness.failPending = false;
  harness.failReservation = false;
  harness.throwBuild = false;
  harness.recordWriteDelayMs = 0;
  harness.recordWriteRejectAfterMs = 0;
  harness.reservationDelayMs = 0;
  harness.markerWriteDelayMs = 0;
  harness.beforeRecordWrite = null;
  vi.useRealTimers();
  harness.authed = true;
  harness.uid = 'owner';
  harness.transactions = [];
  harness.csvTransactions = [];
  harness.db?.records.clear();
  setScheduleCClockForTests(clock);
  setCurrentScheduleCRulesForTests(null);
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
      expect(shouldHoldYear('owner', 2025)).toBe(true);
      expect(() => registerScheduleCRules({ ...frozenScheduleCRules(), version: 'v0' })).toThrow(/frozen/);
      const frozen = frozenScheduleCRules();
      const current = currentScheduleCRules();
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
    harness.transactions = [confirmed({ id: 'ad2025', amount: 100, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    expect((await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }))).status).toBe(200);
    expect(savedExports()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'schedule-c-pdf', taxYear: 2025, rulesVersion: 'v0', totalDeductible: 100 }),
    ]));
  });

  it('B. holds 2025 on v0 until the year is confirmed', async () => {
    setCurrentScheduleCRulesForTests(mealsRules());
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
    const confirmedYear = await confirmTaxYear(exportBody({ uid: 'owner', year: 2025 }));
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
    if (process.env.TZ === 'Asia/Tokyo') expect(safeTaxYear('1 January 2025')).toBe(2024);
    if (process.env.TZ === 'America/Los_Angeles') expect(safeTaxYear('1 January 2025')).toBe(2025);
    const frozen = frozenScheduleCRules();
    setCurrentScheduleCRulesForTests(shiftedDateRules());
    const current = currentScheduleCRules();
    expect(frozen.readYear('1 January 2025')).not.toBe(current.readYear('1 January 2025'));
    harness.transactions = [
      confirmed({ id: 'y2024', amount: 10, date: '2024-06-01', category: 'TRANSPORTATION_FUEL' }),
      confirmed({ id: 'y2025', amount: 20, date: '2025-06-01', category: 'TRANSPORTATION_FUEL' }),
      confirmed({ id: 'boundary', amount: 80, date: '1 January 2025', category: 'SERVICE_ADVERTISING' }),
    ];
    for (const year of [2024, 2025]) {
      const view = capturePdf();
      const response = await scheduleCExport(exportBody({ year, format: 'pdf', includeAppendix: false }));
      expect(response.status).toBe(200);
      const expected = frozen.aggregate(harness.transactions, String(year), frozen.categoryMap, { mode: 'confirmed-only' }).totalDeductible;
      const shifted = current.aggregate(harness.transactions, String(year), current.categoryMap, { mode: 'confirmed-only' }).totalDeductible;
      expect(expected).not.toBe(shifted);
      expect(subtotal(view.text())).toBe(`$${expected.toFixed(2)}`);
      expect(view.flat()).toContain('boundary');
      expect(view.flat()).toContain('date read differently');
      expect(view.flat()).not.toContain('what you filed');
    }
    for (const year of [2024, 2025]) {
      expect((await confirmTaxYear(exportBody({ year }))).status).toBe(200);
      const expected = current.aggregate(harness.transactions, String(year), current.categoryMap, { mode: 'confirmed-only' }).totalDeductible;
      const view = capturePdf();
      expect((await scheduleCExport(exportBody({ year, format: 'pdf', includeAppendix: false }))).status).toBe(200);
      expect(subtotal(view.text())).toBe(`$${expected.toFixed(2)}`);
    }
  });

  it('D. a 2026 export uses the current rules with no hold', async () => {
    expect(shouldHoldYear('owner', 2026)).toBe(true);
    setCurrentScheduleCRulesForTests(mealsRules());
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
    const beforeTransactions = savedExports().length;
    const transactions = await transactionsCsv(new NextRequest('http://localhost/api/transactions/export-csv?year=2025'));
    expect(transactions.status).toBe(200);
    expect(await transactions.text()).toContain('BANK_FEES_ATM_FEES');
    expect(savedExports()).toHaveLength(beforeTransactions);
    expect(savedExports().some(row => row.kind === 'transactions-csv')).toBe(false);
    harness.failWrites = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
    expect(failed.status).toBe(200);
    expect(await failed.text()).toContain('BANK_FEES_ATM_FEES');
    expect(savedExports()).toHaveLength(beforeTransactions);
    expect(error).toHaveBeenCalledWith('Export record write failed', expect.any(Error));
    harness.failWrites = false;
    harness.authed = false;
    expect((await confirmTaxYear(exportBody({ year: 2025 }))).status).toBe(401);
    harness.authed = true;
    const rejected = await confirmTaxYear(exportBody({ uid: 'someone-else', year: 2025 }));
    expect(rejected.status).toBe(403);
    expect([...harness.db!.records.keys()].some(key => key.startsWith('user_tax_year_confirmations/'))).toBe(false);
    const accepted = await confirmTaxYear(exportBody({ uid: 'owner', year: 2025 }));
    expect(accepted.status).toBe(200);
    expect(harness.db!.records.get('user_tax_year_confirmations/owner_2025')).toEqual({
      uid: 'owner', year: 2025, rulesVersion: currentScheduleCRules().version, confirmedAt: CLOCK.toISOString(),
    });
  });

  it('F. compares a later download with the stored export after a charge changes', async () => {
    const charge = confirmed({ id: 'resync', amount: 100, date: '2025-05-01', category: 'SERVICE_ADVERTISING' });
    harness.transactions = [charge];
    const first = capturePdf();
    expect((await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }))).status).toBe(200);
    expect(subtotal(first.text())).toBe('$100.00');
    expect(savedExports()[0]).toMatchObject({ totalDeductible: 100, charges: [{ id: 'resync', line: '8', amount: 100 }] });
    charge.amount = 250;
    const recomputed = frozenScheduleCRules().aggregate(harness.transactions, '2025', CATEGORY_MAP, { mode: 'confirmed-only' }).totalDeductible;
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
    const frozen = frozenScheduleCRules();
    const categoryMap = { ...frozen.categoryMap, SERVICE_ADVERTISING: { line: 'Needs more information', name: 'Needs more information', code: 'Needs more information' } };
    setCurrentScheduleCRulesForTests({
      version: 'v1', categoryMap, readDate: frozen.readDate, readYear: frozen.readYear,
      aggregate: (txs, year, map = categoryMap, options) => frozen.aggregate(txs, year, map, options),
    });
    const moved = [confirmed({ id: 'inflow1', amount: -40, date: '2025-02-01', category: 'SERVICE_ADVERTISING' })];
    harness.transactions = moved;
    const view = capturePdf();
    expect((await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }))).status).toBe(200);
    const flat = view.flat();
    expect(flat).toContain('inflow1');
    expect(flat).toContain('moved to Needs more information');
    expect(flat).not.toContain('what you filed');
    const decision = decideScheduleCExport({
      uid: 'owner', year: 2025, confirmedRulesVersion: null, prior: null, transactions: moved,
    });
    const comparison = decision.comparison;
    expect(comparison).toBeTruthy();
    expect(comparison!.movedCharges).toEqual([{ id: 'inflow1', reason: 'moved to Needs more information' }]);
    expect(comparison!.notice).toContain('awaiting copy approval');
    expect(comparison!.notice).not.toMatch(/[-–—]/);
  });

  it('lists each rule that lowers 2025 on its own line', async () => {
    const frozen = frozenScheduleCRules();
    const categoryMap = { ...frozen.categoryMap, SERVICE_ADVERTISING: { line: '24b', name: 'Meals', code: '24b' } };
    const readDate = (value: unknown) => value === '2025-04-01' ? '2024-04-01' : frozen.readDate(value);
    const readYear = (value: unknown) => {
      const ymd = readDate(value);
      return ymd ? Number(ymd.slice(0, 4)) : null;
    };
    setCurrentScheduleCRulesForTests({
      version: 'v1', categoryMap, readDate, readYear,
      aggregate: (txs, year, map = categoryMap, options) => frozen.aggregate(txs.map(tx => (
        tx.date === '2025-04-01' ? { ...tx, date: '2024-04-01' } : tx
      )), year, map, options),
    });
    harness.transactions = [
      confirmed({ id: 'ad', amount: 100, date: '2025-06-01', category: 'SERVICE_ADVERTISING' }),
      confirmed({ id: 'fuel', amount: 30, date: '2025-04-01', category: 'TRANSPORTATION_FUEL' }),
    ];
    const view = capturePdf();
    expect((await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }))).status).toBe(200);
    const flat = view.flat();
    expect(flat).toContain('draft, awaiting copy approval');
    expect(flat).toContain('Line changed lowered the total by $50.00.');
    expect(flat).toContain('Date read differently lowered the total by $30.00.');
    expect(flat).not.toContain('lowered the total by $80.00');
    expect(flat.toLowerCase()).not.toContain('what you filed');
    expect(flat.toLowerCase()).not.toContain('amend');
    expect(comparisonScreenWording(2025)).toBe('your 2025 total under the rules at the time, on your current data');
    const decision = decideScheduleCExport({
      uid: 'owner', year: 2025, confirmedRulesVersion: null, prior: null, transactions: harness.transactions,
    });
    const comparison = decision.comparison;
    expect(comparison).toBeTruthy();
    expect(comparison!.loweringRules).toEqual([
      { reason: 'line changed', amount: 50 },
      { reason: 'date read differently', amount: 30 },
    ]);
    expect(comparison!.notice).toContain('your 2025 total under the rules at the time, on your current data');
    expect(comparison!.notice).toContain('Line changed lowered the total by $50.00.');
    expect(comparison!.notice).toContain('Date read differently lowered the total by $30.00.');
    expect(comparison!.notice).not.toContain('lowered the total by $80.00');
  });

  it('G. a 2025 export keeps the old total and the moved charge list until confirm', async () => {
    expect(savedExports()).toHaveLength(0);
    expect(shouldHoldYear('owner', 2025)).toBe(true);
    setCurrentScheduleCRulesForTests(mealsRules());
    harness.transactions = [confirmed({ id: 'ad1', amount: 100, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    const first = capturePdf();
    expect((await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }))).status).toBe(200);
    expect(first.flat()).toContain('line changed');
    expect(subtotal(first.text())).toBe('$100.00');
    expect(first.flat()).toContain('ad1');
    expect(savedExports()).toHaveLength(1);
    expect(shouldHoldYear('owner', 2025)).toBe(true);
    const prior = {
      rulesVersion: String(savedExports()[0].rulesVersion),
      lineTotals: savedExports()[0].lineTotals as { line: string; amount: number }[],
      totalDeductible: Number(savedExports()[0].totalDeductible),
      charges: savedExports()[0].charges as { id: string; line: string; amount: number }[],
    };
    const stillHeld = decideScheduleCExport({
      uid: 'owner', year: 2025, transactions: harness.transactions, prior, confirmedRulesVersion: null,
    });
    expect(stillHeld.held).toBe(true);
    expect(stillHeld.totalDeductible).toBe(100);
    const moved = stillHeld.comparison;
    expect(moved).toBeTruthy();
    expect(moved!.movedCharges).toEqual([{ id: 'ad1', reason: 'line changed' }]);
    const second = capturePdf();
    expect((await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }))).status).toBe(200);
    expect(second.flat()).toContain('line changed');
    expect(subtotal(second.text())).toBe('$100.00');
    expect(second.flat()).toContain('ad1');
    expect(savedExports()).toHaveLength(2);
    expect(shouldHoldYear('owner', 2025)).toBe(true);
    expect((await confirmTaxYear(exportBody({ uid: 'owner', year: 2025 }))).status).toBe(200);
    const confirmedView = capturePdf();
    expect((await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }))).status).toBe(200);
    expect(subtotal(confirmedView.text())).toBe('$50.00');
    expect(confirmedView.flat()).not.toContain('awaiting copy approval');
  });

  it('keeps the held 2025 total after a filtered transactions CSV, a data export, and a planning PDF', async () => {
    const charge = confirmed({ id: 'ad1', amount: 100, date: '2025-06-01', category: 'SERVICE_ADVERTISING' });
    harness.transactions = [charge];
    harness.csvTransactions = [{
      id: 'ad1', amount: 100, date: '2025-06-01', category: 'SERVICE_ADVERTISING',
      is_deductible: true, iso_currency_code: 'USD', merchant_name: 'Secret Merchant',
    }];
    const first = capturePdf();
    expect((await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }))).status).toBe(200);
    expect(subtotal(first.text())).toBe('$100.00');
    expect(savedExports()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'schedule-c-pdf', taxYear: 2025, totalDeductible: 100 }),
    ]));
    charge.amount = 250;
    const beforeFiltered = savedExports().map(row => ({ ...row }));
    const filtered = await transactionsCsv(new NextRequest('http://localhost/api/transactions/export-csv?year=2025&filter=non-deductible'));
    expect(filtered.status).toBe(200);
    expect(savedExports()).toEqual(beforeFiltered);
    const archive = await userDataExport(exportBody({ year: 2025 }));
    expect(archive.status).toBe(200);
    const planning = await planningPdf(new NextRequest('http://localhost/api/reports/profit-loss?format=pdf&year=2025'));
    expect(planning.status).toBe(200);
    expect(planning.headers.get('content-type')).toContain('application/pdf');
    expect(savedExports()).toEqual(beforeFiltered);
    const scheduleCExportedAt = String(savedExports().find(row => row.kind === 'schedule-c-pdf')?.exportedAt ?? '');
    const laterThanScheduleC = '2026-07-15T16:00:00.000Z';
    expect(laterThanScheduleC > scheduleCExportedAt).toBe(true);
    expect(savedExports().some(row => row.kind === 'data-export' || row.kind === 'planning-pdf')).toBe(false);
    const { adminDb } = await import('@/lib/firebase/admin');
    await adminDb.collection('user_export_records').doc('aaa-missing-kind').set({
      uid: 'owner', taxYear: 2025, rulesVersion: 'v0', exportedAt: laterThanScheduleC, sha256: 'missing-kind',
      lineTotals: [{ line: '8', amount: 0 }], totalDeductible: 0,
      charges: [{ id: 'stray', line: '8', amount: 0 }],
    });
    const nextPdf = capturePdf();
    expect((await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }))).status).toBe(200);
    expect(subtotal(nextPdf.text())).toBe('$100.00');
    const csv = await (await scheduleCExport(exportBody({ year: 2025, format: 'csv' }))).text();
    expect(csv).toContain('SERVICE_ADVERTISING,8,100,100');
    const csvRecord = savedExports().find(row => row.kind === 'schedule-c-csv');
    const pdfRecord = savedExports().find(row => row.kind === 'schedule-c-pdf');
    expect(csvRecord?.totalDeductible).toBe(100);
    expect(csvRecord?.exportedAt).toBe(scheduleCExportedAt);
    expect(Number(csvRecord?.exportSequence)).toBeGreaterThan(Number(pdfRecord?.exportSequence));
    expect(laterThanScheduleC > String(csvRecord?.exportedAt ?? '')).toBe(true);
    const scheduleC = savedExports().filter(row => row.kind === 'schedule-c-pdf' || row.kind === 'schedule-c-csv');
    expect(scheduleC.length).toBeGreaterThan(1);
    expect(scheduleC.every(row => row.totalDeductible === 100)).toBe(true);
    expect(savedExports().some(row => row.kind === undefined && row.totalDeductible === 0 && row.exportedAt === laterThanScheduleC)).toBe(true);
  });

  it('a saved older rules version leaves the 2025 export held', async () => {
    setCurrentScheduleCRulesForTests(mealsRules());
    const { adminDb } = await import('@/lib/firebase/admin');
    await adminDb.collection('user_tax_year_confirmations').doc('owner_2025').set({
      uid: 'owner', year: 2025, rulesVersion: 'v0', confirmedAt: CLOCK.toISOString(),
    });
    const read = await readFiledYear(new NextRequest('http://localhost/api/tax/schedule-c/filed-year?year=2025'));
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ confirmedRulesVersion: 'v0' });
    harness.transactions = [confirmed({ id: 'ad1', amount: 100, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    const view = capturePdf();
    expect((await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }))).status).toBe(200);
    expect(subtotal(view.text())).toBe('$100.00');
    expect(view.flat()).toContain('awaiting copy approval');
    expect(view.flat()).not.toContain('Meals');
  });

  it('a transactions CSV download writes no export record', async () => {
    harness.csvTransactions = [{
      id: 'fee1', amount: 30, date: '2025-04-01', category: 'BANK_FEES_ATM_FEES',
      is_deductible: true, merchant_name: 'Secret Merchant',
    }];
    const before = savedExports().map(row => ({ ...row }));
    const response = await transactionsCsv(new NextRequest('http://localhost/api/transactions/export-csv?year=2025'));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('BANK_FEES_ATM_FEES');
    expect(savedExports()).toEqual(before);
    expect(savedExports().some(row => row.kind === 'transactions-csv')).toBe(false);
  });

  it('breaks an exportedAt tie on records with no sequence by document id', async () => {
    harness.transactions = [confirmed({ id: 'later', amount: 250, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    const stamped = CLOCK.toISOString();
    await saveExportLog('tie-a', 'schedule-c-pdf', 40, 'early', stamped);
    await saveExportLog('tie-b', 'schedule-c-csv', 100, 'later', stamped);
    await saveExportLog('tie-c', 'transactions-csv', 0, 'filtered', stamped);
    await saveExportLog('tie-d', 'data-export', 0, 'archive', stamped);
    await saveExportLog('tie-e', 'planning-pdf', 0, 'planning', stamped);
    expect((await readLatestExportRecord('owner', 2025))?.totalDeductible).toBe(100);
    const view = capturePdf();
    expect((await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }))).status).toBe(200);
    expect(subtotal(view.text())).toBe('$100.00');
    expect(view.flat()).toContain('later');
    const csv = await (await scheduleCExport(exportBody({ year: 2025, format: 'csv' }))).text();
    expect(csv).toContain('SERVICE_ADVERTISING,8,100,100');
  });

  it('keeps the higher exportSequence when a PDF and CSV share exportedAt', async () => {
    harness.transactions = [confirmed({ id: 'later', amount: 250, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    const stamped = CLOCK.toISOString();
    await saveExportLog('tie-z', 'schedule-c-pdf', 40, 'early', stamped, 1);
    await saveExportLog('tie-a', 'schedule-c-csv', 100, 'later', stamped, 2);
    await saveExportLog('tie-late', 'schedule-c-pdf', 7, 'old', '2026-12-01T00:00:00.000Z');
    expect((await readLatestExportRecord('owner', 2025))?.totalDeductible).toBe(100);
    const view = capturePdf();
    expect((await scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false }))).status).toBe(200);
    expect(subtotal(view.text())).toBe('$100.00');
    expect(view.flat()).toContain('later');
    expect(view.flat()).not.toContain('early');
    const csv = await (await scheduleCExport(exportBody({ year: 2025, format: 'csv' }))).text();
    expect(csv).toContain('SERVICE_ADVERTISING,8,100,100');
  });

  it('assigns distinct sequences when two exports are served together', async () => {
    harness.transactions = [confirmed({ id: 'ad1', amount: 40, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    const [first, second] = await Promise.all([
      scheduleCExport(exportBody({ year: 2025, format: 'csv' })),
      scheduleCExport(exportBody({ year: 2025, format: 'pdf', includeAppendix: false })),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const rows = savedExports().filter(row => row.kind === 'schedule-c-pdf' || row.kind === 'schedule-c-csv');
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.exportSequence).sort((left, right) => Number(left) - Number(right))).toEqual([1, 2]);
    expect(new Set(rows.map(row => row.exportSequence)).size).toBe(2);
    expect((await readLatestExportRecord('owner', 2025))?.totalDeductible).toBe(40);
  });

  it('keeps the pending marker and skips the older export when the record write throws', async () => {
    await saveExportLog('older', 'schedule-c-pdf', 100, 'ad1', CLOCK.toISOString(), 1);
    seedCounter(1);
    harness.transactions = [confirmed({ id: 'ad1', amount: 250, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    harness.failWrites = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('SERVICE_ADVERTISING');
    expect(pendingMarkers()).toHaveLength(1);
    expect(savedExports()).toHaveLength(1);
    expect(savedExports()[0]).toMatchObject({ totalDeductible: 100 });
    expect(error).toHaveBeenCalledWith('Export record write failed', expect.any(Error));
    const read = await readFiledYear(new NextRequest('http://localhost/api/tax/schedule-c/filed-year?year=2025'));
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ prior: null, latestExportUnrecorded: true, confirmedRulesVersion: null });
  });

  it('clears the pending marker when the record commits after the write times out', async () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(part => part instanceof Error ? part.message : String(part)).join(' '));
    });
    try {
      harness.recordWriteDelayMs = 5000;
      harness.transactions = [confirmed({ id: 'ad1', amount: 80, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
      const pending = scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
      await vi.advanceTimersByTimeAsync(4000);
      const response = await pending;
      expect(response.status).toBe(200);
      expect(logs.some(line => line.includes('timed out and is unconfirmed'))).toBe(true);
      expect(logs.some(line => line.toLowerCase().includes('failed'))).toBe(false);
      expect(pendingMarkers()).toHaveLength(1);
      expect(savedExports()).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1000);
      expect(pendingMarkers()).toHaveLength(0);
      expect(savedExports()).toHaveLength(1);
      expect(savedExports()[0]).toMatchObject({ totalDeductible: 80, exportSequence: 1 });
      expect((await readLatestExportRecord('owner', 2025))?.totalDeductible).toBe(80);
      expect(logs.some(line => line.includes('committed after the write timed out and was unconfirmed'))).toBe(true);
      expect(logs.some(line => line.toLowerCase().includes('failed'))).toBe(false);
      expect(error).not.toHaveBeenCalledWith('Export record write failed', expect.anything());
    } finally {
      harness.recordWriteDelayMs = 0;
      vi.useRealTimers();
    }
  });

  it('serves the file and still shows the older export when the marker and the record both fail', async () => {
    await saveExportLog('older', 'schedule-c-pdf', 55, 'ad1', CLOCK.toISOString(), 1);
    harness.transactions = [confirmed({ id: 'ad1', amount: 250, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    harness.failPending = true;
    harness.failWrites = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('SERVICE_ADVERTISING');
    expect(error).toHaveBeenCalledWith('Pending export marker was not written', expect.any(String), expect.any(Error));
    const exportId = error.mock.calls.find(call => call[0] === 'Pending export marker was not written')?.[1];
    expect(exportId).toEqual(expect.any(String));
    expect(String(exportId).length).toBeGreaterThan(0);
    expect(error).toHaveBeenCalledWith('Export record write failed', expect.any(Error));
    expect(pendingMarkers()).toHaveLength(0);
    expect(savedExports()).toEqual([expect.objectContaining({ totalDeductible: 55, exportSequence: 1 })]);
    const read = await readFiledYear(new NextRequest('http://localhost/api/tax/schedule-c/filed-year?year=2025'));
    expect(await read.json()).toEqual({
      prior: { rulesVersion: 'v0', lineTotals: [{ line: '8', amount: 55 }], totalDeductible: 55, charges: [{ id: 'ad1', line: '8', amount: 55 }] },
      latestExportUnrecorded: false,
      confirmedRulesVersion: null,
    });
  });

  it('lets a sequenced record beat a later unsequenced one, and breaks an unsequenced time tie by document id', async () => {
    const stamped = CLOCK.toISOString();
    await saveExportLog('seq-low', 'schedule-c-pdf', 40, 'old', stamped, 1);
    await saveExportLog('seq-none-later', 'schedule-c-csv', 7, 'late', '2026-12-01T00:00:00.000Z');
    expect((await readLatestExportRecord('owner', 2025))?.totalDeductible).toBe(40);
    harness.db!.records.clear();
    await saveExportLog('tie-a', 'schedule-c-pdf', 40, 'early', stamped);
    await saveExportLog('tie-b', 'schedule-c-csv', 100, 'later', stamped);
    expect((await readLatestExportRecord('owner', 2025))?.totalDeductible).toBe(100);
    expect((await readLatestExportRecord('owner', 2025))?.charges).toEqual([{ id: 'later', line: '8', amount: 100 }]);
  });

  it('clears the earlier failed marker when the next export commits and drops the unrecorded notice', async () => {
    harness.transactions = [confirmed({ id: 'ad1', amount: 100, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    harness.failWrites = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
    expect(failed.status).toBe(200);
    expect(pendingMarkers()).toHaveLength(1);
    const failedMarker = pendingMarkers()[0];
    const blocked = await readFiledYear(new NextRequest('http://localhost/api/tax/schedule-c/filed-year?year=2025'));
    expect(await blocked.json()).toEqual({ prior: null, latestExportUnrecorded: true, confirmedRulesVersion: null });
    expect(await readHeldYearExport('owner', 2025)).toEqual({ prior: null, latestExportUnrecorded: true });

    harness.failWrites = false;
    harness.transactions = [confirmed({ id: 'ad1', amount: 120, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    const committed = await scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
    expect(committed.status).toBe(200);
    expect(pendingMarkers()).toHaveLength(0);
    expect(failedMarker.createdAt).toBeInstanceOf(Date);
    const recorded = await readHeldYearExport('owner', 2025);
    expect(recorded.latestExportUnrecorded).toBe(false);
    expect(recorded.prior).toEqual({
      rulesVersion: 'v0',
      lineTotals: [{ line: '8', amount: 120 }],
      totalDeductible: 120,
      charges: [{ id: 'ad1', line: '8', amount: 120 }],
    });
  });

  it('keeps a newer in flight marker when the older export commits first', async () => {
    const releases: Array<() => void> = [];
    harness.beforeRecordWrite = () => new Promise(resolve => { releases.push(resolve); });
    const ready = async (pending: number) => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (pendingMarkers().length === pending && releases.length === pending) return;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      throw new Error(`export did not reach the record write with ${pending} markers`);
    };
    harness.transactions = [confirmed({ id: 'ad1', amount: 40, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    const older = scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
    await ready(1);
    const olderMarker = pendingMarkers()[0];
    await new Promise(resolve => setTimeout(resolve, 20));
    harness.transactions = [confirmed({ id: 'ad1', amount: 90, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    const newer = scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
    await ready(2);
    const newerMarker = pendingMarkers().find(marker => marker.exportId !== olderMarker.exportId);

    releases[0]();
    expect((await older).status).toBe(200);
    expect(pendingMarkers().map(marker => marker.exportId)).toEqual([newerMarker?.exportId]);
    expect(newerMarker?.exportSequence).toBeGreaterThan(Number(olderMarker.exportSequence));
    expect(savedExports().map(row => row.totalDeductible)).toEqual([40]);
    expect(await readHeldYearExport('owner', 2025)).toEqual({ prior: null, latestExportUnrecorded: true });
    const stillBlocked = await readFiledYear(new NextRequest('http://localhost/api/tax/schedule-c/filed-year?year=2025'));
    expect(await stillBlocked.json()).toEqual({ prior: null, latestExportUnrecorded: true, confirmedRulesVersion: null });

    releases[1]();
    expect((await newer).status).toBe(200);
    expect(pendingMarkers()).toHaveLength(0);
    expect(olderMarker.createdAt).toBeInstanceOf(Date);
    expect(newerMarker?.createdAt).toBeInstanceOf(Date);
    expect((olderMarker.createdAt as Date).getTime()).toBeLessThan((newerMarker?.createdAt as Date).getTime());
    const recorded = await readHeldYearExport('owner', 2025);
    expect(recorded.latestExportUnrecorded).toBe(false);
    expect(recorded.prior).toMatchObject({ totalDeductible: 90, charges: [{ id: 'ad1', line: '8', amount: 90 }] });
  });

  it('does not let a stale or unsequenced pending marker block a later export record', async () => {
    await saveExportLog('latest', 'schedule-c-pdf', 80, 'ad1', CLOCK.toISOString(), 3);
    const { adminDb } = await import('@/lib/firebase/admin');
    await adminDb.collection('user_export_pending').doc('older').set({
      uid: 'owner', taxYear: 2025, exportId: 'older', exportSequence: 1, createdAt: new Date(),
    });
    await adminDb.collection('user_export_pending').doc('same-sequence').set({
      uid: 'owner', taxYear: 2025, exportId: 'same-sequence', exportSequence: 3, createdAt: new Date(),
    });
    await adminDb.collection('user_export_pending').doc('legacy').set({
      uid: 'owner', taxYear: 2025, exportId: 'legacy',
    });
    const open = await readHeldYearExport('owner', 2025);
    expect(open.latestExportUnrecorded).toBe(false);
    expect(open.prior).toMatchObject({ totalDeductible: 80 });
    expect(pendingMarkers()).toHaveLength(3);
    const filed = await readFiledYear(new NextRequest('http://localhost/api/tax/schedule-c/filed-year?year=2025'));
    expect((await filed.json()).latestExportUnrecorded).toBe(false);

    await adminDb.collection('user_export_pending').doc('newer').set({
      uid: 'owner', taxYear: 2025, exportId: 'newer', exportSequence: 4, createdAt: new Date(),
    });
    expect(await readHeldYearExport('owner', 2025)).toEqual({ prior: null, latestExportUnrecorded: true });
    expect(pendingMarkers()).toHaveLength(4);
  });

  it('builds the file from the stored record while a marker is open and keeps that held total', async () => {
    await saveExportLog('held', 'schedule-c-pdf', 100, 'ad1', CLOCK.toISOString(), 1);
    seedCounter(1);
    const { adminDb } = await import('@/lib/firebase/admin');
    await adminDb.collection('user_export_pending').doc('open').set({
      uid: 'owner', taxYear: 2025, exportId: 'open', exportSequence: 2, createdAt: new Date(),
    });
    harness.transactions = [confirmed({ id: 'ad1', amount: 250, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    const blocked = await readFiledYear(new NextRequest('http://localhost/api/tax/schedule-c/filed-year?year=2025'));
    expect(await blocked.json()).toEqual({ prior: null, latestExportUnrecorded: true, confirmedRulesVersion: null });
    const response = await scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain('SERVICE_ADVERTISING,8,100,100');
    expect(csv).not.toContain('SERVICE_ADVERTISING,8,250,250');
    expect(pendingMarkers()).toHaveLength(0);
    expect(savedExports().every(row => row.totalDeductible === 100)).toBe(true);
    const held = await readHeldYearExport('owner', 2025);
    expect(held.latestExportUnrecorded).toBe(false);
    expect(held.prior?.totalDeductible).toBe(100);
  });

  it('keeps the later served export as the latest record when it commits first', async () => {
    const releases: Array<() => void> = [];
    harness.beforeRecordWrite = () => new Promise(resolve => { releases.push(resolve); });
    const ready = async (pending: number) => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (pendingMarkers().length === pending && releases.length === pending) return;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      throw new Error(`export did not reach the record write with ${pending} markers`);
    };
    harness.transactions = [confirmed({ id: 'ad1', amount: 40, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    const servedFirst = scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
    await ready(1);
    harness.transactions = [confirmed({ id: 'ad1', amount: 90, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    const servedSecond = scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
    await ready(2);
    releases[1]();
    expect((await servedSecond).status).toBe(200);
    releases[0]();
    expect((await servedFirst).status).toBe(200);
    const firstRecord = savedExports().find(row => row.totalDeductible === 40);
    const secondRecord = savedExports().find(row => row.totalDeductible === 90);
    expect(secondRecord?.exportSequence).toBeGreaterThan(Number(firstRecord?.exportSequence));
    const held = await readHeldYearExport('owner', 2025);
    expect(held.latestExportUnrecorded).toBe(false);
    expect(held.prior?.totalDeductible).toBe(90);
    expect((await readLatestExportRecord('owner', 2025))?.totalDeductible).toBe(90);
  });

  it('logs a build failure, returns the existing error, and writes no marker', async () => {
    harness.throwBuild = true;
    harness.transactions = [confirmed({ id: 'ad1', amount: 80, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Could not create the Schedule C preparer summary. Please retry.' });
    expect(error).toHaveBeenCalledWith('Schedule C export file was not built', expect.any(Error));
    expect(pendingMarkers()).toHaveLength(0);
    expect(savedExports()).toHaveLength(0);
    expect(counterNext()).toEqual([]);
  });

  it('logs a late record rejection with the export id', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    harness.recordWriteRejectAfterMs = 5000;
    harness.transactions = [confirmed({ id: 'ad1', amount: 80, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    try {
      const pending = scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
      await vi.advanceTimersByTimeAsync(4000);
      const response = await pending;
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('SERVICE_ADVERTISING');
      const exportId = pendingMarkers()[0]?.exportId;
      expect(exportId).toEqual(expect.any(String));
      expect(savedExports()).toHaveLength(0);
      expect(error).toHaveBeenCalledWith('Export record write timed out and is unconfirmed', exportId);
      expect(error).not.toHaveBeenCalledWith('Export record write failed after the write timed out and was unconfirmed', exportId, expect.any(Error));
      await vi.advanceTimersByTimeAsync(1000);
      expect(error).toHaveBeenCalledWith('Export record write failed after the write timed out and was unconfirmed', exportId, expect.any(Error));
      expect(pendingMarkers()).toHaveLength(1);
      expect(savedExports()).toHaveLength(0);
    } finally {
      harness.recordWriteRejectAfterMs = 0;
      await vi.advanceTimersByTimeAsync(10000);
      vi.useRealTimers();
    }
  });

  it('serves the file when the marker write times out and logs the export id', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    harness.markerWriteDelayMs = 5000;
    harness.transactions = [confirmed({ id: 'ad1', amount: 80, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    let settled = false;
    const pending = scheduleCExport(exportBody({ year: 2025, format: 'csv' })).then(response => {
      settled = true;
      return response;
    });
    try {
      await vi.advanceTimersByTimeAsync(4000);
      expect(settled).toBe(true);
      const response = await pending;
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('SERVICE_ADVERTISING');
      const timedOut = error.mock.calls.find(call => call[0] === 'Pending export marker write timed out and is unconfirmed');
      expect(timedOut?.[1]).toEqual(expect.any(String));
      expect(String(timedOut?.[1]).length).toBeGreaterThan(0);
    } finally {
      harness.markerWriteDelayMs = 0;
      await vi.advanceTimersByTimeAsync(10000);
      vi.useRealTimers();
    }
  });

  it('serves the stored total when sequence reservation times out and leaves no sequence', async () => {
    await saveExportLog('held', 'schedule-c-pdf', 100, 'ad1', CLOCK.toISOString(), 1);
    seedCounter(1);
    harness.transactions = [confirmed({ id: 'ad1', amount: 250, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    harness.reservationDelayMs = 5000;
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const pending = scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
      await vi.advanceTimersByTimeAsync(4000);
      const response = await pending;
      expect(response.status).toBe(200);
      const csv = await response.text();
      expect(csv).toContain('SERVICE_ADVERTISING,8,100,100');
      expect(csv).not.toContain('SERVICE_ADVERTISING,8,250,250');
      expect(pendingMarkers()).toHaveLength(0);
      expect(savedExports()).toEqual([expect.objectContaining({ totalDeductible: 100, exportSequence: 1 })]);
      expect(counterNext()).toEqual([1]);
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith('Export sequence reservation failed or timed out', expect.any(String));
      await vi.advanceTimersByTimeAsync(2000);
      expect(pendingMarkers()).toHaveLength(0);
      expect(savedExports()).toHaveLength(1);
      expect(counterNext()).toEqual([1]);
      expect(error).toHaveBeenCalledTimes(1);
      harness.reservationDelayMs = 0;
      vi.useRealTimers();
      const next = await scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
      expect(next.status).toBe(200);
      expect(savedExports().map(row => row.exportSequence).sort((left, right) => Number(left) - Number(right))).toEqual([1, 2]);
      expect(savedExports().every(row => row.totalDeductible === 100)).toBe(true);
      expect((await readLatestExportRecord('owner', 2025))?.totalDeductible).toBe(100);
      expect((await readHeldYearExport('owner', 2025)).latestExportUnrecorded).toBe(false);
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      harness.reservationDelayMs = 0;
      vi.useRealTimers();
    }
  });

  it('serves the stored total when sequence reservation rejects and writes nothing', async () => {
    await saveExportLog('held', 'schedule-c-pdf', 100, 'ad1', CLOCK.toISOString(), 1);
    seedCounter(1);
    harness.transactions = [confirmed({ id: 'ad1', amount: 250, date: '2025-06-01', category: 'SERVICE_ADVERTISING' })];
    harness.failReservation = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await scheduleCExport(exportBody({ year: 2025, format: 'csv' }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('SERVICE_ADVERTISING,8,100,100');
    expect(pendingMarkers()).toHaveLength(0);
    expect(savedExports()).toEqual([expect.objectContaining({ totalDeductible: 100, exportSequence: 1 })]);
    expect(counterNext()).toEqual([1]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('Export sequence reservation failed or timed out', expect.any(String));
    const held = await readHeldYearExport('owner', 2025);
    expect(held.latestExportUnrecorded).toBe(false);
    expect(held.prior?.totalDeductible).toBe(100);
  });
});
