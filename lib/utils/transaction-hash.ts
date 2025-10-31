import { createHash } from 'crypto';

export interface TransactionFields {
  trans_id: string;
  account_id: string;
  date: string;
  amount: number;
  merchant_name: string;
  category: string;
  description?: string;
}

/**
 * Creates a stable hash of transaction fields for idempotency
 * This ensures we don't re-analyze transactions that haven't changed
 */
export function createTransactionHash(fields: TransactionFields): string {
  // Sort fields to ensure consistent hash regardless of order
  const sortedFields = Object.keys(fields)
    .sort()
    .reduce((obj, key) => {
      obj[key] = fields[key as keyof TransactionFields];
      return obj;
    }, {} as Record<string, any>);

  // Create a stable string representation
  const stableString = JSON.stringify(sortedFields, Object.keys(sortedFields).sort());
  
  // Generate SHA-256 hash
  return createHash('sha256').update(stableString).digest('hex');
}

/**
 * Checks if two transactions are identical based on their hash
 */
export function areTransactionsIdentical(hash1: string, hash2: string): boolean {
  return hash1 === hash2;
}

/**
 * Creates a hash from existing transaction data
 */
export function createHashFromTransaction(transaction: any): string {
  const fields: TransactionFields = {
    trans_id: transaction.trans_id || transaction.id,
    account_id: transaction.account_id,
    date: transaction.date,
    amount: transaction.amount,
    merchant_name: transaction.merchant_name,
    category: transaction.category,
    description: transaction.description
  };
  
  return createTransactionHash(fields);
}
