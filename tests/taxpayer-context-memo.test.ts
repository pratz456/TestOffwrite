import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const docs = new Map<string, Record<string, any>>();
  const reads: string[] = [];
  let collectionGroupFailure: { code: unknown } | null = null;
  const snap = (path: string) => ({ id: path.split('/').at(-1)!, ref: ref(path), exists: docs.has(path), data: () => docs.has(path) ? structuredClone(docs.get(path)) : undefined });
  function ref(path: string): any {
    return { path, id: path.split('/').at(-1), get: async () => snap(path), collection: (name: string) => collection(`${path}/${name}`) };
  }
  function collection(prefix: string): any {
    const filters: Array<[string, unknown]> = [];
    let max: number | null = null;
    const query: any = {
      doc: (id: string) => ref(`${prefix}/${id}`),
      where: (field: string, _op: string, value: unknown) => { filters.push([field, value]); return query; },
      limit: (count: number) => { max = count; return query; },
      get: async () => {
        reads.push(prefix);
        let rows = [...docs.keys()].filter(path => path.startsWith(`${prefix}/`) && path.slice(prefix.length + 1).split('/').length === 1)
          .filter(path => filters.every(([field, value]) => docs.get(path)![field] === value));
        if (max !== null) rows = rows.slice(0, max);
        return { empty: rows.length === 0, docs: rows.map(snap) };
      },
    };
    return query;
  }
  function collectionGroup(name: string): any {
    const filters: Array<[string, unknown]> = [];
    let max: number | null = null;
    let order: { field: string; dir: string } | null = null;
    const query: any = {
      where: (field: string, _op: string, value: unknown) => { filters.push([field, value]); return query; },
      orderBy: (field: string, dir = 'asc') => { order = { field, dir }; return query; },
      limit: (count: number) => { max = count; return query; },
      get: async () => {
        reads.push(`collectionGroup(${name})`);
        if (collectionGroupFailure) throw Object.assign(new Error('index missing'), collectionGroupFailure);
        let rows = [...docs.keys()].filter(path => path.split('/').at(-2) === name)
          .filter(path => filters.every(([field, value]) => docs.get(path)![field] === value));
        if (order) rows.sort((a, b) => String(docs.get(order!.field === '__name__' ? a : a)![order!.field]).localeCompare(String(docs.get(b)![order!.field])) * (order!.dir === 'desc' ? -1 : 1));
        if (max !== null) rows = rows.slice(0, max);
        return { empty: rows.length === 0, docs: rows.map(snap) };
      },
    };
    return query;
  }
  const adminDb = {
    doc: ref,
    collection,
    collectionGroup,
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const writes: Array<() => void> = [];
      const result = await fn({
        get: async (r: any) => snap(r.path),
        update: (r: any, data: any) => writes.push(() => docs.set(r.path, { ...docs.get(r.path), ...structuredClone(data) })),
        set: (r: any, data: any) => writes.push(() => docs.set(r.path, structuredClone(data))),
      });
      writes.forEach(write => write());
      return result;
    },
  };
  return { docs, reads, adminDb, setCollectionGroupFailure: (value: { code: unknown } | null) => { collectionGroupFailure = value; } };
});

vi.mock('@/lib/firebase/admin', () => ({ adminDb: fake.adminDb }));

import { CONFIRMED_HISTORY_CAP, CONFIRMED_HISTORY_TTL_MS, invalidateTaxpayerContextCache, loadConfirmedTransactionRecords, loadTaxpayerContext, taxpayerContextCacheSize } from '@/lib/ai/taxpayer-context-server';
import { reviewTransaction } from '@/lib/transactions/review';
import type { UserContext } from '@/lib/ai/analyzeTransaction';

const uid = 'memo-owner';
const account = `user_profiles/${uid}/accounts/checking`;
const profile: UserContext = { user_id: uid, profession: ['Photographer'], filing_state: 'TX', business_entity: 'sole_proprietor', w2_income: 0, business_income: 80000 };

function seedConfirmed(count: number, owner: Record<string, unknown> = { userId: uid }) {
  for (let index = 0; index < count; index++) {
    const day = String(index + 1).padStart(2, '0');
    fake.docs.set(`${account}/transactions/confirmed-${day}`, { merchant_name: 'Adobe Creative Cloud', category: 'software_subscriptions', is_deductible: true,
      review_status: 'confirmed', date: `2026-07-${day}`, amount: 55, iso_currency_code: 'USD', pending: false, account_id: 'checking', ...owner });
  }
  fake.docs.set(`${account}/transactions/pending-row`, { merchant_name: 'Adobe Creative Cloud', review_status: 'pending', date: '2026-08-01', userId: uid });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-17T12:00:00Z'));
  fake.docs.clear();
  fake.reads.length = 0;
  fake.setCollectionGroupFailure(null);
  invalidateTaxpayerContextCache();
  fake.docs.set(`user_profiles/${uid}`, { profession: 'Photographer' });
  fake.docs.set(account, { userId: uid, type: 'depository' });
});
afterEach(() => vi.useRealTimers());

describe('confirmed-history memo', () => {
  it('reads one user\'s history once per TTL window across an analysis batch', async () => {
    seedConfirmed(3);
    const first = await loadTaxpayerContext(uid, profile, 'Adobe Creative Cloud', '2026-09-01');
    expect(first.priors.merchant).toMatchObject({ decision: 'business', confirmations: 3 });
    expect(fake.reads.filter(read => read.startsWith('collectionGroup'))).toHaveLength(1);
    for (let task = 0; task < 5; task++) await loadTaxpayerContext(uid, profile, 'Adobe Creative Cloud', '2026-09-01');
    expect(fake.reads.filter(read => read.startsWith('collectionGroup'))).toHaveLength(1);
    for (const collection of ['w2_income', 'income_1099', 'gross_receipts']) {
      expect(fake.reads.filter(read => read === collection)).toHaveLength(2); // userId + legacy user_id, once per TTL
    }
    expect(taxpayerContextCacheSize()).toBe(1);
  });

  it('adds only year-matched income-form presence, never payer identifiers or amounts', async () => {
    fake.docs.set('w2_income/w2-2026', { userId: uid, taxYear: 2026, employer: 'Private employer', ein: '12-3456789', wages: 50_000 });
    fake.docs.set('income_1099/nec-2026', { userId: uid, taxYear: 2026, formType: '1099-NEC', payerName: 'Private payer', amount: 10_000 });
    fake.docs.set('income_1099/old-2025', { userId: uid, taxYear: 2025, formType: '1099-K' });
    fake.docs.set('gross_receipts/receipt-2026', { userId: uid, taxYear: 2026, source: 'Private client', amount: 500 });
    const context = await loadTaxpayerContext(uid, profile, 'Adobe', '2026-09-01');
    expect(context.identity.taxYearRecords).toEqual({
      taxYear: 2026,
      hasW2: true,
      form1099Types: ['1099-NEC'],
      hasGrossReceipts: true,
    });
    expect(JSON.stringify(context)).not.toMatch(/Private employer|Private payer|Private client|12-3456789|50000|10000/);
  });

  it('memoizes per user and expires after the TTL', async () => {
    seedConfirmed(1);
    await loadConfirmedTransactionRecords(uid);
    await loadConfirmedTransactionRecords('someone-else');
    // owner: one group query; other user: empty group query + accounts listing (no accounts to read)
    expect(fake.reads).toEqual(['collectionGroup(transactions)', 'collectionGroup(transactions)', 'user_profiles/someone-else/accounts']);
    expect(taxpayerContextCacheSize()).toBe(2);
    fake.reads.length = 0;
    await loadConfirmedTransactionRecords(uid);
    expect(fake.reads).toEqual([]);
    vi.advanceTimersByTime(CONFIRMED_HISTORY_TTL_MS + 1);
    await loadConfirmedTransactionRecords(uid);
    expect(fake.reads).toEqual(['collectionGroup(transactions)']);
  });

  it('is invalidated when a review confirms or corrects a transaction', async () => {
    seedConfirmed(1);
    fake.docs.set(`${account}/transactions/new-row`, { userId: uid, account_id: 'checking', amount: 40, date: '2026-09-10', merchant_name: 'Office Depot',
      category: 'supplies', iso_currency_code: 'USD', pending: false, is_deductible: null });
    expect((await loadConfirmedTransactionRecords(uid))).toHaveLength(1);
    await reviewTransaction(uid, 'new-row', { action: 'correct', accountId: 'checking', category: 'supplies_small_tools', transactionKind: 'expense', isDeductible: true, reason: 'Printer paper for client proofs' });
    expect(fake.docs.get(`${account}/transactions/new-row`)).toMatchObject({ review_status: 'confirmed', is_deductible: true });
    expect(taxpayerContextCacheSize()).toBe(0);
    expect((await loadConfirmedTransactionRecords(uid))).toHaveLength(2);
  });

  it('does not cache failed reads and never fails analysis context', async () => {
    seedConfirmed(1);
    fake.setCollectionGroupFailure({ code: 'UNAVAILABLE' });
    const context = await loadTaxpayerContext(uid, profile, 'Adobe Creative Cloud', '2026-09-01');
    expect(context.priors.merchant).toBeNull();
    expect(taxpayerContextCacheSize()).toBe(0);
    fake.setCollectionGroupFailure(null);
    const recovered = await loadTaxpayerContext(uid, profile, 'Adobe Creative Cloud', '2026-09-01');
    expect(recovered.priors.merchant).toMatchObject({ confirmations: 1 });
  });

  it('falls back to per-account reads when the composite index is missing or rows lack userId', async () => {
    seedConfirmed(2, { user_id: uid });
    expect(await loadConfirmedTransactionRecords(uid)).toHaveLength(2);
    expect(fake.reads).toEqual(['collectionGroup(transactions)', `user_profiles/${uid}/accounts`, `${account}/transactions`]);

    invalidateTaxpayerContextCache(uid);
    fake.reads.length = 0;
    fake.setCollectionGroupFailure({ code: 9 });
    expect(await loadConfirmedTransactionRecords(uid)).toHaveLength(2);
    expect(fake.reads[0]).toBe('collectionGroup(transactions)');
    expect(fake.reads).toContain(`${account}/transactions`);
  });

  it('caps the history at CONFIRMED_HISTORY_CAP rows', async () => {
    seedConfirmed(CONFIRMED_HISTORY_CAP + 25);
    expect(await loadConfirmedTransactionRecords(uid)).toHaveLength(CONFIRMED_HISTORY_CAP);
  });

  it.each(['indexed', 'legacy'] as const)('excludes withdrawn, pending and superseded confirmations from %s merchant history', async (source) => {
    const owner = source === 'indexed' ? { userId: uid } : { user_id: uid };
    seedConfirmed(1, owner);
    const confirmed = fake.docs.get(`${account}/transactions/confirmed-01`)!;
    for (const [id, excluded] of [
      ['withdrawn', { bank_removed: true }],
      ['pending', { pending: true }],
      ['superseded', { superseded_by: `${account}/transactions/confirmed-01` }],
    ] as const) fake.docs.set(`${account}/transactions/${id}`, { ...confirmed, ...excluded });

    const history = await loadConfirmedTransactionRecords(uid);
    expect(history).toHaveLength(1);
    const context = await loadTaxpayerContext(uid, profile, 'Adobe Creative Cloud', '2026-09-01');
    expect(context.priors.merchant).toMatchObject({ decision: 'business', confirmations: 1 });
    expect(context.priors.recurrence.isRecurring).toBe(false);
  });
});
