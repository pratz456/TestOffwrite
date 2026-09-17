import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * In-memory Firestore stand-in covering exactly the query surface getTransactionsServer uses:
 * collectionGroup/where/select/orderBy/startAfter/limit/get/count plus the per-account fallback.
 */
const fake = vi.hoisted(() => {
  type Doc = { path: string; data: Record<string, any> };
  const docs = new Map<string, Record<string, any>>();
  const calls: Array<{ kind: 'get' | 'count'; description: string }> = [];
  const compare = (a: unknown, b: unknown) => (a === b ? 0 : String(a) < String(b) ? -1 : 1);
  type Snapshot = { id: string; ref: any; data(): Record<string, any>; get(field: string): unknown };
  function snapshotOf(doc: Doc, projection: string[] | null): Snapshot {
    const data = projection ? Object.fromEntries(Object.entries(doc.data).filter(([key]) => projection.includes(key))) : { ...doc.data };
    return { id: doc.path.split('/').at(-1)!, ref: docRef(doc.path), data: () => data, get: (field: string) => data[field] };
  }
  type Cursor = { kind: 'values'; values: unknown[] } | { kind: 'snapshot'; snapshot: Snapshot };
  const isSnapshot = (value: unknown): value is Snapshot => !!value && typeof value === 'object' && typeof (value as any).get === 'function' && 'ref' in (value as any);
  class Query {
    constructor(
      private readonly source: () => Doc[],
      private readonly description: string,
      private readonly filters: Array<[string, unknown]> = [],
      private readonly orders: Array<{ field: string; dir: 'asc' | 'desc' }> = [],
      private readonly after: Cursor | null = null,
      private readonly max: number | null = null,
      private readonly projection: string[] | null = null,
    ) {}
    private clone(patch: Partial<{ filters: Array<[string, unknown]>; orders: Array<{ field: string; dir: 'asc' | 'desc' }>; after: Cursor | null; max: number | null; projection: string[] | null }>) {
      return new Query(this.source, this.description, patch.filters ?? this.filters, patch.orders ?? this.orders,
        patch.after === undefined ? this.after : patch.after, patch.max === undefined ? this.max : patch.max,
        patch.projection === undefined ? this.projection : patch.projection);
    }
    where(field: string, op: string, value: unknown) { if (op !== '==') throw new Error(`unsupported op ${op}`); return this.clone({ filters: [...this.filters, [field, value]] }); }
    select(...fields: string[]) { return this.clone({ projection: fields }); }
    orderBy(field: unknown, dir: 'asc' | 'desc' = 'asc') { return this.clone({ orders: [...this.orders, { field: typeof field === 'string' ? field : '__name__', dir }] }); }
    startAfter(...values: unknown[]) {
      // Firestore accepts either explicit orderBy values (document refs for __name__) or a snapshot.
      if (values.length === 1 && isSnapshot(values[0])) return this.clone({ after: { kind: 'snapshot', snapshot: values[0] } });
      return this.clone({ after: { kind: 'values', values: values.map(value => (value && typeof value === 'object' && 'path' in (value as any)) ? (value as any).path : value) } });
    }
    limit(count: number) { return this.clone({ max: count }); }
    private valueOf(doc: Doc, field: string) { return field === '__name__' ? doc.path : doc.data[field]; }
    private matches(doc: Doc) { return this.filters.every(([field, value]) => doc.data[field] === value); }
    private effectiveOrders() { return this.orders.some(order => order.field === '__name__') ? this.orders : [...this.orders, { field: '__name__', dir: this.orders.at(-1)?.dir ?? 'asc' as const }]; }
    private cursorValues(): unknown[] | null {
      if (!this.after) return null;
      if (this.after.kind === 'values') return this.after.values;
      const snapshot = this.after.snapshot;
      return this.effectiveOrders().map(order => order.field === '__name__' ? snapshot.ref.path : snapshot.get(order.field));
    }
    private ordered() {
      const orders = this.effectiveOrders();
      const rows = this.source().filter(doc => this.matches(doc) && orders.every(order => order.field === '__name__' || doc.data[order.field] !== undefined));
      rows.sort((a, b) => {
        for (const order of orders) {
          const result = compare(this.valueOf(a, order.field), this.valueOf(b, order.field));
          if (result !== 0) return order.dir === 'asc' ? result : -result;
        }
        return 0;
      });
      return rows;
    }
    async get() {
      calls.push({ kind: 'get', description: this.description });
      let rows = this.ordered();
      const cursor = this.cursorValues();
      if (cursor) {
        const orders = this.effectiveOrders();
        rows = rows.filter(doc => {
          for (const [index, order] of orders.entries()) {
            if (index >= cursor.length) return false;
            const result = compare(this.valueOf(doc, order.field), cursor[index]);
            if (result !== 0) return order.dir === 'asc' ? result > 0 : result < 0;
          }
          return false;
        });
      }
      if (this.max !== null) rows = rows.slice(0, this.max);
      const snapshots = rows.map(doc => snapshotOf(doc, this.projection));
      return { empty: snapshots.length === 0, size: snapshots.length, docs: snapshots, forEach: (fn: (doc: any) => void) => snapshots.forEach(fn) };
    }
    count() { return { get: async () => { calls.push({ kind: 'count', description: this.description }); return { data: () => ({ count: this.ordered().length }) }; } }; }
  }
  const all = () => [...docs.entries()].map(([path, data]) => ({ path, data }));
  const collectionAt = (prefix: string, description: string) =>
    new Query(() => all().filter(doc => doc.path.startsWith(`${prefix}/`) && doc.path.slice(prefix.length + 1).split('/').length === 1), description);
  function docRef(path: string): any {
    return { path, id: path.split('/').at(-1), get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
      collection: (name: string) => Object.assign(collectionAt(`${path}/${name}`, `${path}/${name}`), { doc: (id: string) => docRef(`${path}/${name}/${id}`) }) };
  }
  const adminDb = {
    collectionGroup: (name: string) => new Query(() => all().filter(doc => { const parts = doc.path.split('/'); return parts.at(-2) === name; }), `collectionGroup(${name})`),
    collection: (name: string) => Object.assign(collectionAt(name, name), { doc: (id: string) => docRef(`${name}/${id}`) }),
    doc: docRef,
  };
  return { docs, calls, adminDb };
});

vi.mock('@/lib/firebase/admin', () => ({ adminDb: fake.adminDb }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'owner' }, error: null }) }));

import { decodeTransactionsCursor, encodeTransactionsCursor, getPaginatedTransactionsServer, getTransactionsServer, MAX_TRANSACTIONS_PAGE_SIZE } from '@/lib/firebase/transactions-server';
import { GET as listTransactions } from '@/app/api/transactions/route';

const uid = 'owner';
const account = `user_profiles/${uid}/accounts/checking`;
function seed(count: number, owner: Record<string, unknown> = { userId: uid }) {
  for (let index = 0; index < count; index++) {
    const day = String(index + 1).padStart(2, '0');
    fake.docs.set(`${account}/transactions/tx-${day}`, { trans_id: `tx-${day}`, account_id: 'checking', amount: 10 + index, date: `2026-08-${day}`, merchant_name: `Merchant ${day}`, category: 'supplies', notes: 'private note', ...owner });
  }
}
const gets = () => fake.calls.filter(call => call.kind === 'get');

beforeEach(() => {
  fake.docs.clear();
  fake.calls.length = 0;
  fake.docs.set(`user_profiles/${uid}`, { profession: 'Designer' });
  fake.docs.set(account, { userId: uid, type: 'depository' });
});

describe('getTransactionsServer strategy chain', () => {
  it('short-circuits after the canonical userId collection-group query returns rows', async () => {
    seed(5);
    const { data, error, nextCursor } = await getTransactionsServer(uid);
    expect(error).toBeNull();
    expect(nextCursor).toBeNull();
    expect(data.map(row => row.trans_id)).toEqual(['tx-05', 'tx-04', 'tx-03', 'tx-02', 'tx-01']);
    expect(gets()).toHaveLength(1);
    expect(gets()[0].description).toBe('collectionGroup(transactions)');
  });

  it('falls back to the legacy user_id field only when the canonical query is empty', async () => {
    seed(3, { user_id: uid });
    const { data } = await getTransactionsServer(uid);
    expect(data).toHaveLength(3);
    expect(gets()).toHaveLength(2);
  });

  it('reaches the per-account fallback only when no owner field matches', async () => {
    seed(2, {});
    const { data } = await getTransactionsServer(uid);
    expect(data).toHaveLength(2);
    // userId query, user_id query, accounts listing, one query per account
    expect(gets().map(call => call.description)).toEqual([
      'collectionGroup(transactions)', 'collectionGroup(transactions)', `user_profiles/${uid}/accounts`, `${account}/transactions`,
    ]);
  });

  it('returns an empty result without an error for a user with no rows', async () => {
    const result = await getTransactionsServer(uid);
    expect(result).toEqual({ data: [], error: null, nextCursor: null });
  });
});

describe('getTransactionsServer cursor paging', () => {
  it('pages newest-first with one query per page and a null cursor on the last page', async () => {
    seed(5);
    const first = await getTransactionsServer(uid, { limit: 2 });
    expect(first.data.map(row => row.trans_id)).toEqual(['tx-05', 'tx-04']);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(decodeTransactionsCursor(first.nextCursor)).toEqual({ date: '2026-08-04', path: `${account}/transactions/tx-04` });

    const second = await getTransactionsServer(uid, { limit: 2, cursor: first.nextCursor });
    expect(second.data.map(row => row.trans_id)).toEqual(['tx-03', 'tx-02']);

    const third = await getTransactionsServer(uid, { limit: 2, cursor: second.nextCursor });
    expect(third.data.map(row => row.trans_id)).toEqual(['tx-01']);
    expect(third.nextCursor).toBeNull();
    expect(gets()).toHaveLength(3);
  });

  it('treats a malformed cursor as the first page and clamps oversized limits', async () => {
    seed(3);
    const page = await getTransactionsServer(uid, { limit: 10_000, cursor: 'not-a-cursor' });
    expect(page.data).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
    expect(decodeTransactionsCursor('not-a-cursor')).toBeNull();
    expect(decodeTransactionsCursor(encodeTransactionsCursor({ date: '2026-01-01', path: 'transactions/x' }))).toEqual({ date: '2026-01-01', path: 'transactions/x' });
    expect(MAX_TRANSACTIONS_PAGE_SIZE).toBe(500);
  });

  it('projects only the requested fields plus identity fields', async () => {
    seed(1);
    const { data } = await getTransactionsServer(uid, { fields: ['amount', 'is_deductible'] });
    expect(data[0]).toMatchObject({ trans_id: 'tx-01', amount: 10, date: expect.stringContaining('2026-08-01') });
    expect(data[0].merchant_name).toBe('');
    expect(data[0].notes).toBeUndefined();
  });
});

describe('getPaginatedTransactionsServer', () => {
  it('counts with an aggregation instead of reading every row', async () => {
    seed(7);
    const { data, pagination } = await getPaginatedTransactionsServer(uid, { page: 2, limit: 3, sortBy: 'date', sortOrder: 'desc' });
    expect(pagination).toMatchObject({ totalCount: 7, totalPages: 3, hasNextPage: true, hasPrevPage: true });
    expect(data.map(row => row.trans_id)).toEqual(['tx-04', 'tx-03', 'tx-02']);
    expect(fake.calls.filter(call => call.kind === 'count')).toHaveLength(1);
    // skip query (offset rows) + page query; no full-collection read for the count
    expect(gets()).toHaveLength(2);
  });
});

describe('GET /api/transactions', () => {
  it('keeps the unpaged contract and adds nextCursor plus a private no-store cache policy when paging', async () => {
    seed(3);
    const full = await listTransactions(new NextRequest('https://writeoffapp.com/api/transactions'));
    const fullBody = await full.json();
    expect(fullBody.count).toBe(3);
    expect(fullBody.nextCursor).toBeNull();
    expect(full.headers.get('Cache-Control')).toBe('private, no-store');

    const paged = await listTransactions(new NextRequest('https://writeoffapp.com/api/transactions?limit=2'));
    const body = await paged.json();
    expect(body.transactions.map((row: { trans_id: string }) => row.trans_id)).toEqual(['tx-03', 'tx-02']);
    expect(body.nextCursor).toEqual(expect.any(String));

    const rest = await listTransactions(new NextRequest(`https://writeoffapp.com/api/transactions?limit=2&cursor=${encodeURIComponent(body.nextCursor)}`));
    expect((await rest.json()).transactions.map((row: { trans_id: string }) => row.trans_id)).toEqual(['tx-01']);
  });

  it('rejects out-of-range page sizes', async () => {
    for (const limit of ['0', 'abc', String(MAX_TRANSACTIONS_PAGE_SIZE + 1)]) {
      const response = await listTransactions(new NextRequest(`https://writeoffapp.com/api/transactions?limit=${limit}`));
      expect(response.status).toBe(400);
    }
  });
});
