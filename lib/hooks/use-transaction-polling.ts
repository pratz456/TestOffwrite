"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/firebase/auth-context';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';

interface UseTransactionPollingOptions {
  /** Polling interval in milliseconds (default: 15 minutes) */
  interval?: number;
  /** Whether polling is enabled (default: true) */
  enabled?: boolean;
  /** Timeframe for sync (default: '6months') */
  timeframe?: '1month' | '3months' | '6months' | '1year' | '2years';
}

interface UseTransactionPollingResult {
  /** Timestamp of the last successful sync */
  lastSyncTime: Date | null;
  /** Whether a sync is currently in progress */
  isSyncing: boolean;
  /** Error message if the last sync failed */
  error: string | null;
  /** Number of transactions synced in the last sync */
  lastSyncCount: number | null;
  /** Manually trigger a sync */
  syncNow: () => Promise<void>;
  /** Time until next automatic sync (in milliseconds) */
  timeUntilNextSync: number | null;
}

const DEFAULT_INTERVAL = 15 * 60 * 1000; // 15 minutes
const STORAGE_KEY = 'writeoff_last_sync_time';

/**
 * Hook that polls for new transactions periodically
 * - Automatically syncs transactions every 15 minutes (configurable)
 * - Pauses when tab is not visible to save API calls
 * - Provides manual sync function
 * - Persists last sync time to localStorage
 */
export function useTransactionPolling(
  options: UseTransactionPollingOptions = {}
): UseTransactionPollingResult {
  const {
    interval = DEFAULT_INTERVAL,
    enabled = true,
    timeframe = '6months',
  } = options;

  const { user } = useAuth();
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncCount, setLastSyncCount] = useState<number | null>(null);
  const [timeUntilNextSync, setTimeUntilNextSync] = useState<number | null>(null);
  const [isTabVisible, setIsTabVisible] = useState(true);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const syncInProgressRef = useRef(false);

  // Load last sync time from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = new Date(stored);
          if (!isNaN(parsed.getTime())) {
            setLastSyncTime(parsed);
          }
        } catch (e) {
          // Ignore invalid stored date
        }
      }
    }
  }, []);

  // Track tab visibility
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      setIsTabVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Sync function
  const syncNow = useCallback(async () => {
    if (!user?.id || syncInProgressRef.current) {
      return;
    }

    syncInProgressRef.current = true;
    setIsSyncing(true);
    setError(null);

    try {
      console.log('🔄 [Transaction Polling] Starting sync...');
      
      const response = await makeAuthenticatedRequest('/api/plaid/sync-transactions', {
        method: 'POST',
        body: JSON.stringify({
          userId: user.id,
          import_timeframe: timeframe,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        const now = new Date();
        setLastSyncTime(now);
        setLastSyncCount(data.transactions_saved || 0);
        
        // Persist to localStorage
        if (typeof window !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, now.toISOString());
        }
        
        console.log(`✅ [Transaction Polling] Synced ${data.transactions_saved} transactions`);
      } else {
        const errorMessage = data.error || 'Failed to sync transactions';
        setError(errorMessage);
        console.error('❌ [Transaction Polling] Sync failed:', errorMessage);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('❌ [Transaction Polling] Sync error:', err);
    } finally {
      setIsSyncing(false);
      syncInProgressRef.current = false;
    }
  }, [user?.id, timeframe]);

  // Calculate time until next sync
  useEffect(() => {
    if (!enabled || !lastSyncTime) {
      setTimeUntilNextSync(null);
      return;
    }

    const updateCountdown = () => {
      const elapsed = Date.now() - lastSyncTime.getTime();
      const remaining = Math.max(0, interval - elapsed);
      setTimeUntilNextSync(remaining);
    };

    updateCountdown();
    countdownRef.current = setInterval(updateCountdown, 1000);

    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
      }
    };
  }, [enabled, lastSyncTime, interval]);

  // Set up polling interval
  useEffect(() => {
    if (!enabled || !user?.id || !isTabVisible) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Check if we should sync immediately (if never synced or last sync was too long ago)
    const shouldSyncNow = () => {
      if (!lastSyncTime) return true;
      const elapsed = Date.now() - lastSyncTime.getTime();
      return elapsed >= interval;
    };

    // Initial sync if needed
    if (shouldSyncNow() && !syncInProgressRef.current) {
      syncNow();
    }

    // Set up interval for periodic syncs
    intervalRef.current = setInterval(() => {
      if (!syncInProgressRef.current && isTabVisible) {
        syncNow();
      }
    }, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, user?.id, isTabVisible, interval, lastSyncTime, syncNow]);

  return {
    lastSyncTime,
    isSyncing,
    error,
    lastSyncCount,
    syncNow,
    timeUntilNextSync,
  };
}

/**
 * Format time until next sync as a human-readable string
 */
export function formatTimeUntilSync(ms: number | null): string {
  if (ms === null) return 'Not scheduled';
  if (ms <= 0) return 'Syncing soon...';

  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Format last sync time as a relative time string
 */
export function formatLastSyncTime(date: Date | null): string {
  if (!date) return 'Never';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  
  return date.toLocaleDateString();
}
