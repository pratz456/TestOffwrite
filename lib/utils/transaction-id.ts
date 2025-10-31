/**
 * Utility functions for handling transaction IDs consistently across the application
 */

export interface TransactionWithId {
  id?: string;
  trans_id?: string;
  [key: string]: any;
}

/**
 * Get the primary transaction ID from a transaction object
 * Prioritizes trans_id (Plaid ID) over id (internal ID)
 * @param transaction Transaction object with potential ID fields
 * @returns The primary transaction ID
 */
export function getTransactionId(transaction: TransactionWithId): string {
  if (!transaction) {
    throw new Error('Transaction is required');
  }
  
  // Prioritize trans_id (Plaid ID) as it's more stable
  if (transaction.trans_id && typeof transaction.trans_id === 'string') {
    return transaction.trans_id;
  }
  
  if (transaction.id && typeof transaction.id === 'string') {
    return transaction.id;
  }
  
  throw new Error('Transaction must have either trans_id or id field');
}

/**
 * Check if a transaction has a valid ID
 * @param transaction Transaction object to check
 * @returns True if transaction has a valid ID
 */
export function hasValidTransactionId(transaction: TransactionWithId): boolean {
  try {
    getTransactionId(transaction);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get transaction ID with fallback
 * @param transaction Transaction object
 * @param fallback Fallback value if no ID found
 * @returns Transaction ID or fallback
 */
export function getTransactionIdWithFallback(transaction: TransactionWithId, fallback: string): string {
  try {
    return getTransactionId(transaction);
  } catch {
    return fallback;
  }
}
