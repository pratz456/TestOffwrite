import { NextRequest, NextResponse } from 'next/server';
import { Configuration, PlaidApi, PlaidEnvironments, LinkTokenCreateRequest, Products, CountryCode } from 'plaid';

// Helper function to get Plaid config from both environment variables and functions.config()
function getPlaidConfig() {
  // First try process.env (for Next.js/Cloud Run - this is the primary method)
  let plaidClientId: string | undefined = process.env.PLAID_CLIENT_ID;
  let plaidSecret: string | undefined = process.env.PLAID_SECRET;
  let plaidEnv: string | undefined = process.env.PLAID_ENV;
  
  // If not found in process.env, try functions.config() (for legacy Firebase Functions)
  if (!plaidClientId || !plaidSecret) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
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
    console.log('🔄 [Plaid Link Token] Creating link token...');
    
    const { userId } = await request.json();

    if (!userId) {
      console.error('❌ [Plaid Link Token] No user ID provided');
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    console.log('✅ [Plaid Link Token] User ID received:', userId);

    const configs: LinkTokenCreateRequest = {
      user: {
        client_user_id: userId,
      },
      client_name: 'WriteOff',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
      webhook: `${process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || 'http://localhost:3000'}/api/plaid/webhook`,
    };

    console.log('🔄 [Plaid Link Token] Calling Plaid API...');
    const createTokenResponse = await client.linkTokenCreate(configs);
    
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
