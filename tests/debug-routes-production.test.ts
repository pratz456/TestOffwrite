import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ profile: vi.fn(), historical: vi.fn(), transactions: vi.fn() }));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: async () => ({ uid: 'owner' }) }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'owner' }, error: null }) }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { doc: mocks.profile, collection: mocks.profile } }));
vi.mock('@/lib/subscriptions/trial-manager', () => ({ getUserSubscriptionStatus: mocks.historical, userHasHistoricalAccess: mocks.historical }));
vi.mock('@/lib/subscriptions/historical-access', () => ({ checkHistoricalAccess: mocks.historical }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: mocks.transactions }));

import { GET as debugAccess } from '../app/api/subscriptions/debug-access/route';
import { GET as transactionStatus } from '../app/api/debug/transaction-status/route';
import { GET as debugTransactions } from '../app/api/debug/transactions/route';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('diagnostic routes in production', () => {
  it.each([
    ['subscriptions/debug-access', () => debugAccess(new Request('https://writeoffapp.com/api/subscriptions/debug-access'))],
    ['debug/transaction-status', () => transactionStatus(new Request('https://writeoffapp.com/api/debug/transaction-status') as never)],
    ['debug/transactions', () => debugTransactions(new Request('https://writeoffapp.com/api/debug/transactions') as never)],
  ])('%s returns 404 for an authenticated user without touching billing or record data', async (_name, call) => {
    vi.stubEnv('NODE_ENV', 'production');
    const response = await call();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.historical).not.toHaveBeenCalled();
    expect(mocks.transactions).not.toHaveBeenCalled();
  });
});
