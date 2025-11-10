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
): Promise<{ success: boolean; error: any }> {
  try {
    const docRef = adminDb.collection("user_profiles").doc(userId).collection("accounts").doc(accountId);

    // Check if account exists
    const accountDoc = await docRef.get();
    if (!accountDoc.exists) {
      return { success: false, error: new Error('Account not found') };
    }

    // Delete the account document
    // Note: Firestore will automatically delete subcollections (transactions) if cascade delete is configured
    await docRef.delete();

    // Also delete any transactions associated with this account
    const transactionsRef = adminDb.collection("user_profiles").doc(userId).collection("accounts").doc(accountId).collection("transactions");
    const transactionsSnapshot = await transactionsRef.get();

    if (!transactionsSnapshot.empty) {
      const batch = adminDb.batch();
      transactionsSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
    }

    return { success: true, error: null };
  } catch (error) {
    console.error('Error deleting account (server):', error);
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
