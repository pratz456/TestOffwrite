import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ deleteQuery: vi.fn(), deleteUser: vi.fn(), deleteProfile: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: { deleteUser: mocks.deleteUser },
  adminDb: { doc: (path: string) => ({ path, delete: mocks.deleteProfile, get: async () => ({ data: () => ({ deletionRequested: true }) }) }),
  runTransaction: async (work: any) => work({ get: (ref: any) => ref.get(), set: vi.fn() }),
  recursiveDelete: mocks.deleteProfile, collection: (name: string) => ({
    where: (field: string, operator: string, value: string) => ({ name, field, operator, value, get: async () => ({ docs: [] }) }),
    doc: () => ({ delete: mocks.deleteProfile, collection: () => ({ get: async () => ({ docs: [] }) }) }),
  }) },
}));
vi.mock('@/lib/plaid/connections', () => ({ listPlaidConnectionSummaries: async () => [] }));
vi.mock('@/lib/plaid/link-operations', () => ({ recoverPendingPlaidLinks: async () => {} }));
vi.mock('@/lib/firebase/receipt-security', () => ({ receiptBucket: () => ({ deleteFiles: async () => {} }) }));
vi.mock('@/lib/plaid/delete-item', () => ({ disconnectPlaidItem: async () => ({ success: true }) }));
vi.mock('@/lib/stripe/cancel-subscription', () => ({ cancelUserStripeSubscriptions: async () => ({ success: true }) }));
vi.mock('@/lib/firebase/delete-helpers', () => ({ deleteSubcollection: vi.fn(), deleteQueryBatch: mocks.deleteQuery }));
import { deleteUserData } from '@/lib/firebase/delete-user-data';
afterEach(() => vi.restoreAllMocks());
it('account deletion includes durable tasks using their actual owner field and never an unscoped query', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.deleteQuery.mockResolvedValue(1);
  expect(await deleteUserData('synthetic-deleted-owner')).toEqual({});
  expect(mocks.deleteQuery).toHaveBeenCalledWith(expect.objectContaining({ name: 'analysis_tasks', field: 'userId', operator: '==', value: 'synthetic-deleted-owner' }), 500, expect.any(Function));
  for (const name of ['analysis_jobs', 'analysis_status']) {
    for (const field of ['userId', 'user_id']) {
      expect(mocks.deleteQuery).toHaveBeenCalledWith(expect.objectContaining({ name, field, operator: '==', value: 'synthetic-deleted-owner' }), 500, expect.any(Function));
    }
  }
  expect(mocks.deleteQuery.mock.calls.filter(([query]) => query.name === 'analysis_tasks')).toHaveLength(1);
  expect(mocks.deleteQuery.mock.calls.every(([query]) => query.value === 'synthetic-deleted-owner' && query.operator === '==')).toBe(true);
  expect(mocks.deleteUser).toHaveBeenCalledWith('synthetic-deleted-owner');
});
