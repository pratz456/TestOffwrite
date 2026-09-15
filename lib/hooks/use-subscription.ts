"use client";

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/firebase/auth-context';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import {
  canUseSubscriptionFeature,
  loadSubscriptionStatus,
  type PremiumFeature,
  type SubscriptionStatus,
} from '@/lib/subscriptions/client-status';

export type { SubscriptionStatus } from '@/lib/subscriptions/client-status';

/** Account-keyed requests are shared by every gate, navigation and billing view. */
export function useSubscription() {
  const { user, loading: authLoading } = useAuth();
  const query = useQuery<SubscriptionStatus>({
    queryKey: ['subscription-status', user?.id ?? null],
    queryFn: ({ signal }) => loadSubscriptionStatus(makeAuthenticatedRequest, signal),
    enabled: Boolean(user?.id) && !authLoading,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    refetchInterval: 60_000,
  });

  // A failed refresh cannot keep a previously granted entitlement on screen.
  // Keying by account also prevents a prior user's response from unlocking this user.
  const status = user?.id && !authLoading && !query.isError ? query.data ?? null : null;
  const isLoading = authLoading || (Boolean(user?.id) && query.isPending);
  const error = query.isError && user?.id ? 'We could not verify your plan. Please try again.' : null;
  const canAccess = useCallback(
    (feature: PremiumFeature) => canUseSubscriptionFeature(status, feature),
    [status],
  );
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(async () => { await refetchQuery(); }, [refetchQuery]);

  return {
    hasAccess: canAccess('reports'),
    isTrial: status?.isTrial ?? false,
    isPaid: status?.isPaid ?? false,
    status,
    isLoading,
    error,
    canAccess,
    refetch,
  };
}
