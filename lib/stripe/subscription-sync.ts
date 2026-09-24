import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase/admin';
import { evaluateEntitlements, type PaidSubscriptionPlan } from '@/lib/subscriptions/entitlements';

export function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key, { apiVersion: '2025-10-29.clover', timeout: 15000, maxNetworkRetries: 1 }) : null;
}

function premiumPriceIds(): string[] {
  return [process.env.STRIPE_PRICE_ID_MONTHLY, process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_MONTHLY,
    process.env.STRIPE_PRICE_ID_YEARLY, process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_YEARLY,
    process.env.STRIPE_PRICE_ID, process.env.NEXT_PUBLIC_STRIPE_PRICE_ID].filter((id): id is string => Boolean(id));
}

function basicPriceIds(): string[] {
  return [process.env.STRIPE_PRICE_ID_BASIC_MONTHLY, process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_BASIC_MONTHLY,
    process.env.STRIPE_PRICE_ID_BASIC_YEARLY, process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_BASIC_YEARLY,
    process.env.STRIPE_PRICE_ID_BASIC, process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_BASIC].filter((id): id is string => Boolean(id));
}

export function configuredPriceIds(): string[] {
  return [...new Set([...premiumPriceIds(), ...basicPriceIds()])];
}

export function subscriptionPlanForPrice(priceId: string): PaidSubscriptionPlan | null {
  // A conflicting alias must not promote a legacy Basic price to Premium.
  if (basicPriceIds().includes(priceId)) return 'basic';
  return premiumPriceIds().includes(priceId) ? 'premium' : null;
}

function subscriptionItem(subscription: Stripe.Subscription) {
  return subscription.items.data.find(item => subscriptionPlanForPrice(item.price.id) === 'premium')
    ?? subscription.items.data.find(item => subscriptionPlanForPrice(item.price.id) === 'basic');
}

export function customerIdFor(subscription: Stripe.Subscription): string {
  return typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
}

/** ACH subscriptions can be active before the debit settles, even after failure. */
export function subscriptionPaymentStatus(subscription: Stripe.Subscription): string {
  if (subscription.status !== 'active') return subscription.status;
  const invoice = subscription.latest_invoice;
  // Legacy subscriptions also use the actual invoice when Stripe supplies one;
  // otherwise an unpaid portal upgrade could grant Premium without our metadata.
  if (!invoice && subscription.metadata?.payment_policy !== 'settled_invoice') return subscription.status;
  if (invoice && typeof invoice !== 'string' && invoice.status === 'paid') return 'active';
  if (invoice && typeof invoice !== 'string' && ['void', 'uncollectible'].includes(invoice.status ?? '')) return 'payment_required';
  return 'payment_pending';
}

function hasSettledAccess(subscription: Stripe.Subscription): boolean {
  return Boolean(subscriptionItem(subscription)) && subscriptionPaymentStatus(subscription) === 'active';
}

export function subscriptionProfileUpdate(subscription: Stripe.Subscription, now = new Date()): Record<string, unknown> {
  const configured = configuredPriceIds();
  if (!configured.length) throw new Error('Subscription prices not configured');
  const item = subscriptionItem(subscription);
  const accepted = Boolean(item);
  const subscriptionEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
  const paymentStatus = subscriptionPaymentStatus(subscription);
  const update: Record<string, unknown> = {
    stripeCustomerId: customerIdFor(subscription), stripeSubscriptionId: subscription.id,
    subscriptionPlan: item ? subscriptionPlanForPrice(item.price.id) : null,
    stripeSubscriptionStatus: accepted ? paymentStatus : 'unsupported_product',
    subscriptionStatus: accepted && paymentStatus === 'active' ? 'active' : accepted && subscription.status === 'trialing' ? 'trial' : 'expired',
    subscriptionEnd,
  };
  if (subscription.status === 'trialing') {
    update.trialStart = subscription.trial_start ? new Date(subscription.trial_start * 1000) : null;
    update.trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;
  }
  update.hasHistoricalAccess = evaluateEntitlements(update, now).hasAccess;
  return update;
}

/** Require a trusted link and reject conflicting metadata; email alone is never ownership. */
export function assertSubscriptionOwner(uid: string, profile: Record<string, unknown>, subscription: Stripe.Subscription): void {
  const linkedCustomer = profile.stripeCustomerId;
  const metadataUid = subscription.metadata?.firebase_uid;
  if ((metadataUid && metadataUid !== uid) || (linkedCustomer && linkedCustomer !== customerIdFor(subscription)) ||
      (!linkedCustomer && metadataUid !== uid)) throw new Error('Subscription ownership mismatch');
}

export async function getSubscriptionSyncRevision(uid: string): Promise<number> {
  const snapshot = await adminDb.doc(`user_profiles/${uid}/stripe_sync/state`).get();
  return Number(snapshot.data()?.revision) || 0;
}

export async function syncSubscriptionForUser(uid: string, subscription: Stripe.Subscription,
  expectedRevision: number, event?: { id: string; created: number }): Promise<boolean> {
  const ref = adminDb.doc(`user_profiles/${uid}`);
  const stateRef = adminDb.doc(`user_profiles/${uid}/stripe_sync/state`);
  const eventRef = event ? adminDb.doc(`stripe_events/${event.id}`) : null;
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error('Subscription profile missing');
    const profile = snapshot.data() ?? {};
    assertSubscriptionOwner(uid, profile, subscription);
    const syncState = await transaction.get(stateRef);
    if (eventRef && event) {
      const seen = await transaction.get(eventRef);
      if (seen.exists) return true;
      // Old event delivery cannot undo a newer observed subscription lifecycle.
      if (typeof syncState.data()?.eventCreated === 'number' && syncState.data()!.eventCreated > event.created) {
        transaction.set(eventRef, { processedAt: new Date(), ignored: true });
        return true;
      }
    }
    // Every provider read, including polling and recovery, is conditional on the
    // version observed before that read. A slow read cannot undo a newer write.
    const revision = Number(syncState.data()?.revision) || 0;
    if (revision !== expectedRevision) return false;
    // Deletion of an older subscription must not revoke the replacement subscription.
    if (profile.stripeSubscriptionId && profile.stripeSubscriptionId !== subscription.id &&
        !['active', 'trialing'].includes(subscription.status)) {
      if (eventRef) transaction.set(eventRef, { processedAt: new Date(), ignored: true });
      return true;
    }
    transaction.update(ref, subscriptionProfileUpdate(subscription));
    transaction.set(stateRef, { revision: revision + 1, ...(event ? { eventCreated: event.created, eventId: event.id } : {}) }, { merge: true });
    if (eventRef) transaction.set(eventRef, { processedAt: new Date() });
    return true;
  });
}

/** Re-fetch after a concurrent write rather than persisting a stale provider result. */
export async function refreshSubscriptionForUser(uid: string, stripe: Stripe, subscriptionId: string,
  event?: { id: string; created: number }, deletedFallback?: Stripe.Subscription): Promise<Stripe.Subscription> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const revision = await getSubscriptionSyncRevision(uid);
    const profile = (await adminDb.doc(`user_profiles/${uid}`).get()).data() ?? {};
    let subscription: Stripe.Subscription;
    try { subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] }); }
    catch (error) {
      if (deletedFallback && error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing') subscription = deletedFallback;
      else throw error;
    }
    assertSubscriptionOwner(uid, profile, subscription);
    if (subscription.status === 'active' && subscriptionPaymentStatus(subscription) !== 'active' &&
        typeof profile.stripeSubscriptionId === 'string' && profile.stripeSubscriptionId !== subscription.id) {
      // A second, unsettled ACH checkout must not displace an already paid plan.
      // Verify the existing subscription now instead of trusting a stale profile.
      try {
        const existing = await stripe.subscriptions.retrieve(profile.stripeSubscriptionId, { expand: ['latest_invoice'] });
        assertSubscriptionOwner(uid, profile, existing);
        if (hasSettledAccess(existing)) subscription = existing;
      } catch (error) {
        if (!(error instanceof Stripe.errors.StripeInvalidRequestError) || error.code !== 'resource_missing') throw error;
      }
    }
    if (await syncSubscriptionForUser(uid, subscription, revision, event)) return subscription;
  }
  throw new Error('Subscription changed during verification. Retry required.');
}

async function markMissingSubscription(uid: string, subscriptionId: unknown, expectedRevision: number): Promise<boolean> {
  const ref = adminDb.doc(`user_profiles/${uid}`);
  const stateRef = adminDb.doc(`user_profiles/${uid}/stripe_sync/state`);
  return adminDb.runTransaction(async transaction => {
    const profile = await transaction.get(ref);
    const state = await transaction.get(stateRef);
    if ((Number(state.data()?.revision) || 0) !== expectedRevision || profile.data()?.stripeSubscriptionId !== subscriptionId) return false;
    transaction.update(ref, { subscriptionStatus: 'expired', stripeSubscriptionStatus: 'deleted', hasHistoricalAccess: false, subscriptionEnd: null });
    transaction.set(stateRef, { revision: expectedRevision + 1 }, { merge: true });
    return true;
  });
}

export async function reconcileUserSubscription(uid: string, stripe: Stripe): Promise<Stripe.Subscription | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const revision = await getSubscriptionSyncRevision(uid);
    const profile = (await adminDb.doc(`user_profiles/${uid}`).get()).data() ?? {};
    let subscription: Stripe.Subscription | null = null;
    let missing = false;
    if (typeof profile.stripeSubscriptionId === 'string' && profile.stripeSubscriptionId) {
      try { subscription = await stripe.subscriptions.retrieve(profile.stripeSubscriptionId, { expand: ['latest_invoice'] }); }
      catch (error) {
        if (!(error instanceof Stripe.errors.StripeInvalidRequestError) || error.code !== 'resource_missing') throw error;
        missing = true;
      }
    }
    if ((!subscription || (!hasSettledAccess(subscription) && subscription.status !== 'trialing')) && typeof profile.stripeCustomerId === 'string' && profile.stripeCustomerId) {
      const list = await stripe.subscriptions.list({ customer: profile.stripeCustomerId, status: 'all', limit: 100, expand: ['data.latest_invoice'] });
      const prices = configuredPriceIds();
      subscription = list.data.find(hasSettledAccess) ?? list.data.find((sub) => sub.status === 'trialing' &&
        sub.items.data.some((item) => prices.includes(item.price.id))) ?? list.data.find((sub) => sub.status === 'active' &&
        sub.items.data.some((item) => prices.includes(item.price.id))) ?? subscription;
    }
    if (subscription) {
      if (await syncSubscriptionForUser(uid, subscription, revision)) return subscription;
    } else if (!missing || await markMissingSubscription(uid, profile.stripeSubscriptionId, revision)) return null;
  }
  throw new Error('Subscription changed during verification. Retry required.');
}

export function subscriptionDetails(subscription: Stripe.Subscription | null) {
  if (!subscription) return null;
  const item = subscriptionItem(subscription) ?? subscription.items.data[0];
  return { id: subscription.id, plan: item ? subscriptionPlanForPrice(item.price.id) : null, status: subscriptionPaymentStatus(subscription),
    currentPeriodStart: item?.current_period_start ? new Date(item.current_period_start * 1000) : null,
    currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
    planInterval: item?.price.recurring?.interval ?? null,
    planAmount: item?.price.unit_amount == null ? null : item.price.unit_amount / 100,
    planCurrency: item?.price.currency ?? null };
}
