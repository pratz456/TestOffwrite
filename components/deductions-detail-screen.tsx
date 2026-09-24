"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, DollarSign, FileText, TrendingUp, Calendar } from 'lucide-react';
import { formatCategory } from '@/lib/utils';
import { summarizeConfirmedDeductions } from '@/lib/tax/display-deductions';

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
      <div className="min-h-full bg-background">
        <div className="bg-background/95 border-b border-border sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3">
            <div className="flex items-center gap-4">
              <div className="h-9 w-20 bg-muted rounded animate-pulse" />
              <div className="space-y-2">
                <div className="h-6 w-56 bg-muted rounded animate-pulse" />
                <div className="h-4 w-72 bg-muted rounded animate-pulse" />
              </div>
            </div>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="lg:col-span-2 space-y-3">
              <div className="h-10 w-48 bg-muted rounded animate-pulse" />
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
              ))}
            </div>
            <div className="space-y-3">
              <div className="h-10 w-40 bg-muted rounded animate-pulse" />
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-12 bg-muted rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const summary = summarizeConfirmedDeductions(transactions);
  if (summary.reviewMessage) return <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6"><h1 className="text-xl font-semibold">Deductions</h1><p role="alert" className="mt-3 text-sm text-muted-foreground">{summary.reviewMessage}</p><Button className="mt-3" onClick={onBack}>Back</Button></div>;
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
    <div className="min-h-full bg-background">
      {/* Header */}
      <div className="bg-background/95 border-b border-border sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center gap-4">
            <Button onClick={onBack} variant="outline" size="sm" className="min-h-11 gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Tax Deductions Breakdown</h1>
              <p className="text-sm text-muted-foreground">Confirmed transaction deductions for the selected period</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
        <p className="mb-4 text-xs text-muted-foreground">Refunds reduce deductions; the meals limit is applied. Vehicle methods, assets and home-office deductions need separate review in Tax Preview. These amounts are not tax savings.</p>
        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <Card className="p-4 bg-card border-border rounded-2xl shadow-none">
            <div className="flex items-center gap-4">
              <div className="w-9 h-9 shrink-0 bg-emerald-100 rounded-xl flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Confirmed Transaction Deductions</p>
                <p className="text-2xl font-semibold tabular-nums text-foreground">${totalDeductions.toLocaleString()}</p>
              </div>
            </div>
          </Card>

          <Card className="p-4 bg-card border-border rounded-2xl shadow-none">
            <div className="flex items-center gap-4">
              <div className="w-9 h-9 shrink-0 bg-green-100 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Confirmed Net Outflows</p>
                <p className="text-2xl font-semibold tabular-nums text-foreground">${totalRecordedAmount.toLocaleString()}</p>
              </div>
            </div>
          </Card>

          <Card className="p-4 bg-card border-border rounded-2xl shadow-none">
            <div className="flex items-center gap-4">
              <div className="w-9 h-9 shrink-0 bg-blue-100 rounded-xl flex items-center justify-center">
                <FileText className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Confirmed Records</p>
                <p className="text-2xl font-semibold tabular-nums text-foreground">{filteredTransactions.length}</p>
              </div>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {/* Transactions List */}
          <div className="lg:col-span-2">
            <Card className="p-4 bg-card border-border rounded-2xl shadow-none">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h3 className="text-sm font-semibold text-foreground">Confirmed Expenses and Refunds</h3>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={selectedPeriod}
                    onChange={(e) => setSelectedPeriod(e.target.value)}
                    aria-label="Filter by time period"
                    className="min-h-11 max-w-full px-3 py-2 border border-border bg-background rounded-lg text-sm"
                  >
                    {periods.map(period => (
                      <option key={period} value={period}>{period}</option>
                    ))}
                  </select>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    aria-label="Filter by category"
                    className="min-h-11 max-w-full px-3 py-2 border border-border bg-background rounded-lg text-sm"
                  >
                    {categories.map(category => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                {filteredTransactions.length === 0 ? (
                  <div className="text-center py-7">
                    <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <h4 className="text-sm font-medium text-foreground mb-1">
                      {deductibleTransactions.length === 0
                        ? 'No deductible expenses yet'
                        : 'No results for this filter'}
                    </h4>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      {deductibleTransactions.length === 0
                        ? 'Confirmed business transactions appear here after review, including refunds and the meals limit.'
                        : 'Try changing the time period or category filter to see more expenses.'}
                    </p>
                  </div>
                ) : (
                  filteredTransactions
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map((transaction) => (
                      <div key={transaction.id} className="flex items-center justify-between gap-3 p-3 bg-muted/35 rounded-lg hover:bg-muted/60 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                            <DollarSign className="w-4 h-4 text-emerald-600" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{transaction.description}</p>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              <span>{formatCategory(transaction.category)}</span>
                              <span>•</span>
                              <span>{transaction.date.slice(0, 10)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-foreground">${summary.contributions.get(transaction)!.toFixed(2)}</p>
                          <p className="text-xs text-emerald-600">Deduction contribution</p>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </Card>
          </div>

          {/* Category Breakdown */}
          <div>
            <Card className="p-4 bg-card border-border rounded-2xl shadow-none">
              <h3 className="text-sm font-semibold text-foreground mb-4">Category Breakdown</h3>
              <div className="space-y-3">
                {categoryEntries.map(([category, amount]) => {
                  const magnitude = categoryEntries.reduce((sum, [, value]) => sum + Math.abs(value), 0);
                  const percentage = magnitude > 0 ? Math.abs(amount) / magnitude * 100 : 0;
                  return (
                    <div key={category} className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-foreground">{category}</span>
                        <span className="text-sm text-foreground">${amount.toFixed(2)}</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div 
                          className="bg-emerald-600 h-2 rounded-full transition-all duration-300"
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
            <Card className="p-4 bg-card border-border rounded-2xl shadow-none mt-4">
              <div className="mb-4">
                <h3 className="text-sm font-semibold mb-2">Keep supporting records</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Keep detailed records and receipts for all business expenses. The IRS requires documentation to support your deductions.
                </p>
              </div>
              <Button asChild size="sm" variant="outline" className="min-h-11 w-full">
                <a href="/protected?screen=tax-preview">Review your tax estimate</a>
              </Button>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};
