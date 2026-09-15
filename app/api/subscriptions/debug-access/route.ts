import { transactionHistoryWindow } from '@/lib/subscriptions/history-window';
import { subscriptionDate } from '@/lib/subscriptions/entitlements';
import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { adminDb } from '@/lib/firebase/admin';
import { checkHistoricalAccess } from '@/lib/subscriptions/historical-access';

export async function GET(req: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  try {

    // Get user profile
    const userDoc = await adminDb.doc(`user_profiles/${uid}`).get();
    const userData = userDoc.data();

    // Check access status (for subscription/paywall; transaction fetch is always 730 days)
    const accessStatus = await checkHistoricalAccess(uid);

    return NextResponse.json({
      success: true,
      data: {
        userProfile: {
          hasHistoricalAccess: userData?.hasHistoricalAccess,
          stripeSubscriptionStatus: userData?.stripeSubscriptionStatus,
          stripeSubscriptionId: userData?.stripeSubscriptionId,
          stripeCustomerId: userData?.stripeCustomerId,
          trialStart: userData?.trialStart,
          trialEnd: userData?.trialEnd,
          subscriptionEnd: userData?.subscriptionEnd,
        },
        accessStatus,
        transactionDaysAvailable: transactionHistoryWindow(userData ?? {}).days,
        debug: {
          now: new Date().toISOString(),
          trialStartDate: subscriptionDate(userData?.trialStart)?.toISOString() ?? null,
          trialEndDate: subscriptionDate(userData?.trialEnd)?.toISOString() ?? null,
          subscriptionEndDate: subscriptionDate(userData?.subscriptionEnd)?.toISOString() ?? null,
        },
      },
    });
  } catch (error) {
    console.error('Error debugging access:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to debug access status' },
      { status: 500 }
    );
  }
}

