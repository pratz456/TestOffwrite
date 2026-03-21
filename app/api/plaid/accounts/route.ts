import { NextRequest, NextResponse } from 'next/server';
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { getUserProfile } from '@/lib/firebase/profiles';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV as keyof typeof PlaidEnvironments || 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const client = new PlaidApi(configuration);

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Users can only fetch their own Plaid accounts
    const userId = user.uid;

    // Get user's Plaid access token from Firebase
    const { data: userProfile, error: userError } = await getUserProfile(userId);

    if (userError || !userProfile?.plaid_token) {
      return NextResponse.json({ error: 'No Plaid token found for user' }, { status: 404 });
    }

    // Get accounts from Plaid
    const accountsResponse = await client.accountsGet({
      access_token: userProfile.plaid_token,
    });

    return NextResponse.json({
      accounts: accountsResponse.data.accounts,
    });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch accounts' },
      { status: 500 }
    );
  }
}