import { assertSubscriptionOwner, refreshSubscriptionForUser } from '@/lib/stripe/subscription-sync';
import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase/admin';

function getStripeOrNull() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2025-10-29.clover' });
}

export async function POST(req: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  try {
    const stripe = getStripeOrNull();
    if (!stripe) {
      return NextResponse.json({ error: 'Billing is temporarily unavailable' }, { status: 503 });
    }

    // Get user profile to find Stripe subscription ID
    const userDoc = await adminDb.doc(`user_profiles/${uid}`).get();
    const userData = userDoc.data();

    const subscriptionId = userData?.stripeSubscriptionId;

    if (!subscriptionId) {
      return NextResponse.json(
        { error: 'No active subscription found' },
        { status: 400 }
      );
    }

    // Retrieve current subscription
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    assertSubscriptionOwner(uid, userData ?? {}, subscription);

    // If subscription is already cancelled, return success
    if (subscription.status === 'canceled') {
      return NextResponse.json({
        success: true,
        message: 'Subscription is already cancelled',
      });
    }

    // Cancel at period end (user keeps access until end of billing period)
    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
    await refreshSubscriptionForUser(uid, stripe, subscriptionId);

    return NextResponse.json({
      success: true,
      message: 'Subscription cancelled successfully',
    });
  } catch (error: any) {
    console.error('Error cancelling subscription:', error);
    return NextResponse.json(
      { error: 'Failed to cancel subscription. Please try again.' },
      { status: 500 }
    );
  }
}

