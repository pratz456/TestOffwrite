import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), provider: vi.fn(), disconnect: vi.fn(), sync: vi.fn(), profile: vi.fn() }));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: mock.auth }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { doc: mock.db, collection: mock.db }, FieldValue: {} }));
vi.mock('@/lib/plaid/client', () => ({ plaidClient: { accountsGet: mock.provider, itemPublicTokenExchange: mock.provider } }));
vi.mock('@/lib/plaid/delete-item', () => ({ disconnectPlaidItem: mock.disconnect }));
vi.mock('@/lib/plaid/sync-helper', () => ({ syncUserTransactions: mock.sync, syncUserTransactionsIncremental: mock.sync }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: mock.profile }));
vi.mock('@/lib/ai/analyzeTransaction', () => ({ analyzeTransactionWithRetry: mock.provider, convertToEnhancedContext: vi.fn(), findMissingUserFields: vi.fn() }));
vi.mock('firebase-functions', () => ({ config: () => ({}) }));
vi.mock('plaid', () => ({ Configuration: function Configuration() {}, PlaidApi: function PlaidApi() { return { linkTokenCreate: mock.provider, transactionsRecurringGet: mock.provider }; }, PlaidEnvironments: { sandbox: 'https://sandbox.plaid.test' }, Products: { Transactions: 'transactions' }, CountryCode: { Us: 'US' } }));
import { POST as autoAnalyze } from '@/app/api/plaid/auto-analyze/route';
import { POST as createLink } from '@/app/api/plaid/create-link-token/route';
import { POST as exchange } from '@/app/api/plaid/exchange-public-token/route';
import { POST as getAccounts } from '@/app/api/plaid/get-accounts/route';
import { POST as importTransactions } from '@/app/api/plaid/import-transactions/route';
import { POST as recurring } from '@/app/api/plaid/recurring-transactions/route';
import { POST as refresh } from '@/app/api/plaid/refresh-balances/route';
import { POST as sync } from '@/app/api/plaid/sync-transactions/route';
import { GET as items, DELETE as disconnect } from '@/app/api/plaid/items/route';
import { DELETE as disconnectItem } from '@/app/api/plaid/items/[itemId]/route';
import { GET as importStatus } from '@/app/api/plaid/import-status/route';
const request = new NextRequest('http://localhost/api/test', { method: 'POST', body: '{}' });
const handlers = [autoAnalyze, createLink, exchange, getAccounts, importTransactions, recurring, refresh, sync, items, disconnect,
  (req: NextRequest) => disconnectItem(req, { params: { itemId: 'item_fixture' } }), importStatus];
beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockRejectedValue(Error('Missing or invalid Authorization credentials'));
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe('Plaid unauthenticated request boundaries', () => {
  it.each(handlers.map((handler, index) => ({ index, handler })))('returns 401 before data/provider operations for route $index', async ({ handler }) => {
    expect((await handler(request.clone() as NextRequest)).status).toBe(401);
    expect(mock.db).not.toHaveBeenCalled(); expect(mock.provider).not.toHaveBeenCalled();
    expect(mock.disconnect).not.toHaveBeenCalled(); expect(mock.sync).not.toHaveBeenCalled(); expect(mock.profile).not.toHaveBeenCalled();
  });
  it('does not report an idle import when status lookup is unavailable', async () => {
    mock.auth.mockResolvedValue({ uid: 'u1' });
    mock.db.mockImplementation(() => { throw Error('unavailable'); });
    expect((await importStatus(request)).status).toBe(503);
  });
});
