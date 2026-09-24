/**
 * Bank disconnect, sync and billing-portal routes report a missing connection
 * as 404 and a store or provider failure as 503 with a fixed message, never the
 * underlying exception text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contractRequest, installApiRouteMocks, routeContext, CONTRACT_OWNER } from './fixtures/api-route-harness';

const harness = installApiRouteMocks();
const storeFailure = 'store-detail-51c2 at /srv/node_modules/firebase-admin/lib/index.js:1:1';

const itemRoute = () => import('../app/api/plaid/items/[itemId]/route');
const itemsRoute = () => import('../app/api/plaid/items/route');
const syncRoute = () => import('../app/api/plaid/sync-transactions/route');
const portalRoute = () => import('../app/api/stripe/create-portal-session/route');

const itemContext = (itemId: string) => routeContext({ file: '', importPath: '', pattern: '/api/plaid/items/[itemId]', requestPath: `/api/plaid/items/${itemId}`, params: { itemId }, source: '' });

beforeEach(async () => {
  await harness.reset();
  harness.seedOwnerProfile();
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('DELETE /api/plaid/items/[itemId]', () => {
  it('answers 404 for a connection the owner does not have', async () => {
    const { DELETE } = await itemRoute();
    const response = await DELETE(contractRequest('/api/plaid/items/item-missing', { method: 'DELETE', auth: 'owner' }), itemContext('item-missing'));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Bank connection not found' });
  });

  it('rejects an item id with a path separator', async () => {
    const { DELETE } = await itemRoute();
    const response = await DELETE(contractRequest('/api/plaid/items/a%2Fb', { method: 'DELETE', auth: 'owner' }), itemContext('a/b'));
    expect(response.status).toBe(400);
  });

  it('answers 503 with a fixed message when the store fails', async () => {
    harness.failDatabase(new Error(storeFailure));
    const { DELETE } = await itemRoute();
    const response = await DELETE(contractRequest('/api/plaid/items/item-1', { method: 'DELETE', auth: 'owner' }), itemContext('item-1'));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain('store-detail-51c2');
    expect(JSON.parse(text)).toEqual({ error: 'Unable to disconnect bank' });
  });
});

describe('DELETE /api/plaid/items', () => {
  it('answers 503 with a fixed message when the store fails', async () => {
    harness.failDatabase(new Error(storeFailure));
    const { DELETE } = await itemsRoute();
    const response = await DELETE(contractRequest('/api/plaid/items', { method: 'DELETE', auth: 'owner' }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('store-detail-51c2');
  });

  it('asks which bank to disconnect when several are linked', async () => {
    for (const itemId of ['item-a', 'item-b']) {
      harness.db.records.set(`plaid_connections/${CONTRACT_OWNER.uid}_${itemId}`, { uid: CONTRACT_OWNER.uid, itemId, status: 'active', accountIds: [], accessToken: 'enc' });
    }
    const { DELETE } = await itemsRoute();
    const response = await DELETE(contractRequest('/api/plaid/items', { method: 'DELETE', auth: 'owner' }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Choose the bank connection to disconnect' });
  });
});

describe('POST /api/plaid/sync-transactions', () => {
  it('answers 404 when no bank is connected', async () => {
    const { POST } = await syncRoute();
    const response = await POST(contractRequest('/api/plaid/sync-transactions', { method: 'POST', auth: 'owner', body: {} }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: 'No bank connection found' });
  });

  it('rejects sync options of the wrong shape', async () => {
    const { POST } = await syncRoute();
    for (const body of [{ itemId: 'a/b' }, { incremental: 'yes' }, { import_timeframe: 42 }]) {
      const response = await POST(contractRequest('/api/plaid/sync-transactions', { method: 'POST', auth: 'owner', body }));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe('POST /api/stripe/create-portal-session', () => {
  it('answers 503 when the billing provider cannot be reached', async () => {
    // A linked customer is required before the portal can contact Stripe.
    // Missing identities correctly receive BILLING_ACCOUNT_REQUIRED instead.
    harness.seedOwnerProfile({ stripeCustomerId: 'cus_contract_owner' });
    const { POST } = await portalRoute();
    const response = await POST(contractRequest('/api/stripe/create-portal-session', { method: 'POST', auth: 'owner' }));
    expect(response.status).toBe(503);
    expect(harness.fetch).toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: 'Billing is temporarily unavailable. Please try again.' });
  });
});
