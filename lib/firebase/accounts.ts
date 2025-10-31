import { 
  collection,
  doc, 
  getDoc,
  getDocs,
  setDoc, 
  updateDoc, 
  query,
  where,
  serverTimestamp,
  DocumentData
} from "firebase/firestore";
import { db } from "./client";

export type AccountUsageType = 'business' | 'personal' | 'mixed' | 'unknown';

export interface Account {
  id: string;
  account_id: string;
  name: string;
  mask: string;
  type: string;
  subtype: string;
  institution_id: string;
  user_id: string;
  usageType?: AccountUsageType;
  businessUsePercent?: number | null;
  last_cursor?: string;
  created_at?: any;
  updated_at?: any;
}

// Client-side function (for use in components)
export async function getAccounts(userId: string): Promise<{ data: Account[]; error: any }> {
  try {
    const accountsRef = collection(db, "user_profiles", userId, "accounts");
    const querySnapshot = await getDocs(accountsRef);
    const accounts: Account[] = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data() as DocumentData;
      accounts.push({
        id: doc.id,
        account_id: data.account_id || doc.id,
        name: data.name || '',
        mask: data.mask || '',
        type: data.type || '',
        subtype: data.subtype || '',
        institution_id: data.institution_id || '',
        user_id: userId,
        created_at: data.created_at,
        updated_at: data.updated_at,
      });
    });
    
    return { data: accounts, error: null };
  } catch (error) {
    console.error('Error getting accounts:', error);
    return { data: [], error };
  }
}

// Client-side function (for use in components)
export async function createAccount(
  userId: string,
  accountData: {
    account_id: string;
    name: string;
    mask: string;
    type: string;
    subtype: string;
    institution_id: string;
  }
): Promise<{ data: Account | null; error: any }> {
  try {
    const docRef = doc(db, "user_profiles", userId, "accounts", accountData.account_id);
    
    const newAccount = {
      ...accountData,
      user_id: userId,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    };
    
    await setDoc(docRef, newAccount);
    
    // Return the created account
    const createdDoc = await getDoc(docRef);
    if (createdDoc.exists()) {
      const data = createdDoc.data() as DocumentData;
      return {
        data: {
          id: createdDoc.id,
          account_id: data.account_id || createdDoc.id,
          name: data.name || '',
          mask: data.mask || '',
          type: data.type || '',
          subtype: data.subtype || '',
          institution_id: data.institution_id || '',
          user_id: userId,
          created_at: data.created_at,
          updated_at: data.updated_at,
        },
        error: null
      };
    }
    
    return { data: null, error: new Error('Failed to retrieve created account') };
  } catch (error) {
    console.error('Error creating account:', error);
    return { data: null, error };
  }
}

// Client-side function (for use in components)
export async function updateAccount(
  userId: string,
  accountId: string,
  updates: Partial<Account>
): Promise<{ data: Account | null; error: any }> {
  try {
    const docRef = doc(db, "user_profiles", userId, "accounts", accountId);
    const updateData = {
      ...updates,
      updated_at: serverTimestamp(),
    };
    
    await updateDoc(docRef, updateData);
    
    // Return the updated account
    const updatedDoc = await getDoc(docRef);
    if (updatedDoc.exists()) {
      const data = updatedDoc.data() as DocumentData;
      return {
        data: {
          id: updatedDoc.id,
          account_id: data.account_id || updatedDoc.id,
          name: data.name || '',
          mask: data.mask || '',
          type: data.type || '',
          subtype: data.subtype || '',
          institution_id: data.institution_id || '',
          user_id: userId,
          created_at: data.created_at,
          updated_at: data.updated_at,
        },
        error: null
      };
    }
    
    return { data: null, error: new Error('Failed to retrieve updated account') };
  } catch (error) {
    console.error('Error updating account:', error);
    return { data: null, error };
  }
}

// Export alias for backward compatibility
export const addAccount = createAccount;
