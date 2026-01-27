import { PlaidApi, TransactionsGetRequest } from 'plaid';

/**
 * Fetches all transactions from Plaid with automatic pagination handling.
 * This function will continue fetching pages until all transactions are retrieved.
 * Uses cursor-based pagination and continues until next_cursor is null/undefined.
 *
 * @param plaidClient - The Plaid API client instance
 * @param request - The base TransactionsGetRequest (without cursor)
 * @param logPrefix - Optional prefix for log messages (e.g., "[Sync Helper]")
 * @returns Promise with all transactions and metadata
 */
export async function fetchAllPlaidTransactions(
  plaidClient: PlaidApi,
  request: Omit<TransactionsGetRequest, 'options'> & {
    options?: Omit<TransactionsGetRequest['options'], 'cursor'>
  },
  logPrefix: string = '[Plaid]'
): Promise<{
  transactions: any[];
  totalPages: number;
  totalTransactions: number;
  plaidTotalTransactions?: number; // Total transactions available from Plaid
}> {
  let allTransactions: any[] = [];
  let nextCursor: string | undefined = undefined;
  let pageCount = 0;
  let plaidTotalTransactions: number | undefined = undefined;
  const maxPages = 500; // Increased safety limit (Plaid can return many pages for 2 years of data)

  console.log(`${logPrefix} 🚀 Starting transaction fetch with pagination...`);
  console.log(`${logPrefix} 📅 Date range: ${request.start_date} to ${request.end_date}`);

  // Calculate and log the actual date range for debugging
  const startDate = new Date(request.start_date);
  const endDate = new Date(request.end_date);
  const dateRangeDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  console.log(`${logPrefix} 📊 Requesting ${dateRangeDays} days of transaction history`);
  console.log(`${logPrefix} 📅 Start: ${startDate.toLocaleDateString()} (${request.start_date})`);
  console.log(`${logPrefix} 📅 End: ${endDate.toLocaleDateString()} (${request.end_date})`);

  // Log a warning if the date range seems limited
  if (dateRangeDays < 30) {
    console.warn(`${logPrefix} ⚠️ WARNING: Date range is less than 30 days (${dateRangeDays} days). This may limit transaction history.`);
  }

  do {
    pageCount++;

    if (pageCount > maxPages) {
      console.warn(
        `${logPrefix} ⚠️ Reached maximum page limit (${maxPages}), stopping pagination. ` +
        `Fetched ${allTransactions.length} transactions so far.`
      );
      break;
    }

    console.log(`${logPrefix} 📄 Fetching transaction page ${pageCount}${nextCursor ? ` (cursor: ${nextCursor.substring(0, 20)}...)` : ' (initial request)'}...`);

    try {
      const transactionsResponse = await plaidClient.transactionsGet({
        ...request,
        options: {
          ...request.options,
          count: 500, // Request up to 500 transactions per page (max allowed by Plaid)
          cursor: nextCursor, // undefined on first request, then uses the cursor from previous response
        },
      });

      const responseData = transactionsResponse.data;
      const transactions = responseData.transactions || [];

      // Capture total_transactions from Plaid if available (first page only typically has this)
      if (responseData.total_transactions !== undefined && plaidTotalTransactions === undefined) {
        plaidTotalTransactions = responseData.total_transactions;
        console.log(`${logPrefix} 📊 Plaid reports ${plaidTotalTransactions} total transactions available for this date range`);
      }

      allTransactions = allTransactions.concat(transactions);
      nextCursor = responseData.next_cursor || undefined;

      // Debug logging for cursor issue
      console.log(`${logPrefix} 🔍 DEBUG: next_cursor value:`, nextCursor === null ? 'null' : nextCursor === undefined ? 'undefined' : `"${nextCursor.substring(0, 50)}..."`);
      console.log(`${logPrefix} 🔍 DEBUG: responseData keys:`, Object.keys(responseData));
      
      // If we have fewer transactions than reported, log full response structure for debugging
      if (plaidTotalTransactions !== undefined && allTransactions.length < plaidTotalTransactions && !nextCursor) {
        console.error(`${logPrefix} 🐛 BUG DETECTED: Plaid reported ${plaidTotalTransactions} transactions but only ${allTransactions.length} fetched and next_cursor is ${nextCursor === null ? 'null' : 'undefined'}`);
        console.error(`${logPrefix} 🐛 Full response structure:`, JSON.stringify({
          total_transactions: responseData.total_transactions,
          transactions_count: responseData.transactions?.length,
          next_cursor: responseData.next_cursor,
          has_more: responseData.has_more,
          request_id: responseData.request_id,
        }, null, 2));
      }

      console.log(
        `${logPrefix} 📊 Page ${pageCount}: Fetched ${transactions.length} transactions ` +
        `(cumulative: ${allTransactions.length}${plaidTotalTransactions ? ` / ${plaidTotalTransactions} available` : ''})`
      );

      // Check if there are more transactions to fetch
      if (nextCursor) {
        console.log(`${logPrefix} 🔄 More transactions available (has next_cursor), fetching next page...`);
      } else {
        console.log(`${logPrefix} ✅ Pagination complete - no more transactions (next_cursor is null/undefined)`);
        console.log(
          `${logPrefix} 📊 FINAL SUMMARY: Fetched ${allTransactions.length} total transactions across ${pageCount} page(s)`
        );

        // Log if we fetched less than Plaid reported (shouldn't happen, but good to check)
        if (plaidTotalTransactions !== undefined && allTransactions.length !== plaidTotalTransactions) {
          console.warn(
            `${logPrefix} ⚠️ WARNING: Fetched ${allTransactions.length} transactions but Plaid reported ` +
            `${plaidTotalTransactions} total. This may indicate some transactions were filtered or pagination stopped early.`
          );
        } else if (plaidTotalTransactions !== undefined) {
          console.log(
            `${logPrefix} ✅ SUCCESS: Fetched all ${plaidTotalTransactions} transactions reported by Plaid`
          );
        }

        // Log the actual date range of transactions fetched
        if (allTransactions.length > 0) {
          const transactionDates = allTransactions.map(tx => tx.date || tx.authorized_date || '').filter(d => d).sort();
          if (transactionDates.length > 0) {
            const earliestTxDate = transactionDates[0];
            const latestTxDate = transactionDates[transactionDates.length - 1];
            const fetchedDateRange = Math.ceil((new Date(latestTxDate).getTime() - new Date(earliestTxDate).getTime()) / (1000 * 60 * 60 * 24));

            console.log(`${logPrefix} 📅 ACTUAL TRANSACTION DATE RANGE:`);
            console.log(`   📆 Earliest transaction: ${earliestTxDate}`);
            console.log(`   📆 Latest transaction: ${latestTxDate}`);
            console.log(`   📊 Actual date range: ${fetchedDateRange} days`);
            console.log(`   📊 Requested date range: ${dateRangeDays} days`);

            if (earliestTxDate > request.start_date) {
              const daysMissing = Math.ceil((new Date(earliestTxDate).getTime() - new Date(request.start_date).getTime()) / (1000 * 60 * 60 * 24));
              console.warn(`${logPrefix} ⚠️ IMPORTANT: Earliest transaction (${earliestTxDate}) is ${daysMissing} days AFTER requested start date (${request.start_date})`);
              console.warn(`${logPrefix} ⚠️ This means Plaid does not have transactions before ${earliestTxDate}`);
              console.warn(`${logPrefix} ⚠️ Possible reasons:`);
              console.warn(`${logPrefix}   1. Using Plaid Sandbox (typically only has 30-40 days of test data)`);
              console.warn(`${logPrefix}   2. Account was connected on ${earliestTxDate} (Plaid starts tracking from connection date)`);
              console.warn(`${logPrefix}   3. Bank only provides recent transaction history through Plaid API`);
              console.warn(`${logPrefix}   4. Bank has limited historical data available`);
            }

            if (fetchedDateRange < 30) {
              console.warn(`${logPrefix} ⚠️ WARNING: Only ${fetchedDateRange} days of transactions available. This is typical for Plaid Sandbox.`);
            }
          }
        }

        break; // Exit loop when no more cursor
      }
    } catch (error: any) {
      console.error(`${logPrefix} ❌ Error fetching page ${pageCount}:`, error.message);
      console.error(`${logPrefix} ❌ Error details:`, {
        error_code: error.response?.data?.error_code,
        error_message: error.response?.data?.error_message,
        error_type: error.response?.data?.error_type,
      });

      // If it's a PRODUCT_NOT_READY error, we might want to retry, but for now throw
      if (error.response?.data?.error_code === 'PRODUCT_NOT_READY') {
        console.warn(`${logPrefix} ⏳ PRODUCT_NOT_READY error - transactions may still be processing. Consider retrying.`);
      }

      throw error; // Re-throw to let caller handle it
    }
  } while (nextCursor); // Continue while we have a cursor

  // Final summary log
  console.log(
    `${logPrefix} 🎉 Transaction fetch completed: ${allTransactions.length} transactions across ${pageCount} page(s)`
  );

  return {
    transactions: allTransactions,
    totalPages: pageCount,
    totalTransactions: allTransactions.length,
    plaidTotalTransactions, // Include Plaid's reported total for comparison
  };
}
