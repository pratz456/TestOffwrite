import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { adminDb } from '@/lib/firebase/admin';
import { configuredPriceIds } from '@/lib/stripe/subscription-sync';

export class ExistingCheckoutSubscriptionError extends Error {}

type Attempt = { customerId: string; startedAt: number; idempotencyKey: string;
  params: Stripe.Checkout.SessionCreateParams; sessionId?: string };

/** Called only while the owner's checkout-operation lock is held. The private
 * attempt survives timeouts, so a retry cannot create a second paid subscription. */
export async function getOrCreateCheckoutSession(uid: string, stripe: Stripe,
  params: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session> {
  const customerId = params.customer;
  const priceId = params.line_items?.[0]?.price;
  if (!customerId || !priceId || params.mode !== 'subscription') throw new Error('Invalid checkout configuration');
  const ref = adminDb.doc(`user_profiles/${uid}/stripe_sync/checkout`);
  const saved = (await ref.get()).data() as Attempt | undefined;
  let previous: Stripe.Checkout.Session | undefined;
  if (saved) {
    if (saved.customerId !== customerId) throw new Error('Previous checkout customer needs review');
    if (saved.sessionId) previous = await stripe.checkout.sessions.retrieve(saved.sessionId);
    else {
      // Stripe only guarantees idempotency-key retention for 24 hours. Never
      // re-create an unresolved older attempt after that guarantee has elapsed.
      if (!Number.isFinite(saved.startedAt) || Date.now() - saved.startedAt >= 23 * 60 * 60 * 1000) {
        throw new Error('Previous checkout outcome needs review');
      }
      previous = await stripe.checkout.sessions.create(saved.params, { idempotencyKey: saved.idempotencyKey });
      await ref.set({ ...saved, sessionId: previous.id });
    }
  }

  // Include sessions opened by the previous release, before durable tracking.
  const listed = await stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 100 });
  if (listed.has_more) throw new Error('Open checkout history needs review');
  const open = new Map(listed.data.filter(session => session.mode === 'subscription').map(session => [session.id, session]));
  if (previous?.status === 'open') open.set(previous.id, previous);
  const prices = configuredPriceIds();
  for (const session of open.values()) {
    const sessionCustomer = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    if (sessionCustomer !== customerId || (session.metadata?.firebase_uid && session.metadata.firebase_uid !== uid)) {
      throw new Error('Checkout ownership mismatch');
    }
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
    if (items.has_more || items.data.length !== 1 || !items.data[0].price || !prices.includes(items.data[0].price.id)) {
      throw new ExistingCheckoutSubscriptionError('Manage your existing checkout in billing settings.');
    }
    if (open.size === 1 && items.data[0].price.id === priceId && items.data[0].quantity === 1 && session.url) {
      // Same plan, even across a five-minute boundary: return the same session.
      return session;
    }
  }
  // A changed interval replaces the old checkout, not the resulting subscription.
  // If completion wins the race, expire throws and no replacement is created.
  for (const session of open.values()) {
    const expired = await stripe.checkout.sessions.expire(session.id);
    if (expired.status !== 'expired') throw new Error('Checkout expiration not confirmed');
  }
  const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
  if (subscriptions.has_more || subscriptions.data.some(subscription => !['canceled', 'incomplete_expired'].includes(subscription.status) &&
    subscription.items.data.some(item => prices.includes(item.price.id)))) {
    throw new ExistingCheckoutSubscriptionError('Manage your existing subscription in billing settings.');
  }
  const attempt: Attempt = { customerId, startedAt: Date.now(), idempotencyKey: `writeoff-checkout-${uid}-${randomUUID()}`, params };
  await ref.set(attempt);
  const session = await stripe.checkout.sessions.create(params, { idempotencyKey: attempt.idempotencyKey });
  await ref.set({ ...attempt, sessionId: session.id });
  return session;
}
