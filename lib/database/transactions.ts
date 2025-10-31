// This file is deprecated - use lib/firebase/transactions.ts instead
import { getTransactions as getFirebaseTransactions, updateTransaction as updateFirebaseTransaction, createTransaction as createFirebaseTransaction } from '@/lib/firebase/transactions';

export interface Transaction {
  id: string;
  trans_id?: string;
  merchant_name: string;
  amount: number;
  category: string;
  date: string;
  type?: 'expense' | 'income';
  is_deductible?: boolean | null;
  deductible_reason?: string;
  deduction_score?: number;
  description?: string;
  notes?: string;
  savings_percentage?: number;
  deduction_percent?: number;
  estimated_deduction_percent?: number;
  account_id?: string;
}

export async function getTransactions(userId: string) {
  return await getFirebaseTransactions(userId);
}

export async function updateTransaction(transactionId: string, updates: any) {
  return await updateFirebaseTransaction(transactionId, updates);
}

export async function createTransaction(userId: string, accountId: string, transactionData: any) {
  return await createFirebaseTransaction(userId, accountId, transactionData);
}

// Export alias for backward compatibility
export const addTransaction = createTransaction;