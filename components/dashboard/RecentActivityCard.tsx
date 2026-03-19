'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronRight, FileText } from 'lucide-react';
import { consolidateCategory } from '@/lib/utils';
import { transactionNeedsTaxReview } from '@/lib/utils/transaction-tax-review';

interface RecentActivityCardProps {
  transactions: any[];
  onTransactionClick: (transaction: any) => void;
  onViewAll: () => void;
}

export function RecentActivityCard({ transactions, onTransactionClick, onViewAll }: RecentActivityCardProps) {
  const recent = transactions.slice(0, 5);

  return (
    <Card className="h-full">
      <CardHeader className="pb-2 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={onViewAll}
            className="text-primary hover:text-primary hover:bg-primary/5 min-h-[44px] h-9 sm:h-8 px-2 text-xs no-tap-highlight focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            View All
            <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-3 sm:px-5 pb-4">
        {recent.length > 0 ? (
          <div className="space-y-0.5">
            {recent.map((tx) => {
              const isIncome = tx.amount < 0;
              const amount = Math.abs(tx.amount);
              const needsReview = transactionNeedsTaxReview(tx);
              const tagLabel = needsReview ? 'Pending' : tx.is_deductible === true ? 'Ded.' : 'Personal';
              const tagVariant = needsReview ? 'outline' : tx.is_deductible === true ? 'default' : 'secondary';
              const tagClass = tx.is_deductible === true
                ? 'text-[10px] px-1.5 py-0 ml-0.5 bg-primary/15 text-primary border border-primary/25'
                : needsReview
                  ? 'text-[10px] px-1.5 py-0 ml-0.5'
                  : 'text-[10px] px-1.5 py-0 ml-0.5 bg-muted text-muted-foreground';
              return (
                <div
                  key={tx.id}
                  role="button"
                  tabIndex={0}
                  className="flex items-center justify-between min-h-[44px] py-2 px-2 sm:py-2 sm:px-2 hover:bg-muted rounded-lg cursor-pointer group transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => onTransactionClick({ ...tx, _source: 'dashboard' })}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTransactionClick({ ...tx, _source: 'dashboard' }); } }}
                >
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${
                      tx.is_deductible === true ? 'bg-success' :
                      needsReview ? 'bg-warning' :
                      'bg-muted-foreground/40'
                    }`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                        {tx.merchant_name || tx.description || 'Unknown'}
                      </p>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                        <span className="truncate max-w-[80px] sm:max-w-none">
                          {isIncome ? 'Income' : consolidateCategory(tx.category).displayName}
                        </span>
                        <span className="hidden sm:inline">&middot;</span>
                        <span className="hidden sm:inline">
                          {new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                        <Badge variant={tagVariant} className={tagClass}>
                          {tagLabel}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <span className={`text-sm font-semibold tabular-nums ${isIncome ? 'text-success' : 'text-destructive/90'}`}>
                      {isIncome ? '+' : ''}${amount.toFixed(2)}
                    </span>
                    <span className="block text-[10px] text-muted-foreground sm:hidden">
                      {new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No transactions yet</p>
            <p className="text-xs mt-1">Connect your bank to get started</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
