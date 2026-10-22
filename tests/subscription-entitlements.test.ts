import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { evaluateEntitlements, canStartFreeTrial, subscriptionDate } from '@/lib/subscriptions/entitlements';

const { documents, writes, unavailable } = vi.hoisted(() => ({ documents: new Map<string, Record<string, unknown>>(), writes: vi.fn(), unavailable: { value: false } }));
vi.mock('@/lib/firebase/admin', () => {
  const snapshot = (path: string) => ({ exists: documents.has(path), data: () => documents.get(path) });
  const doc = (path: string) => ({ path, get: async () => { if (unavailable.value) throw Error('offline'); return snapshot(path); },
    update: async (data: Record<string, unknown>) => { writes(path, data); documents.set(path, { ...documents.get(path), ...data }); } });
  let queue = Promise.resolve();
  return { adminDb: { doc, runTransaction: (callback: (transaction: unknown) => Promise<unknown>) => {
    const next = queue.then(() => callback({ get: async (ref: { path: string }) => snapshot(ref.path),
      update: (ref: { path: string }, data: Record<string, unknown>) => { writes(ref.path, data); documents.set(ref.path, { ...documents.get(ref.path), ...data }); },
      set: (ref: { path: string }, data: Record<string, unknown>) => documents.set(ref.path, data) }));
    queue = next.then(() => undefined, () => undefined); return next;
  } } };
});
import { startFreeTrial } from '@/lib/subscriptions/trial-manager';
import { requireFeatureAccess } from '@/lib/subscriptions/feature-access';
import { subscriptionProfileUpdate, subscriptionDetails, subscriptionPlanForPrice, configuredPriceIds, assertSubscriptionOwner, syncSubscriptionForUser, reconcileUserSubscription, refreshSubscriptionForUser, getSubscriptionSyncRevision } from '@/lib/stripe/subscription-sync';

const now = new Date('2026-09-15T12:00:00Z');
const past = new Date('2026-09-01T12:00:00Z');
const future = new Date('2026-10-01T12:00:00Z');
const paid = { subscriptionStatus: 'active', subscriptionPlan: 'premium', stripeSubscriptionStatus: 'active', stripeSubscriptionId: 'sub_1', subscriptionEnd: future };
const trial = { subscriptionStatus: 'trial', trialStart: past, trialEnd: future };
function subscription(status: string = 'active', id = 'sub_1'): Stripe.Subscription {
  return { id, status, customer: 'cus_1', metadata: { firebase_uid: 'u1' }, trial_start: past.getTime() / 1000, trial_end: future.getTime() / 1000,
    items: { data: [{ current_period_end: future.getTime() / 1000, price: { id: 'price_month', recurring: { interval: 'month' } } }] } } as Stripe.Subscription;
}
beforeEach(() => { documents.clear(); writes.mockClear(); unavailable.value = false; vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv('STRIPE_PRICE_ID_MONTHLY', 'price_month'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('shared trusted subscription policy', () => {
  it('does not infer Premium from an old paid record without a verified price tier', () => {
    expect(evaluateEntitlements({ ...paid, subscriptionPlan: undefined }, now)).toMatchObject({
      plan: 'free', isPaid: false, reason: 'invalid_subscription', features: { reports: false, exports: false, extended_history: false },
    });
  });
  it.each([false, true])('retains Basic history but not reports or exports with cancellation scheduled=%s', cancelAtPeriodEnd => {
    const basic = { ...paid, subscriptionPlan: 'basic', cancelAtPeriodEnd };
    expect(evaluateEntitlements(basic, now)).toMatchObject({ plan: 'basic', status: 'active', isPaid: true, hasAccess: true,
      features: { reports: false, exports: false, extended_history: true } });
    expect(transactionHistoryWindow(basic, now).days).toBe(730);
    expect(evaluateEntitlements(basic, future).hasAccess).toBe(false);
    expect(transactionHistoryWindow(basic, future).days).toBe(90);
  });
  it.each(['canceled', 'past_due', 'unpaid', 'paused'])('revokes Basic features on %s before period end', stripeSubscriptionStatus => {
    expect(evaluateEntitlements({ ...paid, subscriptionPlan: 'basic', stripeSubscriptionStatus }, now)).toMatchObject({
      plan: 'free', isPaid: false, features: { reports: false, exports: false, extended_history: false },
    });
  });
  it.each([{}, null, { hasHistoricalAccess: true }, { subscriptionStatus: 'starter' }, { subscriptionStatus: 'active' }, { ...paid, subscriptionEnd: undefined }, { ...paid, subscriptionEnd: 'invalid' }, { ...paid, stripeSubscriptionId: undefined }])('fails closed on absent, forged booleans, and malformed profiles %j', (profile) => {
    expect(evaluateEntitlements(profile, now).hasAccess).toBe(false);
  });
  it('unlocks identical features for trial and monthly/yearly premium and preserves pending cancellation', () => {
    for (const profile of [trial, paid, { ...paid, cancelAtPeriodEnd: true }, { ...paid, interval: 'yearly' }]) {
      expect(evaluateEntitlements(profile, now).features).toEqual({ reports: true, exports: true, extended_history: true });
    }
  });
  it.each(['canceled', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', 'deleted', 'unsupported_product', 'surprise'])('Stripe %s overrides stale paid/trial flags', (stripeSubscriptionStatus) => {
    expect(evaluateEntitlements({ ...paid, ...trial, stripeSubscriptionStatus }, now).hasAccess).toBe(false);
  });
  it('ends access at the exact expiry boundary and never grants a future-start trial', () => {
    expect(evaluateEntitlements({ ...trial, trialEnd: now }, now).hasAccess).toBe(false);
    expect(evaluateEntitlements({ ...paid, subscriptionEnd: now }, now).hasAccess).toBe(false);
    expect(evaluateEntitlements({ ...trial, trialStart: future }, now).hasAccess).toBe(false);
    expect(evaluateEntitlements({ ...trial, trialEnd: past }, now).hasAccess).toBe(false);
  });
  it('normalizes valid Firestore dates and rejects broken timestamp data', () => {
    expect(subscriptionDate({ toDate: () => future })).toEqual(future);
    expect(subscriptionDate({ toDate: () => { throw Error('bad'); } })).toBeUndefined();
  });
  it.each([trial, paid, { subscriptionStatus: 'expired' }, { trialEnd: past }, { trialStart: 'invalid' }, { stripeSubscriptionStatus: 'canceled' }])('does not allow a second trial %j', (profile) => expect(canStartFreeTrial(profile)).toBe(false));
  it('claims a first 30-day trial once under concurrent calls', async () => {
    documents.set('user_profiles/u1', { name: 'Synthetic' });
    await Promise.all([startFreeTrial('u1'), startFreeTrial('u1')]);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(documents.get('user_profiles/u1')?.trialEnd).toEqual(new Date(now.getTime() + 30 * 86400000));
  });
  it('does not overwrite an expired trial or a paid cancellation', async () => {
    documents.set('user_profiles/u1', { subscriptionStatus: 'expired', trialStart: past, trialEnd: now });
    await startFreeTrial('u1');
    expect(writes).not.toHaveBeenCalled();
  });
});

describe('server feature enforcement', () => {
  it('reads the authenticated user only and denies absent profiles', async () => {
    documents.set('user_profiles/someone-else', paid);
    const response = await requireFeatureAccess('u1', 'reports');
    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ code: 'SUBSCRIPTION_REQUIRED', feature: 'reports' });
  });
  it('allows premium, then rejects the same user after expiry', async () => {
    documents.set('user_profiles/u1', paid);
    expect(await requireFeatureAccess('u1', 'exports')).toBeNull();
    vi.setSystemTime(future);
    expect((await requireFeatureAccess('u1', 'exports'))?.status).toBe(403);
  });
  it('returns retryable failure for unavailable database instead of granting access', async () => {
    unavailable.value = true;
    expect((await requireFeatureAccess('u1', 'reports'))?.status).toBe(503);
  });
});

describe('Stripe lifecycle persistence', () => {
  it.each(['open', 'draft', 'void', 'uncollectible'])('does not grant an unpaid legacy Basic-to-Premium upgrade with invoice %s', status => {
    const legacyUpgrade = subscription();
    legacyUpgrade.latest_invoice = { status } as Stripe.Invoice;
    expect(legacyUpgrade.metadata.payment_policy).toBeUndefined();
    expect(evaluateEntitlements(subscriptionProfileUpdate(legacyUpgrade, now), now).features.exports).toBe(false);
  });
  it('grants the legacy portal upgrade only after the current invoice is paid', () => {
    const legacyUpgrade = subscription();
    legacyUpgrade.latest_invoice = { status: 'paid' } as Stripe.Invoice;
    expect(evaluateEntitlements(subscriptionProfileUpdate(legacyUpgrade, now), now).plan).toBe('premium');
  });
  it.each([null, 'in_unexpanded', { status: 'open' }, { status: 'draft' }, { status: 'void' }, { status: 'uncollectible' }])(
    'does not grant an active bank-capable subscription before confirmed payment: %j', invoice => {
      const bank = subscription();
      bank.metadata.payment_policy = 'settled_invoice';
      bank.latest_invoice = invoice as Stripe.Subscription['latest_invoice'];
      const update = subscriptionProfileUpdate(bank, now);
      expect(evaluateEntitlements(update, now).isPaid).toBe(false);
      expect(update.hasHistoricalAccess).toBe(false);
      expect(subscriptionDetails(bank)?.status).not.toBe('active');
    },
  );
  it('grants after settlement and revokes after a failed asynchronous renewal', async () => {
    documents.set('user_profiles/u1', { stripeCustomerId: 'cus_1' });
    const bank = subscription();
    bank.metadata.payment_policy = 'settled_invoice';
    bank.latest_invoice = { status: 'paid' } as Stripe.Invoice;
    const retrieve = vi.fn().mockResolvedValue(bank);
    const stripe = { subscriptions: { retrieve, list: vi.fn().mockResolvedValue({ data: [bank] }) } } as unknown as Stripe;
    await reconcileUserSubscription('u1', stripe);
    expect(evaluateEntitlements(documents.get('user_profiles/u1'), now).isPaid).toBe(true);
    bank.latest_invoice = { status: 'void' } as Stripe.Invoice;
    await reconcileUserSubscription('u1', stripe);
    expect(retrieve).toHaveBeenLastCalledWith('sub_1', { expand: ['latest_invoice'] });
    expect(evaluateEntitlements(documents.get('user_profiles/u1'), now).isPaid).toBe(false);
  });
  it.each(['STRIPE_PRICE_ID_BASIC_MONTHLY', 'NEXT_PUBLIC_STRIPE_PRICE_ID_BASIC_MONTHLY', 'STRIPE_PRICE_ID_BASIC_YEARLY',
    'NEXT_PUBLIC_STRIPE_PRICE_ID_BASIC_YEARLY', 'STRIPE_PRICE_ID_BASIC', 'NEXT_PUBLIC_STRIPE_PRICE_ID_BASIC'])(
    'recognizes %s as Basic without promoting it to Premium', alias => {
      vi.stubEnv(alias, 'price_basic');
      const basic = subscription(); basic.items.data[0].price.id = 'price_basic';
      const update = subscriptionProfileUpdate(basic, now);
      expect(configuredPriceIds()).toContain('price_basic');
      expect(subscriptionPlanForPrice('price_month')).toBe('premium');
      expect(update).toMatchObject({ subscriptionPlan: 'basic', stripeSubscriptionStatus: 'active', subscriptionStatus: 'active',
        subscriptionEnd: future, hasHistoricalAccess: true });
      expect(evaluateEntitlements(update, now).features).toEqual({ reports: false, exports: false, extended_history: true });
    },
  );
  it('keeps an ambiguous Basic/Premium alias at Basic and preserves the provider price', () => {
    vi.stubEnv('STRIPE_PRICE_ID_BASIC_MONTHLY', 'price_month');
    expect(subscriptionPlanForPrice('price_month')).toBe('basic');
    const basic = subscription(); basic.items.data[0].price.unit_amount = 799; basic.items.data[0].price.currency = 'usd';
    expect(subscriptionDetails(basic)).toMatchObject({ plan: 'basic', planAmount: 7.99, planCurrency: 'usd' });
  });
  it.each(['unverified', 'unsupported_product'])('recovers an active Basic subscriber from %s to its distinct server-verified tier', async previous => {
    vi.stubEnv('STRIPE_PRICE_ID_BASIC_MONTHLY', 'price_basic');
    documents.set('user_profiles/u1', { ...paid, stripeCustomerId: 'cus_1', subscriptionPlan: undefined,
      ...(previous === 'unsupported_product' ? { subscriptionStatus: 'expired', stripeSubscriptionStatus: 'unsupported_product', subscriptionEnd: null } : {}) });
    const basic = subscription(); basic.items.data[0].price.id = 'price_basic'; basic.cancel_at_period_end = true;
    const stripe = { subscriptions: { retrieve: vi.fn().mockResolvedValue(basic), list: vi.fn() } } as unknown as Stripe;
    await reconcileUserSubscription('u1', stripe);
    expect(evaluateEntitlements(documents.get('user_profiles/u1'), now)).toMatchObject({ plan: 'basic', isPaid: true,
      features: { reports: false, exports: false, extended_history: true } });
    expect(subscriptionDetails(basic)).toMatchObject({ plan: 'basic', cancelAtPeriodEnd: true, currentPeriodEnd: future });
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
  });
  it('accepts configured products only and includes Stripe trial dates', () => {
    expect(subscriptionProfileUpdate(subscription('active')).hasHistoricalAccess).toBe(true);
    expect(subscriptionProfileUpdate(subscription('trialing'))).toMatchObject({ subscriptionStatus: 'trial', trialStart: past, trialEnd: future, hasHistoricalAccess: true });
    const unrelated = subscription(); unrelated.items.data[0].price.id = 'price_other';
    expect(subscriptionProfileUpdate(unrelated)).toMatchObject({ stripeSubscriptionStatus: 'unsupported_product', hasHistoricalAccess: false });
  });
  it('rejects conflicting customer and uid ownership, regardless of email', () => {
    expect(() => assertSubscriptionOwner('u2', { stripeCustomerId: 'cus_1', email: 'same@example.test' }, subscription())).toThrow();
    expect(() => assertSubscriptionOwner('u1', { stripeCustomerId: 'cus_wrong' }, subscription())).toThrow();
    expect(() => assertSubscriptionOwner('u1', {}, subscription())).not.toThrow();
  });
  it('applies each event once and ignores older deliveries', async () => {
    documents.set('user_profiles/u1', { stripeCustomerId: 'cus_1' });
    await syncSubscriptionForUser('u1', subscription(), 0, { id: 'evt_2', created: 2 });
    await syncSubscriptionForUser('u1', subscription(), 0, { id: 'evt_2', created: 2 });
    await syncSubscriptionForUser('u1', subscription('canceled'), 0, { id: 'evt_1', created: 1 });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(documents.get('user_profiles/u1')?.stripeSubscriptionStatus).toBe('active');
  });
  it('does not revoke a replacement subscription when an old subscription is deleted', async () => {
    documents.set('user_profiles/u1', { ...paid, stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_new' });
    await syncSubscriptionForUser('u1', subscription('canceled'), 0, { id: 'evt_old_delete', created: 3 });
    expect(writes).not.toHaveBeenCalled();
  });
  it('persists payment failures as denied even before the period ends', async () => {
    documents.set('user_profiles/u1', { ...paid, stripeCustomerId: 'cus_1' });
    await syncSubscriptionForUser('u1', subscription('past_due'), 0, { id: 'evt_pastdue', created: 3 });
    expect(evaluateEntitlements(documents.get('user_profiles/u1'), now).hasAccess).toBe(false);
  });
});

import { transactionHistoryWindow, isWithinHistoryWindow } from '@/lib/subscriptions/history-window';
describe('plan-aware bank history ingestion', () => {
  it('limits free imports to 90 days and trial/premium to 730 without changing stored data', () => {
    expect(transactionHistoryWindow({}, now)).toEqual({ days: 90, startDate: '2026-06-17', endDate: '2026-09-15' });
    expect(transactionHistoryWindow(trial, now).days).toBe(730);
    expect(transactionHistoryWindow(paid, now).days).toBe(730);
    expect(transactionHistoryWindow({ ...paid, stripeSubscriptionStatus: 'past_due' }, now).days).toBe(90);
    expect(writes).not.toHaveBeenCalled();
  });
  it('filters newly supplied old, future, or malformed provider transactions at the save boundary', () => {
    const window = transactionHistoryWindow({}, now);
    expect(isWithinHistoryWindow('2026-06-16', window)).toBe(false);
    expect(isWithinHistoryWindow('2026-06-17', window)).toBe(true);
    expect(isWithinHistoryWindow('2026-09-16', window)).toBe(false);
    expect(isWithinHistoryWindow(undefined, window)).toBe(false);
  });
});

describe('concurrent subscription reconciliation', () => {
  it('preserves a freshly verified settled subscription when an overlapping ACH checkout is pending', async () => {
    documents.set('user_profiles/u1', { ...paid, stripeCustomerId: 'cus_1' });
    const pending = subscription('active', 'sub_pending'); pending.metadata.payment_policy = 'settled_invoice';
    pending.latest_invoice = { status: 'open' } as Stripe.Invoice;
    const settled = subscription(); settled.latest_invoice = { status: 'paid' } as Stripe.Invoice;
    const retrieve = vi.fn().mockImplementation(async id => id === 'sub_pending' ? pending : settled);
    const stripe = { subscriptions: { retrieve } } as unknown as Stripe;
    await refreshSubscriptionForUser('u1', stripe, 'sub_pending', { id: 'evt_pending', created: 10 });
    expect(documents.get('user_profiles/u1')?.stripeSubscriptionId).toBe('sub_1');
    expect(evaluateEntitlements(documents.get('user_profiles/u1'), now).isPaid).toBe(true);
    expect(retrieve).toHaveBeenCalledWith('sub_1', { expand: ['latest_invoice'] });
  });
  it('does not preserve a stale paid profile when the old subscription is actually canceled', async () => {
    documents.set('user_profiles/u1', { ...paid, stripeCustomerId: 'cus_1' });
    const pending = subscription('active', 'sub_pending'); pending.metadata.payment_policy = 'settled_invoice';
    pending.latest_invoice = { status: 'open' } as Stripe.Invoice;
    const stripe = { subscriptions: { retrieve: vi.fn().mockImplementation(async id => id === 'sub_pending' ? pending : subscription('canceled')) } } as unknown as Stripe;
    await refreshSubscriptionForUser('u1', stripe, 'sub_pending', { id: 'evt_pending', created: 10 });
    expect(documents.get('user_profiles/u1')?.stripeSubscriptionId).toBe('sub_pending');
    expect(evaluateEntitlements(documents.get('user_profiles/u1'), now).isPaid).toBe(false);
  });
  it('recovers the settled subscription when the previously linked overlapping ACH plan is pending', async () => {
    documents.set('user_profiles/u1', { ...paid, stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_pending' });
    const pending = subscription('active', 'sub_pending'); pending.metadata.payment_policy = 'settled_invoice';
    pending.latest_invoice = { status: 'open' } as Stripe.Invoice;
    const settled = subscription(); settled.latest_invoice = { status: 'paid' } as Stripe.Invoice;
    const stripe = { subscriptions: { retrieve: vi.fn().mockResolvedValue(pending), list: vi.fn().mockResolvedValue({ data: [pending, settled] }) } } as unknown as Stripe;
    await reconcileUserSubscription('u1', stripe);
    expect(documents.get('user_profiles/u1')?.stripeSubscriptionId).toBe('sub_1');
    expect(evaluateEntitlements(documents.get('user_profiles/u1'), now).isPaid).toBe(true);
  });
  it('rejects a stale active observation after a canceled webhook was committed', async () => {
    documents.set('user_profiles/u1', { ...paid, stripeCustomerId: 'cus_1' });
    const revisionBeforeRead = await getSubscriptionSyncRevision('u1');
    await syncSubscriptionForUser('u1', subscription('canceled'), revisionBeforeRead, { id: 'evt_cancel', created: 4 });
    expect(await syncSubscriptionForUser('u1', subscription('active'), revisionBeforeRead)).toBe(false);
    expect(evaluateEntitlements(documents.get('user_profiles/u1'), now).hasAccess).toBe(false);
  });
  it('re-fetches current Stripe state when polling overlaps a webhook update', async () => {
    const initial = { ...paid, stripeCustomerId: 'cus_1' };
    documents.set('user_profiles/u1', initial);
    const retrieve = vi.fn().mockImplementationOnce(async () => {
      await syncSubscriptionForUser('u1', subscription('past_due'), 0, { id: 'evt_payment', created: 5 });
      return subscription('active'); // This response began before the payment-failed webhook.
    }).mockResolvedValue(subscription('past_due'));
    const stripe = { subscriptions: { retrieve, list: vi.fn().mockResolvedValue({ data: [] }) } } as unknown as Stripe;
    expect((await reconcileUserSubscription('u1', stripe))?.status).toBe('past_due');
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(evaluateEntitlements(documents.get('user_profiles/u1'), now).hasAccess).toBe(false);
  });
});

it('recovers an active replacement when the linked canceled subscription still exists', async () => {
  documents.set('user_profiles/u1', { ...paid, stripeCustomerId: 'cus_1' });
  const replacement = subscription('active', 'sub_replacement');
  const stripe = { subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription('canceled')),
    list: vi.fn().mockResolvedValue({ data: [replacement, subscription('canceled')] }) } } as unknown as Stripe;
  expect((await reconcileUserSubscription('u1', stripe))?.id).toBe('sub_replacement');
  expect(documents.get('user_profiles/u1')?.stripeSubscriptionId).toBe('sub_replacement');
  expect(evaluateEntitlements(documents.get('user_profiles/u1'), now).hasAccess).toBe(true);
});
