import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { adminDb } from '@/lib/firebase/admin';
import { checkHistoricalAccess, getTransactionDateRange } from '@/lib/subscriptions/historical-access';

export async function GET(req: Request) {
  try {
    const { uid } = await getUserFromReqOrThrow(req);

    // Get user profile
    const userDoc = await adminDb.doc(`user_profiles/${uid}`).get();
    const userData = userDoc.data();

    // Check access status
    const accessStatus = await checkHistoricalAccess(uid);
    const dateRange = await getTransactionDateRange(uid);

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
        dateRange,
        debug: {
          now: new Date().toISOString(),
          trialStartDate: userData?.trialStart ? (userData.trialStart.toDate?.() || new Date(userData.trialStart)).toISOString() : null,
          trialEndDate: userData?.trialEnd ? (userData.trialEnd.toDate?.() || new Date(userData.trialEnd)).toISOString() : null,
          subscriptionEndDate: userData?.subscriptionEnd ? (userData.subscriptionEnd.toDate?.() || new Date(userData.subscriptionEnd)).toISOString() : null,
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

