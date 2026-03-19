import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { checkHistoricalAccess } from '@/lib/subscriptions/historical-access';
import { startFreeTrial } from '@/lib/subscriptions/trial-manager';
import { adminDb } from '@/lib/firebase/admin';
import Stripe from 'stripe';

function getStripeOrNull() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, {
    apiVersion: '2025-10-29.clover',
  });
}

export async function GET(req: Request) {
  try {
    const { uid } = await getUserFromReqOrThrow(req);
    const stripe = getStripeOrNull();

    // Get user profile first
    const userDoc = await adminDb.doc(`user_profiles/${uid}`).get();
    const userData = userDoc.data();
    const subscriptionId = userData?.stripeSubscriptionId;
    const customerId = userData?.stripeCustomerId;

    // Flag to track if subscription was found to be deleted/missing in Stripe
    let subscriptionDeleted = false;

    // Sync subscription status from Stripe if subscription exists
    if (subscriptionId && stripe) {
      try {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId) as any;
        const isActive = subscription.status === 'active';
        const firstItem = subscription.items?.data?.[0];
        let currentPeriodEnd = firstItem?.current_period_end ? new Date(firstItem.current_period_end * 1000) : null;

        // TEST MODE: Set subscription end to 0 days (today) for testing expiration behavior
        if (process.env.STRIPE_TEST_MODE_EXPIRE_TODAY === 'true') {
          currentPeriodEnd = new Date(); // Set to now (0 days remaining)
          console.log(`🧪 TEST MODE: Setting subscriptionEnd to today for testing`);
        }

        // Check if Firestore is out of sync with Stripe
        const firestoreStatus = userData?.subscriptionStatus || 'none';
        const firestoreStripeStatus = userData?.stripeSubscriptionStatus;
        const needsSync =
          (isActive && firestoreStatus !== 'active') ||
          (subscription.status !== firestoreStripeStatus) ||
          (isActive && !userData?.hasHistoricalAccess);

        // Always update if test mode is enabled (to force subscriptionEnd to today)
        const testModeEnabled = process.env.STRIPE_TEST_MODE_EXPIRE_TODAY === 'true';
        const shouldUpdate = needsSync || testModeEnabled;

        if (shouldUpdate) {
          if (testModeEnabled) {
            console.log(`🧪 TEST MODE: Updating subscriptionEnd to today for user ${uid}`);
          } else {
            console.log(`🔄 Syncing subscription status from Stripe for user ${uid}`);
          }

          const updateData: any = {
            stripeSubscriptionId: subscription.id,
            stripeSubscriptionStatus: subscription.status,
            subscriptionStatus: isActive ? 'active' : (subscription.status === 'trialing' ? 'trial' : 'expired'),
            hasHistoricalAccess: isActive || subscription.status === 'trialing',
            subscriptionEnd: currentPeriodEnd,
          };

          // Update customer ID if missing
          if (!customerId && subscription.customer) {
            updateData.stripeCustomerId = typeof subscription.customer === 'string'
              ? subscription.customer
              : (subscription.customer as any).id;
          }

          await adminDb.doc(`user_profiles/${uid}`).update(updateData);
          console.log(`✅ Updated subscription status: ${subscription.status} -> subscriptionStatus: ${updateData.subscriptionStatus}, subscriptionEnd: ${currentPeriodEnd?.toISOString()}`);
        }
      } catch (error: any) {
        // If subscription doesn't exist in Stripe, mark as expired and clear invalid ID
        if (error.code === 'resource_missing' || error.statusCode === 404) {
          subscriptionDeleted = true;  // Set flag to skip second retrieval
          console.log(`⚠️ Subscription ${subscriptionId} not found in Stripe, marking as expired and clearing ID`);
          await adminDb.doc(`user_profiles/${uid}`).update({
            subscriptionStatus: 'expired',
            stripeSubscriptionStatus: 'deleted',
            hasHistoricalAccess: false,
            stripeSubscriptionId: null,  // Clear the invalid subscription ID
          });
        } else {
          console.error('Error fetching subscription from Stripe:', error);
        }
      }
    } else if (customerId && stripe) {
      // If no subscription ID but we have customer ID, try to find active subscription
      try {
        const subscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: 'all',
          limit: 10,
        });

        const activeSubscription = subscriptions.data.find(
          sub => sub.status === 'active' || sub.status === 'trialing'
        ) as any;

        if (activeSubscription) {
          const isActive = activeSubscription.status === 'active';
          let currentPeriodEnd: Date | null = null;
          const activeFirstItem = activeSubscription.items?.data?.[0];
          if (activeFirstItem?.current_period_end) currentPeriodEnd = new Date(activeFirstItem.current_period_end * 1000);

          // TEST MODE: Set subscription end to 0 days (today) for testing expiration behavior
          const testModeEnabled = process.env.STRIPE_TEST_MODE_EXPIRE_TODAY === 'true';
          if (testModeEnabled) {
            currentPeriodEnd = new Date(); // Set to now (0 days remaining)
            console.log(`🧪 TEST MODE: Setting subscriptionEnd to today for testing`);
          }

          await adminDb.doc(`user_profiles/${uid}`).update({
            stripeSubscriptionId: activeSubscription.id,
            stripeCustomerId: customerId,
            stripeSubscriptionStatus: activeSubscription.status,
            subscriptionStatus: isActive ? 'active' : 'trial',
            hasHistoricalAccess: isActive || activeSubscription.status === 'trialing',
            subscriptionEnd: currentPeriodEnd,
          });
          console.log(`✅ Synced subscription ${activeSubscription.id} for user ${uid}, subscriptionEnd: ${currentPeriodEnd?.toISOString()}`);
        }
      } catch (error) {
        console.error('Error searching for subscriptions:', error);
      }
    }

    // Auto-start free trial if user has no trial/subscription
    // This ensures all users get historical access
    const updatedUserDocBeforeTrial = await adminDb.doc(`user_profiles/${uid}`).get();
    const userDataBeforeTrial = updatedUserDocBeforeTrial.data();
    const subscriptionStatusBeforeTrial = userDataBeforeTrial?.subscriptionStatus || 'none';

    if (subscriptionStatusBeforeTrial === 'none' || subscriptionStatusBeforeTrial === 'expired') {
      console.log(`🔄 [Check Access] User ${uid} has no active trial/subscription, starting free trial...`);
      const trialResult = await startFreeTrial(uid);
      if (trialResult.success) {
        console.log(`✅ [Check Access] Free trial started for user ${uid}`);
      } else {
        console.warn(`⚠️ [Check Access] Failed to start trial for user ${uid}:`, trialResult.error);
      }
    }

    // Now check access status (after sync and trial start)
    const accessStatus = await checkHistoricalAccess(uid);

    // Get subscription details for response
    let subscriptionDetails: any = null;
    const updatedUserDoc = await adminDb.doc(`user_profiles/${uid}`).get();
    const updatedUserData = updatedUserDoc.data();
    const finalSubscriptionId = updatedUserData?.stripeSubscriptionId;

    // Only fetch subscription details if we have a valid ID and it wasn't deleted
    if (finalSubscriptionId && !subscriptionDeleted && stripe) {
      try {
        const subscription = await stripe.subscriptions.retrieve(finalSubscriptionId) as any;
        const priceId = subscription.items.data[0]?.price?.id;
        const price = priceId ? await stripe.prices.retrieve(priceId) : null;

        const detailFirstItem = subscription.items?.data?.[0];
        subscriptionDetails = {
          id: subscription.id,
          status: subscription.status,
          currentPeriodStart: detailFirstItem?.current_period_start ? new Date(detailFirstItem.current_period_start * 1000) : null,
          currentPeriodEnd: detailFirstItem?.current_period_end ? new Date(detailFirstItem.current_period_end * 1000) : null,
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

