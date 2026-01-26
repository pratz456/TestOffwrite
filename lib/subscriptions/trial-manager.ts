import { adminDb } from '../firebase/admin';
import type { UserProfile } from '../firebase/profiles-server';

/**
 * Subscription status type
 */
export type SubscriptionStatus = 'trial' | 'active' | 'expired' | 'none';

/**
 * Checks if a user has historical access (1 year of transactions)
 * Returns true if:
 * - User is in active app-managed trial (subscriptionStatus === 'trial' AND now <= trialEnd)
 * - User has active paid subscription (subscriptionStatus === 'active')
 */
export async function userHasHistoricalAccess(userId: string): Promise<boolean> {
  try {
    const userDoc = await adminDb.doc(`user_profiles/${userId}`).get();
    if (!userDoc.exists) {
      return false;
    }

    const userData = userDoc.data();
    const subscriptionStatus = userData?.subscriptionStatus || 'none';
    const trialEnd = userData?.trialEnd?.toDate?.() || (userData?.trialEnd ? new Date(userData.trialEnd) : undefined);
    const stripeSubscriptionStatus = userData?.stripeSubscriptionStatus;
    const subscriptionEnd = userData?.subscriptionEnd?.toDate?.() || (userData?.subscriptionEnd ? new Date(userData.subscriptionEnd) : undefined);

    const now = new Date();

    // Check if user is in active app-managed trial
    if (subscriptionStatus === 'trial' && trialEnd) {
      if (now <= trialEnd) {
        return true; // Active trial
      } else {
        // Trial expired, but check if they have a paid subscription
        if (subscriptionStatus === 'active' || stripeSubscriptionStatus === 'active') {
          return true; // Paid subscription active
        }
        return false; // Trial expired, no paid subscription
      }
    }

    // Check if user has active paid subscription
    if (subscriptionStatus === 'active') {
      // If subscriptionEnd is set, check if it's still valid
      if (subscriptionEnd && subscriptionEnd < now) {
        return false; // Subscription expired
      }
      return true; // Active paid subscription
    }

    // Also check Stripe status as fallback (for backward compatibility)
    if (stripeSubscriptionStatus === 'active' && (!subscriptionEnd || subscriptionEnd > now)) {
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error checking historical access:', error);
    return false;
  }
}

/**
 * Checks if the user's trial has expired
 * Returns true when subscriptionStatus === 'trial' AND now > trialEnd
 */
export async function userTrialExpired(userId: string): Promise<boolean> {
  try {
    const userDoc = await adminDb.doc(`user_profiles/${userId}`).get();
    if (!userDoc.exists) {
      return false;
    }

    const userData = userDoc.data();
    const subscriptionStatus = userData?.subscriptionStatus || 'none';
    const trialEnd = userData?.trialEnd?.toDate?.() || (userData?.trialEnd ? new Date(userData.trialEnd) : undefined);

    if (subscriptionStatus !== 'trial' || !trialEnd) {
      return false; // Not in trial or no trial end date
    }

    const now = new Date();
    return now > trialEnd;
  } catch (error) {
    console.error('Error checking trial expiration:', error);
    return false;
  }
}

/**
 * Starts a 1-month free trial for a user
 * This is app-managed and does NOT require Stripe
 */
export async function startFreeTrial(userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const userDoc = await adminDb.doc(`user_profiles/${userId}`).get();
    if (!userDoc.exists) {
      return { success: false, error: 'User profile not found' };
    }

    const userData = userDoc.data();

    // Check if user already has a trial or subscription
    const subscriptionStatus = userData?.subscriptionStatus || 'none';
    if (subscriptionStatus === 'trial' || subscriptionStatus === 'active') {
      // User already has trial or subscription, don't start a new one
      return { success: true }; // Already has access
    }

    // Start new trial
    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setDate(trialEnd.getDate() + 30); // 30 days from now

    await adminDb.doc(`user_profiles/${userId}`).update({
      subscriptionStatus: 'trial',
      trialStart: now,
      trialEnd: trialEnd,
      hasHistoricalAccess: true, // Trial users get 1-year access
    });

    console.log(`✅ Started free trial for user ${userId}, expires ${trialEnd.toISOString()}`);
    return { success: true };
  } catch (error: any) {
    console.error('Error starting free trial:', error);
    return { success: false, error: error.message || 'Failed to start trial' };
  }
}

/**
 * Gets the user's subscription status
 */
export async function getUserSubscriptionStatus(userId: string): Promise<{
  status: SubscriptionStatus;
  trialStart?: Date;
  trialEnd?: Date;
  subscriptionEnd?: Date;
  isTrialActive: boolean;
  isPaidActive: boolean;
  hasAccess: boolean;
}> {
  try {
    const userDoc = await adminDb.doc(`user_profiles/${userId}`).get();
    if (!userDoc.exists) {
      return {
        status: 'none',
        isTrialActive: false,
        isPaidActive: false,
        hasAccess: false,
      };
    }

    const userData = userDoc.data();
    const subscriptionStatus = (userData?.subscriptionStatus || 'none') as SubscriptionStatus;
    const trialStart = userData?.trialStart?.toDate?.() || (userData?.trialStart ? new Date(userData.trialStart) : undefined);
    const trialEnd = userData?.trialEnd?.toDate?.() || (userData?.trialEnd ? new Date(userData.trialEnd) : undefined);
    const subscriptionEnd = userData?.subscriptionEnd?.toDate?.() || (userData?.subscriptionEnd ? new Date(userData.subscriptionEnd) : undefined);

    const now = new Date();
    const isTrialActive = subscriptionStatus === 'trial' && trialEnd && now <= trialEnd;
    const isPaidActive = subscriptionStatus === 'active' && (!subscriptionEnd || subscriptionEnd > now);
    const hasAccess = await userHasHistoricalAccess(userId);

    return {
      status: subscriptionStatus,
      trialStart,
      trialEnd,
      subscriptionEnd,
      isTrialActive,
      isPaidActive,
      hasAccess,
    };
  } catch (error) {
    console.error('Error getting subscription status:', error);
    return {
      status: 'none',
      isTrialActive: false,
      isPaidActive: false,
      hasAccess: false,
    };
  }
}

