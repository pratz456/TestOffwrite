import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ queries: [] as any[], results: new Map<string, any[]>(), fail: '' }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collectionGroup: (collection: string) => {
  const q: any = { collection };
  h.queries.push(q);
  const chain: any = {
    where: (owner: string, operator: string, uid: string) => { Object.assign(q, { owner, operator, uid }); return chain; },
    orderBy: (field: string, direction: string) => { q.order = [field, direction]; return chain; },
    select: (...fields: string[]) => { q.fields = fields; return chain; },
    limit: (limit: number) => { q.limit = limit; return chain; },
    get: async () => { if (q.owner === h.fail) throw new Error('private index or network failure'); return { docs: h.results.get(q.owner) ?? [] }; },
  }; return chain;
} } }));
import { readAssistantTransactions } from '@/lib/tax-assistant/account-records';
const doc = (id: string, data: Record<string, any>, path = `user_profiles/owner/accounts/bank/transactions/${id}`) => ({ id, ref: { path }, data: () => data });
beforeEach(() => { h.queries = []; h.results.clear(); h.fail = ''; });
describe('bounded assistant transaction reader', () => {
  it('requires both owner queries, raw owner/currency fields, date ordering and a per-query limit', async () => {
    const record = doc('one', { userId: 'owner', user_id: 'owner', date: '2026-09-10T00:00:00.000Z', amount: 52, iso_currency_code: 'USD' });
    h.results.set('userId', [record]); h.results.set('user_id', [record]);
    expect(await readAssistantTransactions('owner')).toEqual([expect.objectContaining({ userId: 'owner', user_id: 'owner', date: '2026-09-10', amount: 52, iso_currency_code: 'USD' })]);
    expect(h.queries).toHaveLength(2);
    for (const q of h.queries) {
      expect(q).toMatchObject({ collection: 'transactions', uid: 'owner', operator: '==', order: ['date', 'desc'], limit: 500 });
      expect(q.fields).toEqual(expect.arrayContaining(['userId', 'user_id', 'iso_currency_code', 'unofficial_currency_code', 'bank_removed', 'date']));
    }
  });
  it.each(['userId', 'user_id'])('propagates failed %s reads rather than returning partial or empty success', async owner => {
    h.results.set('userId', [doc('one', { userId: 'owner', date: '2026-09-10' })]); h.fail = owner;
    await expect(readAssistantTransactions('owner')).rejects.toThrow();
  });
  it.each([
    doc('one', { userId: 'owner', user_id: 'victim', date: '2026-09-10' }),
    doc('one', { userId: 'owner', date: '2026-09-10' }, 'user_profiles/victim/accounts/bank/transactions/one'),
    doc('one', { date: '2026-09-10' }),
  ])('rejects conflicting or missing ownership', async record => {
    h.results.set('userId', [record]); await expect(readAssistantTransactions('owner')).rejects.toThrow();
  });
  it('does not silently drop invalid dated records', async () => {
    h.results.set('userId', [doc('one', { userId: 'owner', date: '2026-02-30' })]);
    await expect(readAssistantTransactions('owner')).rejects.toThrow('Invalid dated');
  });
  it('takes the newest 500 across both owner spellings without double-counting the same document', async () => {
    h.results.set('userId', Array.from({ length: 500 }, (_, i) => doc(`old-${i}`, { userId: 'owner', date: '2026-01-01' })));
    h.results.set('user_id', [doc('new', { user_id: 'owner', date: '2026-09-10' })]);
    const rows = await readAssistantTransactions('owner'); expect(rows).toHaveLength(500); expect(rows[0].id).toBe('new');
  });
});
