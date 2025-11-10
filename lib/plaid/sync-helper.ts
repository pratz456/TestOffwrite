import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { getUserProfileServer, upsertUserProfileServer } from '../firebase/profiles-server';
import { createTransactionServer } from '../firebase/transactions-server';
import { adminDb } from '../firebase/admin';
import { fetchAllPlaidTransactions } from './pagination';

// Helper function to get Plaid config from both environment variables and functions.config()
function getPlaidConfig() {
  // Try to read from functions.config() first (for Firebase Functions)
  let plaidClientId: string | undefined;
  let plaidSecret: string | undefined;
  let plaidEnv: string | undefined;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const functions = require('firebase-functions');
    const config = functions.config();
    if (config.plaid) {
      plaidClientId = config.plaid.client_id || config.plaid.clientId;
      plaidSecret = config.plaid.secret;
      plaidEnv = config.plaid.env;
    }
  } catch (e) {
    // functions.config() not available, continue to process.env
  }

  // Fall back to process.env (for Next.js/local dev)
  plaidClientId = plaidClientId || process.env.PLAID_CLIENT_ID;
  plaidSecret = plaidSecret || process.env.PLAID_SECRET;
  plaidEnv = plaidEnv || process.env.PLAID_ENV || 'sandbox';

  return { plaidClientId, plaidSecret, plaidEnv };
}

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
  error?: string;
}

/**
 * Syncs transactions for a user from Plaid to Firebase
 * @param userId - The user's Firebase UID
 * @param importTimeframe - How far back to sync transactions ('1month', '6months', '1year')
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

    // Calculate date range based on timeframe
    // Use the same robust date calculation as exchange-public-token
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999); // End of today
    const startDate = new Date();

    const MAX_PLAID_DAYS = 730; // Maximum days Plaid supports (2 years)
    let daysToFetch = 365; // Default to 1 year

    switch (importTimeframe) {
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

    console.log(`📅 [Sync Helper] Transaction sync configuration:`);
    console.log(`   📆 Date range: ${startDateStr} to ${endDateStr}`);
    console.log(`   📊 Requested timeframe: ${importTimeframe} (${daysToFetch} days)`);
    console.log(`   ✅ Calculated: ${actualDays} days (${actualDays === MAX_PLAID_DAYS ? 'MAXIMUM AVAILABLE' : 'within limit'})`);
    console.log(`   🔍 Actual date range: ${actualDateRange} days`);
    console.log(`   📅 Start date: ${startDate.toLocaleDateString()} (${startDateStr})`);
    console.log(`   📅 End date: ${endDate.toLocaleDateString()} (${endDateStr})`);
    console.log(`   ⚠️ NOTE: Plaid may only return transactions available from the bank.`);
    console.log(`   ⚠️ NOTE: Sandbox environment may have limited test data (typically 30-40 days).`);

    // Fetch all transactions from Plaid with pagination
    const { transactions, totalPages, totalTransactions, plaidTotalTransactions } = await fetchAllPlaidTransactions(
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

    let transactionsSaved = 0;

    // Process all transactions
    if (transactions.length > 0) {
      for (const transaction of transactions) {
        const category = transaction.personal_finance_category?.detailed || transaction.category?.[0] || 'Other';

        console.log(`📝 [Sync Helper] Processing transaction: ${transaction.merchant_name || transaction.name} - ${category}`);

        const { data: savedTransaction, error: transactionError } = await createTransactionServer(
          userId,
          transaction.account_id,
          {
            trans_id: transaction.transaction_id,
            date: transaction.date,
            amount: transaction.amount,
            merchant_name: transaction.merchant_name || transaction.name,
            category: category,
            description: transaction.name,
            is_deductible: null, // Will be updated by AI analysis
            deductible_reason: undefined,
            deduction_score: null,
            ai: null,
            analyzed: false,
            analysis_status: 'pending',
            analysisStatus: 'pending', // Add camelCase version for consistency
          }
        );

        if (transactionError) {
          console.error(`❌ [Sync Helper] Failed to save transaction ${transaction.transaction_id}:`, transactionError);
        } else if (savedTransaction) {
          // Only count as saved if it was actually created (not skipped due to duplicate)
          console.log(`✅ [Sync Helper] Processed transaction: ${transaction.transaction_id} - ${savedTransaction?.merchant_name}`);
          transactionsSaved++;
        } else {
          console.log(`🔄 [Sync Helper] Skipped duplicate transaction: ${transaction.transaction_id}`);
        }
      }

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
