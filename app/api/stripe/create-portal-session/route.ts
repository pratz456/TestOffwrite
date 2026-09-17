import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase/admin';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';

function getStripeOrNull() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2025-10-29.clover' });
}

export async function POST(req: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  try {
    const stripe = getStripeOrNull();
    if (!stripe) {
      return NextResponse.json({ error: 'Billing is temporarily unavailable' }, { status: 503 });
    }
    // Portal sessions can also create a provider customer; bound attempts per owner.
    const limit = await enforceRateLimit({ ...RATE_LIMITS.stripePortal, key: uid });
    if (!limit.allowed) return rateLimitResponse(limit, { error: 'Too many billing portal requests. Please wait a few minutes and try again.' });

    // Get user profile to find Stripe customer ID
    const userDoc = await adminDb.doc(`user_profiles/${uid}`).get();
    const userData = userDoc.data();

    let customerId = userData?.stripeCustomerId;

    // Verify customer exists in Stripe if we have a customer ID
    if (customerId) {
      try {
        const customer = await stripe.customers.retrieve(customerId);
        if (!customer.deleted && customer.metadata.firebase_uid && customer.metadata.firebase_uid !== uid) {
          return NextResponse.json({ error: 'Billing account mismatch' }, { status: 403 });
        }
        // Check if customer was deleted
        if (customer.deleted) {
          console.log(`[Portal Session] Customer ${customerId} was deleted in Stripe, creating new customer`);
          customerId = null; // Reset to trigger creation
        }
      } catch (error: any) {
        // If customer doesn't exist (404) or other error, create a new one
        if (error.code === 'resource_missing' || error.statusCode === 404) {
          console.log(`[Portal Session] Customer ${customerId} not found in Stripe, creating new customer`);
          customerId = null; // Reset to trigger creation
        } else {
          // Re-throw unexpected errors
          throw error;
        }
      }
    }

    // If no customer ID exists or was deleted, create one (similar to checkout flow)
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
      return_url: `${process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : (process.env.NODE_ENV === 'production' ? 'https://writeoffapp.com' : 'http://localhost:3000'))}/protected?screen=settings&tab=payment`,
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

