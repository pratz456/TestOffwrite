'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, AlertCircle, ChevronRight, TrendingUp } from 'lucide-react';

interface OptimizationCardProps {
  needsReviewCount: number;
  needsAnalysisCount: number;
  totalTransactions: number;
  deductibleCount: number;
  onNavigate: (screen: string) => void;
}

export function OptimizationCard({
  needsReviewCount,
  needsAnalysisCount,
  totalTransactions,
  deductibleCount,
  onNavigate,
}: OptimizationCardProps) {
  const analyzedCount = totalTransactions - needsAnalysisCount;
  const progressPercent = totalTransactions > 0 ? Math.round((analyzedCount / totalTransactions) * 100) : 0;

  return (
    <Card className="h-full">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Transaction Status</h3>
          <span className="text-xs text-muted-foreground">{totalTransactions} total</span>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Expenses verified</span>
            <span className="text-xs font-medium tabular-nums">{progressPercent}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Status items */}
        <div className="space-y-2">
          {needsAnalysisCount > 0 && (
            <div className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-warning/5 border border-warning/20">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0" />
                <span className="text-xs font-medium text-foreground">Uncategorized</span>
              </div>
              <span className="text-xs font-semibold tabular-nums text-warning">{needsAnalysisCount}</span>
            </div>
          )}
          {needsReviewCount > 0 && (
            <div className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-xs font-medium text-foreground">Pending review</span>
              </div>
              <span className="text-xs font-semibold tabular-nums text-primary">{needsReviewCount}</span>
            </div>
          )}
          {deductibleCount > 0 && (
            <div className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span className="text-xs font-medium text-foreground">Confirmed deductions</span>
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
          Review recommendations
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}
