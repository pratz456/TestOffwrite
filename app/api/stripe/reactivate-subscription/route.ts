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

    // If subscription is already canceled (not just scheduled to cancel), return error
    if (subscription.status === 'canceled') {
      return NextResponse.json(
        { error: 'Subscription is already canceled and cannot be reactivated' },
        { status: 400 }
      );
    }

    // If subscription is not scheduled to cancel, return success
    if (!subscription.cancel_at_period_end) {
      await refreshSubscriptionForUser(uid, stripe, subscriptionId);
      return NextResponse.json({
        success: true,
        message: 'Renewal is already enabled. Review billing for your current payment status.',
      });
    }

    // Reactivate subscription by setting cancel_at_period_end to false
    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
    });
    await refreshSubscriptionForUser(uid, stripe, subscriptionId);

    return NextResponse.json({
      success: true,
      message: 'Renewal is enabled. Review billing for your current payment status.',
    });
  } catch {
    console.error('Subscription renewal could not be verified');
    return NextResponse.json(
      { error: 'Failed to reactivate subscription. Please try again.' },
      { status: 503 }
    );
  }
}
