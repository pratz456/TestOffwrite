import { PlaidApi, TransactionsGetRequest } from 'plaid';
import { debugPlaid, logPlaidRequest } from './debug';

const DEBUG_PLAID = process.env.DEBUG_PLAID === 'true';

/**
 * Fetches all transactions from Plaid with automatic pagination handling.
 * Uses OFFSET-based pagination (required by transactionsGet endpoint).
 * transactionsGet uses options.offset + options.count, NOT cursor-based pagination.
 *
 * @param plaidClient - The Plaid API client instance
 * @param request - The base TransactionsGetRequest (without pagination options)
 * @param logPrefix - Optional prefix for log messages (e.g., "[Sync Helper]")
 * @returns Promise with all transactions and metadata (including earliestTxDate, latestTxDate for diagnostics)
 */
export async function fetchAllPlaidTransactions(
  plaidClient: PlaidApi,
  request: Omit<TransactionsGetRequest, 'options'> & {
    options?: Omit<TransactionsGetRequest['options'], 'offset' | 'count'> & Record<string, any>
  },
  logPrefix: string = '[Plaid]'
): Promise<{
  transactions: any[];
  totalPages: number;
  totalTransactions: number;
  plaidTotalTransactions?: number;
  earliestTxDate?: string;
  latestTxDate?: string;
}> {
  let allTransactions: any[] = [];
  let pageCount = 0;
  let plaidTotalTransactions: number | undefined = undefined;
  const PAGE_SIZE = 500; // Max allowed by Plaid transactionsGet
  const maxPages = 500; // Safety limit
  let offset = 0;

  if (DEBUG_PLAID) {
    debugPlaid(`${logPrefix} Starting transaction fetch (transactionsGet)`, {
      start_date: request.start_date,
      end_date: request.end_date,
      options_account_ids: request.options?.account_ids,
    });
  }
  console.log(`${logPrefix} 🚀 Starting transaction fetch with offset-based pagination...`);
  console.log(`${logPrefix} 📅 Date range: ${request.start_date} to ${request.end_date}`);

  const startDate = new Date(request.start_date);
  const endDate = new Date(request.end_date);
  const dateRangeDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  console.log(`${logPrefix} 📊 Requesting ${dateRangeDays} days of transaction history`);
  if (DEBUG_PLAID) {
    console.log(`${logPrefix} 📅 Start: ${startDate.toLocaleDateString()} (${request.start_date})`);
    console.log(`${logPrefix} 📅 End: ${endDate.toLocaleDateString()} (${request.end_date})`);
  }

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

    if (DEBUG_PLAID) {
      console.log(`${logPrefix} 📄 Fetching transaction page ${pageCount} (offset: ${offset}, count: ${PAGE_SIZE})...`);
    }

    const requestPayload = {
      ...request,
      options: {
        ...request.options,
        count: PAGE_SIZE,
        offset: offset,
      } as TransactionsGetRequest['options'] & Record<string, any>,
    };
    if (DEBUG_PLAID) {
      debugPlaid(`${logPrefix} transactionsGet payload (page ${pageCount})`, {
        start_date: requestPayload.start_date,
        end_date: requestPayload.end_date,
        options: {
          count: requestPayload.options?.count,
          offset: requestPayload.options?.offset,
          account_ids: requestPayload.options?.account_ids,
        },
      });
    }
    logPlaidRequest(logPrefix, {
      endpoint: 'transactionsGet',
      start_date: request.start_date,
      end_date: request.end_date,
      options: {
        count: requestPayload.options?.count,
        offset: requestPayload.options?.offset,
        account_ids: requestPayload.options?.account_ids ?? undefined,
      },
    });
    if (DEBUG_PLAID && !requestPayload.options?.account_ids?.length) {
      debugPlaid(`${logPrefix} transactionsGet: no account_ids (fetching all accounts for item)`, {});
    }

    try {
      const transactionsResponse = await plaidClient.transactionsGet(requestPayload);

      const responseData = transactionsResponse.data;
      const transactions = responseData.transactions || [];

      // Capture total_transactions from Plaid (available on every response)
      if (responseData.total_transactions !== undefined) {
        plaidTotalTransactions = responseData.total_transactions;
        if (pageCount === 1) {
          console.log(`${logPrefix} 📊 Plaid reports ${plaidTotalTransactions} total transactions available for this date range`);
        }
      }

      allTransactions = allTransactions.concat(transactions);
      offset += transactions.length;

      if (DEBUG_PLAID) {
        console.log(
          `${logPrefix} 📊 Page ${pageCount}: Fetched ${transactions.length} transactions ` +
          `(cumulative: ${allTransactions.length}${plaidTotalTransactions ? ` / ${plaidTotalTransactions} available` : ''})`
        );
      }

      // Check if we've fetched all transactions
      const hasMore = plaidTotalTransactions !== undefined
        ? allTransactions.length < plaidTotalTransactions
        : transactions.length === PAGE_SIZE; // Fallback: if we got a full page, there might be more

      if (hasMore && transactions.length > 0) {
        if (DEBUG_PLAID) {
          console.log(`${logPrefix} 🔄 More transactions available (${allTransactions.length}/${plaidTotalTransactions}), fetching next page...`);
        }
      } else {
        console.log(`${logPrefix} ✅ Pagination complete - all transactions fetched`);
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
              const isSandbox = process.env.PLAID_ENV === 'sandbox';
              if (isSandbox) {
                console.warn(`${logPrefix}   1. Using Plaid Sandbox (typically only has 30-40 days of test data)`);
              }
              console.warn(`${logPrefix}   ${isSandbox ? '2' : '1'}. Account was connected on ${earliestTxDate} (Plaid starts tracking from connection date)`);
              console.warn(`${logPrefix}   ${isSandbox ? '3' : '2'}. Bank only provides recent transaction history through Plaid API`);
              console.warn(`${logPrefix}   ${isSandbox ? '4' : '3'}. Bank has limited historical data available`);
            }

            if (fetchedDateRange < 30 && process.env.PLAID_ENV === 'sandbox') {
              console.warn(`${logPrefix} ⚠️ WARNING: Only ${fetchedDateRange} days of transactions available. This is typical for Plaid Sandbox.`);
            }
          }
        }

        break; // All transactions fetched
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
  } while (true); // Loop is controlled by break statements above

  console.log(
    `${logPrefix} 🎉 Transaction fetch completed: ${allTransactions.length} transactions across ${pageCount} page(s)`
  );

  let earliestTxDate: string | undefined;
  let latestTxDate: string | undefined;
  if (allTransactions.length > 0) {
    const transactionDates = allTransactions
      .map(tx => tx.date || tx.authorized_date || '')
      .filter(d => d)
      .sort();
    if (transactionDates.length > 0) {
      earliestTxDate = transactionDates[0];
      latestTxDate = transactionDates[transactionDates.length - 1];
      if (DEBUG_PLAID) {
        const isPlaidLimitation =
          plaidTotalTransactions !== undefined &&
          allTransactions.length === plaidTotalTransactions &&
          !!earliestTxDate && earliestTxDate > request.start_date;
        debugPlaid(`${logPrefix} Fetch summary`, {
          minTxDate: earliestTxDate,
          maxTxDate: latestTxDate,
          fetchedCount: allTransactions.length,
          plaidTotalTransactions,
          pageCount,
          requestedStart: request.start_date,
          requestedEnd: request.end_date,
          isPlaidLimitation,
        });
      }
    }
  }

  return {
    transactions: allTransactions,
    totalPages: pageCount,
    totalTransactions: allTransactions.length,
    plaidTotalTransactions,
    earliestTxDate,
    latestTxDate,
  };
}
