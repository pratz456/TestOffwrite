import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { id: string; data: Record<string, any> };

/** Fake of the small query surface the pager needs, honoring orderBy/startAfter/limit like Firestore. */
function fakeQuery(rows: () => Row[], filter: (row: Row) => boolean, calls: number[], orders: string[] = [], after: unknown[] | null = null, max: number | null = null): any {
  const compare = (a: unknown, b: unknown) => (a === b ? 0 : (a as any) < (b as any) ? -1 : 1);
  return {
    orderBy: (field: unknown) => fakeQuery(rows, filter, calls, [...orders, typeof field === 'string' ? field : '__name__'], after, max),
    startAfter: (...values: unknown[]) => fakeQuery(rows, filter, calls, orders, values, max),
    limit: (count: number) => fakeQuery(rows, filter, calls, orders, after, count),
    async get() {
      calls.push(max ?? -1);
      const value = (row: Row, field: string) => (field === '__name__' ? row.id : row.data[field]);
      let list = rows().filter(filter).sort((a, b) => {
        for (const field of orders) { const result = compare(value(a, field), value(b, field)); if (result !== 0) return result; }
        return 0;
      });
      if (after) list = list.filter(row => {
        for (const [index, field] of orders.entries()) { const result = compare(value(row, field), after[index]); if (result !== 0) return result > 0; }
        return false;
      });
      if (max !== null) list = list.slice(0, max);
      return { docs: list.map(row => ({ id: row.id, data: () => row.data, get: (field: string) => row.data[field] })) };
    },
  };
}

const profiles = vi.hoisted(() => new Map<string, Record<string, any>>());
const notifications = vi.hoisted(() => new Map<string, Record<string, any>>());
const pending = vi.hoisted(() => new Map<string, number>());
const countCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('@/lib/firebase/admin', () => {
  const rows = () => [...profiles.entries()].map(([id, data]) => ({ id, data }));
  const adminDb = {
    collection: (name: string) => {
      if (name === 'user_profiles') return Object.assign(fakeQuery(rows, () => true, []), {
        where: (field: string, _op: string, value: number) => fakeQuery(rows, row => row.data[field] > value, []),
      });
      return { doc: (id: string) => ({
        set: async (data: Record<string, any>) => { notifications.set(id, data); },
        get: async () => ({ exists: false }),
      }) };
    },
    collectionGroup: () => {
      const filters: Array<[string, unknown]> = [];
      const query: any = {
        where: (field: string, _op: string, value: unknown) => { filters.push([field, value]); return query; },
        count: () => ({ get: async () => { countCalls.n++; const uid = filters.find(([field]) => field === 'userId')![1] as string; return { data: () => ({ count: pending.get(uid) ?? 0 }) }; } }),
      };
      return query;
    },
  };
  return { adminDb };
});

import { decodeBatchCursor, runUserProfileBatch, USER_PROFILE_PAGE_SIZE } from '@/lib/notifications/user-profile-batch';
import { notificationEngine } from '@/lib/notifications/notification-engine';

function seedProfiles(count: number, data: (index: number) => Record<string, any> = () => ({})) {
  profiles.clear();
  for (let index = 0; index < count; index++) profiles.set(`user-${String(index).padStart(4, '0')}`, data(index));
}

beforeEach(() => { profiles.clear(); notifications.clear(); pending.clear(); countCalls.n = 0; });

describe('runUserProfileBatch', () => {
  it('pages 200 profiles per query and reports completion with a null cursor', async () => {
    seedProfiles(450);
    const calls: number[] = [];
    const seen: string[] = [];
    const result = await runUserProfileBatch(fakeQuery(() => [...profiles].map(([id, data]) => ({ id, data })), () => true, calls), null,
      async doc => { seen.push(doc.id); });
    expect(USER_PROFILE_PAGE_SIZE).toBe(200);
    expect(calls).toEqual([200, 200, 200]);
    expect(result).toMatchObject({ processed: 450, failures: 0, pages: 3, complete: true, nextCursor: null });
    expect(new Set(seen).size).toBe(450);
  });

  it('stops at the time budget and resumes from the cursor without skipping or repeating anyone', async () => {
    seedProfiles(500);
    let clock = 0;
    const now = () => clock;
    const seen: string[] = [];
    const rows = () => [...profiles].map(([id, data]) => ({ id, data }));
    const first = await runUserProfileBatch(fakeQuery(rows, () => true, []), null, async doc => { seen.push(doc.id); clock += 10; }, { now, timeBudgetMs: 1_000 });
    expect(first.complete).toBe(false);
    expect(first.processed).toBe(100);
    expect(decodeBatchCursor(first.nextCursor)).toEqual({ id: 'user-0099', values: [] });

    clock = 0;
    const second = await runUserProfileBatch(fakeQuery(rows, () => true, []), null, async doc => { seen.push(doc.id); }, { now, cursor: first.nextCursor, timeBudgetMs: 1_000 });
    expect(second).toMatchObject({ processed: 400, complete: true, nextCursor: null });
    expect(seen).toHaveLength(500);
    expect(new Set(seen).size).toBe(500);
  });

  it('orders by the range-filtered field first and carries its value in the cursor', async () => {
    seedProfiles(6, index => ({ business_income: index < 3 ? 0 : 5000 }));
    const rows = () => [...profiles].map(([id, data]) => ({ id, data }));
    let clock = 0;
    const seen: string[] = [];
    const base = fakeQuery(rows, row => row.data.business_income > 0, []);
    const first = await runUserProfileBatch(base, 'business_income', async doc => { seen.push(doc.id); clock += 600; }, { now: () => clock, timeBudgetMs: 1_000, pageSize: 200 });
    expect(first.processed).toBe(2);
    expect(decodeBatchCursor(first.nextCursor)).toEqual({ id: 'user-0004', values: [5000] });
    const second = await runUserProfileBatch(base, 'business_income', async doc => { seen.push(doc.id); }, { now: () => 0, cursor: first.nextCursor, pageSize: 200 });
    expect(second).toMatchObject({ processed: 1, complete: true });
    expect(seen).toEqual(['user-0003', 'user-0004', 'user-0005']);
  });

  it('isolates handler failures so one profile cannot stop the batch', async () => {
    seedProfiles(5);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runUserProfileBatch(fakeQuery(() => [...profiles].map(([id, data]) => ({ id, data })), () => true, []), null,
      async doc => { if (doc.id === 'user-0002') throw new Error('boom'); });
    expect(result).toMatchObject({ processed: 5, failures: 1, complete: true });
    errors.mockRestore();
  });
});

describe('NotificationEngine batch jobs', () => {
  it('counts pending rows with an aggregation and pages profiles with the configured size', async () => {
    seedProfiles(5);
    pending.set('user-0001', 7);
    pending.set('user-0003', 25);
    const result = await notificationEngine.generateUnreviewedTransactionsNotifications({ pageSize: 2 });
    expect(result).toMatchObject({ processed: 5, pages: 3, complete: true, nextCursor: null });
    expect(countCalls.n).toBe(5);
    const sent = [...notifications.values()].filter(row => row.type === 'unreviewed_transactions');
    expect(sent.map(row => [row.userId, row.priority, row.data.count])).toEqual([['user-0001', 'medium', 7], ['user-0003', 'high', 25]]);
  });

  it('returns the resume cursor when the budget stops a run early', async () => {
    seedProfiles(4);
    const result = await notificationEngine.generateUnreviewedTransactionsNotifications({ pageSize: 2, timeBudgetMs: 0 });
    expect(result).toMatchObject({ processed: 1, complete: false });
    expect(decodeBatchCursor(result!.nextCursor)).toEqual({ id: 'user-0000', values: [] });
  });
});
