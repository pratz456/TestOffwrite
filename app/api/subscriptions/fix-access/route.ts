import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { adminDb } from '@/lib/firebase/admin';
import { getStripeClient, reconcileUserSubscription } from '@/lib/stripe/subscription-sync';
import { evaluateEntitlements } from '@/lib/subscriptions/entitlements';

export async function POST(req: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  const stripe = getStripeClient();
  if (!stripe) return NextResponse.json({ error: 'Billing is temporarily unavailable' }, { status: 503 });
  try {
    const ref = adminDb.doc(`user_profiles/${uid}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    const subscription = await reconcileUserSubscription(uid, stripe);
    if (!subscription) return NextResponse.json({ error: 'No linked subscription found. Contact support if a payment is missing.' }, { status: 404 });
    const entitlement = evaluateEntitlements((await ref.get()).data());
    return NextResponse.json({ success: true, data: { subscriptionId: subscription.id, status: subscription.status, hasHistoricalAccess: entitlement.hasAccess } },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to verify your subscription. Please try again.' }, { status: 503 });
  }
}
