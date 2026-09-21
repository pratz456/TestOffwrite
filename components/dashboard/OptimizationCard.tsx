'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, AlertCircle, ChevronRight } from 'lucide-react';

interface OptimizationCardProps {
  needsReviewCount: number;
  pendingCount: number;
  totalTransactions: number;
  deductibleCount: number;
  onNavigate: (screen: string) => void;
}

export function OptimizationCard({
  needsReviewCount,
  pendingCount,
  totalTransactions,
  deductibleCount,
  onNavigate,
}: OptimizationCardProps) {
  return (
    <Card className="min-w-0">
      <CardContent className="space-y-3 p-3 sm:p-4 md:p-4 lg:p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Transaction Status</h3>
          <span className="text-xs text-muted-foreground">{totalTransactions} total</span>
        </div>

        <p className="text-xs text-muted-foreground">All dates. Saved classifications are not a tax eligibility check.</p>

        {/* Status items */}
        <div className="space-y-2">
          {pendingCount > 0 && (
            <div className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-warning/5 border border-warning/20">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0" />
                <span className="text-xs font-medium text-foreground">Pending transactions</span>
              </div>
              <span className="text-xs font-semibold tabular-nums text-warning">{pendingCount}</span>
            </div>
          )}
          {needsReviewCount > 0 && (
            <div className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-xs font-medium text-foreground">Posted records needing review</span>
              </div>
              <span className="text-xs font-semibold tabular-nums text-primary">{needsReviewCount}</span>
            </div>
          )}
          {deductibleCount > 0 && (
            <div className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span className="text-xs font-medium text-foreground">Posted records marked deductible</span>
              </div>
              <span className="text-xs font-semibold tabular-nums text-emerald-600">{deductibleCount}</span>
            </div>
          )}
        </div>

        {/* CTA */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onNavigate('review-transactions')}
          className="w-full text-xs gap-1"
        >
          Review records
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}
