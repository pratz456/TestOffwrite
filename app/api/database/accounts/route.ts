export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server'
import { getAccountsServer, createAccountServer, updateAccountServer, deleteAccountServer } from '@/lib/firebase/accounts-server'
import { getAuthenticatedUser } from '@/lib/firebase/api-auth'
import { invalidJsonResponse, readJsonObject } from '@/app/api/_lib/body'

const isAccountId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\/\\\x00-\x1f\x7f]/.test(value);

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
        error: 'Failed to fetch accounts'
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
      error: 'Internal server error'
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

    const accountData = await readJsonObject(request)
    if (!accountData) return invalidJsonResponse()

    if (!isAccountId(accountData.account_id)) {
      console.error('❌ [Database Accounts API] Missing account_id');
      return NextResponse.json({ error: 'Account ID is required' }, { status: 400 })
    }
    const allowedFields = ['account_id', 'name', 'mask', 'type', 'subtype', 'institution_id'];
    if (Object.keys(accountData).some(key => !allowedFields.includes(key))
      || Object.values(accountData).some(value => typeof value !== 'string' || value.length > 500)) {
      return NextResponse.json({ error: 'Account fields must be strings: account_id, name, mask, type, subtype, institution_id' }, { status: 400 })
    }

    console.log('📝 [Database Accounts API] Creating account:', {
      account_id: accountData.account_id,
      name: accountData.name,
      institution_id: accountData.institution_id
    });

    const result = await createAccountServer(user.uid, accountData as Parameters<typeof createAccountServer>[1])
    if (result.error instanceof Error && result.error.message === 'Account already exists') {
      return NextResponse.json({ error: 'Account already exists' }, { status: 409 })
    }

    if (result.error) {
      console.error('❌ [Database Accounts API] Error creating account:', result.error);
      return NextResponse.json({
        error: 'Failed to create account'
      }, { status: 500 })
    }

    console.log('✅ [Database Accounts API] Successfully created account');
    return NextResponse.json({ success: true, account: result.data })
  } catch (error) {
    console.error('❌ [Database Accounts API] Unexpected error:', error);
    return NextResponse.json({
      error: 'Internal server error'
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

    const body = await readJsonObject(request)
    if (!body) return invalidJsonResponse()
    const { accountId, updates } = body

    if (!isAccountId(accountId)) {
      console.error('❌ [Database Accounts API] Missing account ID');
      return NextResponse.json({ error: 'Account ID is required' }, { status: 400 })
    }
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)
      || Object.keys(updates).some(key => !['name', 'usageType', 'businessUsePercent'].includes(key))) {
      return NextResponse.json({ error: 'Updates may only set name, usageType and businessUsePercent' }, { status: 400 })
    }

    console.log('📝 [Database Accounts API] Updating account:', {
      accountId,
      updates
    });

    const result = await updateAccountServer(user.uid, accountId, updates as Parameters<typeof updateAccountServer>[2])

    if (result.error) {
      console.error('❌ [Database Accounts API] Error updating account:', result.error);
      return NextResponse.json({
        error: 'Failed to update account'
      }, { status: 500 })
    }

    console.log('✅ [Database Accounts API] Successfully updated account');
    return NextResponse.json({ success: true, account: result.data })
  } catch (error) {
    console.error('❌ [Database Accounts API] Unexpected error:', error);
    return NextResponse.json({
      error: 'Internal server error'
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

    const body = await readJsonObject(request);
    if (!body) return invalidJsonResponse();
    const { accountId } = body;

    if (!isAccountId(accountId)) {
      console.error('❌ [Database Accounts API] Missing account ID');
      return NextResponse.json({ error: 'Account ID is required' }, { status: 400 });
    }

    console.log('🗑️ [Database Accounts API] Deleting account:', accountId);

    const result = await deleteAccountServer(user.uid, accountId);

    if (!result.success) {
      console.error('❌ [Database Accounts API] Error deleting account:', result.error);
      return NextResponse.json({
        error: 'Failed to delete account'
      }, { status: 500 });
    }

    console.log('✅ [Database Accounts API] Successfully deleted account');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('❌ [Database Accounts API] Unexpected error:', error);
    return NextResponse.json({
      error: 'Internal server error'
    }, { status: 500 });
  }
}