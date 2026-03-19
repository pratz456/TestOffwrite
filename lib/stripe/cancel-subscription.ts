import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase/admin';

function getStripeOrNull() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2025-10-29.clover' });
}

/**
 * Cancel all Stripe subscriptions for a user and clean up Stripe customer
 * This is called when a user account is deleted
 * @param userId - The user's Firebase UID
 * @returns Promise<{ success: boolean; error?: any; canceledSubscriptions?: number }>
 */
export async function cancelUserStripeSubscriptions(
  userId: string
): Promise<{
  success: boolean;
  error?: any;
  canceledSubscriptions?: number;
}> {
  try {
    const stripe = getStripeOrNull();
    if (!stripe) {
      return { success: true, canceledSubscriptions: 0 };
    }
    console.log(`🔄 [Cancel Stripe Subscriptions] Starting for user ${userId}`);

    // Get user profile to find Stripe customer ID
    const userDoc = await adminDb.doc(`user_profiles/${userId}`).get();
    const userData = userDoc.data();

    if (!userData) {
      console.log(`ℹ️ [Cancel Stripe Subscriptions] User profile not found, skipping`);
      return { success: true, canceledSubscriptions: 0 };
    }

    const customerId = userData.stripeCustomerId;
    const subscriptionId = userData.stripeSubscriptionId;

    if (!customerId && !subscriptionId) {
      console.log(`ℹ️ [Cancel Stripe Subscriptions] No Stripe customer or subscription found, skipping`);
      return { success: true, canceledSubscriptions: 0 };
    }

    let canceledCount = 0;

    // Step 1: Cancel active subscriptions
    if (subscriptionId) {
      try {
        // Retrieve the subscription to check its status
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        // Only cancel if subscription is active or trialing
        if (subscription.status === 'active' || subscription.status === 'trialing' || subscription.status === 'past_due') {
          await stripe.subscriptions.cancel(subscriptionId);
          canceledCount++;
          console.log(`✅ [Cancel Stripe Subscriptions] Canceled subscription ${subscriptionId}`);
        } else {
          console.log(`ℹ️ [Cancel Stripe Subscriptions] Subscription ${subscriptionId} is already ${subscription.status}`);
        }
      } catch (error: any) {
        // Subscription might not exist or already canceled
        if (error.code === 'resource_missing') {
          console.log(`ℹ️ [Cancel Stripe Subscriptions] Subscription ${subscriptionId} not found in Stripe`);
        } else {
          console.error(`⚠️ [Cancel Stripe Subscriptions] Error canceling subscription ${subscriptionId}:`, error);
        }
      }
    }

    // Step 2: Cancel all subscriptions for the customer (in case there are multiple)
    if (customerId) {
      try {
        const subscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: 'all', // Get all subscriptions (active, canceled, etc.)
          limit: 100,
        });

        for (const subscription of subscriptions.data) {
          // Skip if already canceled or if we already canceled it above
          if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
            continue;
          }

          // Cancel active, trialing, or past_due subscriptions
          if (subscription.status === 'active' || subscription.status === 'trialing' || subscription.status === 'past_due') {
            try {
              await stripe.subscriptions.cancel(subscription.id);
              if (subscription.id !== subscriptionId) {
                // Only count if it's a different subscription
                canceledCount++;
              }
              console.log(`✅ [Cancel Stripe Subscriptions] Canceled subscription ${subscription.id}`);
            } catch (error: any) {
              console.error(`⚠️ [Cancel Stripe Subscriptions] Error canceling subscription ${subscription.id}:`, error);
            }
          }
        }
      } catch (error: any) {
        console.error(`⚠️ [Cancel Stripe Subscriptions] Error listing subscriptions for customer ${customerId}:`, error);
      }
    }

    // Step 3: Delete the Stripe customer (this will also cancel any remaining subscriptions)
    // Note: Deleting a customer will automatically cancel all their subscriptions
    if (customerId) {
      try {
        await stripe.customers.del(customerId);
        console.log(`✅ [Cancel Stripe Subscriptions] Deleted Stripe customer ${customerId}`);
      } catch (error: any) {
        // Customer might already be deleted or not exist
        if (error.code === 'resource_missing') {
          console.log(`ℹ️ [Cancel Stripe Subscriptions] Customer ${customerId} not found in Stripe`);
        } else {
          console.error(`⚠️ [Cancel Stripe Subscriptions] Error deleting customer ${customerId}:`, error);
          // Don't fail the entire deletion if customer deletion fails
        }
      }
    }

    console.log(`✅ [Cancel Stripe Subscriptions] Successfully canceled ${canceledCount} subscription(s) for user ${userId}`);
    return {
      success: true,
      canceledSubscriptions: canceledCount,
    };
  } catch (error) {
    console.error(`❌ [Cancel Stripe Subscriptions] Error canceling subscriptions for user ${userId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

