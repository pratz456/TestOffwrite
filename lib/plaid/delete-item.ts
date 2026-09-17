import { plaidClient } from './client';
import { adminDb } from '@/lib/firebase/admin';
import { listPlaidConnectionSummaries, removePlaidConnection, updatePlaidConnection, withPlaidConnection } from './connections';
/** Disconnect one bank while retaining imported records and all other banks. */
export async function disconnectPlaidItem(uid: string, itemId?: string): Promise<{
  success: boolean; error?: Error; deletedCounts?: { accounts: number; transactions: number }; plaidRemoved?: boolean;
}> {
  try {
    const connections = await listPlaidConnectionSummaries(uid);
    if (!itemId && connections.length > 1) throw new Error('Choose the bank connection to disconnect');
    const target = itemId ? connections.find(item => item.itemId === itemId) : connections[0];
    if (!target) {
      if (itemId) throw new Error('Bank connection not found');
      return { success: true, plaidRemoved: false, deletedCounts: { accounts: 0, transactions: 0 } };
    }
    return await withPlaidConnection(uid, target.itemId, async (connection, leaseId) => {
      if (!connection.accessToken) {
        // Credentials from the previous provider account cannot be revoked with
        // the new keys. Retain the only recovery record until manual revocation.
        await updatePlaidConnection(uid, target.itemId, { status: 'revocation_required' }, leaseId);
        throw new Error('This older bank connection requires manual revocation. Contact support; its recovery information and your saved records have been retained.');
      }
      let plaidRemoved = false;
      if (connection.accessToken) {
        try { await plaidClient.itemRemove({ access_token: connection.accessToken }); plaidRemoved = true; }
        catch (error) {
          const code = (error as { response?: { data?: { error_code?: string } } }).response?.data?.error_code;
          if (!['ITEM_NOT_FOUND', 'INVALID_ACCESS_TOKEN'].includes(code ?? '')) throw new Error('Bank could not be disconnected. Please retry.');
        }
      }
      // Account association is server-managed. Never touch manual or another item's records.
      for (const accountId of connection.accountIds) {
        const ref = adminDb.doc(`user_profiles/${uid}/accounts/${accountId}`);
        const saved = await ref.get();
        if (saved.exists && saved.data()?.plaid_item_id === target.itemId) await ref.update({ plaid_connection_status: 'disconnected', updated_at: new Date() });
      }
      await removePlaidConnection(uid, target.itemId, leaseId);
      return { success: true, plaidRemoved, deletedCounts: { accounts: 0, transactions: 0 } };
    }, true);
  } catch (error) { return { success: false, error: error instanceof Error ? error : new Error('Unable to disconnect bank') }; }
}
