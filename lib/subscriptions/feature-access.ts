import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { evaluateEntitlements, type PremiumFeature } from './entitlements';

/** Call after authentication. Never accept subscription status from the request body. */
export async function requireFeatureAccess(uid: string, feature: PremiumFeature): Promise<NextResponse | null> {
  try {
    const snapshot = await adminDb.doc(`user_profiles/${uid}`).get();
    const entitlements = evaluateEntitlements(snapshot.exists ? snapshot.data() : null);
    if (entitlements.features[feature] === true) return null;
    return NextResponse.json({ error: 'This feature requires an active trial or Premium subscription.',
      code: 'SUBSCRIPTION_REQUIRED', feature, plan: entitlements.plan, reason: entitlements.reason,
      upgradeUrl: '/protected/subscriptions' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to verify your plan. Please try again.', code: 'SUBSCRIPTION_UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
