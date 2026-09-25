"use client";

import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { DollarSign, FileText } from 'lucide-react';
import { formatCategory } from '@/lib/utils';
import { summarizeConfirmedDeductions } from '@/lib/tax/display-deductions';
import { AppMetricStrip, AppPageHeader, AppScreenShell } from '@/components/app/app-screen-shell';

interface Transaction {
  id: string;
  merchant_name: string;
  amount: number;
  category: string;
  date: string;
  type?: 'expense' | 'income';
  is_deductible?: boolean | null;
  deductible_reason?: string;
  deduction_score?: number;
  description?: string;
  notes?: string;
}

interface DeductionsDetailScreenProps {
  user: {
    id: string;
    email?: string;
    user_metadata?: {
      name?: string;
    };
  };
  onBack: () => void;
  transactions?: Transaction[] | null;
}

export const DeductionsDetailScreen: React.FC<DeductionsDetailScreenProps> = ({ 
  onBack, 
  transactions,
}) => {
  const [selectedPeriod, setSelectedPeriod] = useState('This Year');
  const [selectedCategory, setSelectedCategory] = useState('All Categories');

  const periods = ['This Month', 'Last Month', 'This Quarter', 'This Year', 'All Time'];

  if (!transactions) {
    return (
      <AppScreenShell width="wide">
        <div className="h-20 animate-pulse rounded-xl border border-border/70 bg-card" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="space-y-2 lg:col-span-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-xl bg-muted" />
        </div>
      </AppScreenShell>
    );
  }

  const summary = summarizeConfirmedDeductions(transactions);
  if (summary.reviewMessage) return (
    <AppScreenShell width="wide">
      <AppPageHeader title="Tax deductions" description="Confirmed transaction deductions for a selected period." onBack={onBack} />
      <Card className="border-border/70 bg-card p-4 shadow-[var(--shadow-tight)]">
        <p role="alert" className="text-sm text-muted-foreground">{summary.reviewMessage}</p>
      </Card>
    </AppScreenShell>
  );
  const deductibleTransactions = summary.transactions;
  
  // Get unique categories
  const categories = ['All Categories', ...Array.from(new Set(deductibleTransactions.map(t => t.category)))];

  // Apply filters
  const filteredTransactions = deductibleTransactions.filter(transaction => {
    // Category filter
    if (selectedCategory !== 'All Categories' && transaction.category !== selectedCategory) {
      return false;
    }

    // Period filter
    if (selectedPeriod !== 'All Time') {
      const transactionDate = new Date(`${transaction.date.slice(0, 10)}T12:00:00Z`);
      const now = new Date();
      
      switch (selectedPeriod) {
        case 'This Month':
          if (transactionDate.getUTCMonth() !== now.getMonth() ||
              transactionDate.getUTCFullYear() !== now.getFullYear()) {
            return false;
          }
          break;
        case 'Last Month':
          const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1);
          if (transactionDate.getUTCMonth() !== lastMonth.getMonth() ||
              transactionDate.getUTCFullYear() !== lastMonth.getFullYear()) {
            return false;
          }
          break;
        case 'This Quarter':
          const quarter = Math.floor(now.getMonth() / 3);
          const transactionQuarter = Math.floor(transactionDate.getUTCMonth() / 3);
          if (transactionQuarter !== quarter || 
              transactionDate.getUTCFullYear() !== now.getFullYear()) {
            return false;
          }
          break;
        case 'This Year':
          if (transactionDate.getUTCFullYear() !== now.getFullYear()) {
            return false;
          }
          break;
      }
    }
    
    return true;
  });

  const totalDeductions = filteredTransactions.reduce((sum, t) => sum + Math.round(summary.contributions.get(t)! * 100), 0) / 100;
  const totalRecordedAmount = filteredTransactions.reduce((sum, t) => sum + Math.round(t.amount * 100), 0) / 100;

  // Group by category for breakdown
  const categoryBreakdown = filteredTransactions.reduce((acc, transaction) => {
    if (!acc[transaction.category]) {
      acc[transaction.category] = 0;
    }
    acc[transaction.category] += summary.contributions.get(transaction)!;
    return acc;
  }, {} as Record<string, number>);

  const categoryEntries = Object.entries(categoryBreakdown)
    .sort(([,a], [,b]) => b - a);

  return (
    <AppScreenShell width="wide">
      <AppPageHeader title="Tax deductions" description="Confirmed transaction deductions for the selected period." onBack={onBack} />
      <p className="px-1 text-xs leading-5 text-muted-foreground">Refunds reduce deductions; the meals limit is applied. Vehicle methods, assets and home-office deductions need separate review in Tax Preview. These amounts are not tax savings.</p>
      <AppMetricStrip metrics={[
        { label: 'Confirmed deductions', value: `$${totalDeductions.toLocaleString()}`, tone: 'success' },
        { label: 'Confirmed net outflows', value: `$${totalRecordedAmount.toLocaleString()}` },
        { label: 'Confirmed records', value: filteredTransactions.length },
      ]} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* Transactions List */}
          <div className="lg:col-span-2">
            <Card className="border-border/70 bg-card p-4 shadow-[var(--shadow-tight)]">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-base font-semibold text-foreground">Confirmed expenses and refunds</h3>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={selectedPeriod}
                    onChange={(e) => setSelectedPeriod(e.target.value)}
                    aria-label="Filter by time period"
                    className="min-h-11 min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                  >
                    {periods.map(period => (
                      <option key={period} value={period}>{period}</option>
                    ))}
                  </select>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    aria-label="Filter by category"
                    className="min-h-11 min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
                  >
                    {categories.map(category => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                {filteredTransactions.length === 0 ? (
                  <div className="py-10 text-center">
                    <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/35" />
                    <h4 className="mb-1 text-sm font-medium text-foreground">
                      {deductibleTransactions.length === 0
                        ? 'No deductible expenses yet'
                        : 'No results for this filter'}
                    </h4>
                    <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                      {deductibleTransactions.length === 0
                        ? 'Confirmed business transactions appear here after review, including refunds and the meals limit.'
                        : 'Try changing the time period or category filter to see more expenses.'}
                    </p>
                  </div>
                ) : (
                  filteredTransactions
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map((transaction) => (
                      <div key={transaction.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/25 p-3 transition-colors hover:bg-muted/45">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--success)/0.12)]">
                            <DollarSign className="h-4 w-4 text-[hsl(var(--success))]" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{transaction.description || transaction.merchant_name || 'Recorded expense'}</p>
                            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                              <span>{formatCategory(transaction.category)}</span>
                              <span>•</span>
                              <span>{transaction.date.slice(0, 10)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold tabular-nums text-foreground">${summary.contributions.get(transaction)!.toFixed(2)}</p>
                          <p className="text-[11px] text-[hsl(var(--success))]">Deduction basis</p>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </Card>
          </div>

          {/* Category Breakdown */}
          <div>
            <Card className="border-border/70 bg-card p-4 shadow-[var(--shadow-tight)]">
              <h3 className="mb-4 text-base font-semibold text-foreground">Category breakdown</h3>
              <div className="space-y-3">
                {categoryEntries.length === 0 && <p className="text-sm text-muted-foreground">No categories match these filters.</p>}
                {categoryEntries.map(([category, amount]) => {
                  const magnitude = categoryEntries.reduce((sum, [, value]) => sum + Math.abs(value), 0);
                  const percentage = magnitude > 0 ? Math.abs(amount) / magnitude * 100 : 0;
                  return (
                    <div key={category} className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-foreground">{formatCategory(category)}</span>
                        <span className="text-sm tabular-nums text-foreground">${amount.toFixed(2)}</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted">
                        <div 
                          className="h-2 rounded-full bg-[hsl(var(--success))] transition-all duration-300"
                          style={{ width: `${percentage}%` }}
                        ></div>
                      </div>
                      <div className="text-xs text-muted-foreground">{percentage.toFixed(1)}% of category magnitude</div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Tax Tips */}
            <Card className="mt-3 border-primary/20 bg-primary/5 p-4 shadow-[var(--shadow-tight)]">
              <h3 className="text-sm font-semibold text-foreground">Recordkeeping reminder</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Keep receipts and business-purpose notes with each expense. A category alone may not be enough to support a deduction.
              </p>
            </Card>
          </div>
        </div>
    </AppScreenShell>
  );
};
