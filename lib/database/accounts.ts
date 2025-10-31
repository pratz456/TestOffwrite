// This file is deprecated - use lib/firebase/accounts.ts instead
import { getAccounts as getFirebaseAccounts, addAccount as addFirebaseAccount } from '@/lib/firebase/accounts';

// Account database operations - migrated to Firebase
export async function getAccounts(userId: string) {
  return await getFirebaseAccounts(userId);
}

export async function addAccount(accountData: any) {
  // Extract userId and pass other data to Firebase
  const { user_id, ...accountInfo } = accountData;
  return await addFirebaseAccount(user_id, accountInfo);
}

// All other functions are deprecated - use Firebase equivalents directly
export async function updateAccount() { throw new Error('Use Firebase directly'); }
export async function deleteAccount() { throw new Error('Use Firebase directly'); }
export async function getAccount() { throw new Error('Use Firebase directly'); }