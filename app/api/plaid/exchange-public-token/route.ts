export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { adminDb } from '@/lib/firebase/admin';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { fetchAllPlaidTransactions } from '@/lib/plaid/pagination';

export async function POST(req: Request) {
  try {
    const { uid } = await getUserFromReqOrThrow(req);
    const { public_token, import_timeframe = '1year' } = await req.json();

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

      // Store account with all required fields (only if it doesn't exist)
      await accountRef.set({
        id: accountId,
        account_id: accountId,
        name: plaidAccount.name ?? plaidAccount.official_name ?? `Account • ${plaidAccount.mask ?? ''}`,
        mask: plaidAccount.mask ?? null,
        type: plaidAccount.type || 'depository',
        subtype: plaidAccount.subtype || 'checking',
        institution_id: institutionId || '',
        user_id: uid,
        createdAt: Date.now(),
        created_at: new Date(),
        updated_at: new Date(),
      }); // Removed merge: true - we want to fail if it exists

      storedAccounts.push({
        account_id: accountId,
        name: plaidAccount.name ?? plaidAccount.official_name,
        type: plaidAccount.type,
        subtype: plaidAccount.subtype,
        mask: plaidAccount.mask,
      });

      console.log(`✅ [Plaid] Stored account: ${plaidAccount.name || plaidAccount.official_name} (${accountId})`);
    }

    // For now, let's try to find the most likely account with transactions
    // Priority: checking > credit card > savings > other
    let plaidAccount = allAccounts.find(acc =>
      acc.subtype === 'checking' || acc.type === 'depository'
    ) || allAccounts.find(acc =>
      acc.subtype === 'credit card' || acc.type === 'credit'
    ) || allAccounts[0];

    console.log(`🎯 [Plaid] Selected account for transaction import: ${plaidAccount.name || plaidAccount.official_name}`);

    let accountId = plaidAccount.account_id;
    let accountRef = adminDb.doc(`user_profiles/${uid}/accounts/${accountId}`);

    // 3) Store account with Admin SDK (bypasses rules, enforces UID check)
    await accountRef.set({
      id: accountId,
      name: plaidAccount.name ?? plaidAccount.official_name ?? `Account • ${plaidAccount.mask ?? ''}`,
      mask: plaidAccount.mask ?? null,
      createdAt: Date.now(),
      user_id: uid, // Explicitly set for security
    }, { merge: true });

    // 4) Import transactions with Admin SDK using historical data
    let imported = 0;
    let successfulWrites = 0;
    let failedWrites = 0;
    const writeErrors: any[] = [];
    let allTransactions: any[] = [];

    try {
      // Calculate date range based on timeframe
      const endDate = new Date();
      const startDate = new Date();

      switch (import_timeframe) {
        case '1month':
          startDate.setMonth(endDate.getMonth() - 1);
          break;
        case '6months':
          startDate.setMonth(endDate.getMonth() - 6);
          break;
        case '1year':
          startDate.setFullYear(endDate.getFullYear() - 1);
          break;
        default:
          startDate.setMonth(endDate.getMonth() - 6);
      }

      console.log(`📅 Importing transactions from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

      // Fetch all transactions with pagination and retry logic for PRODUCT_NOT_READY errors
      let allTransactions: any[] = [];
      let totalPages = 0;
      const maxRetries = 3;

      console.log(`🔄 [Plaid] Starting transaction fetch with pagination support and ${maxRetries} max retries per page`);

      try {
        // Use a custom wrapper that adds retry logic to the pagination helper
        const fetchWithRetries = async () => {
          let nextCursor: string | undefined = undefined;
          let pageCount = 0;
          const maxPages = 100; // Safety limit

          do {
            pageCount++;

            if (pageCount > maxPages) {
              console.warn(`[Plaid] ⚠️ Reached maximum page limit (${maxPages}), stopping pagination`);
              break;
            }

            let retryCount = 0;
            let pageTransactions: any[] = [];

            // Retry logic for each page
            while (retryCount < maxRetries) {
              try {
                console.log(`🔄 [Plaid] Fetching page ${pageCount}, attempt ${retryCount + 1}/${maxRetries}...`);
                const transactionsResponse = await plaidClient.transactionsGet({
                  access_token,
                  start_date: startDate.toISOString().split('T')[0],
                  end_date: endDate.toISOString().split('T')[0],
                  options: {
                    include_personal_finance_category: true,
                    include_logo_and_counterparty_beta: true,
                    cursor: nextCursor,
                  },
                });

                pageTransactions = transactionsResponse.data.transactions || [];
                allTransactions = allTransactions.concat(pageTransactions);

                nextCursor = transactionsResponse.data.next_cursor || undefined;

                console.log(
                  `📊 [Plaid] Page ${pageCount}: Fetched ${pageTransactions.length} transactions, ` +
                  `total so far: ${allTransactions.length}`
                );

                if (nextCursor) {
                  console.log(`🔄 [Plaid] More transactions available, fetching next page...`);
                } else {
                  console.log(`✅ [Plaid] All transactions fetched (no more pages)`);
                }

                break; // Success, exit retry loop for this page
              } catch (error: any) {
                retryCount++;
                console.log(`❌ [Plaid] Page ${pageCount}, attempt ${retryCount} failed:`, error.response?.data?.error_code || error.message);

                if (error.response?.data?.error_code === 'PRODUCT_NOT_READY' && retryCount < maxRetries) {
                  const waitTime = retryCount * 2;
                  console.log(`⏳ [Plaid] PRODUCT_NOT_READY error, retrying in ${waitTime} seconds... (attempt ${retryCount}/${maxRetries})`);
                  await new Promise(resolve => setTimeout(resolve, waitTime * 1000)); // Exponential backoff
                } else {
                  console.log(`❌ [Plaid] Final attempt failed or non-retryable error:`, error.response?.data || error.message);
                  throw error; // Re-throw if not PRODUCT_NOT_READY or max retries reached
                }
              }
            }
          } while (nextCursor);

          totalPages = pageCount;
        };

        await fetchWithRetries();

        console.log(`📊 [Plaid] Fetched ${allTransactions.length} total transactions from Plaid for account: ${plaidAccount.name} across ${totalPages} page(s)`);
      } catch (error: any) {
        console.error(`❌ [Plaid] Error fetching transactions with pagination:`, error);
        throw error;
      }

      // If no transactions found, try other accounts
      if (allTransactions.length === 0 && allAccounts.length > 1) {
        console.warn(`⚠️ No transactions found for selected account: ${plaidAccount.name} (${plaidAccount.type}/${plaidAccount.subtype})`);
        console.log(`🔄 Trying other accounts...`);

        for (const altAccount of allAccounts) {
          if (altAccount.account_id === plaidAccount.account_id) continue;

          console.log(`🔍 Trying account: ${altAccount.name} (${altAccount.type}/${altAccount.subtype})`);

          try {
            // Fetch all transactions for alternative account with pagination
            const { transactions: altTransactions, totalPages: altTotalPages } = await fetchAllPlaidTransactions(
              plaidClient,
              {
                access_token,
                start_date: startDate.toISOString().split('T')[0],
                end_date: endDate.toISOString().split('T')[0],
                account_ids: [altAccount.account_id], // Only get transactions for this specific account
                options: {
                  include_personal_finance_category: true,
                  include_logo_and_counterparty_beta: true,
                },
              },
              `[Plaid] Alt Account ${altAccount.name}`
            );

            console.log(`📊 Found ${altTransactions.length} transactions in ${altAccount.name} across ${altTotalPages} page(s)`);

            if (altTransactions.length > 0) {
              console.log(`✅ Switching to account with transactions: ${altAccount.name}`);
              plaidAccount = altAccount;
              accountId = altAccount.account_id;
              accountRef = adminDb.doc(`user_profiles/${uid}/accounts/${accountId}`);

              // Update the stored account info
              await accountRef.set({
                id: accountId,
                name: altAccount.name ?? altAccount.official_name ?? `Account • ${altAccount.mask ?? ''}`,
                mask: altAccount.mask ?? null,
                createdAt: Date.now(),
                user_id: uid,
              }, { merge: true });

              // Use the transactions from this account
              allTransactions = altTransactions;
              totalPages = altTotalPages;
              break;
            }
          } catch (altError) {
            console.warn(`⚠️ Failed to get transactions for ${altAccount.name}:`, altError.message);
          }
        }
      }

      console.log(`📊 Final account selected: ${plaidAccount.name} with ${allTransactions.length} transactions across ${totalPages} page(s)`);

      // Log sample transaction to see what Plaid returns
      if (allTransactions.length > 0) {
        console.log(`📊 Sample transaction from Plaid:`, JSON.stringify(allTransactions[0], null, 2));
      } else {
        console.warn(`⚠️ Plaid returned 0 transactions for date range ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]} on ALL accounts`);
      }

      const transactions = allTransactions;

      console.log(`🔄 [Transaction Import] Starting to save ${transactions.length} transactions to Firebase...`);

      for (const tx of transactions) {
        const txId = tx.transaction_id;

        // Check if transaction already exists before importing
        const txRef = adminDb.doc(
          `user_profiles/${uid}/accounts/${accountId}/transactions/${txId}`
        );
        const existingTx = await txRef.get();

        if (existingTx.exists) {
          console.log(`🔄 Transaction ${txId} already exists, skipping import`);
          successfulWrites++; // Count as successful since it already exists
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

        console.log(`📊 [Import] Setting transaction ${txId} with analysis_status: 'pending' and analyzed: false`);
        console.log(`📊 [Import] Transaction data:`, JSON.stringify(transactionData, null, 2));

        try {
          await txRef.set(transactionData);

          console.log(`✅ [Import] Successfully wrote transaction ${txId} to Firebase`);
          console.log(`📊 [Import] Document path: user_profiles/${uid}/accounts/${accountId}/transactions/${txId}`);

          imported++;
          successfulWrites++;
        } catch (writeError) {
          failedWrites++;
          writeErrors.push({
            transactionId: txId,
            error: writeError.message,
            code: writeError.code,
            path: `user_profiles/${uid}/accounts/${accountId}/transactions/${txId}`
          });

          console.error(`❌ [Import] Failed to write transaction ${txId} to Firebase:`, writeError);
          console.error(`❌ [Import] Write error details:`, {
            error: writeError.message,
            code: writeError.code,
            transactionId: txId,
            path: `user_profiles/${uid}/accounts/${accountId}/transactions/${txId}`,
            userId: uid,
            accountId: accountId,
            stack: writeError.stack
          });
          // Continue with other transactions even if one fails
        }
      }
    } catch (txError: any) {
      console.error('❌ Transaction import failed:', txError);
      console.error('❌ Error name:', txError.name);
      console.error('❌ Error message:', txError.message);
      console.error('❌ Error code:', txError.code);
      console.error('❌ Error response:', txError.response?.data);
      console.error('❌ Full error:', JSON.stringify(txError, Object.getOwnPropertyNames(txError), 2));
      // Continue even if transaction import fails
    }

      // Verify transactions were written and check their analysis status
      const verifySnap = await adminDb
        .collection(`user_profiles/${uid}/accounts/${accountId}/transactions`)
        .get();

      console.log(`✅ Verified ${verifySnap.size} transactions written to Firestore`);
      console.log(`📊 Import summary: ${imported} new transactions, ${verifySnap.size} total in database`);

      // Check analysis status of imported transactions
      const pendingCount = verifySnap.docs.filter(doc => {
        const data = doc.data();
        return data.analysis_status === 'pending' || data.analyzed === false;
      }).length;

      const sampleTxs = verifySnap.docs.slice(0, 3).map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          analysis_status: data.analysis_status,
          analyzed: data.analyzed,
          merchant_name: data.merchant_name
        };
      });

      console.log(`📊 Analysis status check: ${pendingCount} pending transactions out of ${verifySnap.size} total`);
      console.log(`📊 Sample transactions:`, sampleTxs);
      console.log(`📊 Import summary: ${successfulWrites} successful writes, ${failedWrites} failed writes`);

      if (failedWrites > 0) {
        console.error(`❌ Import had ${failedWrites} failed writes:`, writeErrors);
      }

      return NextResponse.json({
        ok: true,
        accountId,
        imported: verifySnap.size, // Return actual count
        successfulWrites,
        failedWrites,
        writeErrors: failedWrites > 0 ? writeErrors : undefined,
        pendingTransactions: pendingCount,
        timeframe: import_timeframe,
        debug: {
          totalTransactionsFromPlaid: allTransactions.length,
          transactionsWrittenToFirebase: verifySnap.size,
          pendingForAnalysis: pendingCount,
          sampleTransactions: sampleTxs
        }
      });
  } catch (err: any) {
    console.error('exchange-public-token failed:', err);
    const message = err?.message || 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
