export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server'
import { getAccountsServer, createAccountServer, updateAccountServer, deleteAccountServer } from '@/lib/firebase/accounts-server'
import { getAuthenticatedUser } from '@/lib/firebase/api-auth'

export async function GET(request: NextRequest) {
  try {
    console.log('🔄 [Database Accounts API] Starting GET request...');

    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);

    if (authError || !user) {
      console.error('❌ [Database Accounts API] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ [Database Accounts API] User authenticated:', user.uid);

    const result = await getAccountsServer(user.uid)

    if (result.error) {
      console.error('❌ [Database Accounts API] Error fetching accounts:', result.error);
      return NextResponse.json({
        error: 'Failed to fetch accounts',
        details: result.error.message || result.error
      }, { status: 500 })
    }

    console.log(`✅ [Database Accounts API] Successfully fetched ${result.data.length} accounts`);

    // Check if any accounts are missing balance data
    // Note: We check for balance being 0, null, or undefined, but 0 is a valid balance
    // So we'll only flag accounts where balance is explicitly null/undefined
    const accountsWithoutBalance = result.data.filter(acc => {
      // Check if balance field is missing or if it's null/undefined (but not 0, as 0 is valid)
      const hasBalanceField = acc.balance !== undefined && acc.balance !== null;
      const hasBalanceData = hasBalanceField || acc.available_balance !== undefined || acc.current_balance !== undefined;
      return !hasBalanceData;
    });

    if (accountsWithoutBalance.length > 0) {
      console.log(`⚠️ [Database Accounts API] Found ${accountsWithoutBalance.length} account(s) without balance data:`);
      accountsWithoutBalance.forEach(acc => {
        console.log(`   - ${acc.name || acc.account_id}: balance=${acc.balance}, available_balance=${acc.available_balance}, current_balance=${acc.current_balance}`);
      });
      console.log(`💡 [Database Accounts API] Balance data can be refreshed via /api/plaid/refresh-balances endpoint`);
    } else {
      console.log(`✅ [Database Accounts API] All ${result.data.length} accounts have balance data`);
    }

    return NextResponse.json({
      accounts: result.data,
      metadata: {
        totalAccounts: result.data.length,
        accountsWithoutBalance: accountsWithoutBalance.length,
        needsBalanceRefresh: accountsWithoutBalance.length > 0
      }
    })
  } catch (error) {
    console.error('❌ [Database Accounts API] Unexpected error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 [Database Accounts API] Starting POST request...');

    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);

    if (authError || !user) {
      console.error('❌ [Database Accounts API] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ [Database Accounts API] User authenticated:', user.uid);

    const accountData = await request.json()

    if (!accountData.account_id) {
      console.error('❌ [Database Accounts API] Missing account_id');
      return NextResponse.json({ error: 'Account ID is required' }, { status: 400 })
    }

    console.log('📝 [Database Accounts API] Creating account:', {
      account_id: accountData.account_id,
      name: accountData.name,
      institution_id: accountData.institution_id
    });

    const result = await createAccountServer(user.uid, accountData)

    if (result.error) {
      console.error('❌ [Database Accounts API] Error creating account:', result.error);
      return NextResponse.json({
        error: 'Failed to create account',
        details: result.error.message || result.error
      }, { status: 500 })
    }

    console.log('✅ [Database Accounts API] Successfully created account');
    return NextResponse.json({ success: true, account: result.data })
  } catch (error) {
    console.error('❌ [Database Accounts API] Unexpected error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    console.log('🔄 [Database Accounts API] Starting PUT request...');

    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);

    if (authError || !user) {
      console.error('❌ [Database Accounts API] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ [Database Accounts API] User authenticated:', user.uid);

    const { accountId, updates } = await request.json()

    if (!accountId) {
      console.error('❌ [Database Accounts API] Missing account ID');
      return NextResponse.json({ error: 'Account ID is required' }, { status: 400 })
    }

    console.log('📝 [Database Accounts API] Updating account:', {
      accountId,
      updates
    });

    const result = await updateAccountServer(user.uid, accountId, updates)

    if (result.error) {
      console.error('❌ [Database Accounts API] Error updating account:', result.error);
      return NextResponse.json({
        error: 'Failed to update account',
        details: result.error.message || result.error
      }, { status: 500 })
    }

    console.log('✅ [Database Accounts API] Successfully updated account');
    return NextResponse.json({ success: true, account: result.data })
  } catch (error) {
    console.error('❌ [Database Accounts API] Unexpected error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    console.log('🔄 [Database Accounts API] Starting DELETE request...');

    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);

    if (authError || !user) {
      console.error('❌ [Database Accounts API] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ [Database Accounts API] User authenticated:', user.uid);

    const { accountId } = await request.json();

    if (!accountId) {
      console.error('❌ [Database Accounts API] Missing account ID');
      return NextResponse.json({ error: 'Account ID is required' }, { status: 400 });
    }

    console.log('🗑️ [Database Accounts API] Deleting account:', accountId);

    const result = await deleteAccountServer(user.uid, accountId);

    if (!result.success) {
      console.error('❌ [Database Accounts API] Error deleting account:', result.error);
      return NextResponse.json({
        error: 'Failed to delete account',
        details: result.error?.message || result.error || 'Unknown error'
      }, { status: 500 });
    }

    console.log('✅ [Database Accounts API] Successfully deleted account');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('❌ [Database Accounts API] Unexpected error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}