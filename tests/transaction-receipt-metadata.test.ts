import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ groupGet: vi.fn(), nestedGet: vi.fn(), set: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => {
  function reference(path: string[] = []): any {
    return {
      collection: (name: string) => reference([...path, name]),
      doc: (id: string) => reference([...path, id]),
      get: () => mocks.nestedGet(path),
      set: mocks.set,
    };
  }
  return { adminDb: {
    ...reference(),
    collectionGroup: () => {
      const query: any = { get: mocks.groupGet };
      for (const method of ['where', 'limit', 'orderBy', 'startAfter']) query[method] = () => query;
      return query;
    },
  } };
});
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'owner' }, error: null }) }));
vi.mock('@/lib/ai/learning-engine', () => ({ aiLearningEngine: { recordCorrection: vi.fn() } }));

import { GET } from '../app/api/transactions/[id]/route';
import { createTransactionServer, getPaginatedTransactionsServer } from '../lib/firebase/transactions-server';

const receipt = { receipt_url: '/api/receipts/stored-receipt', receipt_filename: 'office-supplies.png' };
const transaction = { trans_id: 'saved-expense', userId: 'owner', account_id: 'manual', merchant_name: 'Synthetic office supplies', amount: 25, category: 'supplies', date: '2026-09-02' };
function document(data: Record<string, unknown>) { return { id: transaction.trans_id, exists: true,
  ref: { path: `user_profiles/owner/accounts/manual/transactions/${transaction.trans_id}` }, data: () => data }; }
function snapshot(docs: ReturnType<typeof document>[]) { return { empty: docs.length === 0, docs, size: docs.length, forEach: (visit: (doc: ReturnType<typeof document>) => void) => docs.forEach(visit) }; }

beforeEach(() => { vi.clearAllMocks(); mocks.groupGet.mockReset(); mocks.nestedGet.mockReset(); mocks.set.mockResolvedValue(undefined); });

describe('receipt metadata survives transaction reloads', () => {
  it('rejects a collection-group hit whose path belongs to a different owner', async () => {
    const doc = document(transaction); doc.ref.path = 'user_profiles/other/accounts/manual/transactions/saved-expense';
    mocks.groupGet.mockResolvedValue(snapshot([doc])); mocks.nestedGet.mockResolvedValue({ docs: [] });
    const response = await GET(new NextRequest('https://writeoff.test/api/transactions/saved-expense'), { params: Promise.resolve({ id: transaction.trans_id }) });
    expect(response.status).toBe(404);
  });
  for (const lookup of ['userId', 'user_id', 'account'] as const) {
    it.each([receipt, { receipt_url: '', receipt_filename: '' }])(`detail GET preserves saved or explicitly cleared receipt fields through ${lookup} lookup`, async fields => {
      const doc = document({ ...transaction, ...fields });
      if (lookup === 'userId') mocks.groupGet.mockResolvedValue(snapshot([doc]));
      if (lookup === 'user_id') mocks.groupGet.mockResolvedValueOnce(snapshot([])).mockResolvedValueOnce(snapshot([doc]));
      if (lookup === 'account') {
        mocks.groupGet.mockResolvedValue(snapshot([]));
        mocks.nestedGet.mockImplementation(async (path: string[]) => path.at(-1) === 'accounts' ? { docs: [{ id: 'manual' }] } : snapshot([doc]));
      }
      const response = await GET(new NextRequest('https://writeoff.test/api/transactions/saved-expense'), { params: Promise.resolve({ id: transaction.trans_id }) });
      expect(response.status).toBe(200);
      expect((await response.json()).transaction).toMatchObject({ trans_id: transaction.trans_id, ...fields });
    });
  }

  it('paginated transaction reload preserves the stored receipt', async () => {
    mocks.groupGet.mockResolvedValue(snapshot([document({ ...transaction, ...receipt })]));
    const result = await getPaginatedTransactionsServer('owner', { page: 1, limit: 20 });
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject(receipt);
  });

  it('new receipt transaction returns the metadata actually stored in Firestore', async () => {
    mocks.nestedGet.mockResolvedValueOnce({ exists: false }).mockImplementationOnce(async () => document(mocks.set.mock.calls[0][0]));
    const result = await createTransactionServer('owner', 'manual', { ...transaction, ...receipt });
    expect(result.error).toBeNull();
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining(receipt));
    expect(result.data).toMatchObject(receipt);
  });

  it('idempotent creation returns the existing receipt without replacing it', async () => {
    mocks.nestedGet.mockResolvedValue(document({ ...transaction, ...receipt }));
    const result = await createTransactionServer('owner', 'manual', { ...transaction, receipt_url: '/api/receipts/ignored' });
    expect(result.error).toBeNull();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(result.data).toMatchObject(receipt);
  });
});
