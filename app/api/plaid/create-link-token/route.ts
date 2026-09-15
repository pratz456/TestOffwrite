export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Configuration, PlaidApi, PlaidEnvironments, LinkTokenCreateRequest, Products, CountryCode } from 'plaid';
import { getTransactionHistoryWindow } from '@/lib/subscriptions/history-window';
import { startFreeTrial } from '@/lib/subscriptions/trial-manager';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';

import { getPlaidConfig } from '@/lib/plaid/config';

function pickPlaidErrorDetails(error: any): Record<string, any> | undefined {
  const data = error?.response?.data;
  if (!data || typeof data !== 'object') return undefined;

  const details: Record<string, any> = {};
  const allow = [
    'error_type',
    'error_code',
    'error_message',
    'display_message',
    'request_id',
    'documentation_url',
    'suggested_action',
    'causes',
    'status',
  ] as const;

  for (const k of allow) {
    if (data[k] !== undefined) details[k] = data[k];
  }
  return Object.keys(details).length ? details : undefined;
}

export async function POST(request: NextRequest) {
  try {
    if (process.env.NODE_ENV !== 'production') {
      console.log('🔄 [Plaid Link Token] Creating link token...');
    }

    // Get authenticated user
    let uid: string;
    try { ({ uid } = await getUserFromReqOrThrow(request)); }
    catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

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

    const { plaidClientId, plaidSecret, plaidEnv } = getPlaidConfig(process.env, undefined, true);
    if (!plaidClientId || !plaidSecret) {
      console.error('❌ Plaid credentials not configured:', {
        hasClientId: !!plaidClientId,
        hasSecret: !!plaidSecret,
        env: plaidEnv,
      });
      return NextResponse.json(
        {
          error: 'Plaid credentials not configured. Please add PLAID_CLIENT_ID and PLAID_SECRET.',
          debug: { hasClientId: !!plaidClientId, hasSecret: !!plaidSecret, env: plaidEnv },
        },
        { status: 500 }
      );
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

    const configs: LinkTokenCreateRequest = {
      user: {
        client_user_id: uid,
      },
      client_name: 'WriteOff',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
      transactions: {
        days_requested: (await getTransactionHistoryWindow(uid)).days,
      },
      webhook: `${process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || 'http://localhost:3000'}/api/plaid/webhook`,
    };

    console.log('🔄 [Plaid Link Token] Calling Plaid API...');
    const createTokenResponse = await client.linkTokenCreate(configs);

    console.log('[Plaid Link Token] Requested history days:', configs.transactions?.days_requested);
    console.log('✅ [Plaid Link Token] Link token created successfully');

    return NextResponse.json({
      link_token: createTokenResponse.data.link_token,
    });
  } catch (error) {
    console.error('❌ [Plaid Link Token] Error creating link token:', error);

    const { plaidClientId, plaidSecret, plaidEnv } = getPlaidConfig(process.env, undefined, true);
    const plaid = pickPlaidErrorDetails(error);

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
          {
            error: 'Network connectivity issue. Please check your internet connection and try again.',
            plaid,
            debug: { hasClientId: !!plaidClientId, hasSecret: !!plaidSecret, env: plaidEnv },
          },
          { status: 503 }
        );
      }

      if (error.message.includes('credentials not configured')) {
        return NextResponse.json(
          {
            error: 'Plaid credentials not configured. Please contact support.',
            plaid,
            debug: { hasClientId: !!plaidClientId, hasSecret: !!plaidSecret, env: plaidEnv },
          },
          { status: 500 }
        );
      }

      if (error.message.includes('Request failed with status code 400')) {
        return NextResponse.json(
          {
            error: 'Invalid Plaid configuration. Please check your Plaid credentials and environment settings.',
            plaid,
            debug: { hasClientId: !!plaidClientId, hasSecret: !!plaidSecret, env: plaidEnv },
          },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      {
        error: 'Failed to create link token. Please check your Plaid configuration.',
        plaid,
        debug: { hasClientId: !!plaidClientId, hasSecret: !!plaidSecret, env: plaidEnv },
      },
      { status: 500 }
    );
  }
}
