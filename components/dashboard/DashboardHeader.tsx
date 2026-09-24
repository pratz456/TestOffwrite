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
  taxYear?: number;
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

export function DashboardHeader({ isRefreshing, onRefresh, lastSync, taxYear }: DashboardHeaderProps) {
  const year = taxYear ?? new Date().getFullYear();

  return (
    <div className="bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-1 sm:pt-5">
        <HistoricalAccessNotification />
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tax overview</h1>
              <span className="rounded-md border border-border/70 bg-card px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">Tax year {year}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Your business records. Your next tax steps.</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            aria-label={isRefreshing ? 'Refreshing dashboard' : 'Refresh dashboard'}
            disabled={isRefreshing}
            className="gap-2 min-h-[44px] h-11 px-3 text-xs rounded-lg border border-border/70 bg-card hover:bg-muted text-foreground font-medium shadow-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <RefreshCw className={`h-4 w-4 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </Button>
          {lastSync != null && <p className="hidden text-[10px] text-muted-foreground sm:block">Bank sync {formatLastSync(lastSync)}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
