import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ auth: vi.fn(), startTrial: vi.fn(), reconcile: vi.fn(), sync: vi.fn(),
  profile: {} as Record<string, unknown>, configured: true, exists: true,
  customersRetrieve: vi.fn(), customersCreate: vi.fn(), subscriptionsList: vi.fn(), subscriptionsRetrieve: vi.fn(),
  checkoutCreate: vi.fn(), constructEvent: vi.fn(), profileUpdate: vi.fn() }));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: mock.auth }));
vi.mock('@/lib/subscriptions/trial-manager', () => ({ startFreeTrial: mock.startTrial }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { doc: () => ({ get: async () => ({ exists: mock.exists, data: () => mock.profile }), update: mock.profileUpdate }) } }));
vi.mock('@/lib/stripe/checkout-operations', async original => ({
  ...await original<typeof import('@/lib/stripe/checkout-operations')>(),
  beginCheckoutOperation: async () => 'fixture-billing-operation', finishCheckoutOperation: async () => {}, retainCheckoutRecovery: async () => {},
}));
vi.mock('@/lib/stripe/subscription-sync', () => ({
  getStripeClient: () => mock.configured ? { customers: { retrieve: mock.customersRetrieve, create: mock.customersCreate },
    subscriptions: { list: mock.subscriptionsList, retrieve: mock.subscriptionsRetrieve }, checkout: { sessions: { create: mock.checkoutCreate } },
    webhooks: { constructEvent: mock.constructEvent } } : null,
  configuredPriceIds: () => ['price_month', 'price_basic_month'], reconcileUserSubscription: mock.reconcile, refreshSubscriptionForUser: mock.sync,
  subscriptionPlanForPrice: (price: string) => price === 'price_month' ? 'premium' : price === 'price_basic_month' ? 'basic' : null,
  subscriptionDetails: () => null,
}));
import { GET as checkAccess } from '@/app/api/subscriptions/check-access/route';
import { POST as checkout } from '@/app/api/stripe/create-checkout/route';
import { POST as webhook } from '@/app/api/stripe/webhook/route';
import { POST as fixAccess } from '@/app/api/subscriptions/fix-access/route';
const now = new Date('2026-09-15T12:00:00Z');
const future = new Date('2026-10-01T12:00:00Z');
const req = (body: unknown = {}, signature = false) => new Request('https://writeoffapp.com/api/test', { method: 'POST', body: JSON.stringify(body), headers: signature ? { 'stripe-signature': 'signed-fixture' } : {} });
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv('STRIPE_PRICE_ID_MONTHLY', 'price_month'); vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'mock-secret');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://writeoffapp.com');
  mock.auth.mockResolvedValue({ uid: 'u1' }); mock.configured = true; mock.exists = true;
  mock.profile = { subscriptionStatus: 'none', email: 'fixture@example.test' };
  mock.startTrial.mockResolvedValue({ success: true }); mock.reconcile.mockResolvedValue(null); mock.sync.mockResolvedValue(undefined);
  mock.customersCreate.mockResolvedValue({ id: 'cus_1' }); mock.customersRetrieve.mockResolvedValue({ id: 'cus_1', metadata: { firebase_uid: 'u1' } });
  mock.subscriptionsList.mockResolvedValue({ data: [] }); mock.checkoutCreate.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/session' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('plan status and repair APIs', () => {
  it('serializes Basic as paid with history only after server reconciliation', async () => {
    mock.profile = { subscriptionStatus: 'active', subscriptionPlan: 'basic', stripeSubscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_basic', subscriptionEnd: future };
    const response = await checkAccess(req());
    expect(await response.json()).toMatchObject({ data: { hasAccess: true, isPaid: true, isTrial: false,
      entitlements: { plan: 'basic', features: { reports: false, exports: false, extended_history: true } } } });
  });
  it.each([checkAccess, fixAccess, checkout])('returns 401 before profile/provider access', async (handler) => {
    mock.auth.mockRejectedValue(Error('invalidtoken'));
    expect((await handler(req())).status).toBe(401);
    expect(mock.reconcile).not.toHaveBeenCalled(); expect(mock.checkoutCreate).not.toHaveBeenCalled();
  });
  it('returns consistent trial entitlements and serialized expiry to the frontend', async () => {
    mock.profile = { subscriptionStatus: 'trial', trialStart: new Date('2026-09-01'), trialEnd: future };
    const response = await checkAccess(req());
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({ data: { hasAccess: true, isTrial: true, entitlements: { plan: 'trial', trialEnd: future.toISOString(), features: { reports: true } } } });
  });
  it('returns retryable error when live subscription reconciliation fails instead of showing stale premium', async () => {
    mock.reconcile.mockRejectedValue(Error('providerprivatepayload'));
    const response = await checkAccess(req());
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('providerprivatepayload');
  });
  it('does not pretend a linked paid subscription has been verified without Stripe configured', async () => {
    mock.configured = false; mock.profile.stripeSubscriptionId = 'sub_1';
    expect((await checkAccess(req())).status).toBe(503);
    expect(mock.startTrial).not.toHaveBeenCalled();
  });
  it('repair never searches arbitrary customers by editable email', async () => {
    expect((await fixAccess(req())).status).toBe(404);
    expect(mock.customersRetrieve).not.toHaveBeenCalled(); expect(mock.customersCreate).not.toHaveBeenCalled();
  });
});

describe('checkout creation', () => {
  it('does not sell a legacy Basic price through a misconfigured Premium checkout alias', async () => {
    vi.stubEnv('STRIPE_PRICE_ID_MONTHLY', 'price_basic_month');
    expect((await checkout(req({ interval: 'monthly' }))).status).toBe(503);
    expect(mock.checkoutCreate).not.toHaveBeenCalled();
    expect(mock.customersRetrieve).not.toHaveBeenCalled();
  });
  it.each(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'])('prevents duplicate checkout for a legacy Basic subscription in %s', async status => {
    mock.profile.stripeCustomerId = 'cus_1';
    mock.subscriptionsList.mockResolvedValue({ data: [{ status, cancel_at_period_end: true, items: { data: [{ price: { id: 'price_basic_month' } }] } }] });
    const response = await checkout(req({ interval: 'monthly' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'SUBSCRIPTION_EXISTS' });
    expect(mock.checkoutCreate).not.toHaveBeenCalled();
    expect(mock.customersCreate).not.toHaveBeenCalled();
    expect(mock.profileUpdate).not.toHaveBeenCalled();
  });
  it.each([{ interval: 'free' }, { interval: 'yearly', priceId: 'attacker_price' }, { subscriptionStatus: 'active' }])('rejects untrusted billing fields %j', async (body) => {
    expect((await checkout(req(body))).status).toBe(400);
    expect(mock.customersCreate).not.toHaveBeenCalled(); expect(mock.checkoutCreate).not.toHaveBeenCalled();
  });
  it.each(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'])('uses billing recovery rather than duplicate checkout for %s', async (status) => {
    mock.profile.stripeCustomerId = 'cus_1';
    mock.subscriptionsList.mockResolvedValue({ data: [{ status, items: { data: [{ price: { id: 'price_month' } }] } }] });
    expect((await checkout(req())).status).toBe(409); expect(mock.checkoutCreate).not.toHaveBeenCalled();
  });
  it('uses server prices and an idempotency key, while accepting monthly renewal after cancellation', async () => {
    mock.profile.stripeCustomerId = 'cus_1';
    mock.subscriptionsList.mockResolvedValue({ data: [{ status: 'canceled', items: { data: [{ price: { id: 'price_month' } }] } }] });
    expect((await checkout(req({ interval: 'monthly' }))).status).toBe(200);
    expect(mock.checkoutCreate.mock.calls[0][0]).toMatchObject({ customer: 'cus_1', line_items: [{ price: 'price_month', quantity: 1 }], success_url: expect.stringMatching(/^https:\/\/writeoffapp.com\//),
      payment_method_types: ['card', 'us_bank_account'],
      payment_method_options: { us_bank_account: { financial_connections: { permissions: ['payment_method'] } } },
      subscription_data: { metadata: { firebase_uid: 'u1', payment_policy: 'settled_invoice' } },
    });
    expect(mock.checkoutCreate.mock.calls[0][1].idempotencyKey).toMatch(/^writeoff-checkout-u1-monthly-/);
  });
});

describe('signed Stripe lifecycle notifications', () => {
  it.each(['checkout.session.async_payment_failed', 'checkout.session.async_payment_succeeded', 'invoice.paid', 'invoice.payment_failed', 'invoice.voided', 'invoice.marked_uncollectible'])(
    'reconciles current provider state for %s', type => {
      const object = type.startsWith('checkout.') ? { mode: 'subscription', subscription: 'sub_bank' }
        : { parent: { subscription_details: { subscription: 'sub_bank' } } };
      mock.constructEvent.mockReturnValue({ id: 'evt_bank', created: 6, type, data: { object } });
      mock.subscriptionsRetrieve.mockResolvedValue({ id: 'sub_bank', status: 'active', metadata: { firebase_uid: 'u1' } });
      return webhook(req({}, true)).then(response => {
        expect(response.status).toBe(200);
        expect(mock.sync).toHaveBeenCalledWith('u1', expect.any(Object), 'sub_bank', { id: 'evt_bank', created: 6 }, undefined);
      });
    },
  );
  it('rejects missing/bad signatures before granting anything', async () => {
    expect((await webhook(req())).status).toBe(400);
    mock.constructEvent.mockImplementation(() => { throw Error('bad signature'); });
    expect((await webhook(req({}, true))).status).toBe(400); expect(mock.sync).not.toHaveBeenCalled();
  });
  it('re-fetches current status for an old active event and persists payment failure', async () => {
    mock.constructEvent.mockReturnValue({ id: 'evt_1', created: 1, type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'active' } } });
    const latest = { id: 'sub_1', status: 'past_due', metadata: { firebase_uid: 'u1' }, customer: 'cus_1' };
    mock.subscriptionsRetrieve.mockResolvedValue(latest);
    expect((await webhook(req({}, true))).status).toBe(200);
    expect(mock.sync).toHaveBeenCalledWith('u1', expect.any(Object), 'sub_1', { id: 'evt_1', created: 1 }, undefined);
  });
  it('requests retry if entitlement persistence fails instead of acknowledging a lost update', async () => {
    mock.constructEvent.mockReturnValue({ id: 'evt_1', created: 1, type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_1' } } });
    mock.subscriptionsRetrieve.mockResolvedValue({ id: 'sub_1', status: 'active', metadata: { firebase_uid: 'u1' } });
    mock.sync.mockRejectedValue(Error('databaseinternaldetail'));
    const response = await webhook(req({}, true));
    expect(response.status).toBe(500); expect(await response.text()).not.toContain('databaseinternaldetail');
  });
  it('does not grant access for a payment-mode checkout', async () => {
    mock.constructEvent.mockReturnValue({ id: 'evt_other', type: 'checkout.session.completed', data: { object: { mode: 'payment', subscription: null } } });
    expect((await webhook(req({}, true))).status).toBe(200); expect(mock.sync).not.toHaveBeenCalled();
  });
});
