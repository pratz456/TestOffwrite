import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({ profile: {} as Record<string, unknown>, link: vi.fn(), fetchTransactions: vi.fn(), accounts: vi.fn(), auth: vi.fn(), trial: vi.fn() }));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: mock.auth }));
vi.mock('@/lib/subscriptions/trial-manager', () => ({ startFreeTrial: mock.trial }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { doc: () => ({ get: async () => ({ exists: true, data: () => mock.profile }), update: vi.fn(), set: vi.fn() }) } }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('plaid', () => ({ Configuration: function Configuration() {}, PlaidApi: function PlaidApi() { return { linkTokenCreate: mock.link }; }, PlaidEnvironments: { sandbox: 'https://sandbox.plaid.test' }, Products: { Transactions: 'transactions' }, CountryCode: { Us: 'US' } }));
vi.mock('@/lib/plaid/client', () => ({ plaidClient: { accountsGet: mock.accounts, linkTokenCreate: mock.link } }));
vi.mock('@/lib/plaid/connections', () => {
  const connection = { uid: 'u1', itemId: 'item_1', accessToken: 'owned-token', accountIds: ['acc_1'] };
  return { listPlaidConnections: async () => [connection], getPlaidConnection: async () => connection,
    withPlaidConnection: async (_uid: string, _item: string, work: any) => work(connection, 'lease'), updatePlaidConnection: vi.fn() };
});
vi.mock('@/lib/plaid/pagination', () => ({ fetchAllPlaidTransactions: mock.fetchTransactions }));
import { POST as createLink } from '@/app/api/plaid/create-link-token/route';
import { POST as importTransactions } from '@/app/api/plaid/import-transactions/route';
import { resetRateLimitStore } from './fixtures/rate-limit-store';
const now = new Date('2026-09-15T12:00:00Z');
const future = new Date('2026-10-01T12:00:00Z');
const paid = { subscriptionStatus: 'active', subscriptionPlan: 'premium', stripeSubscriptionStatus: 'active', stripeSubscriptionId: 'sub_1', subscriptionEnd: future };
const trial = { subscriptionStatus: 'trial', trialStart: new Date('2026-09-01'), trialEnd: future };
const req = (body: unknown = {}) => new NextRequest('http://localhost/api/test', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); resetRateLimitStore();
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('PLAID_CLIENT_ID', 'mock-client'); vi.stubEnv('PLAID_SECRET', 'mock-secret'); vi.stubEnv('PLAID_ENV', 'sandbox');
  mock.auth.mockResolvedValue({ uid: 'u1' }); mock.trial.mockResolvedValue({ success: true }); mock.profile = { subscriptionStatus: 'expired', plaid_token: 'owned-token' };
  mock.link.mockResolvedValue({ data: { link_token: 'mock-link' } });
  mock.accounts.mockResolvedValue({ data: { accounts: [{ account_id: 'acc_1', name: 'Synthetic', type: 'depository', subtype: 'checking' }] } });
  mock.fetchTransactions.mockResolvedValue({ transactions: [], totalPages: 0, totalTransactions: 0 });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('Plaid API uses server plan rather than a requested timeframe', () => {
  it.each([[{}, 90], [trial, 730], [paid, 730], [{ ...paid, subscriptionPlan: 'basic' }, 730], [{ ...paid, stripeSubscriptionStatus: 'past_due' }, 90]] as const)('creates a link with the allowed history window %j', async (profile, days) => {
    mock.profile = { ...mock.profile, ...profile };
    expect((await createLink(req({ days_requested: 7300 }))).status).toBe(200);
    expect(mock.link.mock.calls[0][0].transactions.days_requested).toBe(days);
  });
  it.each([[{}, '2026-06-17'], [paid, '2024-09-15'], [{ ...paid, subscriptionPlan: 'basic' }, '2024-09-15']] as const)('caps direct import even if the caller requests 2years %j', async (profile, startDate) => {
    mock.profile = { ...mock.profile, ...profile };
    await importTransactions(req({ account_id: 'acc_1', import_timeframe: '2years' }));
    expect(mock.fetchTransactions).toHaveBeenCalled();
    expect(mock.fetchTransactions.mock.calls[0][1].start_date).toBe(startDate);
  });
  it('rejects another bank token before sending it to Plaid', async () => {
    expect((await importTransactions(req({ account_id: 'acc_1', access_token: 'someone-elses-token' }))).status).toBe(400);
    expect(mock.accounts).not.toHaveBeenCalled(); expect(mock.fetchTransactions).not.toHaveBeenCalled();
  });
});
