"use client";

import React, { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCategory } from '@/lib/utils';
import { 
  TrendingUp, 
  TrendingDown,
  Calendar,
  FileText,
} from 'lucide-react';
import { AppMetricStrip, AppPageHeader, AppScreenShell } from '@/components/app/app-screen-shell';

interface ProfitLossDetailScreenProps {
  onNavigate: (screen: string) => void;
  transactions?: Array<Record<string, any>>;
}

export const ProfitLossDetailScreen: React.FC<ProfitLossDetailScreenProps> = ({ 
  onNavigate, 
  transactions = [] 
}) => {
  const [selectedPeriod, setSelectedPeriod] = useState('this-month');

  const allTransactions = useMemo(() => {
    const now = new Date();
    let start = new Date(now.getFullYear(), now.getMonth(), 1);
    let end = now;
    if (selectedPeriod === 'last-month') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    } else if (selectedPeriod === 'quarter') {
      start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    } else if (selectedPeriod === 'year') {
      start = new Date(now.getFullYear(), 0, 1);
    }
    return transactions
      .filter(transaction => transaction.pending !== true && !transaction.superseded_by)
      .filter(transaction => {
        const date = new Date(transaction.date);
        return Number.isFinite(date.getTime()) && date >= start && date <= end;
      })
      .map(transaction => {
        const amount = Math.abs(Number(transaction.amount) || 0);
        const category = String(transaction.category || 'Uncategorized');
        const kind = transaction.transaction_kind || transaction.type;
        const type = kind === 'income' || (Number(transaction.amount) < 0 && /income|revenue|sales/i.test(category))
          ? 'income'
          : kind === 'transfer' ? 'transfer' : 'expense';
        return {
          ...transaction,
          id: transaction.id || transaction.trans_id,
          description: transaction.merchant_name || transaction.description || 'Recorded transaction',
          category,
          date: String(transaction.date || ''),
          amount,
          type,
        };
      })
      .filter(transaction => transaction.type !== 'transfer' && transaction.amount > 0);
  }, [selectedPeriod, transactions]);
  
  // Calculate P/L metrics
  const revenue = allTransactions.filter(t => t.type === 'income');
  const expenses = allTransactions.filter(t => t.type === 'expense');
  
  const totalRevenue = revenue.reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = expenses.reduce((sum, t) => sum + t.amount, 0);
  const netProfitLoss = totalRevenue - totalExpenses;
  const profitMargin = totalRevenue > 0 ? (netProfitLoss / totalRevenue) * 100 : 0;

  // Group by category
  const revenueByCategory = revenue.reduce((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + t.amount;
    return acc;
  }, {} as Record<string, number>);

  const expensesByCategory = expenses.reduce((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + t.amount;
    return acc;
  }, {} as Record<string, number>);

  return (
    <AppScreenShell width="wide">
        <AppPageHeader
          title="Recorded cash flow"
          description="Saved inflows and outflows for the selected period—not a filed tax return."
          onBack={() => onNavigate('dashboard')}
          backLabel="Dashboard"
        />

        {/* Period Filter */}
        <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card p-3 shadow-[var(--shadow-tight)] sm:flex-row sm:items-center">
          <div className="flex shrink-0 items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Period</span>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Cash flow period">
            {[
              { key: 'this-month', label: 'This Month' },
              { key: 'last-month', label: 'Last Month' },
              { key: 'quarter', label: 'This Quarter' },
              { key: 'year', label: 'This Year' }
            ].map((period) => (
              <Button
                key={period.key}
                variant={selectedPeriod === period.key ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedPeriod(period.key)}
                aria-pressed={selectedPeriod === period.key}
                className="min-h-11"
              >
                {period.label}
              </Button>
            ))}
          </div>
        </div>

        <AppMetricStrip metrics={[
          { label: 'Recorded revenue', value: `$${totalRevenue.toLocaleString()}`, tone: 'success' },
          { label: 'Recorded expenses', value: `$${totalExpenses.toLocaleString()}`, tone: 'danger' },
          { label: 'Net cash flow', value: `${netProfitLoss >= 0 ? '+' : ''}$${netProfitLoss.toLocaleString()}`, tone: netProfitLoss >= 0 ? 'success' : 'danger' },
          { label: 'Cash-flow margin', value: `${profitMargin.toFixed(1)}%` },
        ]} />

        {/* Revenue & Expenses Breakdown */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* Revenue Breakdown */}
          <Card className="border-border/70 bg-card p-4 shadow-[var(--shadow-tight)]">
            <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
              <TrendingUp className="h-5 w-5 text-[hsl(var(--success))]" />
              Revenue breakdown
            </h3>
            <div className="space-y-2">
              {Object.keys(revenueByCategory).length === 0 && (
                <p className="text-sm text-muted-foreground">No recorded inflows for this period.</p>
              )}
              {Object.entries(revenueByCategory)
                .sort(([,a], [,b]) => (b as number) - (a as number))
                .map(([category, amount]) => (
                  <div key={category} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/25 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{formatCategory(category)}</p>
                      <p className="text-xs text-muted-foreground">
                        {(((amount as number) / totalRevenue) * 100).toFixed(1)}% of total revenue
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-[hsl(var(--success))]">
                      ${(amount as number).toLocaleString()}
                    </p>
                  </div>
                ))}
            </div>
          </Card>

          {/* Expenses Breakdown */}
          <Card className="border-border/70 bg-card p-4 shadow-[var(--shadow-tight)]">
            <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
              <TrendingDown className="h-5 w-5 text-destructive" />
              Expenses breakdown
            </h3>
            <div className="space-y-2">
              {Object.keys(expensesByCategory).length === 0 && (
                <p className="text-sm text-muted-foreground">No recorded outflows for this period.</p>
              )}
              {Object.entries(expensesByCategory)
                .sort(([,a], [,b]) => (b as number) - (a as number))
                .map(([category, amount]) => (
                  <div key={category} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/25 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{formatCategory(category)}</p>
                      <p className="text-xs text-muted-foreground">
                        {(((amount as number) / totalExpenses) * 100).toFixed(1)}% of total expenses
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-destructive">
                      ${(amount as number).toLocaleString()}
                    </p>
                  </div>
                ))}
            </div>
          </Card>
        </div>

        {/* Recent Transactions */}
        <Card className="border-border/70 bg-card p-4 shadow-[var(--shadow-tight)]">
          <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
            <FileText className="h-5 w-5 text-primary" />
            Recent transactions
          </h3>
          <div className="space-y-2">
            {allTransactions.length === 0 && (
              <p className="text-sm text-muted-foreground">No transactions were recorded for this period.</p>
            )}
            {[...allTransactions]
              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
              .slice(0, 10)
              .map((transaction) => (
                <div key={transaction.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/25 p-3 transition-colors hover:bg-muted/45">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      transaction.type === 'income' ? 'bg-[hsl(var(--success)/0.12)]' : 'bg-destructive/10'
                    }`}>
                      {transaction.type === 'income' ? (
                        <TrendingUp className="h-4 w-4 text-[hsl(var(--success))]" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-destructive" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{transaction.description}</p>
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>{formatCategory(transaction.category)}</span>
                        <span>•</span>
                        <span>{new Date(transaction.date).toLocaleDateString()}</span>
                        <span>•</span>
                        <span className={`font-medium ${
                          transaction.type === 'income' ? 'text-[hsl(var(--success))]' : 'text-destructive'
                        }`}>
                          {transaction.type === 'income' ? 'Revenue' : 'Expense'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className={`shrink-0 text-sm font-semibold tabular-nums ${
                    transaction.type === 'income' ? 'text-[hsl(var(--success))]' : 'text-destructive'
                  }`}>
                    {transaction.type === 'income' ? '+' : '-'}${transaction.amount.toLocaleString()}
                  </p>
                </div>
              ))}
          </div>
        </Card>
    </AppScreenShell>
  );
};

export default ProfitLossDetailScreen;
