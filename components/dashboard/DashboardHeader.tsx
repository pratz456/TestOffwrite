'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { HistoricalAccessNotification } from '@/components/historical-access-notification';

interface DashboardHeaderProps {
  userName: string;
  isRefreshing: boolean;
  onRefresh: () => void;
}

export function DashboardHeader({ userName, isRefreshing, onRefresh }: DashboardHeaderProps) {
  const year = new Date().getFullYear();

  return (
    <div className="bg-background sticky top-0 z-10 border-b border-border/50 backdrop-blur-sm bg-background/95">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 sm:py-4">
        <HistoricalAccessNotification />
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Financial overview &mdash; {year}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
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
