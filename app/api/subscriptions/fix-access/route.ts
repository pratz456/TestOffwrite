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
    const userEmail = userData?.email;

    // Try to find subscription from customer
    let subscription: Stripe.Subscription | null = null;
    let foundCustomerId: string | null = customerId || null;

    // First, try by subscription ID if we have it
    if (subscriptionId) {
      try {
        subscription = await stripe.subscriptions.retrieve(subscriptionId);
        foundCustomerId = subscription.customer as string;
      } catch (error) {
        console.error('Error retrieving subscription by ID:', error);
      }
    }

    // If not found by ID, try to find from customer ID
    if (!subscription && customerId) {
      try {
        const subscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: 'all',
          limit: 10,
        });
        // Find the most recent active or trialing subscription
        subscription = subscriptions.data.find(
          sub => sub.status === 'active' || sub.status === 'trialing'
        ) || subscriptions.data[0] || null;
      } catch (error) {
        console.error('Error listing subscriptions:', error);
      }
    }

    // If still not found and we have email, try to find customer by email
    if (!subscription && !customerId && userEmail) {
      try {
        const customers = await stripe.customers.list({
          email: userEmail,
          limit: 10,
        });

        if (customers.data.length > 0) {
          foundCustomerId = customers.data[0].id;
          // Try to find subscription for this customer
          const subscriptions = await stripe.subscriptions.list({
            customer: foundCustomerId,
            status: 'all',
            limit: 10,
          });
          subscription = subscriptions.data.find(
            sub => sub.status === 'active' || sub.status === 'trialing'
          ) || subscriptions.data[0] || null;
        }
      } catch (error) {
        console.error('Error searching by email:', error);
      }
    }

    // If still not found, search all recent subscriptions for this user's email in metadata
    if (!subscription) {
      try {
        const allSubscriptions = await stripe.subscriptions.list({
          limit: 100,
          status: 'all',
        });

        // Find subscription with matching firebase_uid in metadata
        subscription = allSubscriptions.data.find(
          sub => sub.metadata?.firebase_uid === uid ||
                 (sub.customer && typeof sub.customer === 'object' &&
                  (sub.customer as any).metadata?.firebase_uid === uid)
        ) || null;

        if (subscription && subscription.customer) {
          foundCustomerId = typeof subscription.customer === 'string'
            ? subscription.customer
            : (subscription.customer as any).id;
        }
      } catch (error) {
        console.error('Error searching all subscriptions:', error);
      }
    }

    if (!subscription) {
      return NextResponse.json(
        { error: 'No active subscription found in Stripe' },
        { status: 400 }
      );
    }

    // Update user profile with subscription data
    const isTrial = subscription.status === 'trialing';
    const isActive = subscription.status === 'active';
    const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;
    const trialStart = subscription.trial_start ? new Date(subscription.trial_start * 1000) : null;
    const currentPeriodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null;

    const updateData: any = {
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: foundCustomerId || (subscription.customer as string),
      stripeSubscriptionStatus: subscription.status,
      hasHistoricalAccess: isActive || isTrial,
      subscriptionEnd: currentPeriodEnd,
    };

    if (isTrial && trialStart && trialEnd) {
      updateData.trialStart = trialStart;
      updateData.trialEnd = trialEnd;
    }

    await adminDb.doc(`user_profiles/${uid}`).update(updateData);

    return NextResponse.json({
      success: true,
      message: 'Subscription access fixed successfully',
      data: {
        subscriptionId: subscription.id,
        status: subscription.status,
        hasHistoricalAccess: isActive || isTrial,
      },
    });
  } catch (error: any) {
    console.error('Error fixing access:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fix access' },
      { status: 500 }
    );
  }
}

