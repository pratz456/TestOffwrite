import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  token: vi.fn(), session: vi.fn(), get: vi.fn(), update: vi.fn(), doc: vi.fn(),
  stripe: vi.fn(), reconcile: vi.fn(), trial: vi.fn(),
}));
vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifyIdToken: mocks.token, verifySessionCookie: mocks.session },
  adminDb: { doc: mocks.doc },
}));
vi.mock('@/lib/subscriptions/trial-manager', () => ({ startFreeTrial: mocks.trial }));
vi.mock('@/lib/stripe/subscription-sync', () => ({
  getStripeClient: mocks.stripe, reconcileUserSubscription: mocks.reconcile, subscriptionDetails: () => null,
}));
import { middleware } from '../middleware';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { GET as checkAccess } from '@/app/api/subscriptions/check-access/route';

const origin = 'http://127.0.0.1:3002';
const preview = {
  WRITEOFF_LOCAL_ACCOUNT_PREVIEW: 'true', NODE_ENV: 'development',
  WRITEOFF_ENV: 'local-account-preview', NEXT_PUBLIC_APP_ENV: 'local-account-preview',
  NEXT_PUBLIC_AUTO_SYNC_ON_VISIT: 'false', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'writeoff-23910',
  FIREBASE_ADMIN_PROJECT_ID: 'writeoff-23910', NEXT_PUBLIC_SITE_URL: origin,
  WRITEOFF_LOCAL_ACCOUNT_PREVIEW_EMAIL: 'owner@example.com',
};
const blocked = [
  '/api/plaid', '/api/plaid/create-link-token', '/api/plaid/exchange-token', '/api/plaid/items/bank',
  '/api/plaid/sync-transactions', '/api/plaid/sync-transactions-internal', '/api/plaid/webhook',
  '/api/plaid/refresh-balances', '/api/plaid/import-status', '/api/stripe', '/api/stripe/create-checkout',
  '/api/stripe/webhook', '/api/stripe/portal', '/api/subscriptions/fix-access',
  '/api/subscriptions/verify-stripe', '/api/user/delete',
];
const request = (headers: Record<string, string> = { authorization: 'Bearer test' }) => new Request(`${origin}/api/subscriptions/check-access`, { headers });
beforeEach(() => {
  vi.clearAllMocks();
  for (const [name, value] of Object.entries(preview)) vi.stubEnv(name, value);
  mocks.token.mockResolvedValue({ uid: 'owner', email: 'owner@example.com', email_verified: true });
  mocks.session.mockResolvedValue({ uid: 'owner', email: 'owner@example.com', email_verified: true });
  mocks.doc.mockReturnValue({ get: mocks.get, update: mocks.update });
  mocks.get.mockResolvedValue({ exists: true, data: () => ({ subscriptionStatus: 'none' }) });
  mocks.stripe.mockReturnValue({}); mocks.reconcile.mockResolvedValue(null); mocks.trial.mockResolvedValue({ success: true });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('real-account preview request boundaries', () => {
  it.each(blocked)('blocks %s before its route can run', async pathname => {
    const response = middleware(new NextRequest(`${origin}${pathname}`, { method: 'POST' }));
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ code: 'LOCAL_ACCOUNT_PREVIEW' });
  });
  it.each(blocked)('leaves production %s routing unchanged', pathname => {
    vi.stubEnv('WRITEOFF_LOCAL_ACCOUNT_PREVIEW', 'false'); vi.stubEnv('NODE_ENV', 'production');
    const response = middleware(new NextRequest(`https://writeoffapp.com${pathname}`, { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
  it.each(['/protected', '/api/accounts', '/api/database/profiles', '/api/subscriptions/check-access', '/api/ai/analyze-transaction', '/api/transactions/transaction'])('keeps %s available for authenticated account workflows', pathname => {
    expect(middleware(new NextRequest(`${origin}${pathname}`)).headers.get('x-middleware-next')).toBe('1');
  });
  it('fails closed on every request when preview accidentally uses production mode', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const response = middleware(new NextRequest(`${origin}/protected`));
    expect(response.status).toBe(503);
    expect(response.headers.get('x-middleware-next')).toBeNull();
  });
});

describe('real-account preview owner restriction', () => {
  it('accepts the verified configured account with revocation checking', async () => {
    mocks.token.mockResolvedValue({ uid: 'owner', email: 'Owner@Example.com', email_verified: true });
    expect((await getAuthenticatedUser(request())).user?.uid).toBe('owner');
    expect(mocks.token).toHaveBeenCalledWith('test', true);
  });
  it.each(['other@example.com', undefined])('rejects an authenticated different or missing email %s', async email => {
    mocks.token.mockResolvedValue({ uid: 'other', email, email_verified: true });
    expect((await getAuthenticatedUser(request())).user).toBeNull();
    expect((await checkAccess(request())).status).toBe(401);
    expect(mocks.doc).not.toHaveBeenCalled(); expect(mocks.stripe).not.toHaveBeenCalled();
  });
  it('applies the same restriction to session cookies', async () => {
    mocks.session.mockResolvedValue({ uid: 'other', email: 'other@example.com', email_verified: true });
    expect((await getAuthenticatedUser(request({ cookie: '__session=test-session' }))).user).toBeNull();
    expect(mocks.session).toHaveBeenCalledWith('test-session', true);
  });
  it('does not accept an unverified matching email', async () => {
    mocks.token.mockResolvedValue({ uid: 'owner', email: 'owner@example.com', email_verified: false });
    expect((await getAuthenticatedUser(request())).user).toBeNull();
  });
  it('does not apply the local account restriction to production users', async () => {
    vi.stubEnv('WRITEOFF_LOCAL_ACCOUNT_PREVIEW', 'false');
    mocks.token.mockResolvedValue({ uid: 'other', email: 'other@example.com', email_verified: true });
    expect((await getAuthenticatedUser(request())).user?.uid).toBe('other');
  });
});

describe('saved local preview entitlements have no billing side effects', () => {
  it('shows no trial for an uninitialized account without creating one', async () => {
    const response = await checkAccess(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { hasAccess: false, isTrial: false, isPaid: false,
      subscription: null, source: 'saved-profile-local-preview', entitlements: { plan: 'free', features: { reports: false, exports: false } } } });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.stripe).not.toHaveBeenCalled(); expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.trial).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each([['basic', false], ['premium', true]])('preserves saved %s features without querying Stripe', async (plan, fullAccess) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    mocks.get.mockResolvedValue({ exists: true, data: () => ({ subscriptionStatus: 'active', subscriptionPlan: plan,
      stripeSubscriptionId: 'sub_fixture', stripeSubscriptionStatus: 'active', subscriptionEnd: new Date('2026-10-23T12:00:00Z') }) });
    const response = await checkAccess(request());
    expect(await response.json()).toMatchObject({ data: { hasAccess: true, isPaid: true, source: 'saved-profile-local-preview',
      entitlements: { plan, features: { reports: fullAccess, exports: fullAccess, extended_history: true } } } });
    expect(mocks.stripe).not.toHaveBeenCalled(); expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.trial).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it('does not unlock paid access from incomplete legacy billing fields', async () => {
    mocks.get.mockResolvedValue({ exists: true, data: () => ({ subscriptionStatus: 'active', stripeSubscriptionId: 'sub_old' }) });
    expect(await (await checkAccess(request())).json()).toMatchObject({ data: { hasAccess: false, source: 'saved-profile-local-preview' } });
    expect(mocks.reconcile).not.toHaveBeenCalled(); expect(mocks.trial).not.toHaveBeenCalled();
  });
  it('continues provider reconciliation and normal trial initialization outside preview', async () => {
    vi.stubEnv('WRITEOFF_LOCAL_ACCOUNT_PREVIEW', 'false');
    const response = await checkAccess(request());
    expect(response.status).toBe(200);
    expect(mocks.stripe).toHaveBeenCalledOnce(); expect(mocks.reconcile).toHaveBeenCalledWith('owner', {});
    expect(mocks.trial).toHaveBeenCalledWith('owner');
    expect((await response.json()).data).not.toHaveProperty('source');
  });
});
