export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { adminDb } from '@/lib/firebase/admin';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';

export async function POST(req: Request) {
  try {
    const { uid } = await getUserFromReqOrThrow(req);
    const { public_token } = await req.json();

    if (!public_token) {
      return NextResponse.json({ error: 'Missing public_token' }, { status: 400 });
    }

    // 1) Exchange token
    const plaidRes = await plaidClient.itemPublicTokenExchange({ public_token });
    const access_token = plaidRes.data.access_token;

    // Store the access token in user profile for future use
    await adminDb.doc(`user_profiles/${uid}`).set({
      plaid_token: access_token,
      plaid_item_id: plaidRes.data.item_id,
      last_updated: Date.now(),
    }, { merge: true });

    // 2) Get all available accounts
    const accountsRes = await plaidClient.accountsGet({ access_token });
    const allAccounts = accountsRes.data.accounts || [];
    
    console.log(`📊 [Get Accounts] Found ${allAccounts.length} accounts from Plaid:`);
    allAccounts.forEach((acc, index) => {
      console.log(`   ${index}: ${acc.name || acc.official_name} (${acc.type}) - ${acc.subtype} - Mask: ${acc.mask || 'N/A'}`);
    });

    if (allAccounts.length === 0) {
      return NextResponse.json({ error: 'No accounts returned by Plaid' }, { status: 502 });
    }

    // Return all accounts for user selection
    return NextResponse.json({ 
      ok: true, 
      accounts: allAccounts,
      access_token // Store temporarily for transaction import
    });

  } catch (err: any) {
    console.error('get-accounts failed:', err);
    const message = err?.message || 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

