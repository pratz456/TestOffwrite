import { NextRequest, NextResponse } from 'next/server';
import { Configuration, PlaidApi, PlaidEnvironments, LinkTokenCreateRequest, Products, CountryCode } from 'plaid';
import { startFreeTrial } from '@/lib/subscriptions/trial-manager';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';

// Helper function to get Plaid config from both environment variables and functions.config()
function getPlaidConfig() {
  // First try process.env (for Next.js/Cloud Run - this is the primary method)
  let plaidClientId: string | undefined = process.env.PLAID_CLIENT_ID;
  let plaidSecret: string | undefined = process.env.PLAID_SECRET;
  let plaidEnv: string | undefined = process.env.PLAID_ENV;

  // If not found in process.env, try functions.config() (for legacy Firebase Functions)
  if (!plaidClientId || !plaidSecret) {
    try {
       
      const functions = require('firebase-functions');
      const config = functions.config();
      if (config.plaid) {
        plaidClientId = plaidClientId || config.plaid.client_id || config.plaid.clientId;
        plaidSecret = plaidSecret || config.plaid.secret;
        plaidEnv = plaidEnv || config.plaid.env;
      }
    } catch (e) {
      // functions.config() not available, that's okay - we'll use process.env
      console.log('⚠️ [Plaid Config] functions.config() not available, using process.env only');
    }
  }

  // Default to sandbox if env not set
  plaidEnv = plaidEnv || 'sandbox';

  // Log what we found (without exposing secrets)
  console.log('🔍 [Plaid Config] Configuration check:', {
    hasClientId: !!plaidClientId,
    hasSecret: !!plaidSecret,
    env: plaidEnv,
    clientIdLength: plaidClientId?.length || 0,
    secretLength: plaidSecret?.length || 0
  });

  return { plaidClientId, plaidSecret, plaidEnv };
}

const { plaidClientId, plaidSecret, plaidEnv } = getPlaidConfig();

if (!plaidClientId || !plaidSecret) {
  console.error('❌ Plaid credentials not configured:', {
    hasClientId: !!plaidClientId,
    hasSecret: !!plaidSecret,
    env: plaidEnv
  });
  throw new Error('Plaid credentials not configured. Please add PLAID_CLIENT_ID and PLAID_SECRET to your environment variables.');
}

const configuration = new Configuration({
  basePath: PlaidEnvironments[plaidEnv as keyof typeof PlaidEnvironments] || PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': plaidClientId,
      'PLAID-SECRET': plaidSecret,
    },
  },
});

const client = new PlaidApi(configuration);

export async function POST(request: NextRequest) {
  try {
    if (process.env.NODE_ENV !== 'production') {
      console.log('🔄 [Plaid Link Token] Creating link token...');
    }

    // Get authenticated user
    const { uid } = await getUserFromReqOrThrow(request);

    // Start free trial if user doesn't have one yet (when they first access Plaid)
    try {
      const trialResult = await startFreeTrial(uid);
      if (trialResult.success) {
        if (process.env.NODE_ENV !== 'production') {
          console.log(`✅ [Plaid Link Token] Free trial started/verified for user ${uid}`);
        }
      }
    } catch (trialError) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('⚠️ [Plaid Link Token] Error starting trial (non-fatal):', trialError);
      }
      // Continue even if trial start fails - don't block Plaid token creation
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('✅ [Plaid Link Token] User ID received:', uid);
    }

    const configs: LinkTokenCreateRequest = {
      user: {
        client_user_id: uid,
      },
      client_name: 'WriteOff',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
      transactions: {
        days_requested: 730, // Request 730 days (2 years) of transaction history - Plaid maximum
      },
      webhook: `${process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || 'http://localhost:3000'}/api/plaid/webhook`,
    };

    console.log('🔄 [Plaid Link Token] Calling Plaid API...');
    const createTokenResponse = await client.linkTokenCreate(configs);

    console.log('[Plaid Link Token] Plaid ingestion: linkTokenDaysRequested=730');
    console.log('✅ [Plaid Link Token] Link token created successfully');

    return NextResponse.json({
      link_token: createTokenResponse.data.link_token,
    });
  } catch (error) {
    console.error('❌ [Plaid Link Token] Error creating link token:', error);

    // More detailed error logging
    if (error instanceof Error) {
      console.error('❌ [Plaid Link Token] Error details:', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });

      // Handle specific error types
      if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
        return NextResponse.json(
          { error: 'Network connectivity issue. Please check your internet connection and try again.' },
          { status: 503 }
        );
      }

      if (error.message.includes('credentials not configured')) {
        return NextResponse.json(
          { error: 'Plaid credentials not configured. Please contact support.' },
          { status: 500 }
        );
      }

      if (error.message.includes('Request failed with status code 400')) {
        return NextResponse.json(
          { error: 'Invalid Plaid configuration. Please check your Plaid credentials and environment settings.' },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Failed to create link token. Please check your Plaid configuration.' },
      { status: 500 }
    );
  }
}
