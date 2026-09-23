'use client';

import { formatTransactionDate } from '@/lib/transactions/calendar-date';
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronRight, FileText } from 'lucide-react';
import { consolidateCategory } from '@/lib/utils';
import { dashboardRecordStatus } from '@/lib/dashboard/record-summary';
import { formatRecordedTransactionAmount } from '@/lib/transactions/amount-display';

interface RecentActivityCardProps {
  transactions: any[];
  onTransactionClick: (transaction: any) => void;
  onViewAll: () => void;
}

export function RecentActivityCard({ transactions, onTransactionClick, onViewAll }: RecentActivityCardProps) {
  const recent = transactions.slice(0, 3);

  return (
    <Card className="overflow-hidden rounded-2xl border-border/70 shadow-none">
      <CardHeader className="px-4 py-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Latest transactions</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={onViewAll}
            className="text-primary hover:text-primary hover:bg-primary/5 min-h-[44px] h-9 sm:h-8 px-2 text-xs no-tap-highlight focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            View all
            <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-1">
        {recent.length > 0 ? (
          <div className="divide-y divide-border/50">
            {recent.map((tx) => {
              const isCredit = tx.amount < 0;
              const amount = formatRecordedTransactionAmount(tx);
              const status = dashboardRecordStatus(tx);
              const needsReview = status === 'pending' || status === 'review';
              const isMarkedExpense = status === 'deductible';
              const tagLabel = { pending: 'Pending', income: 'Income', deductible: 'Marked deductible', personal: 'Personal', review: 'Needs review', skipped: 'Skipped' }[status];
              return (
                <div
                  key={tx.id}
                  role="button"
                  tabIndex={0}
                  className="flex items-center justify-between min-h-[52px] py-2 px-2 hover:bg-muted rounded-lg cursor-pointer group transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => onTransactionClick({ ...tx, _source: 'dashboard' })}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTransactionClick({ ...tx, _source: 'dashboard' }); } }}
                >
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${
                      isMarkedExpense ? 'bg-success' :
                      needsReview ? 'bg-warning' :
                      'bg-muted-foreground/40'
                    }`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                        {tx.merchant_name || tx.description || 'Unknown'}
                      </p>
                      <p className="truncate text-xs text-muted-foreground" title={`${consolidateCategory(tx.category).displayName} · ${tagLabel}`}>
                        {isCredit && !['income', 'revenue'].includes(String(tx.category).toLowerCase()) ? 'Credit / refund' : tagLabel}
                        <span aria-hidden="true"> · </span>
                        {consolidateCategory(tx.category).displayName}
                        {isCredit && !['income', 'revenue'].includes(String(tx.category).toLowerCase()) && <span className="sr-only"> · {tagLabel}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <span className={`text-sm font-semibold tabular-nums ${isCredit ? 'text-success' : 'text-foreground'}`}>
                      {amount === 'Amount needs review' ? amount : `${isCredit ? '+' : '-'}${amount}`}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatTransactionDate(tx.date, 'en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-3 px-2 py-4 text-muted-foreground">
            <FileText className="h-5 w-5 shrink-0 opacity-50" aria-hidden="true" />
            <div><p className="text-sm">No transactions yet</p><p className="mt-0.5 text-xs">Add an expense above to get started.</p></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
