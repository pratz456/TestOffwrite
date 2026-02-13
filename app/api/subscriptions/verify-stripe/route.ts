import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase/admin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-12-18.acacia',
});

export async function POST(req: Request) {
  try {
    const { uid } = await getUserFromReqOrThrow(req);

    // Get user profile
    const userDoc = await adminDb.doc(`user_profiles/${uid}`).get();
    const userData = userDoc.data();

    const customerId = userData?.stripeCustomerId;
    const subscriptionId = userData?.stripeSubscriptionId;

    const stripeData: any = {
      hasCustomer: !!customerId,
      hasSubscription: !!subscriptionId,
    };

    // If we have a customer ID, fetch from Stripe
    if (customerId) {
      try {
        const customer = await stripe.customers.retrieve(customerId);
        if (customer && !customer.deleted) {
          stripeData.customer = {
            id: customer.id,
            email: customer.email,
            metadata: customer.metadata,
          };

          // Get subscriptions for this customer
          const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            limit: 10,
          });

          stripeData.subscriptions = subscriptions.data.map((sub) => ({
            id: sub.id,
            status: sub.status,
            currentPeriodStart: sub.current_period_start ? new Date(sub.current_period_start * 1000).toISOString() : null,
            currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
            trialStart: sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null,
            trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            items: sub.items.data.map((item) => ({
              priceId: item.price.id,
              interval: item.price.recurring?.interval,
              amount: item.price.unit_amount ? item.price.unit_amount / 100 : null,
            })),
          }));
        }
      } catch (error: any) {
        stripeData.customerError = error.message;
      }
    }

    // If we have a subscription ID, fetch it directly
    if (subscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        stripeData.subscriptionDetails = {
          id: subscription.id,
          status: subscription.status,
          currentPeriodStart: subscription.current_period_start ? new Date(subscription.current_period_start * 1000).toISOString() : null,
          currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
          trialStart: subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null,
          trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        };
      } catch (error: any) {
        stripeData.subscriptionError = error.message;
      }
    }

    return NextResponse.json({
      success: true,
      firestore: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        hasHistoricalAccess: userData?.hasHistoricalAccess,
        stripeSubscriptionStatus: userData?.stripeSubscriptionStatus,
        trialStart: userData?.trialStart,
        trialEnd: userData?.trialEnd,
        subscriptionEnd: userData?.subscriptionEnd,
      },
      stripe: stripeData,
    });
  } catch (error: any) {
    console.error('Error verifying Stripe:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to verify Stripe subscription' },
      { status: 500 }
    );
  }
}

