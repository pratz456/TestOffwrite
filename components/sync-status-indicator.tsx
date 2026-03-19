"use client";

import React from 'react';
import { RefreshCw, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  useTransactionPolling, 
  formatLastSyncTime, 
  formatTimeUntilSync 
} from '@/lib/hooks/use-transaction-polling';

interface SyncStatusIndicatorProps {
  /** Show compact version (icon only with tooltip) */
  compact?: boolean;
  /** Show countdown to next sync (hidden in production by default) */
  showCountdown?: boolean;
  /** Custom class name */
  className?: string;
}

// Only show countdown timer in development mode
const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * Component that displays transaction sync status and provides manual refresh
 */
export function SyncStatusIndicator({
  compact = false,
  showCountdown = true,
  className = '',
}: SyncStatusIndicatorProps) {
  const {
    lastSyncTime,
    isSyncing,
    error,
    info,
    lastSyncCount,
    syncNow,
    timeUntilNextSync,
  } = useTransactionPolling();

  const handleSync = async () => {
    await syncNow();
  };

  // Compact version - just a refresh button with status
  if (compact) {
    return (
      <Button
        onClick={handleSync}
        disabled={isSyncing}
        variant="outline"
        size="sm"
        className={`relative h-10 px-3 border-2 border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 hover:border-primary/60 dark:hover:border-primary/60 text-gray-700 dark:text-gray-200 transition-all duration-200 ${className}`}
        title={`${info ? `${info} • ` : ''}Last synced: ${formatLastSyncTime(lastSyncTime)}${error ? ` (Error: ${error})` : ''}`}
      >
        <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
        {error && (
          <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 dark:bg-red-400 rounded-full" />
        )}
        {!error && info && (
          <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 dark:bg-blue-400 rounded-full" />
        )}
      </Button>
    );
  }

  // Full version with status details
  return (
    <div className={`flex items-center gap-2 sm:gap-3 ${className}`}>
      {/* Sync Button - improved dark mode styling */}
      <Button
        onClick={handleSync}
        disabled={isSyncing}
        variant="outline"
        size="sm"
        className="h-10 px-3 sm:px-4 flex items-center gap-2 border-2 border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 hover:border-primary/60 dark:hover:border-primary/60 text-gray-700 dark:text-gray-200 transition-all duration-200"
      >
        <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
        <span className="hidden sm:inline font-medium">
          {isSyncing ? 'Syncing...' : 'Sync'}
        </span>
      </Button>

      {/* Status Info */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {error ? (
          <>
            <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400" />
            <span className="text-red-500 dark:text-red-400 hidden sm:inline">Sync failed</span>
          </>
        ) : info ? (
          <>
            <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="hidden sm:inline text-blue-700 dark:text-blue-300">
              {info}
            </span>
          </>
        ) : lastSyncTime ? (
          <>
            <CheckCircle className="w-4 h-4 text-green-500 dark:text-green-400" />
            <span className="hidden sm:inline text-foreground/80">
              {formatLastSyncTime(lastSyncTime)}
              {lastSyncCount !== null && lastSyncCount > 0 && (
                <span className="text-green-600 dark:text-green-400 ml-1">
                  (+{lastSyncCount})
                </span>
              )}
            </span>
          </>
        ) : (
          <>
            <Clock className="w-4 h-4" />
            <span className="hidden sm:inline">Not synced yet</span>
          </>
        )}
      </div>

      {/* Countdown to next sync - only show in development mode */}
      {isDevelopment && showCountdown && timeUntilNextSync !== null && !isSyncing && (
        <div className="hidden md:flex items-center gap-1 text-xs text-muted-foreground/70">
          <Clock className="w-3 h-3" />
          <span>Next: {formatTimeUntilSync(timeUntilNextSync)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Minimal sync button that can be placed anywhere
 */
export function SyncButton({
  className = '',
  showLabel = true,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const { isSyncing, syncNow, error, info } = useTransactionPolling();

  return (
    <Button
      onClick={syncNow}
      disabled={isSyncing}
      variant="outline"
      size="sm"
      className={`h-10 px-3 sm:px-4 flex items-center gap-2 border-2 border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 hover:border-primary/60 dark:hover:border-primary/60 text-gray-700 dark:text-gray-200 transition-all duration-200 ${className}`}
      title={error ? `Error: ${error}` : info ? info : 'Sync transactions'}
    >
      <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
      {showLabel && (
        <span className="font-medium">{isSyncing ? 'Syncing...' : 'Sync'}</span>
      )}
    </Button>
  );
}

/**
 * Banner component for showing sync status at the top of a page
 */
export function SyncStatusBanner({ className = '' }: { className?: string }) {
  const {
    lastSyncTime,
    isSyncing,
    error,
    info,
    lastSyncCount,
    syncNow,
  } = useTransactionPolling();

  if (!error && !isSyncing && lastSyncTime) {
    // Don't show banner when everything is fine and recently synced
    const timeSinceSync = Date.now() - lastSyncTime.getTime();
    if (timeSinceSync < 60000) { // Less than 1 minute ago
      return null;
    }
  }

  // Show success message briefly after sync
  if (!error && lastSyncCount !== null && lastSyncCount > 0 && lastSyncTime) {
    const timeSinceSync = Date.now() - lastSyncTime.getTime();
    if (timeSinceSync < 5000) { // Within 5 seconds
      return (
        <div className={`bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 flex items-center justify-between ${className}`}>
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
            <span className="text-sm text-green-700 dark:text-green-300">
              Synced {lastSyncCount} new transaction{lastSyncCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      );
    }
  }

  // Show error state
  if (error) {
    return (
      <div className={`bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-center justify-between ${className}`}>
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
          <span className="text-sm text-red-700 dark:text-red-300">
            Sync failed: {error}
          </span>
        </div>
        <Button
          onClick={syncNow}
          disabled={isSyncing}
          variant="outline"
          size="sm"
          className="border-red-300 text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/30"
        >
          <RefreshCw className={`w-4 h-4 mr-1 ${isSyncing ? 'animate-spin' : ''}`} />
          Retry
        </Button>
      </div>
    );
  }

  // Show syncing state
  if (isSyncing) {
    return (
      <div className={`bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-center gap-2 ${className}`}>
        <RefreshCw className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
        <span className="text-sm text-blue-700 dark:text-blue-300">
          Syncing transactions...
        </span>
      </div>
    );
  }

  // Show info state (non-error), e.g. already running
  if (info) {
    return (
      <div className={`bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-center gap-2 ${className}`}>
        <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        <span className="text-sm text-blue-700 dark:text-blue-300">
          {info}
        </span>
      </div>
    );
  }

  return null;
}
