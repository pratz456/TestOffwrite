import { NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import Stripe from 'stripe';
import { adminDb } from '@/lib/firebase/admin';
import { checkHistoricalAccess } from '@/lib/subscriptions/historical-access';

function getStripeOrNull() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2025-10-29.clover' });
}

export async function POST(req: Request) {
  try {
    const { uid } = await getUserFromReqOrThrow(req);
    const stripe = getStripeOrNull();
    if (!stripe) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
    }
    const { interval = 'monthly' } = await req.json(); // 'monthly' or 'yearly'

    // Check if user already has an active paid subscription
    const accessStatus = await checkHistoricalAccess(uid);
    if (accessStatus.hasAccess && accessStatus.isPaid) {
      return NextResponse.json(
        { error: 'You already have an active subscription' },
        { status: 400 }
      );
    }
    // Allow checkout even if user is in trial - they can subscribe to keep access after trial

    // Get user profile to check for existing Stripe customer
    const userDoc = await adminDb.doc(`user_profiles/${uid}`).get();
    const userData = userDoc.data();

    let customerId = userData?.stripeCustomerId;

    // Verify customer exists in Stripe if we have a customer ID
    if (customerId) {
      try {
        const customer = await stripe.customers.retrieve(customerId);
        // Check if customer was deleted
        if (customer.deleted) {
          console.log(`Customer ${customerId} was deleted in Stripe, creating new customer`);
          customerId = null; // Reset to trigger creation
        }
      } catch (error: any) {
        // If customer doesn't exist (404) or other error, create a new one
        if (error.code === 'resource_missing' || error.statusCode === 404) {
          console.log(`Customer ${customerId} not found in Stripe, creating new customer`);
          customerId = null; // Reset to trigger creation
        } else {
          // Re-throw unexpected errors
          throw error;
        }
      }
    }

    // Create Stripe customer if doesn't exist or was deleted
    if (!customerId) {
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
      console.log(`✅ Created new Stripe customer ${customerId} for user ${uid}`);
    }

    // Get price ID based on interval
    let priceId: string | undefined;
    if (interval === 'yearly') {
      priceId = process.env.STRIPE_PRICE_ID_YEARLY || process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_YEARLY;
    } else {
      priceId = process.env.STRIPE_PRICE_ID_MONTHLY || process.env.NEXT_PUBLIC_STRIPE_PRICE_ID_MONTHLY || process.env.STRIPE_PRICE_ID || process.env.NEXT_PUBLIC_STRIPE_PRICE_ID;
    }

    if (!priceId) {
      return NextResponse.json(
        { error: `Stripe ${interval} price ID not configured` },
        { status: 500 }
      );
    }

    // Create checkout session WITHOUT trial (trial is app-managed, not Stripe-managed)
    // User should only reach here AFTER their free trial expires
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      subscription_data: {
        // NO trial_period_days - trial is app-managed, not Stripe-managed
        metadata: {
          firebase_uid: uid,
          feature: 'historical_transactions',
        },
      },
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || 'http://localhost:3000'}/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || 'http://localhost:3000'}/stripe/cancel`,
      metadata: {
        firebase_uid: uid,
        feature: 'historical_transactions',
      },
    });

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error('Error creating Stripe checkout:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorDetails = error instanceof Error ? error.stack : String(error);
    console.error('Error details:', errorDetails);
    return NextResponse.json(
      {
        error: 'Failed to create checkout session',
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

