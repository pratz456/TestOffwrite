import { getUserSubscriptionStatus } from './trial-manager';

export interface HistoricalAccessStatus {
  hasAccess: boolean; isTrial: boolean; isPaid: boolean;
  trialStart?: Date; trialEnd?: Date; subscriptionEnd?: Date; daysRemaining?: number;
  subscriptionStatus?: 'trial' | 'active' | 'expired' | 'none';
}

export async function checkHistoricalAccess(userId: string): Promise<HistoricalAccessStatus> {
  const status = await getUserSubscriptionStatus(userId);
  const end = status.isTrialActive ? status.trialEnd : status.isPaidActive ? status.subscriptionEnd : undefined;
  return { hasAccess: status.hasAccess, isTrial: status.isTrialActive, isPaid: status.isPaidActive,
    trialStart: status.trialStart, trialEnd: status.trialEnd, subscriptionEnd: status.subscriptionEnd,
    daysRemaining: end ? Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000)) : undefined,
    subscriptionStatus: status.status };
}
