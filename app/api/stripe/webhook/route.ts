import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase/admin';
import { headers } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-12-18.acacia',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

export async function POST(req: Request) {
  try {
    const body = await req.text();
    const headersList = await headers();
    const signature = headersList.get('stripe-signature');

    if (!signature) {
      return NextResponse.json(
        { error: 'No signature' },
        { status: 400 }
      );
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 400 }
      );
    }

    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdate(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
          await handleSubscriptionUpdate(subscription);
        }
        break;
      }

      case 'invoice.payment_failed': {
        // Handle payment failure - could revoke access or send notification
        console.log('Payment failed for subscription:', event.data.object);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  let firebaseUid = session.metadata?.firebase_uid;

  // If not in session metadata, try to get from customer
  if (!firebaseUid && session.customer) {
    try {
      const customer = typeof session.customer === 'string'
        ? await stripe.customers.retrieve(session.customer)
        : session.customer;
      if (customer && !customer.deleted) {
        firebaseUid = customer.metadata?.firebase_uid;
      }
    } catch (error) {
      console.error('Error retrieving customer in checkout:', error);
    }
  }

  if (!firebaseUid) {
    console.error('No firebase_uid in session or customer metadata');
    return;
  }

  // Get subscription details
  const subscriptionId = session.subscription as string;
  if (!subscriptionId) {
    console.error('No subscription ID in session');
    return;
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await handleSubscriptionUpdate(subscription);
    console.log(`✅ Checkout completed for user ${firebaseUid}, subscription ${subscriptionId}`);
  } catch (error) {
    console.error('Error processing checkout completion:', error);
  }
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  // Try to get firebase_uid from subscription metadata first
  let firebaseUid = subscription.metadata?.firebase_uid;

  // If not in subscription metadata, try to get from customer metadata
  if (!firebaseUid && subscription.customer) {
    try {
      const customer = typeof subscription.customer === 'string'
        ? await stripe.customers.retrieve(subscription.customer)
        : subscription.customer;
      if (customer && !customer.deleted) {
        firebaseUid = customer.metadata?.firebase_uid;
      }
    } catch (error) {
      console.error('Error retrieving customer:', error);
    }
  }

  if (!firebaseUid) {
    console.error('No firebase_uid found in subscription or customer metadata');
    return;
  }

  const customerId = subscription.customer as string;
  // Active includes subscriptions that are active even if scheduled for cancellation
  const isActive = subscription.status === 'active';
  let currentPeriodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null;

  // TEST MODE: Set subscription end to 0 days (today) for testing expiration behavior
  if (process.env.STRIPE_TEST_MODE_EXPIRE_TODAY === 'true') {
    currentPeriodEnd = new Date(); // Set to now (0 days remaining)
    console.log(`🧪 TEST MODE: Setting subscriptionEnd to today for testing`);
  }

  // Update user profile with subscription info
  // When user pays, set subscriptionStatus to 'active' and grant 1-year access
  // Note: Trial is app-managed, not Stripe-managed, so we don't use Stripe's trial fields
  const updateData: any = {
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId,
    stripeSubscriptionStatus: subscription.status,
    subscriptionStatus: isActive ? 'active' : 'expired', // App-managed status
    hasHistoricalAccess: isActive, // Only true if subscription is active
    subscriptionEnd: currentPeriodEnd,
  };

  // Keep app-managed trial dates for historical reference, but subscriptionStatus is now 'active'
  // Don't overwrite trialStart/trialEnd - they're app-managed

  await adminDb.doc(`user_profiles/${firebaseUid}`).update(updateData);

  console.log(`✅ Updated user ${firebaseUid} with subscription status: ${subscription.status} (app status: ${updateData.subscriptionStatus})`);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  // Try to get firebase_uid from subscription metadata first
  let firebaseUid = subscription.metadata?.firebase_uid;

  // If not in subscription metadata, try to get from customer metadata
  if (!firebaseUid && subscription.customer) {
    try {
      const customer = typeof subscription.customer === 'string'
        ? await stripe.customers.retrieve(subscription.customer)
        : subscription.customer;
      if (customer && !customer.deleted) {
        firebaseUid = customer.metadata?.firebase_uid;
      }
    } catch (error) {
      console.error('Error retrieving customer:', error);
    }
  }

  if (!firebaseUid) {
    console.error('No firebase_uid found in subscription or customer metadata');
    return;
  }

  // When subscription is deleted, check if trial expired
  // If trial expired, set to 'expired', otherwise keep as 'none' (they can still use free tier)
  const userDoc = await adminDb.doc(`user_profiles/${firebaseUid}`).get();
  const userData = userDoc.data();
  const trialEnd = userData?.trialEnd?.toDate?.() || (userData?.trialEnd ? new Date(userData.trialEnd) : undefined);
  const now = new Date();
  const trialExpired = trialEnd && now > trialEnd;

  // Revoke access when subscription is deleted
  await adminDb.doc(`user_profiles/${firebaseUid}`).update({
    subscriptionStatus: trialExpired ? 'expired' : 'none', // If trial expired, mark as expired; otherwise back to none
    hasHistoricalAccess: false, // No longer have 1-year access
    stripeSubscriptionStatus: 'canceled',
    stripeSubscriptionId: null,
    // Keep trialStart/trialEnd for historical reference
  });

  console.log(`✅ Revoked access for user ${firebaseUid} - subscription deleted (status: ${trialExpired ? 'expired' : 'none'})`);
}

