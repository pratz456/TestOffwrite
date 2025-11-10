export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { adminDb } from '@/lib/firebase/admin';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { fetchAllPlaidTransactions } from '@/lib/plaid/pagination';

export async function POST(req: Request) {
  try {
    const { uid } = await getUserFromReqOrThrow(req);
    const { account_id, import_timeframe = '2years', access_token } = await req.json();

    if (!account_id || !access_token) {
      return NextResponse.json({ error: 'Missing account_id or access_token' }, { status: 400 });
    }

    console.log(`🚀 [Import Transactions] Starting import for account: ${account_id}`);

    // Get the specific account info
    const accountsRes = await plaidClient.accountsGet({ access_token });
    const selectedAccount = accountsRes.data.accounts?.find(acc => acc.account_id === account_id);

    if (!selectedAccount) {
      return NextResponse.json({ error: 'Selected account not found' }, { status: 404 });
    }

    console.log(`📊 [Import Transactions] Selected account: ${selectedAccount.name} (${selectedAccount.type}/${selectedAccount.subtype})`);

    // Store account info
    const accountRef = adminDb.doc(`user_profiles/${uid}/accounts/${account_id}`);
    await accountRef.set({
      id: account_id,
      name: selectedAccount.name ?? selectedAccount.official_name ?? `Account • ${selectedAccount.mask ?? ''}`,
      mask: selectedAccount.mask ?? null,
      type: selectedAccount.type,
      subtype: selectedAccount.subtype,
      createdAt: Date.now(),
      user_id: uid,
    }, { merge: true });

    // Import transactions for this specific account
    let imported = 0;
    try {
      // Calculate date range based on timeframe - use same robust calculation
      const endDate = new Date();
      endDate.setHours(23, 59, 59, 999); // End of today
      const startDate = new Date();

      const MAX_PLAID_DAYS = 730; // Maximum days Plaid supports (2 years)
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

      const actualDays = Math.min(daysToFetch, MAX_PLAID_DAYS);

      // Calculate start date more reliably using milliseconds
      const startDateMs = endDate.getTime() - (actualDays * 24 * 60 * 60 * 1000);
      startDate.setTime(startDateMs);
      startDate.setHours(0, 0, 0, 0); // Start of the day

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      const actualDateRange = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

      console.log(`📅 [Import Transactions] Transaction import configuration:`);
      console.log(`   📆 Date range: ${startDateStr} to ${endDateStr}`);
      console.log(`   📊 Requested timeframe: ${import_timeframe} (${daysToFetch} days)`);
      console.log(`   ✅ Calculated: ${actualDays} days (${actualDays === MAX_PLAID_DAYS ? 'MAXIMUM AVAILABLE' : 'within limit'})`);
      console.log(`   🔍 Actual date range: ${actualDateRange} days`);
      console.log(`   📅 Start date: ${startDate.toLocaleDateString()} (${startDateStr})`);
      console.log(`   📅 End date: ${endDate.toLocaleDateString()} (${endDateStr})`);
      console.log(`   ⚠️ NOTE: Plaid may only return transactions available from the bank.`);
      console.log(`   ⚠️ NOTE: Sandbox environment may have limited test data (typically 30-40 days).`);

      // Get all transactions for the specific account with pagination
      const { transactions: allTransactions, totalPages, totalTransactions, plaidTotalTransactions } = await fetchAllPlaidTransactions(
        plaidClient,
        {
          access_token,
          start_date: startDateStr,
          end_date: endDateStr,
          account_ids: [account_id], // Only get transactions for this specific account
          options: {
            include_personal_finance_category: true,
            include_logo_and_counterparty_beta: true,
          },
        },
        '[Import Transactions]'
      );

      console.log(`📊 [Import Transactions] Fetched ${totalTransactions} transactions from Plaid for account: ${selectedAccount.name} across ${totalPages} page(s)`);
      if (plaidTotalTransactions !== undefined) {
        console.log(`📊 [Import Transactions] Plaid reported ${plaidTotalTransactions} total transactions available`);
      }

      // Log the date range of fetched transactions for debugging
      if (allTransactions.length > 0) {
        const transactionDates = allTransactions.map(tx => tx.date).sort();
        const earliestTx = transactionDates[0];
        const latestTx = transactionDates[transactionDates.length - 1];
        console.log(`📊 [Import Transactions] Transaction date range in results: ${earliestTx} to ${latestTx}`);
        console.log(`📊 [Import Transactions] Requested date range: ${startDateStr} to ${endDateStr}`);

        if (earliestTx > startDateStr) {
          console.warn(`⚠️ [Import Transactions] WARNING: Earliest transaction (${earliestTx}) is after requested start date (${startDateStr})`);
          console.warn(`⚠️ [Import Transactions] Difference: ${Math.ceil((new Date(earliestTx).getTime() - new Date(startDateStr).getTime()) / (1000 * 60 * 60 * 24))} days`);
          console.warn(`⚠️ [Import Transactions] Possible reasons:`);
          console.warn(`   - Account was connected on or after ${earliestTx}`);
          console.warn(`   - Bank/Plaid has limited historical data available`);
          console.warn(`   - Using Plaid Sandbox (typically limited to 30-40 days of test data)`);
        }
      } else {
        console.warn(`⚠️ [Import Transactions] No transactions found in date range ${startDateStr} to ${endDateStr}`);
      }

      if (allTransactions.length === 0) {
        console.warn(`⚠️ [Import Transactions] No transactions found for account ${selectedAccount.name} (${selectedAccount.type}/${selectedAccount.subtype})`);
        return NextResponse.json({
          error: 'No transactions found for the selected account. This account may not have any recent transaction activity.',
          details: `Account: ${selectedAccount.name} (${selectedAccount.type}/${selectedAccount.subtype})`,
          debug: {
            accountId: account_id,
            accountName: selectedAccount.name,
            accountType: selectedAccount.type,
            accountSubtype: selectedAccount.subtype,
            dateRange: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`
          }
        }, { status: 400 });
      }

      // Log sample transaction to see what Plaid returns
      console.log(`📊 [Import Transactions] Sample transaction from Plaid:`, JSON.stringify(allTransactions[0], null, 2));

      const transactions = allTransactions;
      for (const tx of transactions) {
        const txId = tx.transaction_id;

        // Check if transaction already exists before importing
        const txRef = adminDb.doc(
          `user_profiles/${uid}/accounts/${account_id}/transactions/${txId}`
        );
        const existingTx = await txRef.get();

        if (existingTx.exists) {
          console.log(`🔄 [Import Transactions] Transaction ${txId} already exists, skipping import`);
          continue; // Skip this transaction
        }

        const transactionData = {
          analysis_status: 'pending',
          analysisStatus: 'pending', // Add camelCase version for consistency
          user_id: uid,        // Snake case for security rules
          userId: uid,         // Camel case for queries
          account_id: account_id,
          accountId: account_id, // Add camelCase version
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

        console.log(`📊 [Import Transactions] Setting transaction ${txId} with analysis_status: 'pending' and analyzed: false`);

        await txRef.set(transactionData);

        if (imported < 3) {
          console.log(`✅ [Import Transactions] Wrote transaction ${txId} to Firebase`);
          console.log(`📊 [Import Transactions] Document path: user_profiles/${uid}/accounts/${account_id}/transactions/${txId}`);
          console.log(`📊 [Import Transactions] Transaction data:`, JSON.stringify(transactionData, null, 2));
        }

        imported++;
      }
    } catch (txError: any) {
      console.error('❌ [Import Transactions] Transaction import failed:', txError);
      console.error('❌ [Import Transactions] Error name:', txError.name);
      console.error('❌ [Import Transactions] Error message:', txError.message);
      console.error('❌ [Import Transactions] Error code:', txError.code);
      console.error('❌ [Import Transactions] Error response:', txError.response?.data);
      console.error('❌ [Import Transactions] Full error:', JSON.stringify(txError, Object.getOwnPropertyNames(txError), 2));
      // Continue even if transaction import fails
    }

    // Verify transactions were written and check their analysis status
    const verifySnap = await adminDb
      .collection(`user_profiles/${uid}/accounts/${account_id}/transactions`)
      .get();

    console.log(`✅ [Import Transactions] Verified ${verifySnap.size} transactions written to Firestore`);
    console.log(`📊 [Import Transactions] Import summary: ${imported} new transactions, ${verifySnap.size} total in database`);

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

    console.log(`📊 [Import Transactions] Analysis status check: ${pendingCount} pending transactions out of ${verifySnap.size} total`);
    console.log(`📊 [Import Transactions] Sample transactions:`, sampleTxs);

    return NextResponse.json({
      ok: true,
      accountId: account_id,
      accountName: selectedAccount.name,
      accountType: selectedAccount.type,
      accountSubtype: selectedAccount.subtype,
      imported: verifySnap.size, // Return actual count
      pendingTransactions: pendingCount,
      timeframe: import_timeframe,
      sampleTransactions: sampleTxs
    });

  } catch (err: any) {
    console.error('❌ [Import Transactions] Import failed:', err);
    const message = err?.message || 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

