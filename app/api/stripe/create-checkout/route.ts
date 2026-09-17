import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { adminDb } from '@/lib/firebase/admin';
import { getStripeClient, configuredPriceIds, subscriptionPlanForPrice } from '@/lib/stripe/subscription-sync';
import { z } from 'zod';

const checkoutRequest = z.object({ interval: z.enum(['monthly', 'yearly']).default('monthly') }).strict();

function checkoutOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  const origin = new URL(configured || (process.env.NODE_ENV === 'production' ? 'https://writeoffapp.com' : 'http://localhost:3000'));
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Invalid checkout origin');
  return origin.origin;
}

export async function POST(req: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  const parsed = checkoutRequest.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Choose monthly or yearly billing' }, { status: 400 });
  const { interval } = parsed.data;
  const stripe = getStripeClient();
  const priceId = interval === 'yearly'
    ? process.env.STRIPE_PRICE_ID_YEARLY || process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_YEARLY
    : process.env.STRIPE_PRICE_ID_MONTHLY || process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_MONTHLY || process.env.STRIPE_PRICE_ID || process.env.NEXT_PUBLIC_STRIPE_PRICE_ID;
  // Checkout sells Premium only; Basic prices are recognized for existing subscriptions.
  if (!stripe || !priceId || subscriptionPlanForPrice(priceId) !== 'premium') {
    return NextResponse.json({ error: 'Billing is temporarily unavailable' }, { status: 503 });
  }
  try {
    const ref = adminDb.doc(`user_profiles/${uid}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    const profile = snapshot.data() ?? {};
    let customerId = typeof profile.stripeCustomerId === 'string' ? profile.stripeCustomerId : undefined;
    if (customerId) {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer.deleted) customerId = undefined;
      else if (customer.metadata.firebase_uid && customer.metadata.firebase_uid !== uid) throw new Error('Customer ownership mismatch');
    }
    // Resolve an existing subscription in Stripe before opening another Checkout,
    // including payment-recovery states that should use the billing portal.
    if (customerId) {
      const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
      const existing = subscriptions.data.some((subscription) => !['canceled', 'incomplete_expired'].includes(subscription.status) &&
        subscription.items.data.some((item) => configuredPriceIds().includes(item.price.id)));
      if (existing) return NextResponse.json({ error: 'Manage your existing subscription in billing settings.', code: 'SUBSCRIPTION_EXISTS' }, { status: 409 });
    }
    const origin = checkoutOrigin();
    if (!customerId) {
      const customer = await stripe.customers.create({ email: typeof profile.email === 'string' ? profile.email : undefined,
        metadata: { firebase_uid: uid } }, { idempotencyKey: `writeoff-customer-${uid}-${profile.stripeCustomerId || 'new'}-${Math.floor(Date.now() / 300000)}` });
      customerId = customer.id;
      await ref.update({ stripeCustomerId: customerId });
    }
    const session = await stripe.checkout.sessions.create({ customer: customerId, mode: 'subscription',
      payment_method_types: ['card', 'us_bank_account'], line_items: [{ price: priceId, quantity: 1 }],
      payment_method_options: { us_bank_account: { financial_connections: { permissions: ['payment_method'] } } },
      subscription_data: { metadata: { firebase_uid: uid, feature: 'historical_transactions', payment_policy: 'settled_invoice' } },
      success_url: `${origin}/stripe/success?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${origin}/stripe/cancel`,
      metadata: { firebase_uid: uid, feature: 'historical_transactions' },
    }, { idempotencyKey: `writeoff-checkout-${uid}-${interval}-${customerId}-bank-v1-${Math.floor(Date.now() / 300000)}` });
    return NextResponse.json({ success: true, sessionId: session.id, url: session.url }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to create checkout. Please try again.' }, { status: 503 });
  }
}
