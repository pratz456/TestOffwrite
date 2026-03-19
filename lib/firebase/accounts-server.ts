import { adminDb } from "./admin";

export type AccountUsageType = 'business' | 'personal' | 'mixed' | 'unknown';

export interface Account {
  id: string;
  account_id: string;
  name: string;
  mask: string;
  type: string;
  subtype: string;
  institution_id: string;
  access_token?: string; // Add access token field
  user_id: string;
  usageType?: AccountUsageType;
  businessUsePercent?: number | null;
  // Balance fields
  balance?: number;
  available_balance?: number | null;
  current_balance?: number | null;
  limit?: number | null;
  iso_currency_code?: string;
  unofficial_currency_code?: string | null;
  balance_last_updated?: string;
  created_at?: any;
  updated_at?: any;
  // Import metadata (for UX: "Bank provided history from X")
  last_import_at?: number | null;
  last_import_requested_start?: string | null;
  last_import_earliest_tx?: string | null;
  last_import_latest_tx?: string | null;
  last_import_count?: number | null;
}

// Server-side function (for use in API routes)
export async function getAccountsServer(userId: string): Promise<{ data: Account[]; error: any }> {
  try {
    const accountsRef = adminDb.collection("user_profiles").doc(userId).collection("accounts");
    const querySnapshot = await accountsRef.get();
    const accounts: Account[] = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      accounts.push({
        id: doc.id,
        account_id: data.account_id || doc.id,
        name: data.name || '',
        mask: data.mask || '',
        type: data.type || '',
        subtype: data.subtype || '',
        institution_id: data.institution_id || '',
        user_id: userId,
        // Balance fields
        balance: data.balance ?? data.available_balance ?? data.current_balance ?? 0,
        available_balance: data.available_balance ?? null,
        current_balance: data.current_balance ?? null,
        limit: data.limit ?? null,
        iso_currency_code: data.iso_currency_code || 'USD',
        unofficial_currency_code: data.unofficial_currency_code || null,
        balance_last_updated: data.balance_last_updated || null,
        created_at: data.created_at,
        updated_at: data.updated_at,
        last_import_at: data.last_import_at ?? null,
        last_import_requested_start: data.last_import_requested_start ?? null,
        last_import_earliest_tx: data.last_import_earliest_tx ?? null,
        last_import_latest_tx: data.last_import_latest_tx ?? null,
        last_import_count: data.last_import_count ?? null,
        usageType: data.usageType || undefined,
        businessUsePercent: data.businessUsePercent ?? null,
      });
    });

    return { data: accounts, error: null };
  } catch (error) {
    console.error('Error getting accounts (server):', error);
    return { data: [], error };
  }
}

// Server-side function (for use in API routes)
export async function createAccountServer(
  userId: string,
  accountData: {
    account_id: string;
    name: string;
    mask: string;
    type: string;
    subtype: string;
    institution_id: string;
    access_token?: string; // Add access token parameter
  }
): Promise<{ data: Account | null; error: any }> {
  try {
    const docRef = adminDb.collection("user_profiles").doc(userId).collection("accounts").doc(accountData.account_id);

    const newAccount = {
      ...accountData,
      user_id: userId,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await docRef.set(newAccount);

    // Return the created account
    const createdDoc = await docRef.get();
    if (createdDoc.exists) {
      const data = createdDoc.data();
      if (!data) {
        return { data: null, error: 'Failed to retrieve created account data' };
      }
      return {
        data: {
          id: createdDoc.id,
          account_id: data.account_id || createdDoc.id,
          name: data.name || '',
          mask: data.mask || '',
          type: data.type || '',
          subtype: data.subtype || '',
          institution_id: data.institution_id || '',
          access_token: data.access_token, // Include access token in response
          user_id: userId,
          created_at: data.created_at,
          updated_at: data.updated_at,
        },
        error: null
      };
    }

    return { data: null, error: new Error('Failed to retrieve created account') };
  } catch (error) {
    console.error('Error creating account (server):', error);
    return { data: null, error };
  }
}

// Server-side function (for use in API routes)
export async function updateAccountServer(
  userId: string,
  accountId: string,
  updates: Partial<Account>
): Promise<{ data: Account | null; error: any }> {
  try {
    const docRef = adminDb.collection("user_profiles").doc(userId).collection("accounts").doc(accountId);
    const updateData = {
      ...updates,
      updated_at: new Date(),
    };

    await docRef.update(updateData);

    // Return the updated account
    const updatedDoc = await docRef.get();
    if (updatedDoc.exists) {
      const data = updatedDoc.data();
      if (!data) {
        return { data: null, error: 'Failed to retrieve updated account data' };
      }
      return {
        data: {
          id: updatedDoc.id,
          account_id: data.account_id || updatedDoc.id,
          name: data.name || '',
          mask: data.mask || '',
          type: data.type || '',
          subtype: data.subtype || '',
          institution_id: data.institution_id || '',
          access_token: data.access_token, // Include access token in response
          user_id: userId,
          created_at: data.created_at,
          updated_at: data.updated_at,
        },
        error: null
      };
    }

    return { data: null, error: new Error('Failed to retrieve updated account') };
  } catch (error) {
    console.error('Error updating account (server):', error);
    return { data: null, error };
  }
}

// Export alias for backward compatibility
export const addAccountServer = createAccountServer;

// Server-side function (for use in API routes)
export async function deleteAccountServer(
  userId: string,
  accountId: string
): Promise<{ success: boolean; error: any; deletedTransactions?: number }> {
  try {
    const docRef = adminDb.collection("user_profiles").doc(userId).collection("accounts").doc(accountId);

    // Check if account exists
    const accountDoc = await docRef.get();
    if (!accountDoc.exists) {
      return { success: false, error: new Error('Account not found') };
    }

    console.log(`🗑️ [Delete Account] Starting deletion for account ${accountId} (user: ${userId})`);

    // Step 1: Delete all transactions associated with this account
    // First, delete from the subcollection path
    const { deleteSubcollection, deleteQueryBatch } = await import('@/lib/firebase/delete-helpers');
    let transactionsDeleted = 0;

    try {
      transactionsDeleted = await deleteSubcollection(docRef, 'transactions');
      console.log(`✅ [Delete Account] Deleted ${transactionsDeleted} transactions from subcollection`);
    } catch (subcollectionError) {
      console.warn('⚠️ [Delete Account] Error deleting subcollection transactions:', subcollectionError);
    }

    // Step 2: Also delete transactions from top-level collection if they exist
    // Search for transactions with this account_id in collectionGroup (with pagination)
    try {

      // Try with userId first (more efficient)
      let topLevelQuery = adminDb
        .collectionGroup('transactions')
        .where('account_id', '==', accountId)
        .where('userId', '==', userId);

      let topLevelDeleted = 0;
      try {
        topLevelDeleted = await deleteQueryBatch(topLevelQuery, 500);
        transactionsDeleted += topLevelDeleted;
        console.log(`✅ [Delete Account] Deleted ${topLevelDeleted} transactions from collectionGroup (userId)`);
      } catch (userIdError: any) {
        // If query fails (e.g., missing index), try with user_id (snake_case)
        if (userIdError?.code === 9 || userIdError?.code === 'FAILED_PRECONDITION') {
          console.log('⚠️ [Delete Account] userId query failed, trying user_id...');
          topLevelQuery = adminDb
            .collectionGroup('transactions')
            .where('account_id', '==', accountId)
            .where('user_id', '==', userId);

          topLevelDeleted = await deleteQueryBatch(topLevelQuery, 500);
          transactionsDeleted += topLevelDeleted;
          console.log(`✅ [Delete Account] Deleted ${topLevelDeleted} transactions from collectionGroup (user_id)`);
        } else {
          throw userIdError;
        }
      }
    } catch (topLevelError) {
      console.warn('⚠️ [Delete Account] Error deleting top-level transactions:', topLevelError);
      // Continue with account deletion even if top-level transaction deletion fails
    }

    // Step 2b: Also check top-level transactions collection (if transactions are stored there)
    try {
      const topLevelCollectionQuery = adminDb
        .collection('transactions')
        .where('account_id', '==', accountId)
        .where('userId', '==', userId);

      const topCollectionDeleted = await deleteQueryBatch(topLevelCollectionQuery, 500);
      transactionsDeleted += topCollectionDeleted;

      if (topCollectionDeleted > 0) {
        console.log(`✅ [Delete Account] Deleted ${topCollectionDeleted} transactions from top-level transactions collection`);
      }
    } catch (topCollectionError: any) {
      // If query fails, try with user_id (snake_case)
      if (topCollectionError?.code === 9 || topCollectionError?.code === 'FAILED_PRECONDITION') {
        try {
          const topLevelCollectionQuery = adminDb
            .collection('transactions')
            .where('account_id', '==', accountId)
            .where('user_id', '==', userId);

          const topCollectionDeleted = await deleteQueryBatch(topLevelCollectionQuery, 500);
          transactionsDeleted += topCollectionDeleted;

          if (topCollectionDeleted > 0) {
            console.log(`✅ [Delete Account] Deleted ${topCollectionDeleted} transactions from top-level transactions collection (user_id)`);
          }
        } catch (error) {
          console.warn('⚠️ [Delete Account] Error deleting from top-level transactions collection:', error);
        }
      } else {
        console.warn('⚠️ [Delete Account] Error deleting from top-level transactions collection:', topCollectionError);
      }
    }

    // Step 3: Delete the account document (after transactions are deleted)
    await docRef.delete();
    console.log(`✅ [Delete Account] Deleted account ${accountId}`);

    return {
      success: true,
      error: null,
      deletedTransactions: transactionsDeleted
    };
  } catch (error) {
    console.error('❌ [Delete Account] Error deleting account:', error);
    return { success: false, error };
  }
}

// Server-side function to set account usage type
export async function setAccountUsageServer(
  uid: string,
  accountId: string,
  usageType: 'business' | 'personal' | 'mixed' | 'unknown',
  businessUsePercent?: number | null
) {
  const ref = adminDb.doc(`user_profiles/${uid}/accounts/${accountId}`);
  await ref.set(
    {
      usageType,
      businessUsePercent: usageType === 'mixed' ? (businessUsePercent ?? 50) : null,
      updatedAt: Date.now(),
    },
    { merge: true }
  );
}
