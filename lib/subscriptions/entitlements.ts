/** Shared policy. Only pass a profile read by the server to make access decisions. */
export const PREMIUM_FEATURES = ['reports', 'exports', 'extended_history'] as const;
export type PremiumFeature = typeof PREMIUM_FEATURES[number];
export type SubscriptionStatus = 'trial' | 'active' | 'expired' | 'none';
export interface Entitlements {
  plan: 'free' | 'trial' | 'premium';
  status: SubscriptionStatus;
  reason: 'free' | 'trial_active' | 'paid_active' | 'trial_expired' | 'subscription_expired' | 'payment_required' | 'invalid_subscription';
  hasAccess: boolean;
  isTrial: boolean;
  isPaid: boolean;
  features: Record<PremiumFeature, boolean>;
  trialStart?: Date;
  trialEnd?: Date;
  subscriptionEnd?: Date;
}

export function subscriptionDate(value: unknown): Date | undefined {
  try {
    const normalized = value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function'
      ? value.toDate() : value;
    if (!(normalized instanceof Date) && typeof normalized !== 'string' && typeof normalized !== 'number') return undefined;
    const date = new Date(normalized);
    return Number.isFinite(date.getTime()) ? date : undefined;
  } catch { return undefined; }
}

export function evaluateEntitlements(profile: Record<string, unknown> | null | undefined, now = new Date()): Entitlements {
  const data = profile ?? {};
  const trialStart = subscriptionDate(data.trialStart);
  const trialEnd = subscriptionDate(data.trialEnd);
  const subscriptionEnd = subscriptionDate(data.subscriptionEnd);
  const stripeStatus = typeof data.stripeSubscriptionStatus === 'string' && data.stripeSubscriptionStatus ? data.stripeSubscriptionStatus : undefined;
  const hasStripeSubscription = typeof data.stripeSubscriptionId === 'string' && data.stripeSubscriptionId.length > 0;
  let reason: Entitlements['reason'] = 'free';
  let plan: Entitlements['plan'] = 'free';
  let status: SubscriptionStatus = data.subscriptionStatus === 'expired' ? 'expired' : 'none';
  // Stripe's terminal/payment states override stale app-managed status and dates.
  if (stripeStatus && !['active', 'trialing'].includes(stripeStatus)) {
    status = 'expired';
    reason = ['past_due', 'unpaid', 'incomplete', 'paused'].includes(stripeStatus) ? 'payment_required' : 'subscription_expired';
  } else if (stripeStatus === 'active' || data.subscriptionStatus === 'active') {
    status = 'expired';
    reason = 'invalid_subscription';
    if (hasStripeSubscription && stripeStatus === 'active' && subscriptionEnd) {
      reason = subscriptionEnd > now ? 'paid_active' : 'subscription_expired';
      if (subscriptionEnd > now) { plan = 'premium'; status = 'active'; }
    }
  } else if (stripeStatus === 'trialing' || data.subscriptionStatus === 'trial') {
    status = 'expired';
    reason = 'invalid_subscription';
    if (trialStart && trialEnd && trialStart <= now && trialEnd > trialStart && (!stripeStatus || hasStripeSubscription)) {
      reason = trialEnd > now ? 'trial_active' : 'trial_expired';
      if (trialEnd > now) { plan = 'trial'; status = 'trial'; }
    }
  } else if (data.subscriptionStatus && !['none', 'expired'].includes(String(data.subscriptionStatus))) {
    reason = 'invalid_subscription';
  }
  const hasAccess = plan !== 'free';
  return { plan, status, reason, hasAccess, isTrial: plan === 'trial', isPaid: plan === 'premium',
    features: { reports: hasAccess, exports: hasAccess, extended_history: hasAccess }, trialStart, trialEnd, subscriptionEnd };
}

/** A trial can be claimed once, even after cancellation or a failed payment. */
export function canStartFreeTrial(profile: Record<string, unknown>): boolean {
  return (!profile.subscriptionStatus || profile.subscriptionStatus === 'none') &&
    !profile.trialStart && !profile.trialEnd && !profile.subscriptionEnd &&
    !profile.stripeSubscriptionId && !profile.stripeSubscriptionStatus;
}
