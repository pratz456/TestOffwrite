import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import * as taxDate from '@/lib/schedule-c/taxDate';

const { safeTaxYear } = taxDate;

function chargeYear(record: { date?: unknown; datetime?: unknown } | null | undefined) {
  return taxDate.chargeYear(record);
}
import { summarizeRecordedCashFlow } from '@/lib/dashboard/cash-flow-summary';
import { summarizeConfirmedDeductions } from '@/lib/tax/display-deductions';
import { buildMonthlySavings } from '@/lib/tax/savings-summary';
import { convertTransactionsToCSV, exportDate, selectExportYear } from '@/lib/reports/transaction-export';
import { isCountableRecord } from '@/lib/transactions/record-scope';
import { transactionCreateInput } from '@/lib/transactions/client-updates';
import { composeForYou } from '@/lib/tax-assistant/context';
import { loadAssistantContext } from '@/lib/tax-assistant/context-server';

/**
 * In-memory Firestore stand-in for getTransactionsServer, including the per-account
 * fallback used when an orderBy('date') query drops a document that has no date field.
 */
const fake = vi.hoisted(() => {
  type Doc = { path: string; data: Record<string, any> };
  const docs = new Map<string, Record<string, any>>();
  const writes: Array<{ path: string; patch: Record<string, unknown> }> = [];
  const compare = (a: unknown, b: unknown) => (a === b ? 0 : String(a) < String(b) ? -1 : 1);
  type Snapshot = { id: string; ref: any; data(): Record<string, any>; get(field: string): unknown };
  function snapshotOf(doc: Doc, projection: string[] | null): Snapshot {
    const data = projection ? Object.fromEntries(Object.entries(doc.data).filter(([key]) => projection.includes(key))) : { ...doc.data };
    return { id: doc.path.split('/').at(-1)!, ref: docRef(doc.path), data: () => data, get: (field: string) => data[field] };
  }
  class Query {
    constructor(
      private readonly source: () => Doc[],
      private readonly filters: Array<[string, unknown]> = [],
      private readonly orders: Array<{ field: string; dir: 'asc' | 'desc' }> = [],
      private readonly max: number | null = null,
      private readonly projection: string[] | null = null,
    ) {}
    private clone(patch: Partial<{ filters: Array<[string, unknown]>; orders: Query['orders']; max: number | null; projection: string[] | null }>) {
      return new Query(this.source, patch.filters ?? this.filters, patch.orders ?? this.orders, patch.max === undefined ? this.max : patch.max, patch.projection === undefined ? this.projection : patch.projection);
    }
    where(field: string, op: string, value: unknown) { if (op !== '==') throw new Error(`unsupported op ${op}`); return this.clone({ filters: [...this.filters, [field, value]] }); }
    select(...fields: string[]) { return this.clone({ projection: fields }); }
    orderBy(field: unknown, dir: 'asc' | 'desc' = 'asc') { return this.clone({ orders: [...this.orders, { field: typeof field === 'string' ? field : '__name__', dir }] }); }
    startAfter() { return this; }
    limit(count: number) { return this.clone({ max: count }); }
    private matches(doc: Doc) { return this.filters.every(([field, value]) => doc.data[field] === value); }
    async get() {
      let rows = this.source().filter(doc => this.matches(doc) && this.orders.every(order => order.field === '__name__' || doc.data[order.field] !== undefined));
      if (this.orders.length) {
        rows.sort((a, b) => {
          for (const order of this.orders) {
            const left = order.field === '__name__' ? a.path : a.data[order.field];
            const right = order.field === '__name__' ? b.path : b.data[order.field];
            const result = compare(left, right);
            if (result !== 0) return order.dir === 'asc' ? result : -result;
          }
          return 0;
        });
      }
      if (this.max !== null) rows = rows.slice(0, this.max);
      const snapshots = rows.map(doc => snapshotOf(doc, this.projection));
      return { empty: snapshots.length === 0, size: snapshots.length, docs: snapshots, forEach: (fn: (doc: Snapshot) => void) => snapshots.forEach(fn) };
    }
    count() { return { get: async () => ({ data: () => ({ count: this.source().filter(doc => this.matches(doc)).length }) }) }; }
  }
  const all = () => [...docs.entries()].map(([path, data]) => ({ path, data }));
  const collectionAt = (prefix: string) => new Query(() => all().filter(doc => doc.path.startsWith(`${prefix}/`) && doc.path.slice(prefix.length + 1).split('/').length === 1));
  function docRef(path: string): any {
    return {
      path, id: path.split('/').at(-1),
      get: async () => ({ exists: docs.has(path), id: path.split('/').at(-1), data: () => docs.get(path) }),
      collection: (name: string) => Object.assign(collectionAt(`${path}/${name}`), { doc: (id: string) => docRef(`${path}/${name}/${id}`) }),
    };
  }
  const adminDb = {
    collectionGroup: (name: string) => new Query(() => all().filter(doc => doc.path.split('/').at(-2) === name)),
    collection: (name: string) => Object.assign(collectionAt(name), { doc: (id: string) => docRef(`${name}/${id}`) }),
    doc: docRef,
    runTransaction: async (work: (tx: any) => Promise<unknown>) => work({
      get: async (ref: { path: string }) => ({ exists: docs.has(ref.path), id: ref.path.split('/').at(-1), data: () => ({ ...docs.get(ref.path) }) }),
      update: (ref: { path: string }, patch: Record<string, unknown>) => {
        writes.push({ path: ref.path, patch });
        docs.set(ref.path, { ...docs.get(ref.path), ...patch });
      },
    }),
  };
  return { docs, writes, adminDb };
});

vi.mock('@/lib/firebase/admin', () => ({ adminDb: fake.adminDb }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'owner' }, error: null }) }));
vi.mock('@/lib/ai/learning-engine', async () => {
  const { learningMerchantKey } = await import('@/lib/ai/merchant-key');
  return { aiLearningEngine: { recordCorrection: async () => undefined }, learningMerchantKey };
});

import { GET as listTransactions } from '@/app/api/transactions/route';
import { PUT as updateOne } from '@/app/api/transactions/[id]/route';
import { GET as listDatabase, PUT as updateDatabase } from '@/app/api/database/transactions/route';
import { GET as monthly } from '@/app/api/monthly-deductions/route';
import { GET as savings } from '@/app/api/tax-savings/route';

const uid = 'owner';
const account = `user_profiles/${uid}/accounts/checking`;
const MISSING_DATE = 'Review missing or invalid transaction dates before showing confirmed deduction totals.';
const CASH_DATE = 'Review missing or invalid dates before showing cash flow.';

function seedProfile() {
  fake.docs.set(`user_profiles/${uid}`, { income: 100000, filing_status: 'single', email: 'owner@example.com', name: 'Owner' });
  fake.docs.set(account, { userId: uid, account_id: 'checking' });
}

function seedCharge(id: string, data: Record<string, unknown>) {
  fake.docs.set(`${account}/transactions/${id}`, {
    trans_id: id, account_id: 'checking', userId: uid, amount: 100, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES',
    iso_currency_code: 'USD', is_deductible: true, review_status: 'confirmed', merchant_name: 'Adobe', pending: false,
    ...data,
  });
}

const list = (query = '') => listTransactions(new NextRequest(`http://localhost/api/transactions${query}`));
const dateAccepted = (value: string) => transactionCreateInput.safeParse({
  trans_id: 'fuel', account_id: 'checking', merchant_name: 'Adobe', amount: 100, date: value,
}).success;

/** Same charge-day screen the reports page uses for cash flow, the in-year count, and the month drill-down. */
function reportsScreen(rows: Record<string, unknown>[], chartYear: number, currentYear = new Date().getUTCFullYear()) {
  const today = new Date().toISOString().slice(0, 10);
  const visible = rows.filter(record => {
    const date = exportDate(record);
    return !date || chartYear !== currentYear || date <= today;
  });
  const cash = summarizeRecordedCashFlow(visible, chartYear);
  const inYear = visible.filter(record => {
    const date = exportDate(record);
    return isCountableRecord(record) && date !== null && date.startsWith(`${chartYear}-`);
  });
  const drilldown = summarizeConfirmedDeductions(visible, chartYear);
  return { cash, inYear, totalCount: inYear.length, drilldown };
}

beforeEach(() => { fake.docs.clear(); fake.writes.length = 0; seedProfile(); });

describe('undated rows keep save timestamps out of every year and month', () => {
  beforeEach(() => {
    seedCharge('undated', { created_at: '2025-06-15T18:00:00.000Z', updated_at: '2026-06-15T18:00:00.000Z' });
  });

  it('withholds tax savings and monthly deductions instead of placing the row in a save-time month', async () => {
    for (const year of [2025, 2026]) {
      const response = await monthly(new NextRequest(`http://localhost/api/monthly-deductions?year=${year}`));
      const body = await response.json();
      expect(response.status).toBe(422);
      expect(body).toMatchObject({ code: 'EXPORT_REVIEW_REQUIRED' });
      expect(body.error).toContain(MISSING_DATE);
    }
    const savingsResponse = await savings(new NextRequest('http://localhost/api/tax-savings'));
    expect(savingsResponse.status).toBe(422);
    expect((await savingsResponse.json()).error).toContain(MISSING_DATE);
    const { data } = await listDatabase(new NextRequest('http://localhost/api/database/transactions')).then(async response => ({ data: (await response.json()).transactions }));
    const row = data[0];
    expect(row.date).toBe('');
    expect(summarizeConfirmedDeductions([row]).reviewMessage).toBe(MISSING_DATE);
    expect(summarizeConfirmedDeductions([row]).totalDeductible).toBeNull();
    for (const year of [2025, 2026]) expect(() => buildMonthlySavings([row], year, 0.2, new Date('2026-09-23T12:00:00Z'))).toThrow(MISSING_DATE);
  });

  it('excludes the row from the transaction list month and year filter', async () => {
    const open = await list();
    const body = await open.json();
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].date).toBe('');
    for (const query of ['?month=5&year=2025', '?month=5&year=2026', '?month=11&year=2025', '?month=0&year=2026']) {
      const filtered = await (await list(query)).json();
      expect(filtered.transactions).toEqual([]);
      expect(filtered.count).toBe(0);
    }
  });

  it('keeps the row out of reports cash flow, the in-year count, and the month drill-down', async () => {
    const rows = (await (await list()).json()).transactions;
    for (const year of [2025, 2026]) {
      const screen = reportsScreen(rows, year, 2026);
      expect(screen.cash.reviewMessage).toBe(CASH_DATE);
      expect(screen.cash.months).toEqual([]);
      expect(screen.totalCount).toBe(0);
      expect(screen.inYear).toEqual([]);
      expect(screen.drilldown.reviewMessage).toBe(MISSING_DATE);
      expect(screen.drilldown.totalDeductible).toBeNull();
      expect(screen.drilldown.transactions).toEqual([]);
    }
  });

  it('gives the Schedule C preview no year', async () => {
    const row = (await (await list()).json()).transactions[0];
    expect(safeTaxYear(row.date)).toBeNull();
    for (const year of ['2025', '2026']) {
      const result = aggregateScheduleC([row], year, CATEGORY_MAP, { mode: 'confirmed-only' });
      expect(result.totalDeductible).toBe(0);
      expect(result.counts.year).toBe(0);
      expect(result.undated).toHaveLength(1);
    }
  });

  it('returns no charge date to the react-query transaction list', async () => {
    const result = await (await list()).json();
    const apiTransactions = result.transactions || result.data || [];
    expect(apiTransactions[0].date).toBe('');
    expect(apiTransactions[0].date).not.toMatch(/2025|2026/);
    expect(String(apiTransactions[0].created_at)).toContain('2025');
  });

  it('does not count the per-account assistant fallback row in a tax year', async () => {
    for (const taxYear of [2025, 2026]) {
      const context = await loadAssistantContext(uid, 'How much did Adobe cost', taxYear);
      expect(context.merchant).toBeNull();
      const paragraph = composeForYou(context, 'software-subscriptions')?.paragraph ?? '';
      expect(paragraph).not.toMatch(/\bin 2025\b/);
      expect(paragraph).not.toMatch(/\bin 2026\b/);
      expect(context.undatedCount).toBe(1);
    }
  });
});

describe('trimmed write-back cannot replace the charge day with a save time', () => {
  async function readBack(id: string) {
    const transactions = (await (await list()).json()).transactions as Array<Record<string, any>>;
    return transactions.find(row => row.trans_id === id);
  }

  async function attemptTrimmedWrite(id: string, trimmed: string) {
    const database = await updateDatabase(new NextRequest('http://localhost/api/database/transactions', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transactionId: id, updates: { business_purpose: 'Client delivery', date: trimmed } }),
    }));
    const one = await updateOne(new NextRequest(`http://localhost/api/transactions/${id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ business_purpose: 'Client delivery', date: trimmed }),
    }), { params: Promise.resolve({ id }) });
    return { database: database.status, one: one.status };
  }

  it('keeps a 2025-12-31 charge in 2025 after the API read and a trimmed PUT', async () => {
    seedCharge('year-end', { date: '2025-12-31', created_at: '2026-01-02T08:00:00.000Z', updated_at: '2026-01-02T08:00:00.000Z' });
    const read = await readBack('year-end');
    const trimmed = String(read.date ?? '').slice(0, 10);
    expect(read.date).toBe('2025-12-31');
    expect(trimmed).toBe('2025-12-31');
    expect(dateAccepted(trimmed)).toBe(true);
    const rejected = await attemptTrimmedWrite('year-end', trimmed);
    expect(rejected.database).toBe(400);
    expect(rejected.one).toBe(400);
    expect(fake.writes).toEqual([]);
    const saved = await updateDatabase(new NextRequest('http://localhost/api/database/transactions', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transactionId: 'year-end', updates: { business_purpose: 'Client delivery' } }),
    }));
    expect(saved.status).toBe(200);
    expect(fake.writes.every(write => !Object.prototype.hasOwnProperty.call(write.patch, 'date'))).toBe(true);
    expect(String(fake.docs.get(`${account}/transactions/year-end`)?.date)).toBe('2025-12-31');
    const row = await readBack('year-end');
    expect(row.date).toBe('2025-12-31');
    expect(aggregateScheduleC([row], '2025', CATEGORY_MAP).totalDeductible).toBe(100);
    expect(aggregateScheduleC([row], '2026', CATEGORY_MAP).totalDeductible).toBe(0);
    expect(selectExportYear([row], 2025)).toHaveLength(1);
    expect(selectExportYear([row], 2026)).toHaveLength(0);
    const csv = convertTransactionsToCSV([row]);
    expect(csv).toContain('2025-12-31');
    expect(csv).not.toContain('2026-01-02');
    const savings = buildMonthlySavings([row], 2025, 0.2, new Date('2026-09-23T12:00:00Z'));
    expect(savings.monthlyData[11].deductionBasis).toBe(100);
    expect(buildMonthlySavings([row], 2026, 0.2, new Date('2026-09-23T12:00:00Z')).summary.deductionBasis).toBe(0);
  });

  it('gives a UTC save time that is still the previous evening in Pacific time no date and no year', async () => {
    seedCharge('boundary', { created_at: '2026-01-01T03:00:00.000Z', updated_at: '2026-01-01T03:00:00.000Z' });
    const read = await readBack('boundary');
    const trimmed = String(read.date ?? '').slice(0, 10);
    expect(read.date).toBe('');
    expect(chargeYear(read)).toBeNull();
    expect(safeTaxYear(read.date)).toBeNull();
    expect(dateAccepted(trimmed)).toBe(false);
    const rejected = await attemptTrimmedWrite('boundary', trimmed);
    expect(rejected.database).toBe(400);
    expect(rejected.one).toBe(400);
    const saved = await updateOne(new NextRequest('http://localhost/api/transactions/boundary', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ business_purpose: 'Client delivery' }),
    }), { params: Promise.resolve({ id: 'boundary' }) });
    expect(saved.status).toBe(200);
    expect(fake.writes.every(write => !Object.prototype.hasOwnProperty.call(write.patch, 'date'))).toBe(true);
    expect(fake.docs.get(`${account}/transactions/boundary`)?.date).toBeUndefined();
    const row = await readBack('boundary');
    expect(row.date).toBe('');
    expect(String(row.date).slice(0, 10)).not.toBe('2025-12-31');
    expect(String(row.date).slice(0, 10)).not.toBe('2026-01-01');
    expect(convertTransactionsToCSV([row]).split('\r\n')[1].split(',')[2]).toBe('');
    for (const year of [2025, 2026]) {
      const totals = aggregateScheduleC([row], String(year), CATEGORY_MAP);
      expect(totals.totalDeductible).toBe(0);
      expect(totals.counts.year).toBe(0);
      expect(() => selectExportYear([row], year)).toThrow(/missing or invalid dates/);
    }
    for (const query of ['?month=11&year=2025', '?month=0&year=2026']) {
      expect((await (await list(query)).json()).transactions).toEqual([]);
    }
    expect(reportsScreen([row], 2025, 2026).totalCount).toBe(0);
    expect(reportsScreen([row], 2026, 2026).totalCount).toBe(0);
    expect(reportsScreen([row], 2025, 2026).cash.reviewMessage).toBe(CASH_DATE);
    expect(reportsScreen([row], 2026, 2026).cash.months).toEqual([]);
  });

  it('leaves a datetime-only row off the reports year in both zones and keeps the amount', () => {
    const row = {
      id: 'datetime-only', trans_id: 'datetime-only', account_id: 'checking', userId: uid, amount: 80,
      category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', iso_currency_code: 'USD', is_deductible: true,
      review_status: 'confirmed', merchant_name: 'Adobe', pending: false, datetime: '2024-12-31T15:00:00Z',
    };
    expect(exportDate(row)).toBeNull();
    for (const year of [2024, 2025]) {
      const screen = reportsScreen([row], year, 2026);
      expect(screen.totalCount).toBe(0);
      expect(screen.cash.reviewMessage).toBe(CASH_DATE);
      expect(screen.cash.months).toEqual([]);
    }
    expect(row.amount).toBe(80);
    expect(row.datetime).toBe('2024-12-31T15:00:00Z');
  });
});
