import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { getStripeClient } from '@/lib/stripe/subscription-sync';
import { adminDb } from '@/lib/firebase/admin';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';

export async function POST(req: Request) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(req)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      return NextResponse.json({ error: 'Billing is temporarily unavailable' }, { status: 503 });
    }
    // Bound provider portal-session creation per owner.
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
          customerId = null;
        }
      } catch (error: any) {
        // New billing identities are created only in the locked checkout flow.
        if (error.code === 'resource_missing' || error.statusCode === 404) {
          customerId = null;
        } else {
          // Re-throw unexpected errors
          throw error;
        }
      }
    }

    // A portal must never race checkout/deletion to create or replace a customer.
    if (!customerId) {
      return NextResponse.json({ error: 'No billing account is linked. Choose a plan to start a subscription.',
        code: 'BILLING_ACCOUNT_REQUIRED' }, { status: 409 });
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
  } catch {
    console.error('Billing portal could not be opened');
    return NextResponse.json(
      { error: 'Billing is temporarily unavailable. Please try again.' },
      { status: 503 }
    );
  }
}
