import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({ auth: vi.fn(), connection: vi.fn(), link: vi.fn(), trial: vi.fn(), history: vi.fn(), historyReady: vi.fn() }));
vi.mock('@/lib/plaid/history-review', () => ({ assertBankHistoryReadyForNewConnection: mock.historyReady,
  BANK_HISTORY_REVIEW_REQUIRED: 'BANK_HISTORY_REVIEW_REQUIRED', BANK_HISTORY_REVIEW_MESSAGE: 'Review saved bank history with WriteOff support.' }));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: mock.auth }));
vi.mock('@/lib/plaid/connections', () => ({ getPlaidConnection: mock.connection }));
vi.mock('@/lib/plaid/client', () => ({ plaidClient: { linkTokenCreate: mock.link } }));
vi.mock('@/lib/subscriptions/trial-manager', () => ({ startFreeTrial: mock.trial }));
vi.mock('@/lib/subscriptions/history-window', () => ({ getTransactionHistoryWindow: mock.history }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
import { POST } from '@/app/api/plaid/create-link-token/route';
import { RATE_LIMITS } from '@/lib/security/rate-limit';
import { exhaustRateLimit, failRateLimitStore, resetRateLimitStore } from './fixtures/rate-limit-store';
const req = (body = {}) => new NextRequest('https://staging.example.test/api/plaid/create-link-token', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); resetRateLimitStore(); mock.auth.mockResolvedValue({ uid: 'owner' }); mock.link.mockResolvedValue({ data: { link_token: 'public-link-token' } });
  mock.historyReady.mockResolvedValue(undefined);
  mock.connection.mockResolvedValue({ uid: 'owner', itemId: 'owned-item', accessToken: 'synthetic-private-token' }); mock.trial.mockResolvedValue({ success: true });
  mock.history.mockResolvedValue({ days: 90 }); vi.stubEnv('PLAID_ENV', 'sandbox'); vi.stubEnv('PLAID_WEBHOOK_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://staging.example.test'); vi.stubEnv('VERCEL_URL', '');
  vi.stubEnv('PLAID_REDIRECT_URI', '');
});
afterEach(() => vi.unstubAllEnvs());
describe('authenticated bank Link update mode', () => {
  it('blocks legacy-history new Items before trial or provider work', async () => {
    mock.historyReady.mockRejectedValue(new Error('BANK_HISTORY_REVIEW_REQUIRED'));
    const response = await POST(req());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'BANK_HISTORY_REVIEW_REQUIRED' });
    expect(mock.historyReady).toHaveBeenCalledWith('owner');
    expect(mock.trial).not.toHaveBeenCalled(); expect(mock.link).not.toHaveBeenCalled();
  });
  it('continues repairing an owned current-provider Item even with legacy history', async () => {
    mock.historyReady.mockRejectedValue(new Error('BANK_HISTORY_REVIEW_REQUIRED'));
    expect((await POST(req({ itemId: 'owned-item' }))).status).toBe(200);
    expect(mock.historyReady).not.toHaveBeenCalled();
    expect(mock.link.mock.calls[0][0]).toHaveProperty('access_token', 'synthetic-private-token');
  });
  it('fails closed when bank history cannot be checked', async () => {
    mock.historyReady.mockRejectedValue(new Error('store unavailable'));
    expect((await POST(req())).status).toBe(503);
    expect(mock.link).not.toHaveBeenCalled(); expect(mock.trial).not.toHaveBeenCalled();
  });
  it('uses an owned server token, omits new-item product/history parameters, and returns only a public Link token', async () => {
    const response = await POST(req({ itemId: 'owned-item', access_token: 'injected-token' }));
    expect(response.status).toBe(200);
    const body = await response.json(); expect(body).toEqual({ link_token: 'public-link-token', mode: 'update', itemId: 'owned-item' });
    expect(JSON.stringify(body)).not.toContain('private-token');
    expect(mock.connection).toHaveBeenCalledWith('owner', 'owned-item');
    expect(mock.link.mock.calls[0][0]).toMatchObject({ access_token: 'synthetic-private-token', webhook: 'https://staging.example.test/api/plaid/webhook' });
    expect(mock.link.mock.calls[0][0]).not.toHaveProperty('products'); expect(mock.link.mock.calls[0][0]).not.toHaveProperty('transactions');
    expect(mock.trial).not.toHaveBeenCalled(); expect(mock.history).not.toHaveBeenCalled();
  });
  it('requires fresh relinking for unowned or mismatched-client items before any provider call', async () => {
    mock.connection.mockResolvedValue(null);
    const response = await POST(req({ itemId: 'unavailable-item' }));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'BANK_RELINK_REQUIRED' });
    expect(mock.link).not.toHaveBeenCalled();
  });
  it('creates a normal Link flow using the server plan and normalized HTTPS Vercel origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', ''); vi.stubEnv('VERCEL_URL', 'staging.example.test');
    expect((await POST(req({ days_requested: 7300 }))).status).toBe(200);
    expect(mock.link.mock.calls[0][0]).toMatchObject({ products: ['transactions'], transactions: { days_requested: 90 }, webhook: 'https://staging.example.test/api/plaid/webhook' });
    expect(mock.link.mock.calls[0][0]).not.toHaveProperty('access_token');
  });
  it('refuses insecure remote webhook configuration before provider calls', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://remote.example.test');
    expect((await POST(req())).status).toBe(503); expect(mock.link).not.toHaveBeenCalled();
  });
  it.each([{}, { itemId: 'owned-item' }])('refuses Link tokens over the durable per-owner window with Retry-After (%j)', async body => {
    await exhaustRateLimit(RATE_LIMITS.plaidLinkToken, 'owner');
    const response = await POST(req(body));
    expect(response.status).toBe(429); expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await response.json()).toMatchObject({ code: 'RATE_LIMITED', error: expect.stringContaining('Too many bank connection attempts') });
    expect(mock.link).not.toHaveBeenCalled(); expect(mock.connection).not.toHaveBeenCalled(); expect(mock.trial).not.toHaveBeenCalled();
  });
  it('fails closed rather than starting unmetered provider sessions when the limiter store is unreachable', async () => {
    failRateLimitStore();
    const response = await POST(req());
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: 'RATE_LIMIT_UNAVAILABLE' });
    expect(mock.link).not.toHaveBeenCalled();
  });
  it.each([{}, { itemId: 'owned-item' }])('configures the same registered OAuth callback for create and update mode (%j)', async body => {
    vi.stubEnv('WRITEOFF_ENV', 'staging'); vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'staging');
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'writeoff-production-testing');
    vi.stubEnv('PLAID_REDIRECT_URI', 'https://writeoff-production-testing.web.app/plaid/oauth');
    const response = await POST(req({ ...body, redirect_uri: 'https://evil.test/callback' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ redirect_uri: 'https://writeoff-production-testing.web.app/plaid/oauth' });
    expect(mock.link.mock.calls[0][0].redirect_uri).toBe('https://writeoff-production-testing.web.app/plaid/oauth');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('rejects invalid OAuth configuration before starting a trial or calling Plaid', async () => {
    vi.stubEnv('PLAID_REDIRECT_URI', 'https://evil.test/callback');
    expect((await POST(req())).status).toBe(503);
    expect(mock.link).not.toHaveBeenCalled(); expect(mock.trial).not.toHaveBeenCalled();
  });
});
