'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, AlertCircle, ChevronRight } from 'lucide-react';

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
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 px-5">
        <CardTitle className="text-sm font-medium">Transaction Status</CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 flex-1 flex flex-col">
        <div className="space-y-2.5 flex-1">
          {needsAnalysisCount > 0 && (
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
              <span className="text-xs text-muted-foreground">
                {needsAnalysisCount} uncategorized transactions
              </span>
            </div>
          )}
          {needsReviewCount > 0 && (
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
              <span className="text-xs text-muted-foreground">
                {needsReviewCount} pending review
              </span>
            </div>
          )}
          {deductibleCount > 0 && (
            <div className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-success mt-0.5 shrink-0" />
              <span className="text-xs text-muted-foreground">
                {deductibleCount} confirmed deductions
              </span>
            </div>
          )}
        </div>

        {/* CTA */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onNavigate('review-transactions')}
          className="w-full min-h-[44px] mt-4 text-xs gap-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Review recommendations
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}
