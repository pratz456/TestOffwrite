export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { adminDb } from '@/lib/firebase/admin';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';

export async function POST(req: Request) {
  try {
    const { uid } = await getUserFromReqOrThrow(req);
    const { public_token, import_timeframe = '6months' } = await req.json();

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

    // For now, let's try to find the most likely account with transactions
    // Priority: checking > credit card > savings > other
    let plaidAccount = allAccounts.find(acc => 
      acc.subtype === 'checking' || acc.type === 'depository'
    ) || allAccounts.find(acc => 
      acc.subtype === 'credit card' || acc.type === 'credit'
    ) || allAccounts[0];

    console.log(`🎯 [Plaid] Selected account: ${plaidAccount.name || plaidAccount.official_name} (${plaidAccount.type}/${plaidAccount.subtype})`);
    
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

      // Retry mechanism for Plaid PRODUCT_NOT_READY error
      let transactionsRes;
      let retryCount = 0;
      const maxRetries = 3;
      
      console.log(`🔄 [Plaid] Starting transaction fetch with ${maxRetries} max retries`);
      
      while (retryCount < maxRetries) {
        try {
          console.log(`🔄 [Plaid] Attempt ${retryCount + 1}/${maxRetries}: Fetching transactions...`);
          transactionsRes = await plaidClient.transactionsGet({
            access_token,
            start_date: startDate.toISOString().split('T')[0],
            end_date: endDate.toISOString().split('T')[0],
            options: {
              include_personal_finance_category: true,
              include_logo_and_counterparty_beta: true,
            },
          });
          console.log(`✅ [Plaid] Successfully fetched transactions on attempt ${retryCount + 1}`);
          break; // Success, exit retry loop
        } catch (error: any) {
          retryCount++;
          console.log(`❌ [Plaid] Attempt ${retryCount} failed:`, error.response?.data?.error_code || error.message);
          
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

      allTransactions = transactionsRes.data.transactions || [];
      console.log(`📊 Fetched ${allTransactions.length} transactions from Plaid for account: ${plaidAccount.name}`);

      // If no transactions found, try other accounts
      if (allTransactions.length === 0 && allAccounts.length > 1) {
        console.warn(`⚠️ No transactions found for selected account: ${plaidAccount.name} (${plaidAccount.type}/${plaidAccount.subtype})`);
        console.log(`🔄 Trying other accounts...`);
        
        for (const altAccount of allAccounts) {
          if (altAccount.account_id === plaidAccount.account_id) continue;
          
          console.log(`🔍 Trying account: ${altAccount.name} (${altAccount.type}/${altAccount.subtype})`);
          
          try {
            const altTransactionsRes = await plaidClient.transactionsGet({
              access_token,
              start_date: startDate.toISOString().split('T')[0],
              end_date: endDate.toISOString().split('T')[0],
              account_ids: [altAccount.account_id], // Only get transactions for this specific account
              options: {
                include_personal_finance_category: true,
                include_logo_and_counterparty_beta: true,
              },
            });
            
            const altTransactions = altTransactionsRes.data.transactions || [];
            console.log(`📊 Found ${altTransactions.length} transactions in ${altAccount.name}`);
            
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
              break;
            }
          } catch (altError) {
            console.warn(`⚠️ Failed to get transactions for ${altAccount.name}:`, altError.message);
          }
        }
      }

      console.log(`📊 Final account selected: ${plaidAccount.name} with ${allTransactions.length} transactions`);
      
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
