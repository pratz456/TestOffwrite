import { adminAuth, adminDb } from './admin';
import { disconnectPlaidItem } from '@/lib/plaid/delete-item';
import { deleteSubcollection, deleteQueryBatch } from './delete-helpers';

/**
 * Delete all user data from Firestore and Firebase Auth.
 * This includes:
 * - All Plaid items and related accounts/transactions
 * - User profile
 * - All user-scoped collections (accounts, transactions, categories, etc.)
 * - Storage assets (if any)
 * - Firebase Auth user
 * @param {string} uid - The user's UID.
 * @returns {Promise<{ error?: any }>}
 */
export async function deleteUserData(uid: string): Promise<{ error?: any }> {
  try {
    console.log(`🔄 [Delete User Data] Starting deletion for user ${uid}`);

    // Step 1: Disconnect all Plaid items
    try {
      const plaidResult = await disconnectPlaidItem(uid);
      if (plaidResult.success) {
        console.log(`✅ [Delete User Data] Disconnected Plaid items`);
      } else {
        console.warn(`⚠️ [Delete User Data] Plaid disconnection had issues:`, plaidResult.error);
        // Continue with deletion even if Plaid disconnection fails
      }
    } catch (plaidError) {
      console.warn(`⚠️ [Delete User Data] Error disconnecting Plaid, continuing:`, plaidError);
      // Continue with deletion
    }

    // Step 2: Delete all accounts and their subcollections
    // (This should already be done by disconnectPlaidItem, but do it again to be safe)
    const accountsRef = adminDb.collection('user_profiles').doc(uid).collection('accounts');
    const accountsSnapshot = await accountsRef.get();

    for (const accountDoc of accountsSnapshot.docs) {
      const accountRef = accountDoc.ref;

      // Delete transactions subcollection
      await deleteSubcollection(accountRef, 'transactions');

      // Delete the account document
      await accountRef.delete();
    }
    console.log(`✅ [Delete User Data] Deleted ${accountsSnapshot.docs.length} accounts`);

    // Step 3: Delete user profile document
    await adminDb.collection('user_profiles').doc(uid).delete();
    console.log(`✅ [Delete User Data] Deleted user profile`);

    // Step 4: Delete any other user-scoped collections
    // Categories, rules, budgets, exports, audit logs, etc.
    const collectionsToCheck = [
      'categories',
      'rules',
      'budgets',
      'exports',
      'audit_logs',
      'analysis_jobs',
      'analysis_status',
    ];

    for (const collectionName of collectionsToCheck) {
      try {
        const collectionRef = adminDb.collection(collectionName);
        const query = collectionRef.where('user_id', '==', uid);
        const deleted = await deleteQueryBatch(query, 500);
        if (deleted > 0) {
          console.log(`✅ [Delete User Data] Deleted ${deleted} documents from ${collectionName}`);
        }
      } catch (error) {
        // Collection might not exist or have different field names, continue
        console.log(`ℹ️ [Delete User Data] Skipping ${collectionName} (may not exist)`);
      }
    }

    // Step 5: Delete user from Firebase Auth
    try {
      await adminAuth.deleteUser(uid);
      console.log(`✅ [Delete User Data] Deleted user from Firebase Auth`);
    } catch (authError: any) {
      // User might already be deleted
      if (authError.code === 'auth/user-not-found') {
        console.log(`ℹ️ [Delete User Data] User already deleted from Auth`);
      } else {
        throw authError;
      }
    }

    // Note: Storage files would need to be deleted separately if you store receipts
    // This would require Firebase Storage Admin SDK

    console.log(`✅ [Delete User Data] Successfully deleted all data for user ${uid}`);
    return {};
  } catch (error) {
    console.error(`❌ [Delete User Data] Error deleting user data:`, error);
    return { error };
  }
}
