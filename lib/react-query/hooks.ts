import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auth } from '@/lib/firebase/client';

// API functions for React Query
const api = {
  // Get transactions with field selection
  async getTransactions(userId: string, fields?: string[]) {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('No authenticated user');
    
    const token = await currentUser.getIdToken();
    const params = fields ? `?fields=${fields.join(',')}` : '';
    
    const response = await fetch(`/api/transactions${params}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch transactions');
    }
    
    return response.json();
  },

  // Get accounts with field selection
  async getAccounts(userId: string, fields?: string[]) {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('No authenticated user');
    
    const token = await currentUser.getIdToken();
    const params = fields ? `?fields=${fields.join(',')}` : '';
    
    const response = await fetch(`/api/database/accounts${params}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch accounts');
    }
    
    return response.json();
  },

  // Get user profile
  async getUserProfile(userId: string) {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('No authenticated user');
    
    const token = await currentUser.getIdToken();
    
    const response = await fetch('/api/user/profile', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch user profile');
    }
    
    return response.json();
  },

  // Get monthly deductions (reports data)
  async getMonthlyDeductions(userId: string) {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('No authenticated user');
    
    const token = await currentUser.getIdToken();
    
    const response = await fetch('/api/monthly-deductions', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch monthly deductions');
    }
    
    return response.json();
  },

  // Update transaction
  async updateTransaction(userId: string, transactionId: string, updates: any) {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('No authenticated user');
    
    const token = await currentUser.getIdToken();
    
    const response = await fetch('/api/database/transactions', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transactionId, updates }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update transaction');
    }
    
    return response.json();
  },
};

// Query keys for consistent caching
export const queryKeys = {
  transactions: (userId: string, fields?: string[]) => 
    ['transactions', userId, fields],
  accounts: (userId: string, fields?: string[]) => 
    ['accounts', userId, fields],
  userProfile: (userId: string) => 
    ['userProfile', userId],
  monthlyDeductions: (userId: string) => 
    ['monthlyDeductions', userId],
};

// Optimized hooks
export function useTransactions(userId: string, fields?: string[]) {
  return useQuery({
    queryKey: queryKeys.transactions(userId, fields),
    queryFn: () => api.getTransactions(userId, fields),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useAccounts(userId: string, fields?: string[]) {
  return useQuery({
    queryKey: queryKeys.accounts(userId, fields),
    queryFn: () => api.getAccounts(userId, fields),
    enabled: !!userId,
    staleTime: 10 * 60 * 1000, // 10 minutes (accounts change less frequently)
    gcTime: 15 * 60 * 1000, // 15 minutes
  });
}

export function useUserProfile(userId: string) {
  return useQuery({
    queryKey: queryKeys.userProfile(userId),
    queryFn: () => api.getUserProfile(userId),
    enabled: !!userId,
    staleTime: 30 * 60 * 1000, // 30 minutes (profile changes rarely)
    gcTime: 60 * 60 * 1000, // 1 hour
  });
}

export function useMonthlyDeductions(userId: string) {
  return useQuery({
    queryKey: queryKeys.monthlyDeductions(userId),
    queryFn: () => api.getMonthlyDeductions(userId),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

// Mutation hooks
export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ userId, transactionId, updates }: {
      userId: string;
      transactionId: string;
      updates: any;
    }) => api.updateTransaction(userId, transactionId, updates),
    onSuccess: (data, { userId }) => {
      // Invalidate and refetch transactions
      queryClient.invalidateQueries({
        queryKey: queryKeys.transactions(userId),
      });
      // Invalidate monthly deductions since they depend on transactions
      queryClient.invalidateQueries({
        queryKey: queryKeys.monthlyDeductions(userId),
      });
    },
  });
}

// Prefetching utilities
export function usePrefetchTransactions(userId: string) {
  const queryClient = useQueryClient();
  
  return () => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.transactions(userId),
      queryFn: () => api.getTransactions(userId),
      staleTime: 2 * 60 * 1000,
    });
  };
}

export function usePrefetchAccounts(userId: string) {
  const queryClient = useQueryClient();
  
  return () => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.accounts(userId),
      queryFn: () => api.getAccounts(userId),
      staleTime: 10 * 60 * 1000,
    });
  };
}

export function usePrefetchMonthlyDeductions(userId: string) {
  const queryClient = useQueryClient();
  
  return () => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.monthlyDeductions(userId),
      queryFn: () => api.getMonthlyDeductions(userId),
      staleTime: 5 * 60 * 1000,
    });
  };
}
