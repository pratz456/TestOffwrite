import { assertSubscriptionOwner, getStripeClient, refreshSubscriptionForUser } from '@/lib/stripe/subscription-sync';
import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { adminDb } from '@/lib/firebase/admin';

export async function POST(req: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  try {
    const stripe = getStripeClient();
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
      await refreshSubscriptionForUser(uid, stripe, subscriptionId);
      return NextResponse.json({
        success: true,
        message: 'Subscription is already cancelled',
      });
    }

    // Cancel at period end (user keeps access until end of billing period)
    if (!subscription.cancel_at_period_end) {
      await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
    }
    await refreshSubscriptionForUser(uid, stripe, subscriptionId);

    return NextResponse.json({
      success: true,
      message: 'Renewal is off. Your subscription will end at the close of the current billing period.',
    });
  } catch {
    console.error('Subscription cancellation could not be verified');
    return NextResponse.json(
      { error: 'Failed to cancel subscription. Please try again.' },
      { status: 503 }
    );
  }
}
