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
  /** Informational message (non-error) about sync state */
  info: string | null;
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
  const [info, setInfo] = useState<string | null>(null);
  const [lastSyncCount, setLastSyncCount] = useState<number | null>(null);
  const [timeUntilNextSync, setTimeUntilNextSync] = useState<number | null>(null);
  const [isTabVisible, setIsTabVisible] = useState(true);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const syncInProgressRef = useRef(false);
  const infoTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    setInfo(null);
    if (infoTimeoutRef.current) {
      clearTimeout(infoTimeoutRef.current);
      infoTimeoutRef.current = null;
    }

    try {
      console.log('🔄 [Transaction Polling] Starting sync...');

      const response = await makeAuthenticatedRequest('/api/plaid/sync-transactions', {
        method: 'POST',
        body: JSON.stringify({
          userId: user.id,
          import_timeframe: timeframe,
          /** Background poll uses incremental (cursor) sync — same as on protected load. Avoids full-import lock + false "failures" from already_running. */
          incremental: true,
        }),
      });

      let data: any = null;
      let rawText: string | null = null;
      try {
        data = await response.json();
      } catch {
        try {
          rawText = await response.text();
        } catch {
          rawText = null;
        }
      }

      // Lock case: API returns 200 with { status: "already_running" }
      if (response.ok && data && typeof data === 'object' && data.status === 'already_running') {
        const message = 'Sync already in progress';
        setInfo(message);
        infoTimeoutRef.current = setTimeout(() => setInfo(null), 5000);
        console.log('ℹ️ [Transaction Polling] Sync already running');
        return;
      }

      if (response.ok && data && typeof data === 'object' && data.success === true) {
        const now = new Date();
        setLastSyncTime(now);
        setLastSyncCount(data.transactions_saved || 0);

        // Persist to localStorage
        if (typeof window !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, now.toISOString());
        }

        console.log(`✅ [Transaction Polling] Synced ${data.transactions_saved} transactions`);
      } else {
        const fallback =
          (data && typeof data === 'object' && (data.details || data.error)) ||
          rawText ||
          (response.ok ? 'Failed to sync transactions' : `Failed to sync transactions (${response.status})`);
        const errorMessage = typeof fallback === 'string' ? fallback : 'Failed to sync transactions';

        // If the user hasn't connected a bank yet, don't spam console errors.
        // The sync endpoint expects `user_profiles/<uid>.plaid_token` to already exist
        // (written during the Plaid exchange-public-token step).
        const isNoPlaidToken = typeof errorMessage === 'string' && /no plaid token/i.test(errorMessage);
        if (isNoPlaidToken) {
          setError(null);
          setInfo('Connect your bank account first to enable transaction syncing.');
          if (infoTimeoutRef.current) clearTimeout(infoTimeoutRef.current);
          infoTimeoutRef.current = setTimeout(() => setInfo(null), 8000);
          console.log('ℹ️ [Transaction Polling] Plaid token missing; waiting for bank connection.');
          return;
        }

        setError(errorMessage);
        console.error('❌ [Transaction Polling] Sync failed:', errorMessage);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';

      const isNoPlaidToken = typeof errorMessage === 'string' && /no plaid token/i.test(errorMessage);
      if (isNoPlaidToken) {
        setError(null);
        setInfo('Connect your bank account first to enable transaction syncing.');
        if (infoTimeoutRef.current) clearTimeout(infoTimeoutRef.current);
        infoTimeoutRef.current = setTimeout(() => setInfo(null), 8000);
        console.log('ℹ️ [Transaction Polling] Plaid token missing; waiting for bank connection.');
        return;
      }

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
    info,
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
