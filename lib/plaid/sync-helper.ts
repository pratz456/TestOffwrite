import { getTransactionHistoryWindow, isWithinHistoryWindow } from '@/lib/subscriptions/history-window';
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { getUserProfileServer, upsertUserProfileServer } from '../firebase/profiles-server';
import {
  createTransactionServer,
  deleteTransactionByUserIdAndTransId,
} from '../firebase/transactions-server';
import { adminDb } from '../firebase/admin';
import { fetchAllPlaidTransactions } from './pagination';
import { debugPlaid } from './debug';
import { updateImportedTransactionForAnalysis } from '@/lib/ai/analysis-jobs';

import { getPlaidConfig } from './config';

const { plaidClientId, plaidSecret, plaidEnv } = getPlaidConfig();

const configuration = new Configuration({
  basePath: PlaidEnvironments[plaidEnv as keyof typeof PlaidEnvironments] || PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': plaidClientId || '',
      'PLAID-SECRET': plaidSecret || '',
    },
  },
});

const client = new PlaidApi(configuration);

export interface SyncResult {
  success: boolean;
  transactionsSaved: number;
  autoClassified?: number;
  error?: string;
}

/**
 * Check if a transaction is a likely duplicate by (merchant, amount, date).
 * Used as secondary dedup when Plaid transaction IDs change (pending -> settled).
 */
async function isDuplicateByContent(
  userId: string,
  accountId: string,
  merchantName: string,
  amount: number,
  date: string
): Promise<boolean> {
  try {
    const snapshot = await adminDb
      .collection('user_profiles')
      .doc(userId)
      .collection('accounts')
      .doc(accountId)
      .collection('transactions')
      .where('merchant_name', '==', merchantName)
      .where('amount', '==', amount)
      .where('date', '==', date)
      .limit(1)
      .get();
    return !snapshot.empty;
  } catch {
    return false; // If query fails, don't block the import
  }
}

/**
 * Incremental sync using Plaid Transactions Sync API (cursor-based).
 * Fetches only new/updated/removed transactions since last cursor; persists cursor after full pagination.
 */
export async function syncUserTransactionsIncremental(userId: string): Promise<SyncResult> {
  try {
    console.log(`🔄 [Sync Helper] Starting incremental transaction sync for user ${userId}...`);

    const { data: userProfile, error: profileError } = await getUserProfileServer(userId);
    if (profileError || !userProfile?.plaid_token) {
      console.error('❌ [Sync Helper] No Plaid token found for user:', userId);
      return { success: false, transactionsSaved: 0, error: 'No Plaid token found for user' };
    }

    const cursor = userProfile.plaid_transactions_cursor || undefined;
    if (process.env.DEBUG_PLAID === 'true') {
      try {
        const itemRes = await client.itemGet({ access_token: userProfile.plaid_token });
        const item = itemRes.data.item;
        debugPlaid('[Sync Helper] Item status before sync', {
          item_id: item.item_id,
          institution_id: item.institution_id ?? null,
          status: (item as any).status,
          error: item.error ?? null,
        });
      } catch (itemErr: any) {
        debugPlaid('[Sync Helper] Failed to get item status', { error: itemErr?.message });
      }
    }
    const allAdded: any[] = [];
    const allModified: any[] = [];
    const allRemoved: { transaction_id: string; account_id: string }[] = [];
    let nextCursor = cursor;
    let hasMore = true;

    while (hasMore) {
      const response = await client.transactionsSync({
        access_token: userProfile.plaid_token,
        cursor: nextCursor,
        options: {
          include_personal_finance_category: true,
          include_logo_and_counterparty_beta: true,
        },
      });
      const data = response.data;
      allAdded.push(...(data.added || []));
      allModified.push(...(data.modified || []));
      allRemoved.push(...(data.removed || []).map((r: { transaction_id: string; account_id: string }) => ({ transaction_id: r.transaction_id, account_id: r.account_id })));
      nextCursor = data.next_cursor ?? '';
      hasMore = data.has_more === true;
    }

    // Filter out pending transactions (they'll be picked up when settled)
    const historyWindow = await getTransactionHistoryWindow(userId);
    const settledAdded = allAdded.filter(tx => !tx.pending && isWithinHistoryWindow(tx.date, historyWindow));
    const skippedPending = allAdded.length - settledAdded.length;
    if (skippedPending > 0) {
      console.log(`⏳ [Sync Helper] Skipped ${skippedPending} pending transactions`);
    }

    let transactionsSaved = 0;

    const CONCURRENT_BATCH = 20;
    for (let i = 0; i < settledAdded.length; i += CONCURRENT_BATCH) {
      const chunk = settledAdded.slice(i, i + CONCURRENT_BATCH);
      const results = await Promise.all(chunk.map(async (tx) => {
        const category = tx.personal_finance_category?.detailed || tx.category?.[0] || 'Other';
        const merchantName = tx.merchant_name || tx.name;

        const contentDup = await isDuplicateByContent(userId, tx.account_id, merchantName, tx.amount, tx.date);
        if (contentDup) {
          return null;
        }

        const { data: saved } = await createTransactionServer(userId, tx.account_id, {
          trans_id: tx.transaction_id,
          date: tx.date,
          amount: tx.amount,
          merchant_name: merchantName,
          category,
          description: tx.name,
          is_deductible: null,
          analyzed: false,
          analysis_status: 'pending',
          analysisStatus: 'pending',
          authorized_date: tx.authorized_date || undefined,
          datetime: tx.datetime || undefined,
          payment_channel: tx.payment_channel || undefined,
          merchant_category_code: tx.category_id || undefined,
          iso_currency_code: tx.iso_currency_code || undefined,
          location: tx.location ? {
            address: tx.location.address || undefined,
            city: tx.location.city || undefined,
            state: tx.location.region || undefined,
            lat: tx.location.lat || undefined,
            lon: tx.location.lon || undefined,
          } : undefined,
          personal_finance_category: tx.personal_finance_category ? {
            primary: tx.personal_finance_category.primary || undefined,
            detailed: tx.personal_finance_category.detailed || undefined,
            confidence: tx.personal_finance_category.confidence_level || undefined,
          } : undefined,
          counterparties: (tx as any).counterparties || undefined,
          logo_url: (tx as any).logo_url || undefined,
          merchant_entity_id: (tx as any).merchant_entity_id || undefined,
        });
        return saved ? { tx, merchantName, category, saved } : null;
      }));

      for (const result of results) {
        if (result) {
          transactionsSaved++;
        }
      }
    }

    for (const tx of allModified) {
      const category = tx.personal_finance_category?.detailed || tx.category?.[0] || 'Other';
      await updateImportedTransactionForAnalysis({ userId, accountId: tx.account_id, transactionId: tx.transaction_id }, {
        date: tx.date,
        amount: tx.amount,
        merchant_name: tx.merchant_name || tx.name,
        category,
        description: tx.name,
        iso_currency_code: tx.iso_currency_code,
        unofficial_currency_code: tx.unofficial_currency_code,
        pending: tx.pending,
      });
    }
    for (const r of allRemoved) {
      await deleteTransactionByUserIdAndTransId(userId, r.transaction_id);
    }

    // Firestore bank-transaction events enqueue durable AI work after each saved record.

    await upsertUserProfileServer(userId, {
      plaid_transactions_cursor: nextCursor || undefined,
      last_sync: Date.now(),
      last_sync_source: 'incremental',
    } as any);

    console.log(`🎉 [Sync Helper] Incremental sync completed. Added: ${transactionsSaved}, modified: ${allModified.length}, removed: ${allRemoved.length}`);
    return { success: true, transactionsSaved };
  } catch (error) {
    console.error(`❌ [Sync Helper] Incremental sync error for user ${userId}:`, error);
    return {
      success: false,
      transactionsSaved: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Syncs transactions for a user from Plaid to Firebase.
 * importTimeframe is display-only; the server plan controls the allowed history window.
 * @param userId - The user's Firebase UID
 * @param importTimeframe - Logged/stored for display only ('1month', '6months', '2years', etc.)
 * @returns Promise<SyncResult>
 */
export async function syncUserTransactions(
  userId: string,
  importTimeframe: string = '1year'
): Promise<SyncResult> {
  try {
    console.log(`🔄 [Sync Helper] Starting transaction sync for user ${userId}...`);

    // Get user's Plaid access token from Firebase
    const { data: userProfile, error: profileError } = await getUserProfileServer(userId);

    if (profileError || !userProfile?.plaid_token) {
      console.error('❌ [Sync Helper] No Plaid token found for user:', userId);
      return {
        success: false,
        transactionsSaved: 0,
        error: 'No Plaid token found for user'
      };
    }

    // New history import follows the current server-verified plan.
    const historyWindow = await getTransactionHistoryWindow(userId);
    const daysToFetch = historyWindow.days;
    const actualDays = daysToFetch;

    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999); // End of today
    const startDate = new Date();

    // Calculate start date more reliably using milliseconds
    const startDateMs = endDate.getTime() - (actualDays * 24 * 60 * 60 * 1000);
    startDate.setTime(startDateMs);
    startDate.setHours(0, 0, 0, 0); // Start of the day

    const startDateStr = historyWindow.startDate;
    const endDateStr = endDate.toISOString().split('T')[0];
    const actualDateRange = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    console.log(`📅 [Sync Helper] Transaction sync configuration:`);
    console.log(`   📆 Date range: ${startDateStr} to ${endDateStr}`);
    console.log(`   📊 Timeframe: ${daysToFetch} days (current plan)`);
    console.log(`   ✅ Calculated: ${actualDays} days (MAXIMUM AVAILABLE)`);
    console.log(`   🔍 Actual date range: ${actualDateRange} days`);
    console.log(`   📅 Start date: ${startDate.toLocaleDateString()} (${startDateStr})`);
    console.log(`   📅 End date: ${endDate.toLocaleDateString()} (${endDateStr})`);
    console.log(`   ⚠️ NOTE: Plaid may only return transactions available from the bank.`);
    if (process.env.PLAID_ENV === 'sandbox') {
      console.log(`   ⚠️ NOTE: Sandbox environment may have limited test data (typically 30-40 days).`);
    }

    // Fetch all transactions from Plaid with pagination
    const { transactions, totalPages, totalTransactions, plaidTotalTransactions, earliestTxDate, latestTxDate } = await fetchAllPlaidTransactions(
      client,
      {
        access_token: userProfile.plaid_token,
        start_date: startDateStr,
        end_date: endDateStr,
        options: {
          include_personal_finance_category: true,
          include_logo_and_counterparty_beta: true,
        },
      },
      '[Sync Helper]'
    );

    console.log(`[Sync Helper] Plaid ingestion: linkTokenDaysRequested=N/A, daysToFetch=${daysToFetch}, start_date=${startDateStr}, end_date=${endDateStr}, earliestReturned=${earliestTxDate ?? 'N/A'}, latestReturned=${latestTxDate ?? 'N/A'}`);
    console.log(`📊 [Sync Helper] Fetched ${totalTransactions} transactions from Plaid`);
    if (plaidTotalTransactions !== undefined) {
      console.log(`📊 [Sync Helper] Plaid reported ${plaidTotalTransactions} total transactions available`);
      if (totalTransactions < plaidTotalTransactions) {
        console.warn(`⚠️ [Sync Helper] WARNING: Fetched ${totalTransactions} but Plaid reported ${plaidTotalTransactions} available. Some transactions may be missing.`);
      }
    }

    // Log the date range of fetched transactions for debugging
    if (transactions.length > 0) {
      const transactionDates = transactions.map(tx => tx.date).sort();
      const earliestTx = transactionDates[0];
      const latestTx = transactionDates[transactionDates.length - 1];
      console.log(`📊 [Sync Helper] Transaction date range in results: ${earliestTx} to ${latestTx}`);
      console.log(`📊 [Sync Helper] Requested date range: ${startDateStr} to ${endDateStr}`);

      if (earliestTx > startDateStr) {
        console.warn(`⚠️ [Sync Helper] WARNING: Earliest transaction (${earliestTx}) is after requested start date (${startDateStr})`);
        console.warn(`⚠️ [Sync Helper] This suggests Plaid/bank does not have transactions before ${earliestTx}`);
        console.warn(`⚠️ [Sync Helper] Possible reasons: Account connected on ${earliestTx}, or bank/Plaid has limited historical data`);
      }
    }

    console.log(`📊 [Sync Helper] Fetched ${totalTransactions} transactions from Plaid across ${totalPages} page(s)`);

    // Filter out pending transactions (they'll be picked up when settled)
    const settledTransactions = transactions.filter(tx => !tx.pending && isWithinHistoryWindow(tx.date, historyWindow));
    const skippedPending = transactions.length - settledTransactions.length;
    if (skippedPending > 0) {
      console.log(`⏳ [Sync Helper] Skipped ${skippedPending} pending transactions`);
    }

    let transactionsSaved = 0;

    // Process settled transactions
    if (settledTransactions.length > 0) {
      for (const transaction of settledTransactions) {
        const category = transaction.personal_finance_category?.detailed || transaction.category?.[0] || 'Other';
        const merchantName = transaction.merchant_name || transaction.name;

        // Secondary dedup by content (catches pending->settled ID changes)
        const contentDup = await isDuplicateByContent(userId, transaction.account_id, merchantName, transaction.amount, transaction.date);
        if (contentDup) {
          console.log(`🔄 [Sync Helper] Skipped content-duplicate: ${merchantName} $${transaction.amount} on ${transaction.date}`);
          continue;
        }

        const { data: savedTransaction, error: transactionError } = await createTransactionServer(
          userId,
          transaction.account_id,
          {
            trans_id: transaction.transaction_id,
            date: transaction.date,
            amount: transaction.amount,
            merchant_name: merchantName,
            category: category,
            description: transaction.name,
            is_deductible: null,
            deductible_reason: undefined,
            deduction_score: null,
            ai: null,
            analyzed: false,
            analysis_status: 'pending',
            analysisStatus: 'pending',
            authorized_date: transaction.authorized_date || undefined,
            datetime: transaction.datetime || undefined,
            payment_channel: transaction.payment_channel || undefined,
            merchant_category_code: transaction.category_id || undefined,
            iso_currency_code: transaction.iso_currency_code || undefined,
            location: transaction.location ? {
              address: transaction.location.address || undefined,
              city: transaction.location.city || undefined,
              state: transaction.location.region || undefined,
              lat: transaction.location.lat || undefined,
              lon: transaction.location.lon || undefined,
            } : undefined,
            personal_finance_category: transaction.personal_finance_category ? {
              primary: transaction.personal_finance_category.primary || undefined,
              detailed: transaction.personal_finance_category.detailed || undefined,
              confidence: transaction.personal_finance_category.confidence_level || undefined,
            } : undefined,
            counterparties: (transaction as any).counterparties || undefined,
            logo_url: (transaction as any).logo_url || undefined,
            merchant_entity_id: (transaction as any).merchant_entity_id || undefined,
          }
        );

        if (transactionError) {
          console.error(`❌ [Sync Helper] Failed to save transaction ${transaction.transaction_id}:`, transactionError);
        } else if (savedTransaction) {
          console.log(`✅ [Sync Helper] Processed transaction: ${transaction.transaction_id} - ${savedTransaction?.merchant_name}`);
          transactionsSaved++;
        } else {
          console.log(`🔄 [Sync Helper] Skipped duplicate transaction: ${transaction.transaction_id}`);
        }
      }

    // Firestore bank-transaction events enqueue durable AI work after each saved record.

      // Update the last sync time for this user
      const { error: syncError } = await upsertUserProfileServer(userId, {
        last_sync: Date.now(),
        last_import_timeframe: importTimeframe
      } as any);

      if (syncError) {
        console.error(`❌ [Sync Helper] Failed to update sync time for user ${userId}:`, syncError);
      } else {
        console.log(`✅ [Sync Helper] Updated sync time for user ${userId}`);
      }
    } else {
      console.log(`📭 [Sync Helper] No new transactions for user ${userId}`);
    }

    console.log(`🎉 [Sync Helper] Transaction sync completed! Saved ${transactionsSaved} transactions`);

    return {
      success: true,
      transactionsSaved,
    };

  } catch (error) {
    console.error(`❌ [Sync Helper] Error syncing transactions for user ${userId}:`, error);
    return {
      success: false,
      transactionsSaved: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Find user by Plaid item ID for webhook processing
 * @param plaidItemId - The Plaid item ID from webhook
 * @returns Promise<string | null> - User ID if found, null otherwise
 */
export async function findUserByPlaidItemId(plaidItemId: string): Promise<string | null> {
  try {
    console.log(`🔍 [Sync Helper] Looking for user with Plaid item ID: ${plaidItemId}`);

    // Query user_profiles collection to find user with matching plaid_item_id
    const userProfilesSnapshot = await adminDb
      .collection('user_profiles')
      .where('plaid_item_id', '==', plaidItemId)
      .limit(1)
      .get();

    if (userProfilesSnapshot.empty) {
      console.log(`❌ [Sync Helper] No user found with Plaid item ID: ${plaidItemId}`);
      return null;
    }

    const userDoc = userProfilesSnapshot.docs[0];
    const userId = userDoc.id;

    console.log(`✅ [Sync Helper] Found user ${userId} for Plaid item ${plaidItemId}`);
    return userId;
  } catch (error) {
    console.error('❌ [Sync Helper] Error finding user by Plaid item ID:', error);
    return null;
  }
}
