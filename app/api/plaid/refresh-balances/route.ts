export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { adminDb } from '@/lib/firebase/admin';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';

export async function POST(req: Request) {
  try {
    console.log('🔄 [Refresh Balances] Starting balance refresh...');
    const { uid } = await getUserFromReqOrThrow(req);
    console.log(`✅ [Refresh Balances] User authenticated: ${uid}`);

    // Get user's Plaid access token
    const userProfileDoc = await adminDb.doc(`user_profiles/${uid}`).get();
    if (!userProfileDoc.exists) {
      console.error('❌ [Refresh Balances] User profile not found');
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    const userProfile = userProfileDoc.data();
    if (!userProfile?.plaid_token) {
      console.error('❌ [Refresh Balances] No Plaid token found in user profile');
      return NextResponse.json({ error: 'No Plaid connection found' }, { status: 404 });
    }

    console.log('🔄 [Refresh Balances] Fetching accounts from Plaid...');
    // Fetch fresh account data from Plaid
    const accountsResponse = await plaidClient.accountsGet({
      access_token: userProfile.plaid_token,
    });

    const plaidAccounts = accountsResponse.data.accounts || [];
    console.log(`📊 [Refresh Balances] Found ${plaidAccounts.length} account(s) from Plaid`);

    if (plaidAccounts.length === 0) {
      console.warn('⚠️ [Refresh Balances] No accounts returned from Plaid');
      return NextResponse.json({
        success: true,
        updated: 0,
        accounts: [],
        message: 'No accounts found in Plaid'
      });
    }

    const updatedAccounts = [];
    const skippedAccounts = [];

    // Update each account with fresh balance information
    console.log(`🔄 [Refresh Balances] Processing ${plaidAccounts.length} account(s)...`);
    for (const plaidAccount of plaidAccounts) {
      const accountId = plaidAccount.account_id;
      const accountName = plaidAccount.name || plaidAccount.official_name || accountId;
      const accountRef = adminDb.doc(`user_profiles/${uid}/accounts/${accountId}`);

      console.log(`🔄 [Refresh Balances] Processing account: ${accountName} (${accountId})`);

      // Check if account exists
      const accountDoc = await accountRef.get();
      if (!accountDoc.exists) {
        console.warn(`⚠️ [Refresh Balances] Account ${accountId} (${accountName}) not found in database, skipping`);
        skippedAccounts.push({
          account_id: accountId,
          name: accountName,
          reason: 'not_found_in_database'
        });
        continue;
      }

      const existingAccountData = accountDoc.data();
      console.log(`📊 [Refresh Balances] Existing account data: balance=${existingAccountData?.balance}, available_balance=${existingAccountData?.available_balance}, current_balance=${existingAccountData?.current_balance}`);

      // Extract balance information
      const balances = plaidAccount.balances || {};
      const availableBalance = balances.available;
      const currentBalance = balances.current;
      const limit = balances.limit;

      // Calculate display balance based on account type
      let displayBalance = 0;
      if (plaidAccount.type === 'credit') {
        // For credit cards: show available credit
        // available = available credit (positive), current = amount owed (usually negative), limit = credit limit
        if (availableBalance !== null && availableBalance !== undefined) {
          displayBalance = availableBalance;
        } else if (limit !== null && limit !== undefined && currentBalance !== null && currentBalance !== undefined) {
          // Calculate available credit: limit - |currentBalance| (currentBalance is negative for amount owed)
          // If currentBalance is negative, we add it to limit. If positive, we subtract it.
          const amountOwed = Math.abs(currentBalance);
          displayBalance = Math.max(0, limit - amountOwed);
        } else if (limit !== null && limit !== undefined) {
          displayBalance = limit;
        } else {
          displayBalance = 0;
        }
        console.log(`💳 [Refresh Balances] Credit card ${accountId}: limit=${limit}, current=${currentBalance}, available=${availableBalance}, display=${displayBalance}`);
      } else {
        // For depository accounts: show available balance
        // available = available balance (after pending), current = current balance
        if (availableBalance !== null && availableBalance !== undefined) {
          displayBalance = availableBalance;
        } else if (currentBalance !== null && currentBalance !== undefined) {
          displayBalance = currentBalance;
        } else {
          displayBalance = 0;
        }
        console.log(`💰 [Refresh Balances] Depository account ${accountId}: available=${availableBalance}, current=${currentBalance}, display=${displayBalance}`);
      }

      // Update account with fresh balance data
      await accountRef.update({
        balance: displayBalance,
        available_balance: availableBalance,
        current_balance: currentBalance,
        limit: limit,
        iso_currency_code: balances.iso_currency_code || 'USD',
        unofficial_currency_code: balances.unofficial_currency_code || null,
        balance_last_updated: balances.last_updated_datetime || new Date().toISOString(),
        updated_at: new Date(),
      });

      console.log(`💵 [Refresh Balances] Updated account ${accountId} (${accountName}): $${displayBalance} (type: ${plaidAccount.type}, available: ${availableBalance}, current: ${currentBalance})`);

      updatedAccounts.push({
        account_id: accountId,
        name: accountName,
        balance: displayBalance,
        available_balance: availableBalance,
        current_balance: currentBalance,
        limit: limit,
      });
    }

    console.log(`✅ [Refresh Balances] Balance refresh completed:`);
    console.log(`   📊 Updated: ${updatedAccounts.length} account(s)`);
    console.log(`   ⏭️ Skipped: ${skippedAccounts.length} account(s)`);
    if (skippedAccounts.length > 0) {
      console.log(`   ⚠️ Skipped accounts:`, skippedAccounts.map(a => `${a.name} (${a.reason})`).join(', '));
    }

    return NextResponse.json({
      success: true,
      updated: updatedAccounts.length,
      skipped: skippedAccounts.length,
      accounts: updatedAccounts,
      skippedAccounts: skippedAccounts.length > 0 ? skippedAccounts : undefined,
      message: `Updated ${updatedAccounts.length} account(s)${skippedAccounts.length > 0 ? `, skipped ${skippedAccounts.length} account(s)` : ''}`
    });
  } catch (error: any) {
    console.error('❌ [Refresh Balances] Error refreshing account balances:', error);
    console.error('❌ [Refresh Balances] Error details:', {
      message: error.message,
      error_code: error.response?.data?.error_code,
      error_message: error.response?.data?.error_message,
      error_type: error.response?.data?.error_type,
      stack: error.stack
    });
    return NextResponse.json(
      {
        error: error.message || 'Failed to refresh balances',
        error_code: error.response?.data?.error_code,
        error_message: error.response?.data?.error_message,
      },
      { status: 500 }
    );
  }
}

