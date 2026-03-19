import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auth } from '@/lib/firebase/client';
import { getTransactions as getTransactionsClient } from '@/lib/firebase/transactions';
import { getUserProfile } from '@/lib/firebase/profiles';
import { getUserTaxRate } from '@/lib/tax-rules/federal-brackets';

type MonthlyData = {
  month: number;
  monthName: string;
  total: number;
  count: number;
};

async function computeMonthlyDeductionsClient(userId: string, year?: number) {
  const targetYear = year ?? new Date().getFullYear();

  const [{ data: profile }, { data: txs, error: txErr }] = await Promise.all([
    getUserProfile(userId),
    getTransactionsClient(userId),
  ]);

  if (txErr) {
    throw new Error(txErr?.message || 'Failed to fetch transactions');
  }

  const allTransactions = Array.isArray(txs) ? txs : [];
  const availableYears =
    allTransactions.length > 0
      ? [...new Set(allTransactions.map((t) => new Date(t.date).getFullYear()))]
          .filter((y) => Number.isFinite(y) && y >= 2000 && y <= new Date().getFullYear())
          .sort((a, b) => b - a)
      : [new Date().getFullYear()];

  const taxRate = getUserTaxRate(profile ?? undefined);

  const monthlyData: MonthlyData[] = Array.from({ length: 12 }, (_, i) => ({
    month: i,
    monthName: new Date(targetYear, i, 1).toLocaleDateString('en-US', { month: 'short' }),
    total: 0,
    count: 0,
  }));

  const start = new Date(targetYear, 0, 1).getTime();
  const end = new Date(targetYear, 11, 31, 23, 59, 59).getTime();

  for (const t of allTransactions) {
    const amount = Number((t as any).amount) || 0;
    if (!(amount > 0)) continue; // expenses only
    const dt = new Date((t as any).date).getTime();
    if (!Number.isFinite(dt) || dt < start || dt > end) continue;

    const month = new Date(dt).getMonth();
    const isDeductible = (t as any).is_deductible === true;
    const taxSavings = isDeductible ? amount * taxRate : 0;
    monthlyData[month].total += taxSavings;
    if (taxSavings > 0) monthlyData[month].count += 1;
  }

  const now = new Date();
  const isCurrentYear = targetYear === now.getFullYear();
  const currentMonthIdx = isCurrentYear ? now.getMonth() : 11;
  const currentMonthTotal = monthlyData[currentMonthIdx]?.total ?? 0;
  const lastMonthTotal = currentMonthIdx > 0 ? monthlyData[currentMonthIdx - 1]?.total ?? 0 : 0;
  const monthOverMonthChange =
    lastMonthTotal > 0 ? ((currentMonthTotal - lastMonthTotal) / lastMonthTotal) * 100 : 0;

  const monthsWithData = monthlyData
    .slice(0, currentMonthIdx + 1)
    .filter((m) => m.total > 0);
  const avgMonthly =
    monthsWithData.length > 0
      ? monthsWithData.reduce((sum, m) => sum + m.total, 0) / monthsWithData.length
      : 0;

  const yearToDateTotal = monthlyData.reduce((sum, m) => sum + m.total, 0);

  return {
    success: true,
    data: {
      monthlyData,
      summary: {
        currentMonthTotal,
        monthOverMonthChange,
        avgMonthly,
        monthsWithData: monthsWithData.length,
        yearToDateTotal,
        estimatedRefund: yearToDateTotal,
      },
      availableYears,
    },
  };
}

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
      const error = await response.json().catch(() => ({} as any));
      const msg: string = error?.error || 'Failed to fetch transactions';

      // Local dev fallback: if server-side Firebase Admin/Firestore isn't configured,
      // fall back to client Firestore (scoped by security rules).
      try {
        const { data: txs, error: txErr } = await getTransactionsClient(userId);
        if (!txErr) return { success: true, transactions: txs, data: txs, count: txs.length };
      } catch (_) {}

      throw new Error(msg);
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

  // Get monthly deductions (reports data); optional year for viewing previous years
  async getMonthlyDeductions(userId: string, year?: number) {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('No authenticated user');
    
    // Force refresh token to avoid 401 from expired token (e.g. after tab idle)
    const token = await currentUser.getIdToken(true);
    const params = year != null ? `?year=${year}` : '';
    
    const response = await fetch(`/api/monthly-deductions${params}`, {
      credentials: 'include',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({} as any));
      const msg: string = error?.error || 'Failed to fetch monthly deductions';

      // Local dev fallback: compute from client-side Firestore transactions.
      try {
        return await computeMonthlyDeductionsClient(userId, year);
      } catch (_) {}

      throw new Error(msg);
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
  monthlyDeductions: (userId: string, year?: number) => 
    ['monthlyDeductions', userId, year],
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

export function useMonthlyDeductions(userId: string, year?: number, authReady = true) {
  return useQuery({
    queryKey: queryKeys.monthlyDeductions(userId, year),
    queryFn: () => api.getMonthlyDeductions(userId, year),
    enabled: !!userId && authReady,
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
      // Invalidate all monthly deductions (all years) since they depend on transactions
      queryClient.invalidateQueries({
        queryKey: ['monthlyDeductions', userId],
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
    const currentYear = new Date().getFullYear();
    queryClient.prefetchQuery({
      queryKey: queryKeys.monthlyDeductions(userId, currentYear),
      queryFn: () => api.getMonthlyDeductions(userId, currentYear),
      staleTime: 5 * 60 * 1000,
    });
  };
}
