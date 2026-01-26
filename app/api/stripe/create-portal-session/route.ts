import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase/admin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-12-18.acacia',
});

export async function POST(req: Request) {
  try {
    const { uid } = await getUserFromReqOrThrow(req);

    // Get user profile to find Stripe customer ID
    const userDoc = await adminDb.doc(`user_profiles/${uid}`).get();
    const userData = userDoc.data();

    let customerId = userData?.stripeCustomerId;

    // If no customer ID exists, create one (similar to checkout flow)
    // This allows users in trial to access the portal to subscribe
    if (!customerId) {
      try {
        const customer = await stripe.customers.create({
          email: userData?.email,
          metadata: {
            firebase_uid: uid,
          },
        });
        customerId = customer.id;

        // Save customer ID to user profile
        await adminDb.doc(`user_profiles/${uid}`).update({
          stripeCustomerId: customerId,
        });

        console.log(`✅ [Portal Session] Created Stripe customer ${customerId} for user ${uid}`);
      } catch (createError) {
        console.error('Error creating Stripe customer:', createError);
        return NextResponse.json(
          { error: 'Failed to create Stripe customer. Please try again.' },
          { status: 500 }
        );
      }
    }

    // Create billing portal session
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || 'http://localhost:3000'}/protected?screen=settings&tab=payment`,
    });

    return NextResponse.json({
      success: true,
      url: portalSession.url,
    });
  } catch (error) {
    console.error('Error creating billing portal session:', error);
    return NextResponse.json(
      { error: 'Failed to create billing portal session' },
      { status: 500 }
    );
  }
}

