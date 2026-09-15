import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { startFreeTrial } from '@/lib/subscriptions/trial-manager';
import { evaluateEntitlements } from '@/lib/subscriptions/entitlements';
import { adminDb } from '@/lib/firebase/admin';
import { getStripeClient, reconcileUserSubscription, subscriptionDetails } from '@/lib/stripe/subscription-sync';

export async function GET(req: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  try {
    const ref = adminDb.doc(`user_profiles/${uid}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    const profile = snapshot.data() ?? {};
    const stripe = getStripeClient();
    const subscription = stripe ? await reconcileUserSubscription(uid, stripe) : null;
    if (!stripe && (profile.stripeSubscriptionId || profile.stripeCustomerId)) {
      return NextResponse.json({ error: 'Billing status is temporarily unavailable', code: 'SUBSCRIPTION_UNAVAILABLE' }, { status: 503 });
    }
    const trial = await startFreeTrial(uid);
    if (!trial.success) throw new Error('Trial initialization unavailable');
    const entitlements = evaluateEntitlements((await ref.get()).data());
    const end = entitlements.isTrial ? entitlements.trialEnd : entitlements.isPaid ? entitlements.subscriptionEnd : undefined;
    return NextResponse.json({ success: true, data: {
      hasAccess: entitlements.hasAccess, isTrial: entitlements.isTrial, isPaid: entitlements.isPaid,
      trialStart: entitlements.trialStart, trialEnd: entitlements.trialEnd, subscriptionEnd: entitlements.subscriptionEnd,
      subscriptionStatus: entitlements.status, daysRemaining: end ? Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000)) : undefined,
      entitlements, subscription: subscriptionDetails(subscription),
    } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ success: false, error: 'Unable to verify your plan. Please try again.', code: 'SUBSCRIPTION_UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
