import { plaidClient } from './client';
import { adminDb, FieldValue } from '@/lib/firebase/admin';
import { deleteSubcollection, deleteQueryBatch } from '@/lib/firebase/delete-helpers';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';

/**
 * Disconnect a single Plaid Item and delete all related data
 * @param userId - The user's UID
 * @param itemId - The Plaid item ID (optional, will use user's current item if not provided)
 * @returns Promise<{ success: boolean; error?: any; deletedCounts?: { accounts: number; transactions: number } }>
 */
export async function disconnectPlaidItem(
  userId: string,
  itemId?: string
): Promise<{
  success: boolean;
  error?: any;
  deletedCounts?: { accounts: number; transactions: number };
  plaidRemoved?: boolean;
}> {
  try {
    console.log(`🔄 [Delete Plaid Item] Starting disconnect for user ${userId}, item ${itemId || 'current'}`);

    // Get user profile to find Plaid token and item ID
    const { data: userProfile, error: profileError } = await getUserProfileServer(userId);

    if (profileError || !userProfile) {
      console.error(`❌ [Delete Plaid Item] Failed to get user profile:`, profileError);
      return { success: false, error: profileError || new Error('User profile not found') };
    }

    // Determine which item to disconnect
    const userProfileData = userProfile as any;
    const targetItemId = itemId || userProfileData.plaid_item_id || null;

    if (!targetItemId) {
      console.log(`ℹ️ [Delete Plaid Item] No Plaid item found for user ${userId}`);
      return { success: true, plaidRemoved: false }; // No item to remove, consider success
    }

    // Verify ownership - ensure the item belongs to this user
    const userProfileDoc = await adminDb.collection('user_profiles').doc(userId).get();
    const userData = userProfileDoc.data();

    if (!userData || userData.plaid_item_id !== targetItemId) {
      console.error(`❌ [Delete Plaid Item] Item ${targetItemId} does not belong to user ${userId}`);
      return { success: false, error: new Error('Item not found or access denied') };
    }

    const accessToken = userData.plaid_token;

    if (!accessToken) {
      console.log(`ℹ️ [Delete Plaid Item] No access token found, proceeding with local cleanup only`);
    }

    // Step 1: Remove item from Plaid (if access token exists)
    let plaidRemoved = false;
    if (accessToken) {
      try {
        await plaidClient.itemRemove({ access_token: accessToken });
        plaidRemoved = true;
        console.log(`✅ [Delete Plaid Item] Successfully removed item from Plaid`);
      } catch (plaidError: any) {
        // If item was already removed in Plaid Portal, continue with local cleanup
        // Item might already be removed, so we'll continue with local cleanup
        const errorCode = plaidError?.response?.data?.error_code;
        if (errorCode === 'ITEM_NOT_FOUND' || errorCode === 'INVALID_ACCESS_TOKEN') {
          console.log(`ℹ️ [Delete Plaid Item] Item already removed in Plaid, continuing with local cleanup`);
          plaidRemoved = false; // Already removed, but we'll continue
        } else {
          console.error(`⚠️ [Delete Plaid Item] Failed to remove from Plaid, but continuing with local cleanup:`, plaidError);
          // Continue with local cleanup even if Plaid removal fails
        }
      }
    }

    // Step 2: Get all accounts for this user (they're all from the same Plaid item in current setup)
    const accountsRef = adminDb.collection('user_profiles').doc(userId).collection('accounts');
    const accountsSnapshot = await accountsRef.get();

    let totalAccountsDeleted = 0;
    let totalTransactionsDeleted = 0;

    // Step 3: Delete all accounts and their transactions
    for (const accountDoc of accountsSnapshot.docs) {
      const accountRef = accountDoc.ref;

      // Delete transactions subcollection
      const transactionsDeleted = await deleteSubcollection(accountRef, 'transactions');
      totalTransactionsDeleted += transactionsDeleted;
      console.log(`🗑️ [Delete Plaid Item] Deleted ${transactionsDeleted} transactions from account ${accountDoc.id}`);

      // Delete the account document
      await accountRef.delete();
      totalAccountsDeleted++;
      console.log(`🗑️ [Delete Plaid Item] Deleted account ${accountDoc.id}`);
    }

    // Step 4: Remove Plaid credentials from user profile
    await adminDb.collection('user_profiles').doc(userId).update({
      plaid_token: FieldValue.delete(),
      plaid_item_id: FieldValue.delete(),
      last_updated: FieldValue.delete(),
    });
    console.log(`✅ [Delete Plaid Item] Removed Plaid credentials from user profile`);

    // Step 5: Delete any webhook state or sync cursors (if stored separately)
    // Note: This might be stored in the user profile or in a separate collection
    // Adjust based on your actual schema

    console.log(`✅ [Delete Plaid Item] Successfully disconnected Plaid item`);
    return {
      success: true,
      deletedCounts: {
        accounts: totalAccountsDeleted,
        transactions: totalTransactionsDeleted,
      },
      plaidRemoved,
    };
  } catch (error) {
    console.error(`❌ [Delete Plaid Item] Error disconnecting Plaid item:`, error);
    return {
      success: false,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

