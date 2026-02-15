import { useEffect, useState } from 'react';
import {
  collectionGroup,
  query,
  where,
  or,
  orderBy,
  onSnapshot,
  DocumentData,
  QuerySnapshot
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from './client';
import { Transaction, hydrateTransactionRecord } from './transactions';

// Query keys for consistent caching
export const queryKeys = {
  transactions: (uid: string) => ['transactions', uid],
  transaction: (id: string) => ['transaction', id],
  stats: (uid: string) => ['stats', uid],
};

// Hook for realtime transactions list
export function useTransactions(uid: string) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!uid) {
      console.log('🔍 [useTransactions] No UID provided, skipping fetch');
      setIsLoading(false);
      return;
    }

    // Check if user is authenticated
    const auth = getAuth();
    if (!auth.currentUser) {
      console.log('🔍 [useTransactions] No authenticated user, skipping fetch');
      setIsLoading(false);
      return;
    }

    console.log('🔍 [useTransactions] Starting fetch for UID:', uid);
    setIsLoading(true);
    setError(null);

    // Query with both userId (camelCase) and user_id (snake_case) to cover
    // all transactions regardless of which field name was used at creation time.
    const transactionsQuery = query(
      collectionGroup(db, 'transactions'),
      or(
        where('userId', '==', uid),
        where('user_id', '==', uid)
      ),
      orderBy('date', 'desc')
    );

    const unsubscribe = onSnapshot(
      transactionsQuery,
      (querySnapshot: QuerySnapshot) => {
        try {
          const processedTransactions = querySnapshot.docs.map((doc) =>
            hydrateTransactionRecord(doc.data(), doc.id)
          );
          console.log('✅ [useTransactions] Fetched transactions via collectionGroup:', processedTransactions.length);
          setTransactions(processedTransactions);
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err : new Error('Failed to process transactions'));
        } finally {
          setIsLoading(false);
        }
      },
      (err) => {
        console.warn('⚠️ [useTransactions] CollectionGroup query issue, falling back to API:', err.code || err.message);

        // If collectionGroup fails, fall back to API-based fetching
        if (err.code === 'failed-precondition') {
          console.log('🔄 [useTransactions] Falling back to API-based fetching...');

          // Fetch transactions via API as fallback
          const fetchTransactionsViaAPI = async () => {
            try {
              const { makeAuthenticatedRequest } = await import('./api-client');
              const response = await makeAuthenticatedRequest('/api/transactions');

              if (response.ok) {
                const result = await response.json();
                const apiTransactions = result.transactions || result.data || [];
                console.log('✅ [useTransactions] Fetched transactions via API:', apiTransactions.length);
                setTransactions(apiTransactions);
                setError(null);
              } else {
                throw new Error('API request failed');
              }
            } catch (apiError) {
              console.error('❌ [useTransactions] API fallback also failed:', apiError);
              setError(new Error('Failed to fetch transactions from both Firestore and API'));
            } finally {
              setIsLoading(false);
            }
          };

          fetchTransactionsViaAPI();
        } else if (err.code === 'permission-denied') {
          console.log('🔄 [useTransactions] Permission denied, falling back to API-based fetching...');

          // Fall back to API for permission-denied errors too
          const fetchTransactionsViaAPI = async () => {
            try {
              const { makeAuthenticatedRequest } = await import('./api-client');
              const response = await makeAuthenticatedRequest('/api/transactions');

              if (response.ok) {
                const result = await response.json();
                const apiTransactions = result.transactions || result.data || [];
                console.log('✅ [useTransactions] Fetched transactions via API (permission fallback):', apiTransactions.length);
                setTransactions(apiTransactions);
                setError(null);
              } else {
                throw new Error('API request failed');
              }
            } catch (apiError) {
              console.error('❌ [useTransactions] API fallback also failed:', apiError);
              setError(new Error('Permission denied. Please check your authentication.'));
            } finally {
              setIsLoading(false);
            }
          };

          fetchTransactionsViaAPI();
        } else if (err.code === 'unavailable') {
          console.log('🔄 [useTransactions] Service unavailable, falling back to API-based fetching...');

          // Fall back to API for unavailable errors too
          const fetchTransactionsViaAPI = async () => {
            try {
              const { makeAuthenticatedRequest } = await import('./api-client');
              const response = await makeAuthenticatedRequest('/api/transactions');

              if (response.ok) {
                const result = await response.json();
                const apiTransactions = result.transactions || result.data || [];
                console.log('✅ [useTransactions] Fetched transactions via API (unavailable fallback):', apiTransactions.length);
                setTransactions(apiTransactions);
                setError(null);
              } else {
                throw new Error('API request failed');
              }
            } catch (apiError) {
              console.error('❌ [useTransactions] API fallback also failed:', apiError);
              setError(new Error('Database service temporarily unavailable. Please try again.'));
            } finally {
              setIsLoading(false);
            }
          };

          fetchTransactionsViaAPI();
        } else {
          console.log('🔄 [useTransactions] Unknown error, falling back to API-based fetching...');

          // Fall back to API for any other errors
          const fetchTransactionsViaAPI = async () => {
            try {
              const { makeAuthenticatedRequest } = await import('./api-client');
              const response = await makeAuthenticatedRequest('/api/transactions');

              if (response.ok) {
                const result = await response.json();
                const apiTransactions = result.transactions || result.data || [];
                console.log('✅ [useTransactions] Fetched transactions via API (unknown error fallback):', apiTransactions.length);
                setTransactions(apiTransactions);
                setError(null);
              } else {
                throw new Error('API request failed');
              }
            } catch (apiError) {
              console.error('❌ [useTransactions] API fallback also failed:', apiError);
              setError(err instanceof Error ? err : new Error('Failed to fetch transactions'));
            } finally {
              setIsLoading(false);
            }
          };

          fetchTransactionsViaAPI();
        }
      }
    );

    return () => unsubscribe();
  }, [uid]);

  return { transactions, isLoading, error };
}

// Hook for realtime single transaction
export function useTransaction(id: string, uid: string) {
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!id || !uid) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Find the transaction document across all collections
    const transactionsQuery = query(
      collectionGroup(db, 'transactions'),
      where('trans_id', '==', id),
      where('userId', '==', uid)
    );

    const unsubscribe = onSnapshot(
      transactionsQuery,
      (querySnapshot: QuerySnapshot) => {
        try {
          if (querySnapshot.empty) {
            setTransaction(null);
            setError(new Error('Transaction not found'));
          } else {
            const doc = querySnapshot.docs[0];
            const processedTransaction = processTransactionData(doc);
            setTransaction(processedTransaction);
            setError(null);
          }
        } catch (err) {
          setError(err instanceof Error ? err : new Error('Failed to process transaction'));
        } finally {
          setIsLoading(false);
        }
      },
      (err) => {
        console.warn('⚠️ [useTransaction] Snapshot error:', err.code || err.message);

        // Check for specific Firestore index errors
        if (err.code === 'failed-precondition') {
          setError(new Error('Database query failed. Missing required index. Please contact support.'));
        } else if (err.code === 'permission-denied') {
          setError(new Error('Permission denied. Please check your authentication.'));
        } else if (err.code === 'unavailable') {
          setError(new Error('Database service temporarily unavailable. Please try again.'));
        } else {
          setError(err instanceof Error ? err : new Error('Failed to fetch transaction'));
        }

        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [id, uid]);

  return { transaction, isLoading, error };
}

// Hook for realtime user stats
export function useUserStats(uid: string) {
  const [stats, setStats] = useState<{
    totalTransactions: number;
    deductibleTransactions: number;
    needsReviewTransactions: number;
    totalDeductibleAmount: number;
    potentialSavings: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!uid) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Subscribe to transactions to calculate stats in real-time
    const transactionsQuery = query(
      collectionGroup(db, 'transactions'),
      where('userId', '==', uid),
      orderBy('date', 'desc')
    );

    const unsubscribe = onSnapshot(
      transactionsQuery,
      (querySnapshot: QuerySnapshot) => {
        try {
          const transactions = querySnapshot.docs.map(processTransactionData);

          const totalTransactions = transactions.length;
          const deductibleTransactions = transactions.filter(t => t.is_deductible === true).length;
          const needsReviewTransactions = transactions.filter(t => t.is_deductible === null).length;
          const totalDeductibleAmount = transactions
            .filter(t => t.is_deductible === true)
            .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

          // Estimate potential savings (assuming 30% tax rate)
          const potentialSavings = totalDeductibleAmount * 0.3;

          setStats({
            totalTransactions,
            deductibleTransactions,
            needsReviewTransactions,
            totalDeductibleAmount,
            potentialSavings,
          });
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err : new Error('Failed to calculate stats'));
        } finally {
          setIsLoading(false);
        }
      },
      (err) => {
        console.warn('⚠️ [useUserStats] Snapshot error:', err.code || err.message);

        // Check for specific Firestore index errors
        if (err.code === 'failed-precondition') {
          setError(new Error('Database query failed. Missing required index. Please contact support.'));
        } else if (err.code === 'permission-denied') {
          setError(new Error('Permission denied. Please check your authentication.'));
        } else if (err.code === 'unavailable') {
          setError(new Error('Database service temporarily unavailable. Please try again.'));
        } else {
          setError(err instanceof Error ? err : new Error('Failed to fetch stats'));
        }

        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [uid]);

  return { stats, isLoading, error };
}
