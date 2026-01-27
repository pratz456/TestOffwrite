import { NextRequest, NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { getAccountsServer } from '@/lib/firebase/accounts-server';
import { adminDb } from '@/lib/firebase/admin';
import { deleteSubcollection, deleteQueryBatch } from '@/lib/firebase/delete-helpers';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { plaidClient } from '@/lib/plaid/client';
import { fetchAllPlaidTransactions } from '@/lib/plaid/pagination';
import { createTransactionServer } from '@/lib/firebase/transactions-server';

/**
 * POST /api/plaid/reset-transactions
 * Deletes all transactions for the user and re-fetches maximum (730 days / 2 years) from Plaid
 * ONLY AVAILABLE IN TESTING - Requires ENABLE_TRANSACTION_RESET=true
 */
export async function POST(req: Request) {
  try {
    // Check if transaction reset is enabled (testing only)
    if (process.env.ENABLE_TRANSACTION_RESET !== 'true') {
      console.warn('⚠️ [Reset Transactions] Endpoint disabled - ENABLE_TRANSACTION_RESET not set to true');
      return NextResponse.json({ 
        error: 'Transaction reset is only available in testing mode',
        message: 'This endpoint is disabled in production. Set ENABLE_TRANSACTION_RESET=true to enable.'
      }, { status: 403 });
    }

    console.log('🗑️ [Reset Transactions] Starting transaction reset...');

    // Get the authenticated user
    const { uid } = await getUserFromReqOrThrow(req);
    console.log('✅ [Reset Transactions] User authenticated:', uid);

    // Get userId from request body (optional - defaults to authenticated user)
    const { userId } = await req.json();
    const targetUserId = userId || uid;

    // Verify the authenticated user matches the requested userId (if provided)
    if (userId && uid !== userId) {
      console.error('❌ [Reset Transactions] User ID mismatch:', { uid, userId });
      return NextResponse.json({ error: 'Unauthorized access to user data' }, { status: 403 });
    }

    console.log(`🔄 [Reset Transactions] Resetting transactions for user ${targetUserId}`);

    let totalDeleted = 0;

    // Step 1: Get all accounts for the user
    const { data: accounts, error: accountsError } = await getAccountsServer(targetUserId);
    if (accountsError) {
      console.error('❌ [Reset Transactions] Error getting accounts:', accountsError);
      return NextResponse.json({ 
        error: 'Failed to get accounts',
        details: accountsError 
      }, { status: 500 });
    }

    console.log(`📊 [Reset Transactions] Found ${accounts.length} accounts for user ${targetUserId}`);
    
    // Diagnostic: Log account details to help debug visibility issues
    if (accounts.length > 0) {
      console.log(`📋 [Reset Transactions] Account details:`);
      accounts.forEach((acc, idx) => {
        console.log(`   ${idx + 1}. ${acc.name || 'Unknown'} (ID: ${acc.account_id || acc.id}, Institution: ${acc.institution_id || 'N/A'})`);
      });
    } else {
      console.warn(`⚠️ [Reset Transactions] No accounts found for user ${targetUserId} - transactions may still exist in subcollections`);
    }

    // Step 2: Delete transactions from subcollections (user_profiles/{uid}/accounts/{accountId}/transactions)
    for (const account of accounts) {
      try {
        const accountRef = adminDb.collection("user_profiles").doc(targetUserId).collection("accounts").doc(account.id || account.account_id);
        const deleted = await deleteSubcollection(accountRef, 'transactions');
        totalDeleted += deleted;
        console.log(`✅ [Reset Transactions] Deleted ${deleted} transactions from account ${account.name || account.account_id}`);
      } catch (error) {
        console.warn(`⚠️ [Reset Transactions] Error deleting transactions from account ${account.account_id}:`, error);
      }
    }

    // Step 3: Delete transactions from collectionGroup (transactions subcollections across all accounts)
    try {
      let collectionGroupQuery = adminDb
        .collectionGroup('transactions')
        .where('userId', '==', targetUserId);

      let collectionGroupDeleted = 0;
      try {
        collectionGroupDeleted = await deleteQueryBatch(collectionGroupQuery, 500);
        totalDeleted += collectionGroupDeleted;
        console.log(`✅ [Reset Transactions] Deleted ${collectionGroupDeleted} transactions from collectionGroup (userId)`);
      } catch (userIdError: any) {
        // If query fails (e.g., missing index), try with user_id (snake_case)
        if (userIdError?.code === 9 || userIdError?.code === 'FAILED_PRECONDITION') {
          console.log('⚠️ [Reset Transactions] userId query failed, trying user_id...');
          collectionGroupQuery = adminDb
            .collectionGroup('transactions')
            .where('user_id', '==', targetUserId);

          collectionGroupDeleted = await deleteQueryBatch(collectionGroupQuery, 500);
          totalDeleted += collectionGroupDeleted;
          console.log(`✅ [Reset Transactions] Deleted ${collectionGroupDeleted} transactions from collectionGroup (user_id)`);
        } else {
          throw userIdError;
        }
      }
    } catch (collectionGroupError) {
      console.warn('⚠️ [Reset Transactions] Error deleting from collectionGroup:', collectionGroupError);
    }

    // Step 4: Delete transactions from top-level transactions collection
    try {
      let topLevelQuery = adminDb
        .collection('transactions')
        .where('userId', '==', targetUserId);

      let topLevelDeleted = 0;
      try {
        topLevelDeleted = await deleteQueryBatch(topLevelQuery, 500);
        totalDeleted += topLevelDeleted;
        console.log(`✅ [Reset Transactions] Deleted ${topLevelDeleted} transactions from top-level collection (userId)`);
      } catch (userIdError: any) {
        // If query fails, try with user_id (snake_case)
        if (userIdError?.code === 9 || userIdError?.code === 'FAILED_PRECONDITION') {
          console.log('⚠️ [Reset Transactions] userId query failed, trying user_id...');
          topLevelQuery = adminDb
            .collection('transactions')
            .where('user_id', '==', uid);

          topLevelDeleted = await deleteQueryBatch(topLevelQuery, 500);
          totalDeleted += topLevelDeleted;
          console.log(`✅ [Reset Transactions] Deleted ${topLevelDeleted} transactions from top-level collection (user_id)`);
        } else {
          throw userIdError;
        }
      }
    } catch (topLevelError) {
      console.warn('⚠️ [Reset Transactions] Error deleting from top-level collection:', topLevelError);
    }

    console.log(`✅ [Reset Transactions] Total transactions deleted: ${totalDeleted}`);

    // Step 5: Re-fetch maximum transactions (730 days / 2 years) from Plaid
    // In test mode, bypass subscription limits and fetch directly from Plaid with 730 days
    console.log(`🔄 [Reset Transactions] Starting sync with maximum timeframe (730 days / 2 years)...`);
    
    // Get user's Plaid token
    const { data: userProfile, error: profileError } = await getUserProfileServer(targetUserId);
    if (profileError || !userProfile?.plaid_token) {
      console.error('❌ [Reset Transactions] No Plaid token found for user:', targetUserId);
      return NextResponse.json({
        success: false,
        transactions_deleted: totalDeleted,
        error: 'No Plaid token found for user'
      }, { status: 500 });
    }

    // Calculate 730-day date range (bypassing subscription checks in test mode)
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999); // End of today
    const startDate = new Date();
    startDate.setTime(endDate.getTime() - (730 * 24 * 60 * 60 * 1000)); // 730 days ago
    startDate.setHours(0, 0, 0, 0); // Start of the day

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    console.log(`📅 [Reset Transactions] Fetching transactions from ${startDateStr} to ${endDateStr} (730 days)`);

    // Fetch all transactions directly from Plaid (bypassing subscription limits)
    const { transactions: allTransactions, totalPages, totalTransactions } = await fetchAllPlaidTransactions(
      plaidClient,
      {
        access_token: userProfile.plaid_token,
        start_date: startDateStr,
        end_date: endDateStr,
        options: {
          include_personal_finance_category: true,
          include_logo_and_counterparty_beta: true,
        },
      },
      '[Reset Transactions]'
    );

    console.log(`📊 [Reset Transactions] Fetched ${totalTransactions} transactions from Plaid across ${totalPages} page(s)`);

    // Save transactions to Firestore
    let transactionsSaved = 0;
    for (const transaction of allTransactions) {
      const category = transaction.personal_finance_category?.detailed || transaction.category?.[0] || 'Other';

      const { data: savedTransaction, error: transactionError } = await createTransactionServer(
        targetUserId,
        transaction.account_id,
        {
          trans_id: transaction.transaction_id,
          date: transaction.date,
          amount: transaction.amount,
          merchant_name: transaction.merchant_name || transaction.name,
          category: category,
          description: transaction.name,
          is_deductible: null,
          deductible_reason: undefined,
          deduction_score: null,
          ai: null,
          analyzed: false,
          analysis_status: 'pending',
          analysisStatus: 'pending',
        }
      );

      if (transactionError) {
        console.error(`❌ [Reset Transactions] Failed to save transaction ${transaction.transaction_id}:`, transactionError);
      } else if (savedTransaction) {
        transactionsSaved++;
      }
    }

    console.log(`✅ [Reset Transactions] Successfully reset and synced ${transactionsSaved} transactions for user ${targetUserId}`);
    return NextResponse.json({
      success: true,
      transactions_deleted: totalDeleted,
      transactions_saved: transactionsSaved,
      message: `Successfully deleted ${totalDeleted} transactions and synced ${transactionsSaved} new transactions (730 days maximum)`
    });

  } catch (error) {
    console.error('❌ [Reset Transactions] Error resetting transactions:', error);

    if (error instanceof Error) {
      console.error('❌ [Reset Transactions] Error details:', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
    }

    return NextResponse.json(
      {
        error: 'Failed to reset transactions. Please try again.',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
