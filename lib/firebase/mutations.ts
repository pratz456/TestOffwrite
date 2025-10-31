import { useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  collectionGroup, 
  query, 
  where, 
  limit, 
  getDocs,
  runTransaction,
  serverTimestamp
} from 'firebase/firestore';
import { db } from './client';
import { Transaction } from './transactions';
import { queryKeys } from './hooks';

// Types for transaction updates
export interface TransactionUpdate {
  is_deductible?: boolean | null;
  deductible_reason?: string;
  deduction_score?: number;
  ai_analysis?: string; // Original AI analysis text - never overwritten
  user_classification_reason?: string; // User's reason for classification
  notes?: string;
  category?: string;
  receipt_url?: string;
  receipt_filename?: string;
  
  // Transaction-Specific Context Fields
  business_purpose?: string;
  attendees?: string[];
  travel_destination?: string;
  equipment_details?: {
    make?: string;
    model?: string;
    year?: number;
    business_use_percentage?: number;
    depreciation_method?: 'straight_line' | 'declining_balance' | 'section_179';
  };
  client_project?: string;
  documentation_status?: 'complete' | 'partial' | 'missing';
  meeting_notes?: string;
  mileage_details?: {
    start_location?: string;
    end_location?: string;
    miles?: number;
    business_purpose?: string;
  };
}

// Helper function to find transaction document reference
async function findTransactionDoc(transactionId: string, userId: string) {
  const transactionsQuery = query(
    collectionGroup(db, 'transactions'),
    where('trans_id', '==', transactionId),
    where('userId', '==', userId),
    limit(1)
  );
  
  const querySnapshot = await getDocs(transactionsQuery);
  
  if (querySnapshot.empty) {
    throw new Error('Transaction not found');
  }
  
  return querySnapshot.docs[0].ref;
}

// Helper function to calculate local stats from transactions
function calculateLocalStats(transactions: Transaction[]) {
  const totalTransactions = transactions.length;
  const deductibleTransactions = transactions.filter(t => t.is_deductible === true).length;
  const needsReviewTransactions = transactions.filter(t => t.is_deductible === null).length;
  const totalDeductibleAmount = transactions
    .filter(t => t.is_deductible === true)
    .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
  const potentialSavings = totalDeductibleAmount * 0.3;

  return {
    totalTransactions,
    deductibleTransactions,
    needsReviewTransactions,
    totalDeductibleAmount,
    potentialSavings,
  };
}

// Hook for updating transactions with optimistic updates
export function useUpdateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      transactionId, 
      userId, 
      updates 
    }: { 
      transactionId: string; 
      userId: string; 
      updates: TransactionUpdate;
    }) => {
      // Use Firebase transaction for atomic updates
      return await runTransaction(db, async (transaction) => {
        const docRef = await findTransactionDoc(transactionId, userId);
        
        // Get current document
        const doc = await transaction.get(docRef);
        if (!doc.exists()) {
          throw new Error('Transaction not found');
        }

        const currentData = doc.data();
        // Filter out undefined values as Firebase doesn't support them
        const filteredUpdates = Object.fromEntries(
          Object.entries(updates).filter(([, value]) => value !== undefined)
        );
        
        const updateData = {
          ...filteredUpdates,
          updated_at: serverTimestamp(),
        };

        // Update the transaction document
        transaction.update(docRef, updateData);

        // Return the updated data for verification
        return {
          ...currentData,
          ...updateData,
          id: transactionId,
          trans_id: transactionId,
        };
      });
    },

    onMutate: async ({ transactionId, userId, updates }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.transactions(userId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.transaction(transactionId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.stats(userId) });

      // Snapshot the previous values
      const previousTransactions = queryClient.getQueryData(queryKeys.transactions(userId));
      const previousTransaction = queryClient.getQueryData(queryKeys.transaction(transactionId));
      const previousStats = queryClient.getQueryData(queryKeys.stats(userId));

      // Optimistically update the transaction in the list
      if (previousTransactions) {
        queryClient.setQueryData(
          queryKeys.transactions(userId),
          (old: Transaction[] | undefined) => {
            if (!old) return old;
            return old.map(transaction => 
              transaction.trans_id === transactionId || transaction.id === transactionId
                ? { ...transaction, ...updates }
                : transaction
            );
          }
        );
      }

      // Optimistically update the single transaction
      if (previousTransaction) {
        queryClient.setQueryData(
          queryKeys.transaction(transactionId),
          (old: Transaction | undefined) => {
            if (!old) return old;
            return { ...old, ...updates };
          }
        );
      }

      // Optimistically update stats
      if (previousTransactions && previousStats) {
        const updatedTransactions = (previousTransactions as Transaction[]).map(transaction => 
          transaction.trans_id === transactionId || transaction.id === transactionId
            ? { ...transaction, ...updates }
            : transaction
        );
        
        const newStats = calculateLocalStats(updatedTransactions);
        queryClient.setQueryData(queryKeys.stats(userId), newStats);
      }

      // Return context with the snapshotted values
      return { 
        previousTransactions, 
        previousTransaction, 
        previousStats,
        userId,
        transactionId 
      };
    },

    onError: (err, variables, context) => {
      if (context) {
        const { previousTransactions, previousTransaction, previousStats, userId, transactionId } = context;
        
        // Rollback transactions list
        if (previousTransactions) {
          queryClient.setQueryData(queryKeys.transactions(userId), previousTransactions);
        }
        
        // Rollback single transaction
        if (previousTransaction) {
          queryClient.setQueryData(queryKeys.transaction(transactionId), previousTransaction);
        }
        
        // Rollback stats
        if (previousStats) {
          queryClient.setQueryData(queryKeys.stats(userId), previousStats);
        }
      }
      
      console.error('Transaction update failed:', err);
      
      // Log specific error details for debugging
      if (err instanceof Error) {
        if (err.message.includes('index')) {
          console.error('Index error detected. This may require creating a Firestore index.');
        } else if (err.message.includes('permission')) {
          console.error('Permission error detected. Check Firestore security rules.');
        }
      }
    },

    onSettled: (data, error, variables) => {
      const { userId, transactionId } = variables;
      
      // Always refetch after error or success to ensure consistency
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions(userId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.transaction(transactionId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats(userId) });
    },
  });
}

// Hook for bulk transaction updates (e.g., batch categorization)
export function useBulkUpdateTransactions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      transactionIds, 
      userId, 
      updates 
    }: { 
      transactionIds: string[]; 
      userId: string; 
      updates: TransactionUpdate;
    }) => {
      // Use Firebase transaction for atomic bulk updates
      return await runTransaction(db, async (transaction) => {
        const results = [];
        
        for (const transactionId of transactionIds) {
          try {
            const docRef = await findTransactionDoc(transactionId, userId);
            const doc = await transaction.get(docRef);
            
            if (doc.exists()) {
              const currentData = doc.data();
                           // Filter out undefined values as Firebase doesn't support them
             const filteredUpdates = Object.fromEntries(
               Object.entries(updates).filter(([, value]) => value !== undefined)
             );
             
             const updateData = {
               ...filteredUpdates,
               updated_at: serverTimestamp(),
             };
              
              transaction.update(docRef, updateData);
              results.push({ id: transactionId, success: true, data: { ...currentData, ...updateData } });
            } else {
              results.push({ id: transactionId, success: false, error: 'Transaction not found' });
            }
          } catch (error) {
            results.push({ id: transactionId, success: false, error: error instanceof Error ? error.message : 'Unknown error' });
          }
        }
        
        return results;
      });
    },

    onMutate: async ({ transactionIds, userId, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.transactions(userId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.stats(userId) });

      const previousTransactions = queryClient.getQueryData(queryKeys.transactions(userId));
      const previousStats = queryClient.getQueryData(queryKeys.stats(userId));

      // Optimistically update all affected transactions
      if (previousTransactions) {
        queryClient.setQueryData(
          queryKeys.transactions(userId),
          (old: Transaction[] | undefined) => {
            if (!old) return old;
            return old.map(transaction => 
              transactionIds.includes(transaction.trans_id) || transactionIds.includes(transaction.id)
                ? { ...transaction, ...updates }
                : transaction
            );
          }
        );
      }

      // Optimistically update stats
      if (previousTransactions && previousStats) {
        const updatedTransactions = (previousTransactions as Transaction[]).map(transaction => 
          transactionIds.includes(transaction.trans_id) || transactionIds.includes(transaction.id)
            ? { ...transaction, ...updates }
            : transaction
        );
        
        const newStats = calculateLocalStats(updatedTransactions);
        queryClient.setQueryData(queryKeys.stats(userId), newStats);
      }

      return { previousTransactions, previousStats, userId };
    },

    onError: (err, variables, context) => {
      if (context) {
        const { previousTransactions, previousStats, userId } = context;
        
        if (previousTransactions) {
          queryClient.setQueryData(queryKeys.transactions(userId), previousTransactions);
        }
        
        if (previousStats) {
          queryClient.setQueryData(queryKeys.stats(userId), previousStats);
        }
      }
      
      console.error('Bulk transaction update failed:', err);
    },

    onSettled: (data, error, variables) => {
      const { userId } = variables;
      
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions(userId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats(userId) });
    },
  });
}
