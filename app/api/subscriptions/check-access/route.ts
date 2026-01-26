import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { checkHistoricalAccess } from '@/lib/subscriptions/historical-access';
import { adminDb } from '@/lib/firebase/admin';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-12-18.acacia',
});

export async function GET(req: Request) {
  try {
    const { uid } = await getUserFromReqOrThrow(req);
    const accessStatus = await checkHistoricalAccess(uid);

    // Get additional subscription details from Stripe if subscription exists
    let subscriptionDetails: any = null;
    const userDoc = await adminDb.doc(`user_profiles/${uid}`).get();
    const userData = userDoc.data();
    const subscriptionId = userData?.stripeSubscriptionId;

    if (subscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0]?.price?.id;
        const price = priceId ? await stripe.prices.retrieve(priceId) : null;

        subscriptionDetails = {
          id: subscription.id,
          status: subscription.status,
          currentPeriodStart: subscription.current_period_start ? new Date(subscription.current_period_start * 1000) : null,
          currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
          planInterval: price?.recurring?.interval || null, // 'month' or 'year'
          planAmount: price?.unit_amount ? (price.unit_amount / 100) : null, // Convert from cents
          planCurrency: price?.currency || null,
        };
      } catch (error) {
        console.error('Error fetching subscription details from Stripe:', error);
        // Continue without subscription details
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        ...accessStatus,
        subscription: subscriptionDetails,
      },
    });
  } catch (error) {
    console.error('Error checking historical access:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check access status' },
      { status: 500 }
    );
  }
}

