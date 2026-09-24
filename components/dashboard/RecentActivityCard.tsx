'use client';

import { formatTransactionDate } from '@/lib/transactions/calendar-date';
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, FileText } from 'lucide-react';
import { consolidateCategory } from '@/lib/utils';
import { dashboardRecordStatus } from '@/lib/dashboard/record-summary';
import { formatRecordedTransactionAmount } from '@/lib/transactions/amount-display';

interface RecentActivityCardProps {
  transactions: any[];
  onTransactionClick: (transaction: any) => void;
  onViewAll: () => void;
}

export function RecentActivityCard({ transactions, onTransactionClick, onViewAll }: RecentActivityCardProps) {
  const recent = transactions.slice(0, 5);

  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl border-border/70 bg-card shadow-none hover:shadow-none motion-safe:hover:translate-y-0">
      <CardHeader className="px-4 py-3 md:px-5 md:py-3 lg:px-5 lg:py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold">Latest transactions</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Your latest saved activity, ready to review.</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onViewAll}
            className="h-11 shrink-0 px-2 text-xs font-medium text-primary hover:bg-primary/5 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            View all
            <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0 pt-0 md:px-0 md:pb-0 md:pt-0 lg:px-0 lg:pb-0 lg:pt-0">
        {recent.length > 0 ? (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center border-y border-border/60 bg-muted/35 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground sm:grid-cols-[minmax(0,1fr)_136px_108px] md:px-5" aria-hidden="true">
              <span>Transaction</span>
              <span className="hidden sm:block">Review status</span>
              <span className="text-right">Amount</span>
            </div>
            <div className="divide-y divide-border/50">
              {recent.map((tx) => {
                const isCredit = tx.amount < 0;
                const isRefund = isCredit && !['income', 'revenue'].includes(String(tx.category).toLowerCase());
                const amount = formatRecordedTransactionAmount(tx);
                const status = dashboardRecordStatus(tx);
                const needsReview = status === 'pending' || status === 'review';
                const isMarkedExpense = status === 'deductible';
                const tagLabel = { pending: 'Pending', income: 'Income', deductible: 'Marked deductible', personal: 'Personal', review: 'Needs review', skipped: 'Skipped' }[status];
                const merchant = tx.merchant_name || tx.description || 'Unknown';
                return (
                  <div
                    key={tx.id}
                    role="button"
                    tabIndex={0}
                    className="group grid min-h-[65px] cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-2.5 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_136px_108px] md:px-5"
                    onClick={() => onTransactionClick({ ...tx, _source: 'dashboard' })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTransactionClick({ ...tx, _source: 'dashboard' }); } }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-muted/40 text-xs font-semibold text-muted-foreground md:flex" aria-hidden="true">
                        {String(merchant).trim().slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">{merchant}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={`${consolidateCategory(tx.category).displayName} · ${tagLabel}`}>
                          <span className={isRefund ? '' : 'sm:hidden'}>{isRefund ? 'Credit / refund' : tagLabel}<span aria-hidden="true"> · </span></span>
                          {consolidateCategory(tx.category).displayName}
                        </p>
                      </div>
                    </div>
                    <div className="hidden min-w-0 sm:block">
                      <span className={`inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium ${
                        isMarkedExpense ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' :
                        needsReview ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" aria-hidden="true" />
                        <span className="truncate">{tagLabel}</span>
                      </span>
                    </div>
                    <div className="text-right">
                      <span className={`text-sm font-semibold tabular-nums ${isCredit ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground'}`}>
                        {amount === 'Amount needs review' ? amount : `${isCredit ? '+' : '-'}${amount}`}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {formatTransactionDate(tx.date, 'en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3 border-t border-border/60 px-5 py-7 text-muted-foreground">
            <FileText className="h-5 w-5 shrink-0 opacity-50" aria-hidden="true" />
            <div><p className="text-sm font-medium text-foreground">No transactions yet</p><p className="mt-1 text-xs">Add an expense to start building your tax records.</p></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
