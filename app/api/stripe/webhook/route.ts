import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripeClient, refreshSubscriptionForUser } from '@/lib/stripe/subscription-sync';
import { adminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const stripe = getStripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  const signature = req.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(await req.text(), signature, secret); }
  catch { return NextResponse.json({ error: 'Invalid signature' }, { status: 400 }); }
  try {
    let subscriptionId: string | null = null;
    let deleted: Stripe.Subscription | null = null;
    if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
      const payload = event.data.object as Stripe.Subscription;
      subscriptionId = payload.id;
      if (event.type === 'customer.subscription.deleted') deleted = payload;
    } else if (['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed'].includes(event.type)) {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === 'subscription') subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null;
    } else if (['invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed', 'invoice.voided', 'invoice.marked_uncollectible'].includes(event.type)) {
      const invoice = event.data.object as Stripe.Invoice;
      const linked = invoice.parent?.subscription_details?.subscription;
      subscriptionId = typeof linked === 'string' ? linked : linked?.id ?? null;
    }
    if (subscriptionId) {
      let subscription: Stripe.Subscription;
      // Stripe does not guarantee event order. Retrieve its current state instead
      // of granting from an old event payload or from Checkout success alone.
      try { subscription = await stripe.subscriptions.retrieve(subscriptionId); }
      catch (error) {
        if (deleted && error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing') subscription = deleted;
        else throw error;
      }
      let uid = subscription.metadata?.firebase_uid;
      if (!uid) {
        const customer = typeof subscription.customer === 'string' ? await stripe.customers.retrieve(subscription.customer) : subscription.customer;
        if (!customer.deleted) uid = customer.metadata?.firebase_uid;
      }
      if (!uid) {
        // Legacy subscriptions can predate Firebase UID metadata. Only a unique,
        // server-owned customer mapping is identity evidence; never use email.
        const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
        const owners = await adminDb.collection('user_profiles').where('stripeCustomerId', '==', customerId).limit(2).get();
        if (owners.size > 1) throw new Error('Ambiguous subscription owner');
        uid = owners.docs[0]?.id;
      }
      // Unrelated Stripe products/customers do not belong to this application.
      if (uid) await refreshSubscriptionForUser(uid, stripe, subscriptionId, { id: event.id, created: event.created }, deleted ?? undefined);
    }
    return NextResponse.json({ received: true });
  } catch {
    // Retry on a failed persistence/provider operation; never acknowledge a lost grant.
    return NextResponse.json({ error: 'Webhook processing unavailable' }, { status: 500 });
  }
}
