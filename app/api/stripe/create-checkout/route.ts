import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { adminDb } from '@/lib/firebase/admin';
import { getStripeClient, configuredPriceIds, subscriptionPlanForPrice } from '@/lib/stripe/subscription-sync';
import { z } from 'zod';
import { beginCheckoutOperation, finishCheckoutOperation, retainCheckoutRecovery, CheckoutOperationError } from '@/lib/stripe/checkout-operations';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';
import { ExistingCheckoutSubscriptionError, getOrCreateCheckoutSession } from '@/lib/stripe/checkout-session';

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
  // Each attempt can create a provider customer and session; bound it per owner
  // before the billing operation marker is opened.
  const limit = await enforceRateLimit({ ...RATE_LIMITS.stripeCheckout, key: uid });
  if (!limit.allowed) return rateLimitResponse(limit, { error: 'Too many checkout attempts. Please wait a few minutes and try again.' });
  let operationId: string | undefined;
  let safeToRelease = true;
  let unsavedCustomerId: string | undefined;
  const response = await (async () => { try {
    operationId = await beginCheckoutOperation(uid);
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
      const existing = subscriptions.has_more || subscriptions.data.some((subscription) => !['canceled', 'incomplete_expired'].includes(subscription.status) &&
        subscription.items.data.some((item) => configuredPriceIds().includes(item.price.id)));
      if (existing) return NextResponse.json({ error: 'Manage your existing subscription in billing settings.', code: 'SUBSCRIPTION_EXISTS' }, { status: 409 });
    }
    const origin = checkoutOrigin();
    if (!customerId) {
      // An unknown provider outcome must keep deletion blocked until reviewed.
      safeToRelease = false;
      const customer = await stripe.customers.create({ email: typeof profile.email === 'string' ? profile.email : undefined,
        metadata: { firebase_uid: uid } }, { idempotencyKey: `writeoff-customer-${uid}-${operationId}` });
      customerId = customer.id;
      unsavedCustomerId = customer.id;
      await ref.update({ stripeCustomerId: customerId });
      unsavedCustomerId = undefined;
      safeToRelease = true; // Deletion can now discover and close this customer.
    }
    const session = await getOrCreateCheckoutSession(uid, stripe, { customer: customerId, mode: 'subscription',
      payment_method_types: ['card', 'us_bank_account'], line_items: [{ price: priceId, quantity: 1 }],
      payment_method_options: { us_bank_account: { financial_connections: { permissions: ['payment_method'] } } },
      subscription_data: { metadata: { firebase_uid: uid, feature: 'historical_transactions', payment_policy: 'settled_invoice' } },
      success_url: `${origin}/stripe/success?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${origin}/stripe/cancel`,
      metadata: { firebase_uid: uid, feature: 'historical_transactions' },
    });
    return NextResponse.json({ success: true, sessionId: session.id, url: session.url }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (operationId && !safeToRelease) {
      if (unsavedCustomerId) {
        try { safeToRelease = (await stripe.customers.del(unsavedCustomerId)).deleted === true; }
        catch { /* Keep the operation and recovery identifier for support. */ }
      }
      if (!safeToRelease) await retainCheckoutRecovery(uid, operationId, unsavedCustomerId).catch(() => {});
    }
    if (error instanceof CheckoutOperationError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    if (error instanceof ExistingCheckoutSubscriptionError) return NextResponse.json({ error: error.message, code: 'SUBSCRIPTION_EXISTS' }, { status: 409 });
    return NextResponse.json({ error: 'Unable to create checkout. Please try again.' }, { status: 503 });
  } })();
  if (operationId && safeToRelease) {
    try { await finishCheckoutOperation(uid, operationId); }
    catch { return NextResponse.json({ error: 'Billing status needs another check. Please contact support before continuing.', code: 'BILLING_OPERATION_PENDING' }, { status: 503 }); }
  }
  return response;
}
