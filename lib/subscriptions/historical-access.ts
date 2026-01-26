import { adminDb } from '../firebase/admin';
import { userHasHistoricalAccess, getUserSubscriptionStatus } from './trial-manager';

export interface HistoricalAccessStatus {
  hasAccess: boolean;
  isTrial: boolean;
  isPaid: boolean;
  trialStart?: Date;
  trialEnd?: Date;
  subscriptionEnd?: Date;
  daysRemaining?: number;
  subscriptionStatus?: 'trial' | 'active' | 'expired' | 'none';
}

/**
 * Checks if a user has access to historical transactions (3-12 months)
 * Uses the new app-managed trial system
 */
export async function checkHistoricalAccess(userId: string): Promise<HistoricalAccessStatus> {
  try {
    const status = await getUserSubscriptionStatus(userId);
    const hasAccess = await userHasHistoricalAccess(userId);

    const now = new Date();
    let daysRemaining: number | undefined;

    if (status.isTrialActive && status.trialEnd) {
      daysRemaining = Math.ceil((status.trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    } else if (status.isPaidActive && status.subscriptionEnd) {
      daysRemaining = Math.ceil((status.subscriptionEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }

    return {
      hasAccess,
      isTrial: status.isTrialActive,
      isPaid: status.isPaidActive,
      trialStart: status.trialStart,
      trialEnd: status.trialEnd,
      subscriptionEnd: status.subscriptionEnd,
      daysRemaining: daysRemaining && daysRemaining > 0 ? daysRemaining : undefined,
      subscriptionStatus: status.status,
    };
  } catch (error) {
    console.error('Error checking historical access:', error);
    return {
      hasAccess: false,
      isTrial: false,
      isPaid: false,
      subscriptionStatus: 'none',
    };
  }
}

/**
 * Gets the appropriate transaction date range based on user's access level
 * Returns days to fetch: 90 for standard users, 365 for historical access users
 * Uses the new app-managed trial system
 */
export async function getTransactionDateRange(userId: string): Promise<number> {
  const hasAccess = await userHasHistoricalAccess(userId);

  if (hasAccess) {
    // Users with historical access (trial or paid) get up to 1 year (365 days)
    return 365;
  }

  // Standard users (no trial or expired trial without payment) get 3 months (90 days)
  return 90;
}

