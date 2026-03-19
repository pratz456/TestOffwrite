import { NextResponse } from 'next/server';
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { adminDb } from '@/lib/firebase/admin';

function getPlaidConfig() {
  let plaidClientId: string | undefined;
  let plaidSecret: string | undefined;
  let plaidEnv: string | undefined;
  try {
    const functions = require('firebase-functions');
    const config = functions.config();
    if (config.plaid) {
      plaidClientId = config.plaid.client_id || config.plaid.clientId;
      plaidSecret = config.plaid.secret;
      plaidEnv = config.plaid.env;
    }
  } catch {
    // functions.config() not available
  }
  plaidClientId = plaidClientId || process.env.PLAID_CLIENT_ID;
  plaidSecret = plaidSecret || process.env.PLAID_SECRET;
  plaidEnv = plaidEnv || process.env.PLAID_ENV || 'sandbox';
  return { plaidClientId, plaidSecret, plaidEnv };
}

const { plaidClientId, plaidSecret, plaidEnv } = getPlaidConfig();

const configuration = new Configuration({
  basePath: PlaidEnvironments[plaidEnv as keyof typeof PlaidEnvironments] || PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': plaidClientId || '',
      'PLAID-SECRET': plaidSecret || '',
    },
  },
});

const client = new PlaidApi(configuration);

export async function POST(req: Request) {
  try {
    const { uid } = await getUserFromReqOrThrow(req);

    const profileDoc = await adminDb.doc(`user_profiles/${uid}`).get();
    const profile = profileDoc.data();
    if (!profile?.plaid_token) {
      return NextResponse.json({ error: 'No Plaid connection found' }, { status: 400 });
    }

    const accessToken = profile.plaid_token;

    let response;
    try {
      response = await client.transactionsRecurringGet({
        access_token: accessToken,
      });
    } catch (plaidError: any) {
      if (plaidError?.response?.data?.error_code === 'PRODUCTS_NOT_READY' ||
          plaidError?.response?.data?.error_code === 'PRODUCT_NOT_ENABLED') {
        return NextResponse.json({
          success: true,
          message: 'Recurring transactions not available yet. Plaid needs more transaction history.',
          inflow_streams: [],
          outflow_streams: [],
        });
      }
      throw plaidError;
    }

    const inflowStreams = response.data.inflow_streams || [];
    const outflowStreams = response.data.outflow_streams || [];

    const recurringRef = adminDb.collection(`user_profiles/${uid}/recurring_transactions`);

    const batch = adminDb.batch();

    const existingDocs = await recurringRef.get();
    existingDocs.forEach(doc => batch.delete(doc.ref));

    for (const stream of [...inflowStreams, ...outflowStreams]) {
      const docRef = recurringRef.doc(stream.stream_id);
      batch.set(docRef, {
        stream_id: stream.stream_id,
        account_id: stream.account_id,
        merchant_name: stream.merchant_name || null,
        description: stream.description,
        first_date: stream.first_date,
        last_date: stream.last_date,
        frequency: stream.frequency,
        average_amount: stream.average_amount?.amount || null,
        last_amount: stream.last_amount?.amount || null,
        is_active: stream.is_active,
        status: stream.status,
        category: stream.personal_finance_category || null,
        direction: inflowStreams.includes(stream) ? 'inflow' : 'outflow',
        updated_at: new Date(),
      });
    }

    await batch.commit();

    return NextResponse.json({
      success: true,
      inflow_count: inflowStreams.length,
      outflow_count: outflowStreams.length,
    });

  } catch (error: any) {
    console.error('❌ [Recurring Transactions] Error:', error?.response?.data || error);
    return NextResponse.json(
      { error: 'Failed to fetch recurring transactions', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
