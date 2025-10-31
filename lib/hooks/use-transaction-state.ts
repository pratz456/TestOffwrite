import { useState, useEffect, useCallback, useRef } from 'react';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';

export interface Transaction {
  id: string;
  trans_id: string;
  merchant_name: string;
  amount: number;
  category: string;
  date: string;
  datetime?: string; // Full datetime from Plaid (ISO format)
  type?: 'expense' | 'income';
  is_deductible?: boolean | null;
  deductible_reason?: string;
  deduction_score?: number;
  description?: string;
  notes?: string;
  account_id?: string;
  user_id?: string;
  analyzed?: boolean;
  analysisStatus?: 'pending' | 'running' | 'completed' | 'failed';
  transactionHash?: string;
  analysisStartedAt?: any;
  analysisCompletedAt?: any;
  created_at?: any;
  updated_at?: any;
}

interface TransactionState {
  transactions: Transaction[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

interface TransactionActions {
  updateTransaction: (transactionId: string, updates: Partial<Transaction>) => Promise<boolean>;
  refreshTransactions: () => Promise<void>;
  addTransaction: (transaction: Transaction) => void;
  removeTransaction: (transactionId: string) => void;
  getTransaction: (transactionId: string) => Transaction | undefined;
  getTransactionsByStatus: (status: 'deductible' | 'personal' | 'pending') => Transaction[];
  getTransactionsByCategory: (category: string) => Transaction[];
}

export function useTransactionState(userId: string): TransactionState & TransactionActions {
  const [state, setState] = useState<TransactionState>({
    transactions: [],
    loading: false,
    error: null,
    lastUpdated: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch transactions from API
  const fetchTransactions = useCallback(async () => {
    if (!userId) return;

    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const response = await makeAuthenticatedRequest('/api/transactions', {
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch transactions: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.success && Array.isArray(result.transactions)) {
        setState(prev => ({
          ...prev,
          transactions: result.transactions,
          loading: false,
          lastUpdated: new Date(),
        }));
      } else {
        throw new Error('Invalid response format');
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // Request was cancelled, don't update state
        return;
      }
      
      setState(prev => ({
        ...prev,
        loading: false,
        error: error.message || 'Failed to fetch transactions',
      }));
    }
  }, [userId]);

  // Update a single transaction
  const updateTransaction = useCallback(async (transactionId: string, updates: Partial<Transaction>): Promise<boolean> => {
    try {
      // Optimistically update local state for immediate UI feedback
      setState(prev => ({
        ...prev,
        transactions: prev.transactions.map(t => 
          (t.id === transactionId || t.trans_id === transactionId) 
            ? { ...t, ...updates, updated_at: new Date() }
            : t
        ),
      }));

      // Send update to API
      const response = await makeAuthenticatedRequest(`/api/transactions/${transactionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update transaction');
      }

      const result = await response.json();
      
      if (result.success) {
        // Update with the server response to ensure consistency
        setState(prev => ({
          ...prev,
          transactions: prev.transactions.map(t => 
            (t.id === transactionId || t.trans_id === transactionId) 
              ? { ...t, ...result.transaction, updated_at: new Date() }
              : t
          ),
          lastUpdated: new Date(),
        }));
        
        return true;
      } else {
        throw new Error(result.error || 'Update failed');
      }
    } catch (error: any) {
      // Revert optimistic update on error
      await fetchTransactions();
      setState(prev => ({
        ...prev,
        error: error.message || 'Failed to update transaction',
      }));
      return false;
    }
  }, [fetchTransactions]);

  // Refresh transactions from server
  const refreshTransactions = useCallback(async () => {
    await fetchTransactions();
  }, [fetchTransactions]);

  // Add a new transaction
  const addTransaction = useCallback((transaction: Transaction) => {
    setState(prev => ({
      ...prev,
      transactions: [...prev.transactions, transaction],
      lastUpdated: new Date(),
    }));
  }, []);

  // Remove a transaction
  const removeTransaction = useCallback((transactionId: string) => {
    setState(prev => ({
      ...prev,
      transactions: prev.transactions.filter(t => 
        t.id !== transactionId && t.trans_id !== transactionId
      ),
      lastUpdated: new Date(),
    }));
  }, []);

  // Get a specific transaction
  const getTransaction = useCallback((transactionId: string): Transaction | undefined => {
    return state.transactions.find(t => 
      t.id === transactionId || t.trans_id === transactionId
    );
  }, [state.transactions]);

  // Get transactions by status
  const getTransactionsByStatus = useCallback((status: 'deductible' | 'personal' | 'pending'): Transaction[] => {
    switch (status) {
      case 'deductible':
        return state.transactions.filter(t => t.is_deductible === true);
      case 'personal':
        return state.transactions.filter(t => t.is_deductible === false);
      case 'pending':
        return state.transactions.filter(t => t.is_deductible === null);
      default:
        return [];
    }
  }, [state.transactions]);

  // Get transactions by category
  const getTransactionsByCategory = useCallback((category: string): Transaction[] => {
    return state.transactions.filter(t => t.category === category);
  }, [state.transactions]);

  // Initial fetch and periodic refresh
  useEffect(() => {
    fetchTransactions();

    // Set up periodic refresh every 30 seconds
    const interval = setInterval(fetchTransactions, 30000);

    return () => {
      clearInterval(interval);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchTransactions]);

  return {
    ...state,
    updateTransaction,
    refreshTransactions,
    addTransaction,
    removeTransaction,
    getTransaction,
    getTransactionsByStatus,
    getTransactionsByCategory,
  };
}
