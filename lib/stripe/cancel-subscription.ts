import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase/admin';

/** Account deletion must not discard billing identifiers while charges can continue. */
export async function cancelUserStripeSubscriptions(userId: string): Promise<{
  success: boolean; error?: Error; canceledSubscriptions?: number;
}> {
  try {
    const profile = (await adminDb.doc(`user_profiles/${userId}`).get()).data();
    const customerId = profile?.stripeCustomerId;
    const subscriptionId = profile?.stripeSubscriptionId;
    if (!customerId && !subscriptionId) return { success: true, canceledSubscriptions: 0 };
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('Billing is not configured');
    const stripe = new Stripe(key, { apiVersion: '2025-10-29.clover' });

    let subscription: Stripe.Subscription | undefined;
    if (subscriptionId) {
      try { subscription = await stripe.subscriptions.retrieve(subscriptionId); }
      catch (error) {
        // An existing customer can still be positively deleted, closing all of
        // its subscriptions. An unresolvable subscription alone needs support.
        if (!customerId || (error as { code?: string }).code !== 'resource_missing') throw error;
      }
      const subscriptionCustomer = typeof subscription?.customer === 'string'
        ? subscription.customer : subscription?.customer?.id;
      if (customerId && subscription && subscriptionCustomer !== customerId) throw new Error('Billing ownership mismatch');
    }
    if (customerId) {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer.deleted === true) {
        if (subscription && !['canceled', 'incomplete_expired'].includes(subscription.status)) throw new Error('Billing status is inconsistent');
        return { success: true, canceledSubscriptions: 0 };
      }
      // Stripe customer deletion immediately cancels every active subscription,
      // including subscriptions beyond a single paginated list response.
      const deleted = await stripe.customers.del(customerId);
      if (deleted.deleted !== true) throw new Error('Billing deletion was not confirmed');
      return { success: true };
    }
    if (!subscription) throw new Error('Billing status could not be verified');
    if (['canceled', 'incomplete_expired'].includes(subscription.status)) return { success: true, canceledSubscriptions: 0 };
    const canceled = await stripe.subscriptions.cancel(subscription.id);
    if (canceled.status !== 'canceled') throw new Error('Subscription cancellation was not confirmed');
    return { success: true, canceledSubscriptions: 1 };
  } catch {
    return { success: false, error: new Error('Billing could not be closed. Please retry or contact support.') };
  }
}
