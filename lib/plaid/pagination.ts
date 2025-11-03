import { PlaidApi, TransactionsGetRequest } from 'plaid';

/**
 * Fetches all transactions from Plaid with automatic pagination handling.
 * This function will continue fetching pages until all transactions are retrieved.
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
}> {
  let allTransactions: any[] = [];
  let nextCursor: string | undefined = undefined;
  let pageCount = 0;
  const maxPages = 100; // Safety limit to prevent infinite loops

  do {
    pageCount++;
    
    if (pageCount > maxPages) {
      console.warn(`${logPrefix} ⚠️ Reached maximum page limit (${maxPages}), stopping pagination`);
      break;
    }

    console.log(`${logPrefix} 📄 Fetching transaction page ${pageCount}...`);

    try {
      const transactionsResponse = await plaidClient.transactionsGet({
        ...request,
        options: {
          ...request.options,
          cursor: nextCursor,
        },
      });

      const transactions = transactionsResponse.data.transactions || [];
      allTransactions = allTransactions.concat(transactions);

      nextCursor = transactionsResponse.data.next_cursor || undefined;

      console.log(
        `${logPrefix} 📊 Page ${pageCount}: Fetched ${transactions.length} transactions, ` +
        `total so far: ${allTransactions.length}`
      );

      if (nextCursor) {
        console.log(`${logPrefix} 🔄 More transactions available, fetching next page...`);
      } else {
        console.log(`${logPrefix} ✅ All transactions fetched (no more pages)`);
      }
    } catch (error: any) {
      console.error(`${logPrefix} ❌ Error fetching page ${pageCount}:`, error.message);
      throw error; // Re-throw to let caller handle it
    }
  } while (nextCursor);

  console.log(
    `${logPrefix} 📊 Fetched ${allTransactions.length} total transactions across ${pageCount} page(s)`
  );

  return {
    transactions: allTransactions,
    totalPages: pageCount,
    totalTransactions: allTransactions.length,
  };
}
