export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid/client';
import { adminDb } from '@/lib/firebase/admin';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { fetchAllPlaidTransactions } from '@/lib/plaid/pagination';

export async function POST(req: Request) {
  try {
    const { uid } = await getUserFromReqOrThrow(req);
    const { account_id, import_timeframe = '1year', access_token } = await req.json();

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

      console.log(`📅 [Import Transactions] Importing transactions from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

      // Get all transactions for the specific account with pagination
      const { transactions: allTransactions, totalPages, totalTransactions } = await fetchAllPlaidTransactions(
        plaidClient,
        {
          access_token,
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
          account_ids: [account_id], // Only get transactions for this specific account
          options: {
            include_personal_finance_category: true,
            include_logo_and_counterparty_beta: true,
          },
        },
        '[Import Transactions]'
      );

      console.log(`📊 [Import Transactions] Fetched ${totalTransactions} transactions from Plaid for account: ${selectedAccount.name} across ${totalPages} page(s)`);

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

