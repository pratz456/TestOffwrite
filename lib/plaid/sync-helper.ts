import { getTransactionHistoryWindow, isWithinHistoryWindow } from '@/lib/subscriptions/history-window';
import { createTransactionServer } from '@/lib/firebase/transactions-server';
import { adminDb } from '@/lib/firebase/admin';
import { updateImportedTransactionForAnalysis } from '@/lib/ai/analysis-jobs';
import { plaidClient } from './client';
import { fetchAllPlaidTransactions } from './pagination';
import { findPlaidConnectionByItemId, listPlaidConnections, updatePlaidConnection, withPlaidConnection, type PlaidConnection } from './connections';
import type { Transaction } from 'plaid';

export interface SyncResult { success: boolean; transactionsSaved: number; accountsProcessed?: number; autoClassified?: number; error?: string; }

async function assertAccount(uid: string, connection: PlaidConnection, accountId: string) {
  if (!connection.accountIds.includes(accountId)) throw new Error('Transaction does not belong to the selected bank');
  const account = await adminDb.doc(`user_profiles/${uid}/accounts/${accountId}`).get();
  if (!account.exists || account.data()?.plaid_item_id !== connection.itemId) throw new Error('Bank account ownership could not be verified');
}
async function saveTransaction(uid: string, connection: PlaidConnection, transaction: Transaction): Promise<number> {
  await assertAccount(uid, connection, transaction.account_id);
  const existing = await adminDb.doc(`user_profiles/${uid}/accounts/${transaction.account_id}/transactions/${transaction.transaction_id}`).get();
  if (existing.exists) {
    if (existing.data()?.bank_removed === true) {
      await updateImportedTransactionForAnalysis({ userId: uid, accountId: transaction.account_id, transactionId: transaction.transaction_id }, {
        date: transaction.date, amount: transaction.amount, merchant_name: transaction.merchant_name || transaction.name,
        category: transaction.personal_finance_category?.detailed || transaction.category?.[0] || 'Other', description: transaction.name,
        iso_currency_code: transaction.iso_currency_code, unofficial_currency_code: transaction.unofficial_currency_code, pending: transaction.pending,
      });
      await existing.ref.update({ bank_removed: false, bank_removed_at: null });
    }
    return 0;
  }
  const { data, error } = await createTransactionServer(uid, transaction.account_id, {
    trans_id: transaction.transaction_id, date: transaction.date, amount: transaction.amount,
    merchant_name: transaction.merchant_name || transaction.name,
    category: transaction.personal_finance_category?.detailed || transaction.category?.[0] || 'Other',
    description: transaction.name, is_deductible: null, analyzed: false,
    analysis_status: 'pending', analysisStatus: 'pending', pending: transaction.pending,
    authorized_date: transaction.authorized_date || undefined, datetime: transaction.datetime || undefined,
    payment_channel: ['in_store', 'online', 'other'].includes(transaction.payment_channel) ? transaction.payment_channel as 'in_store' | 'online' | 'other' : undefined, merchant_category_code: transaction.category_id || undefined,
    iso_currency_code: transaction.iso_currency_code || undefined,
    unofficial_currency_code: transaction.unofficial_currency_code || undefined,
    location: transaction.location ? { address: transaction.location.address || undefined, city: transaction.location.city || undefined,
      state: transaction.location.region || undefined, lat: transaction.location.lat || undefined, lon: transaction.location.lon || undefined } : undefined,
    personal_finance_category: transaction.personal_finance_category ? {
      primary: transaction.personal_finance_category.primary, detailed: transaction.personal_finance_category.detailed,
      confidence: transaction.personal_finance_category.confidence_level || undefined,
    } : undefined,
    counterparties: transaction.counterparties || undefined, logo_url: transaction.logo_url || undefined,
    merchant_entity_id: transaction.merchant_entity_id || undefined,
  });
  if (error) throw new Error('Could not save all bank transactions. Please retry.');
  return data ? 1 : 0;
}

async function eachConnection(uid: string, itemId: string | undefined,
  work: (connection: PlaidConnection, leaseId: string) => Promise<number>): Promise<SyncResult> {
  try {
    const all = await listPlaidConnections(uid, true);
    const connections = itemId ? all.filter(connection => connection.itemId === itemId) : all;
    if (!connections.length) return { success: false, transactionsSaved: 0, error: 'No bank connection found' };
    let transactionsSaved = 0;
    let failed = false;
    // Banks are independent: one failed item never replaces another item's cursor.
    for (const connection of connections) {
      try { transactionsSaved += await withPlaidConnection(uid, connection.itemId, async (current, leaseId) => {
        if (current.reauthenticationRequired) {
          // Cached transaction data alone does not prove that a login was repaired.
          const { data } = await plaidClient.itemGet({ access_token: current.accessToken });
          if (data.item.item_id !== current.itemId || data.item.error !== null) throw new Error('Bank sign-in is required');
          await updatePlaidConnection(uid, current.itemId, { reauthenticationRequired: false }, leaseId);
          current.reauthenticationRequired = false;
        }
        return work(current, leaseId);
      }, false, true); }
      catch { failed = true; }
    }
    return { success: !failed, transactionsSaved, accountsProcessed: connections.reduce((count, connection) => count + connection.accountIds.length, 0),
      ...(failed ? { error: 'A bank connection could not finish syncing. Please retry.' } : {}) };
  } catch { return { success: false, transactionsSaved: 0, error: 'Bank connections could not be loaded. Please retry.' }; }
}

/** An omitted item syncs all banks; webhooks always provide their verified item ID. */
export async function syncUserTransactionsIncremental(uid: string, itemId?: string): Promise<SyncResult> {
  return eachConnection(uid, itemId, async (connection, leaseId) => {
    if (connection.reconnectSessionId) {
      const { syncReconnectUnderLease } = await import('./reconnect');
      return syncReconnectUnderLease(uid, connection, leaseId);
    }
    const startCursor = connection.cursor || undefined;
    let added: Transaction[] = [], modified: Transaction[] = [];
    let removed: Array<{ transaction_id: string; account_id?: string }> = [];
    let cursor = startCursor;
    // Plaid requires restarting the entire page sequence after pagination mutation.
    for (let attempt = 0; attempt < 3; attempt++) {
      added = []; modified = []; removed = []; cursor = startCursor;
      try {
        let hasMore = true;
        let pages = 0;
        while (hasMore) {
          if (++pages > 1000) throw new Error('Bank sync pagination limit exceeded');
          const response = await plaidClient.transactionsSync({ access_token: connection.accessToken, cursor,
            options: { include_personal_finance_category: true } });
          added.push(...response.data.added); modified.push(...response.data.modified); removed.push(...response.data.removed);
          cursor = response.data.next_cursor; hasMore = response.data.has_more;
          await updatePlaidConnection(uid, connection.itemId, {}, leaseId);
        }
        break;
      } catch (error) {
        const code = (error as { response?: { data?: { error_code?: string } } }).response?.data?.error_code;
        if (code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt < 2) continue;
        throw new Error('Bank transactions are not ready to sync. Please retry.');
      }
    }
    const window = await getTransactionHistoryWindow(uid);
    let saved = 0;
    for (const transaction of added) {
      if (transaction.pending || !isWithinHistoryWindow(transaction.date, window)) continue;
      await updatePlaidConnection(uid, connection.itemId, {}, leaseId);
      saved += await saveTransaction(uid, connection, transaction);
    }
    for (const transaction of modified) {
      await assertAccount(uid, connection, transaction.account_id);
      const result = await updateImportedTransactionForAnalysis({ userId: uid, accountId: transaction.account_id, transactionId: transaction.transaction_id }, {
        date: transaction.date, amount: transaction.amount, merchant_name: transaction.merchant_name || transaction.name,
        category: transaction.personal_finance_category?.detailed || transaction.category?.[0] || 'Other', description: transaction.name,
        iso_currency_code: transaction.iso_currency_code, unofficial_currency_code: transaction.unofficial_currency_code, pending: transaction.pending,
      });
      if (!result.updated && !transaction.pending && isWithinHistoryWindow(transaction.date, window)) {
        saved += await saveTransaction(uid, connection, transaction);
      }
    }
    for (const transaction of removed) {
      const accountIds = transaction.account_id ? [transaction.account_id] : connection.accountIds;
      for (const accountId of accountIds) {
        await assertAccount(uid, connection, accountId);
        const matches = await adminDb.collection(`user_profiles/${uid}/accounts/${accountId}/transactions`)
          .where('trans_id', '==', transaction.transaction_id).get();
        for (const record of matches.docs) {
          // Preserve audit history and user decisions. Existing report/export
          // filters exclude pending bank records until a provider re-add restores them.
          await record.ref.update({ bank_removed: true, bank_removed_at: new Date(), pending: true, updated_at: new Date() });
        }
      }
    }
    // Commit this item's cursor only after every write has succeeded; retries are idempotent by transaction ID.
    await updatePlaidConnection(uid, connection.itemId, { cursor: cursor ?? '', lastSync: Date.now() }, leaseId);
    await adminDb.doc(`user_profiles/${uid}`).set({ last_sync: Date.now(), last_sync_source: 'incremental' }, { merge: true });
    return saved;
  });
}

/** Full history backfill is capped by the server plan and can target one owned account. */
export async function syncUserTransactions(uid: string, importTimeframe = '1year', itemId?: string, accountId?: string): Promise<SyncResult> {
  return eachConnection(uid, itemId, async (connection, leaseId) => {
    if (connection.reconnectSessionId) {
      const { backfillReconnectUnderLease } = await import('./reconnect');
      return backfillReconnectUnderLease(uid, connection, leaseId, accountId);
    }
    if (accountId && !connection.accountIds.includes(accountId)) throw new Error('Bank account not found');
    const window = await getTransactionHistoryWindow(uid);
    const result = await fetchAllPlaidTransactions(plaidClient, { access_token: connection.accessToken,
      start_date: window.startDate, end_date: window.endDate,
      options: { account_ids: accountId ? [accountId] : connection.accountIds, include_personal_finance_category: true } }, '[Bank history]');
    let saved = 0;
    for (const transaction of result.transactions) {
      if (transaction.pending || !isWithinHistoryWindow(transaction.date, window)) continue;
      await updatePlaidConnection(uid, connection.itemId, {}, leaseId);
      saved += await saveTransaction(uid, connection, transaction);
    }
    await updatePlaidConnection(uid, connection.itemId, { lastSync: Date.now() }, leaseId);
    await adminDb.doc(`user_profiles/${uid}`).set({ last_sync: Date.now(), last_import_timeframe: importTimeframe,
      plaid_requested_start_date: window.startDate, plaid_earliest_returned_tx_date: result.earliestTxDate ?? null,
      plaid_imported_count: saved }, { merge: true });
    return saved;
  });
}
export async function findUserByPlaidItemId(itemId: string): Promise<string | null> {
  return (await findPlaidConnectionByItemId(itemId))?.uid ?? null;
}
