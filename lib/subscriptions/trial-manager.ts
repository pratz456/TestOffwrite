import { adminDb } from '../firebase/admin';
import { canStartFreeTrial, evaluateEntitlements, type SubscriptionStatus } from './entitlements';
export type { SubscriptionStatus } from './entitlements';

export async function userHasHistoricalAccess(userId: string): Promise<boolean> {
  return (await getUserSubscriptionStatus(userId)).hasAccess;
}

export async function userTrialExpired(userId: string): Promise<boolean> {
  const status = await getUserSubscriptionStatus(userId);
  return Boolean(status.trialEnd && status.trialEnd <= new Date() && !status.hasAccess);
}

/** Claim the existing 30-day app trial once, atomically across concurrent requests. */
export async function startFreeTrial(userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const ref = adminDb.doc(`user_profiles/${userId}`);
    return await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return { success: false, error: 'User profile not found' };
      const profile = snapshot.data() ?? {};
      if (!canStartFreeTrial(profile)) return { success: true };
      const now = new Date();
      transaction.update(ref, { subscriptionStatus: 'trial', trialStart: now,
        trialEnd: new Date(now.getTime() + 30 * 86400000), hasHistoricalAccess: true });
      return { success: true };
    });
  } catch {
    return { success: false, error: 'Unable to start trial' };
  }
}

export async function getUserSubscriptionStatus(userId: string): Promise<{
  status: SubscriptionStatus; trialStart?: Date; trialEnd?: Date; subscriptionEnd?: Date;
  isTrialActive: boolean; isPaidActive: boolean; hasAccess: boolean;
}> {
  try {
    const snapshot = await adminDb.doc(`user_profiles/${userId}`).get();
    const access = evaluateEntitlements(snapshot.exists ? snapshot.data() : null);
    return { status: access.status, trialStart: access.trialStart, trialEnd: access.trialEnd,
      subscriptionEnd: access.subscriptionEnd, isTrialActive: access.isTrial, isPaidActive: access.isPaid, hasAccess: access.hasAccess };
  } catch {
    return { status: 'none', isTrialActive: false, isPaidActive: false, hasAccess: false };
  }
}
