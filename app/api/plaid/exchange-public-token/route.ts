export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { adminDb } from '@/lib/firebase/admin';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { fetchAllPlaidTransactions } from '@/lib/plaid/pagination';

export async function POST(req: Request) {
  try {
    const { uid } = await getUserFromReqOrThrow(req);
    // Default to 2 years (730 days) - maximum available from Plaid for comprehensive transaction history
    const { public_token, import_timeframe = '2years' } = await req.json();

    if (!public_token) {
      return NextResponse.json({ error: 'Missing public_token' }, { status: 400 });
    }

    // 1) Exchange token
    const plaidRes = await plaidClient.itemPublicTokenExchange({ public_token });
    const access_token = plaidRes.data.access_token;
    const item_id = plaidRes.data.item_id;

    console.log(`🔍 [Plaid] Checking for duplicate bank account connection...`);
    console.log(`🔍 [Plaid] Item ID: ${item_id}`);

    // Get institution info to check for duplicates BEFORE storing
    let institutionId = '';
    try {
      const itemResponse = await plaidClient.itemGet({ access_token });
      institutionId = itemResponse.data.item.institution_id || '';
      console.log(`🔍 [Plaid] Institution ID: ${institutionId}`);
    } catch (err) {
      console.warn('Could not fetch institution ID:', err);
    }

    // Comprehensive duplicate check: Check if user already has any bank accounts connected
    try {
      // First, check if user has any existing accounts at all
      const allExistingAccountsSnapshot = await adminDb
        .collection(`user_profiles/${uid}/accounts`)
        .get();

      console.log(`🔍 [Plaid] Found ${allExistingAccountsSnapshot.size} existing accounts for user`);

      if (allExistingAccountsSnapshot.size > 0) {
        // User has existing accounts, check for duplicates

        // Check 1: By institution_id (most reliable)
        if (institutionId) {
          const institutionAccounts = allExistingAccountsSnapshot.docs.filter(doc => {
            const data = doc.data();
            return data.institution_id === institutionId;
          });

          if (institutionAccounts.length > 0) {
            const existingAccount = institutionAccounts[0].data();
            console.log(`⚠️ [Plaid] Bank account already exists for institution: ${institutionId}`);
            console.log(`⚠️ [Plaid] Existing account: ${existingAccount.name || 'Unknown'}`);
            return NextResponse.json({
              error: 'BANK_ALREADY_CONNECTED',
              message: `This bank account is already connected. You can manage it from your bank settings.`,
              institutionId,
              existingAccountName: existingAccount.name || 'Unknown Account'
            }, { status: 409 }); // 409 Conflict
          }
        }

        // Check 2: By plaid_item_id in user profile
        const userProfileDoc = await adminDb.doc(`user_profiles/${uid}`).get();
        if (userProfileDoc.exists) {
          const userProfile = userProfileDoc.data();
          if (userProfile?.plaid_item_id && userProfile.plaid_item_id === item_id) {
            console.log(`⚠️ [Plaid] Same Plaid item already connected: ${item_id}`);
            return NextResponse.json({
              error: 'BANK_ALREADY_CONNECTED',
              message: `This bank account is already connected. You can manage it from your bank settings.`,
              itemId: item_id
            }, { status: 409 }); // 409 Conflict
          }
        }

        // Check 3: If user has plaid_token, they already have a connection
        // (This prevents connecting a second bank if they already have one)
        if (userProfileDoc.exists) {
          const userProfile = userProfileDoc.data();
          if (userProfile?.plaid_token) {
            console.log(`⚠️ [Plaid] User already has a Plaid connection (plaid_token exists)`);
            // Note: We allow this to continue if institution_id doesn't match
            // This allows users to connect multiple different banks
            // But we'll check account_ids later to prevent exact duplicates
          }
        }
      }
    } catch (checkError) {
      console.error('❌ [Plaid] Error checking for existing bank account:', checkError);
      console.error('❌ [Plaid] Error details:', {
        message: checkError instanceof Error ? checkError.message : String(checkError),
        stack: checkError instanceof Error ? checkError.stack : undefined
      });
      // Don't continue if check fails - this is a critical check
      return NextResponse.json({
        error: 'DUPLICATE_CHECK_FAILED',
        message: 'Unable to verify if bank account already exists. Please try again or contact support.'
      }, { status: 500 });
    }

    console.log(`✅ [Plaid] No duplicate found, proceeding with connection...`);

    // Store the access token in user profile for future use
    await adminDb.doc(`user_profiles/${uid}`).set({
      plaid_token: access_token,
      plaid_item_id: item_id,
      last_updated: Date.now(),
    }, { merge: true });

    // 2) Get all available accounts and log them for debugging
    const accountsRes = await plaidClient.accountsGet({ access_token });
    const allAccounts = accountsRes.data.accounts || [];

    console.log(`📊 [Plaid] Found ${allAccounts.length} accounts from Plaid:`);
    allAccounts.forEach((acc, index) => {
      console.log(`   ${index}: ${acc.name || acc.official_name} (${acc.type}) - ${acc.subtype} - Mask: ${acc.mask || 'N/A'}`);
    });

    if (allAccounts.length === 0) {
      return NextResponse.json({ error: 'No accounts returned by Plaid' }, { status: 502 });
    }

    // Additional check: Verify none of the account_ids already exist
    // This is a critical check - if ANY account_id exists, block the entire connection
    console.log(`🔍 [Plaid] Checking if any account IDs already exist...`);
    const duplicateAccountIds: string[] = [];
    for (const plaidAccount of allAccounts) {
      const accountId = plaidAccount.account_id;
      const accountRef = adminDb.doc(`user_profiles/${uid}/accounts/${accountId}`);
      const existingAccountDoc = await accountRef.get();

      if (existingAccountDoc.exists) {
        const existingAccount = existingAccountDoc.data();
        duplicateAccountIds.push(accountId);
        console.log(`⚠️ [Plaid] DUPLICATE DETECTED: Account ID ${accountId} already exists: ${existingAccount?.name || 'Unknown'}`);
        console.log(`⚠️ [Plaid] Existing account data:`, JSON.stringify(existingAccount, null, 2));
      }
    }

    if (duplicateAccountIds.length > 0) {
      console.log(`❌ [Plaid] BLOCKING CONNECTION: Found ${duplicateAccountIds.length} duplicate account(s): ${duplicateAccountIds.join(', ')}`);
      // Get the first duplicate account for the error message
      const firstDuplicateId = duplicateAccountIds[0];
      const firstDuplicateRef = adminDb.doc(`user_profiles/${uid}/accounts/${firstDuplicateId}`);
      const firstDuplicateDoc = await firstDuplicateRef.get();
      const firstDuplicateData = firstDuplicateDoc.exists ? firstDuplicateDoc.data() : null;

      return NextResponse.json({
        error: 'BANK_ALREADY_CONNECTED',
        message: `This bank account (${firstDuplicateData?.name || firstDuplicateId}) is already connected. You can manage it from your bank settings.`,
        accountId: firstDuplicateId,
        existingAccountName: firstDuplicateData?.name || 'Unknown Account',
        duplicateCount: duplicateAccountIds.length
      }, { status: 409 }); // 409 Conflict
    }
    console.log(`✅ [Plaid] No duplicate account IDs found - all ${allAccounts.length} accounts are new`);

    // Store ALL accounts in the database, not just one
    // BUT: Double-check each account doesn't exist before storing
    const storedAccounts = [];
    for (const plaidAccount of allAccounts) {
      const accountId = plaidAccount.account_id;
      const accountRef = adminDb.doc(`user_profiles/${uid}/accounts/${accountId}`);

      // Final check: Verify this specific account doesn't exist
      const finalCheck = await accountRef.get();
      if (finalCheck.exists) {
        const existingData = finalCheck.data();
        console.log(`❌ [Plaid] BLOCKED: Account ${accountId} already exists: ${existingData?.name || 'Unknown'}`);
        return NextResponse.json({
          error: 'BANK_ALREADY_CONNECTED',
          message: `This bank account (${existingData?.name || accountId}) is already connected. You can manage it from your bank settings.`,
          accountId,
          existingAccountName: existingData?.name || 'Unknown Account'
        }, { status: 409 }); // 409 Conflict
      }

      // Extract balance information from Plaid account
      const balances = plaidAccount.balances || {};
      const availableBalance = balances.available;
      const currentBalance = balances.current;
      const limit = balances.limit;

      // Calculate display balance based on account type (same logic as refresh-balances)
      let displayBalance = 0;
      if (plaidAccount.type === 'credit') {
        // For credit cards: show available credit
        // available = available credit (positive), current = amount owed (usually negative), limit = credit limit
        if (availableBalance !== null && availableBalance !== undefined) {
          displayBalance = availableBalance;
        } else if (limit !== null && limit !== undefined && currentBalance !== null && currentBalance !== undefined) {
          // Calculate available credit: limit - |currentBalance| (currentBalance is negative for amount owed)
          const amountOwed = Math.abs(currentBalance);
          displayBalance = Math.max(0, limit - amountOwed);
        } else if (limit !== null && limit !== undefined) {
          displayBalance = limit;
        } else {
          displayBalance = 0;
        }
        console.log(`💳 [Plaid] Credit card ${accountId}: limit=${limit}, current=${currentBalance}, available=${availableBalance}, display=${displayBalance}`);
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
        console.log(`💰 [Plaid] Depository account ${accountId}: available=${availableBalance}, current=${currentBalance}, display=${displayBalance}`);
      }

      // Store account with all required fields including balance (only if it doesn't exist)
      await accountRef.set({
        id: accountId,
        account_id: accountId,
        name: plaidAccount.name ?? plaidAccount.official_name ?? `Account • ${plaidAccount.mask ?? ''}`,
        mask: plaidAccount.mask ?? null,
        type: plaidAccount.type || 'depository',
        subtype: plaidAccount.subtype || 'checking',
        institution_id: institutionId || '',
        user_id: uid,
        // Balance information
        balance: displayBalance,
        available_balance: availableBalance,
        current_balance: currentBalance,
        limit: limit,
        iso_currency_code: balances.iso_currency_code || 'USD',
        unofficial_currency_code: balances.unofficial_currency_code || null,
        balance_last_updated: balances.last_updated_datetime || new Date().toISOString(),
        createdAt: Date.now(),
        created_at: new Date(),
        updated_at: new Date(),
      }); // Removed merge: true - we want to fail if it exists

      console.log(`💵 [Plaid] Stored account ${accountId} with balance: $${displayBalance} (type: ${plaidAccount.type}, available: ${availableBalance}, current: ${currentBalance})`);

      storedAccounts.push({
        account_id: accountId,
        name: plaidAccount.name ?? plaidAccount.official_name,
        type: plaidAccount.type,
        subtype: plaidAccount.subtype,
        mask: plaidAccount.mask,
      });

      console.log(`✅ [Plaid] Stored account: ${plaidAccount.name || plaidAccount.official_name} (${accountId})`);
    }

    // 4) Import transactions for ALL accounts (not just one)
    // Calculate date range - Plaid supports up to 730 days (2 years) of historical data
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999); // End of today
    const startDate = new Date();

    // Calculate days to go back based on timeframe
    // Note: Plaid's maximum is 730 days (2 years) for transactions/get endpoint
    const MAX_PLAID_DAYS = 730; // Maximum days Plaid supports
    let daysToFetch = 365; // Default to 1 year

    switch (import_timeframe) {
      case '1month':
        daysToFetch = 30;
        break;
      case '6months':
        daysToFetch = 180;
        break;
      case '1year':
        daysToFetch = 365;
        break;
      case '2years':
        daysToFetch = 730; // Maximum available from Plaid
        break;
      default:
        daysToFetch = 730; // Default to maximum (2 years / 730 days)
    }

    // Use maximum available days if timeframe exceeds Plaid's limit
    const actualDays = Math.min(daysToFetch, MAX_PLAID_DAYS);

    // Calculate start date more reliably using milliseconds
    // This avoids issues with month boundaries and leap years
    const startDateMs = endDate.getTime() - (actualDays * 24 * 60 * 60 * 1000);
    startDate.setTime(startDateMs);
    startDate.setHours(0, 0, 0, 0); // Start of the day

    // Format dates as YYYY-MM-DD for Plaid API
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Calculate and log the actual date range for debugging
    const actualDateRange = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    console.log(`📅 [Plaid] Transaction import configuration:`);
    console.log(`   📆 Date range: ${startDateStr} to ${endDateStr}`);
    console.log(`   📊 Requested timeframe: ${import_timeframe} (${daysToFetch} days)`);
    console.log(`   ✅ Calculated: ${actualDays} days (${actualDays === MAX_PLAID_DAYS ? 'MAXIMUM AVAILABLE' : 'within limit'})`);
    console.log(`   🔍 Actual date range: ${actualDateRange} days (${startDateStr} to ${endDateStr})`);
    console.log(`   📅 Start date: ${startDate.toLocaleDateString()} (${startDateStr})`);
    console.log(`   📅 End date: ${endDate.toLocaleDateString()} (${endDateStr})`);
    console.log(`   🏦 Accounts to process: ${allAccounts.length}`);
    console.log(`   🔄 Pagination: Will fetch ALL available transactions using cursor-based pagination`);
    console.log(`   ⚠️ NOTE: Plaid may only return transactions available from the bank.`);
    console.log(`   ⚠️ NOTE: If account was connected recently, historical data may be limited.`);
    console.log(`   ⚠️ NOTE: Sandbox environment may have limited test data.`);

    // Import transactions for ALL accounts
    let totalImported = 0;
    let totalSuccessfulWrites = 0;
    let totalFailedWrites = 0;
    const allWriteErrors: any[] = [];
    const accountImportResults: any[] = [];
    let primaryAccountId = allAccounts[0]?.account_id || '';

    // Iterate through each account and import its transactions
    for (const plaidAccount of allAccounts) {
      const accountId = plaidAccount.account_id;
      let accountImported = 0;
      let accountSuccessfulWrites = 0;
      let accountFailedWrites = 0;
      const accountWriteErrors: any[] = [];

      console.log(`🔄 [Plaid] Importing transactions for account: ${plaidAccount.name || plaidAccount.official_name} (${accountId})`);

      try {
        // Fetch all transactions for this account with pagination
        // This will automatically paginate through all available transactions using cursor
        console.log(`🔄 [Plaid] Starting transaction fetch for account: ${plaidAccount.name} (${accountId})`);
        const {
          transactions: accountTransactions,
          totalPages,
          totalTransactions,
          plaidTotalTransactions
        } = await fetchAllPlaidTransactions(
          plaidClient,
          {
            access_token,
            start_date: startDateStr,
            end_date: endDateStr,
            account_ids: [accountId], // Only get transactions for this specific account
            options: {
              include_personal_finance_category: true,
              include_logo_and_counterparty_beta: true,
            },
          },
          `[Plaid] Account ${plaidAccount.name}`
        );

        console.log(`✅ [Plaid] Transaction fetch completed for account: ${plaidAccount.name}`);
        console.log(`   📊 Fetched: ${totalTransactions} transactions`);
        console.log(`   📄 Pages: ${totalPages}`);
        if (plaidTotalTransactions !== undefined) {
          console.log(`   📈 Plaid reported: ${plaidTotalTransactions} total transactions`);
          if (totalTransactions === plaidTotalTransactions) {
            console.log(`   ✅ SUCCESS: All available transactions fetched`);
          } else {
            console.warn(`   ⚠️ WARNING: Fetched ${totalTransactions} but Plaid reported ${plaidTotalTransactions} available`);
          }
        }

        // Log the date range of fetched transactions for debugging
        if (accountTransactions.length > 0) {
          const transactionDates = accountTransactions.map(tx => tx.date).sort();
          const earliestTx = transactionDates[0];
          const latestTx = transactionDates[transactionDates.length - 1];
          console.log(`   📅 Transaction date range: ${earliestTx} to ${latestTx}`);
          console.log(`   📅 Requested date range: ${startDateStr} to ${endDateStr}`);

          if (earliestTx > startDateStr) {
            const daysDifference = Math.ceil((new Date(earliestTx).getTime() - new Date(startDateStr).getTime()) / (1000 * 60 * 60 * 24));
            console.warn(`   ⚠️ WARNING: Earliest transaction (${earliestTx}) is ${daysDifference} days after requested start date (${startDateStr})`);
            console.warn(`   ⚠️ This suggests Plaid/bank does not have transactions before ${earliestTx}`);
            console.warn(`   ⚠️ Possible reasons:`);
            console.warn(`      - Account was connected on or after ${earliestTx}`);
            console.warn(`      - Bank/Plaid has limited historical data available`);
            console.warn(`      - Using Plaid Sandbox (typically limited to 30-40 days of test data)`);
            console.warn(`      - Bank only provides recent transaction history through Plaid`);
          }
        } else {
          console.warn(`   ⚠️ No transactions found in date range ${startDateStr} to ${endDateStr}`);
        }

        if (accountTransactions.length === 0) {
          console.log(`⚠️ [Plaid] No transactions found for account: ${plaidAccount.name} (${plaidAccount.type}/${plaidAccount.subtype})`);
          accountImportResults.push({
            accountId,
            accountName: plaidAccount.name || plaidAccount.official_name,
            imported: 0,
            totalTransactions: 0,
            status: 'no_transactions'
          });
          continue;
        }

        // Store transactions for this account
        console.log(`🔄 [Transaction Import] Starting to save ${accountTransactions.length} transactions to Firebase for account: ${plaidAccount.name}...`);

        for (const tx of accountTransactions) {
          const txId = tx.transaction_id;

          // Check if transaction already exists before importing
          const txRef = adminDb.doc(
            `user_profiles/${uid}/accounts/${accountId}/transactions/${txId}`
          );
          const existingTx = await txRef.get();

          if (existingTx.exists) {
            console.log(`🔄 Transaction ${txId} already exists, skipping import`);
            accountSuccessfulWrites++; // Count as successful since it already exists
            continue; // Skip this transaction
          }

          const transactionData = {
            analysis_status: 'pending',
            analysisStatus: 'pending', // Add camelCase version for consistency
            user_id: uid,        // Snake case for security rules
            userId: uid,         // Camel case for queries
            account_id: accountId,
            accountId: accountId, // Add camelCase version
            trans_id: txId,
            date: tx.date,
            datetime: tx.datetime, // Capture the full datetime from Plaid
            amount: tx.amount,
            merchant_name: tx.merchant_name || tx.name,
            category: tx.personal_finance_category?.detailed || tx.category?.[0] || 'Other',
            description: tx.name,
            is_deductible: null,
            deduction_score: null,
            deductible_reason: null,
            ai: null,
            analyzed: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          try {
            await txRef.set(transactionData);
            accountImported++;
            accountSuccessfulWrites++;
          } catch (writeError: any) {
            accountFailedWrites++;
            accountWriteErrors.push({
              transactionId: txId,
              error: writeError.message,
              code: writeError.code,
              path: `user_profiles/${uid}/accounts/${accountId}/transactions/${txId}`
            });
            console.error(`❌ [Import] Failed to write transaction ${txId} to Firebase:`, writeError);
            // Continue with other transactions even if one fails
          }
        }

        // Verify transactions were written for this account
        const verifySnap = await adminDb
          .collection(`user_profiles/${uid}/accounts/${accountId}/transactions`)
          .get();

        console.log(`✅ [Plaid] Account ${plaidAccount.name}: ${accountImported} new transactions imported, ${verifySnap.size} total in database`);

        totalImported += accountImported;
        totalSuccessfulWrites += accountSuccessfulWrites;
        totalFailedWrites += accountFailedWrites;
        allWriteErrors.push(...accountWriteErrors);

        accountImportResults.push({
          accountId,
          accountName: plaidAccount.name || plaidAccount.official_name,
          imported: accountImported,
          totalTransactions: verifySnap.size,
          successfulWrites: accountSuccessfulWrites,
          failedWrites: accountFailedWrites,
          status: 'success'
        });

        // Set the first account with transactions as the primary account
        if (!primaryAccountId && accountTransactions.length > 0) {
          primaryAccountId = accountId;
        }

      } catch (accountError: any) {
        console.error(`❌ [Plaid] Error importing transactions for account ${plaidAccount.name}:`, accountError);
        accountImportResults.push({
          accountId,
          accountName: plaidAccount.name || plaidAccount.official_name,
          imported: 0,
          totalTransactions: 0,
          status: 'error',
          error: accountError.message
        });
        // Continue with other accounts even if one fails
      }
    }

    console.log(`✅ [Plaid] ========================================`);
    console.log(`✅ [Plaid] TRANSACTION IMPORT SUMMARY`);
    console.log(`✅ [Plaid] ========================================`);
    console.log(`   📊 Total transactions imported: ${totalImported}`);
    console.log(`   ✅ Successful writes: ${totalSuccessfulWrites}`);
    console.log(`   ❌ Failed writes: ${totalFailedWrites}`);
    console.log(`   🏦 Accounts processed: ${accountImportResults.length}`);
    console.log(`   📅 Date range: ${startDateStr} to ${endDateStr} (${actualDays} days)`);
    console.log(`   🔄 Pagination: Completed for all accounts`);
    console.log(`✅ [Plaid] ========================================`);

    // Log detailed results for each account
    accountImportResults.forEach((result, index) => {
      console.log(`   Account ${index + 1}: ${result.accountName || result.accountId}`);
      console.log(`     - Status: ${result.status}`);
      console.log(`     - Transactions imported: ${result.imported || 0}`);
      console.log(`     - Total in database: ${result.totalTransactions || 0}`);
      if (result.failedWrites > 0) {
        console.log(`     - Failed writes: ${result.failedWrites}`);
      }
    });

    // Return the primary account ID (first account with transactions, or first account)
    if (!primaryAccountId) {
      primaryAccountId = allAccounts[0]?.account_id || '';
    }

    return NextResponse.json({
      ok: true,
      accountId: primaryAccountId,
      imported: totalImported,
      successfulWrites: totalSuccessfulWrites,
      failedWrites: totalFailedWrites,
      writeErrors: totalFailedWrites > 0 ? allWriteErrors : undefined,
      timeframe: import_timeframe,
      accountsProcessed: accountImportResults.length,
      accountResults: accountImportResults,
      debug: {
        totalAccounts: allAccounts.length,
        accountsProcessed: accountImportResults.length,
        totalTransactionsImported: totalImported,
        accountImportResults
      }
    });
  } catch (err: any) {
    console.error('exchange-public-token failed:', err);
    const message = err?.message || 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
