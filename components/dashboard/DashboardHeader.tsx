'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { HistoricalAccessNotification } from '@/components/historical-access-notification';

interface DashboardHeaderProps {
  userName: string;
  isRefreshing: boolean;
  onRefresh: () => void;
  lastSync?: number | null;
  analysisInProgress?: boolean;
}

function formatLastSync(ms: number): string {
  const date = new Date(ms);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function DashboardHeader({ isRefreshing, onRefresh, lastSync }: DashboardHeaderProps) {
  const year = new Date().getFullYear();

  return (
    <div className="bg-background">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-3 pb-1">
        <HistoricalAccessNotification />
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">Home</h1>
              <span className="text-xs text-muted-foreground">{year}</span>
            </div>
            {lastSync != null && <p className="text-xs text-muted-foreground">Bank sync {formatLastSync(lastSync)}</p>}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            aria-label={isRefreshing ? 'Refreshing dashboard' : 'Refresh dashboard'}
            disabled={isRefreshing}
            className="gap-2 min-h-[44px] h-9 sm:h-9 px-3 text-sm rounded-lg border border-border bg-card hover:bg-muted text-foreground font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <RefreshCw className={`h-4 w-4 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
