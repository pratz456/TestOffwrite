"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/firebase/auth-context';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';

export interface SubscriptionStatus {
  hasAccess: boolean;
  isTrial: boolean;
  isPaid: boolean;
  trialStart?: Date;
  trialEnd?: Date;
  subscriptionEnd?: Date;
  daysRemaining?: number;
  subscriptionStatus?: 'trial' | 'active' | 'expired' | 'none';
  cancelAtPeriodEnd?: boolean;
  subscription?: {
    id: string;
    status: string;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: Date | null;
    planInterval: 'month' | 'year' | null;
    planAmount: number | null;
    planCurrency: string | null;
  } | null;
}

interface UseSubscriptionResult {
  /** Whether the user has access (trial or paid) */
  hasAccess: boolean;
  /** Whether user is on a trial */
  isTrial: boolean;
  /** Whether user has an active paid subscription */
  isPaid: boolean;
  /** Full subscription status object */
  status: SubscriptionStatus | null;
  /** Whether subscription data is loading */
  isLoading: boolean;
  /** Error message if fetching failed */
  error: string | null;
  /** Refetch subscription status */
  refetch: () => Promise<void>;
}

/**
 * Hook to check user's subscription status
 * Centralizes subscription checking across the app
 */
export function useSubscription(): UseSubscriptionResult {
  const { user } = useAuth();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscriptionStatus = useCallback(async () => {
    if (!user?.id) {
      setStatus(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await makeAuthenticatedRequest('/api/subscriptions/check-access');
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          // Parse dates from the response
          const accessData = data.data;
          setStatus({
            ...accessData,
            trialStart: accessData.trialStart ? new Date(accessData.trialStart) : undefined,
            trialEnd: accessData.trialEnd ? new Date(accessData.trialEnd) : undefined,
            subscriptionEnd: accessData.subscriptionEnd ? new Date(accessData.subscriptionEnd) : undefined,
            cancelAtPeriodEnd: accessData.subscription?.cancelAtPeriodEnd || false,
          });
        } else {
          setError(data.error || 'Failed to fetch subscription status');
          setStatus({
            hasAccess: false,
            isTrial: false,
            isPaid: false,
            subscriptionStatus: 'none',
          });
        }
      } else {
        setError(`Failed to fetch subscription status: ${response.statusText}`);
        setStatus({
          hasAccess: false,
          isTrial: false,
          isPaid: false,
          subscriptionStatus: 'none',
        });
      }
    } catch (err) {
      console.error('Error fetching subscription status:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus({
        hasAccess: false,
        isTrial: false,
        isPaid: false,
        subscriptionStatus: 'none',
      });
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchSubscriptionStatus();
  }, [fetchSubscriptionStatus]);

  return {
    hasAccess: status?.hasAccess ?? false,
    isTrial: status?.isTrial ?? false,
    isPaid: status?.isPaid ?? false,
    status,
    isLoading,
    error,
    refetch: fetchSubscriptionStatus,
  };
}
