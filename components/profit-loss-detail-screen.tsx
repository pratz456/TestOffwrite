"use client";

import React, { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCategory } from '@/lib/utils';
import { 
  ArrowLeft, 
  TrendingUp, 
  TrendingDown,
  DollarSign,
  Calendar,
  FileText,
  BarChart3
} from 'lucide-react';

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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button 
            onClick={() => onNavigate('dashboard')}
            variant="outline" 
            size="sm"
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Recorded Cash Flow</h1>
            <p className="text-slate-600">Your saved inflows and outflows for the selected period—not a filed tax return</p>
          </div>
        </div>

        {/* Period Filter */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-slate-600" />
            <span className="font-medium text-slate-700">Period:</span>
          </div>
          <div className="flex gap-2">
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
              >
                {period.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="p-6 bg-white border-0 shadow-lg">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Total Revenue</p>
                <p className="text-2xl font-bold text-emerald-600">${totalRevenue.toLocaleString()}</p>
              </div>
            </div>
          </Card>

          <Card className="p-6 bg-white border-0 shadow-lg">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
                <TrendingDown className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Total Expenses</p>
                <p className="text-2xl font-bold text-red-600">${totalExpenses.toLocaleString()}</p>
              </div>
            </div>
          </Card>

          <Card className="p-6 bg-white border-0 shadow-lg">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                netProfitLoss >= 0 ? 'bg-blue-100' : 'bg-orange-100'
              }`}>
                <DollarSign className={`w-6 h-6 ${
                  netProfitLoss >= 0 ? 'text-blue-600' : 'text-orange-600'
                }`} />
              </div>
              <div>
                <p className="text-sm text-slate-600">Net P/L</p>
                <p className={`text-2xl font-bold ${
                  netProfitLoss >= 0 ? 'text-blue-600' : 'text-orange-600'
                }`}>
                  {netProfitLoss >= 0 ? '+' : ''}${netProfitLoss.toLocaleString()}
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-6 bg-white border-0 shadow-lg">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Profit Margin</p>
                <p className={`text-2xl font-bold ${
                  profitMargin >= 0 ? 'text-purple-600' : 'text-red-600'
                }`}>
                  {profitMargin.toFixed(1)}%
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Revenue & Expenses Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Revenue Breakdown */}
          <Card className="p-6 bg-white border-0 shadow-lg">
            <h3 className="text-xl font-semibold text-slate-900 mb-6 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
              Revenue Breakdown
            </h3>
            <div className="space-y-4">
              {Object.keys(revenueByCategory).length === 0 && (
                <p className="text-sm text-slate-600">No recorded inflows for this period.</p>
              )}
              {Object.entries(revenueByCategory)
                .sort(([,a], [,b]) => (b as number) - (a as number))
                .map(([category, amount]) => (
                  <div key={category} className="flex items-center justify-between p-4 bg-emerald-50 rounded-lg">
                    <div>
                      <p className="font-medium text-slate-900">{category}</p>
                      <p className="text-sm text-slate-600">
                        {(((amount as number) / totalRevenue) * 100).toFixed(1)}% of total revenue
                      </p>
                    </div>
                    <p className="text-lg font-bold text-emerald-600">
                      ${(amount as number).toLocaleString()}
                    </p>
                  </div>
                ))}
            </div>
          </Card>

          {/* Expenses Breakdown */}
          <Card className="p-6 bg-white border-0 shadow-lg">
            <h3 className="text-xl font-semibold text-slate-900 mb-6 flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-red-600" />
              Expenses Breakdown
            </h3>
            <div className="space-y-4">
              {Object.keys(expensesByCategory).length === 0 && (
                <p className="text-sm text-slate-600">No recorded outflows for this period.</p>
              )}
              {Object.entries(expensesByCategory)
                .sort(([,a], [,b]) => (b as number) - (a as number))
                .map(([category, amount]) => (
                  <div key={category} className="flex items-center justify-between p-4 bg-red-50 rounded-lg">
                    <div>
                      <p className="font-medium text-slate-900">{category}</p>
                      <p className="text-sm text-slate-600">
                        {(((amount as number) / totalExpenses) * 100).toFixed(1)}% of total expenses
                      </p>
                    </div>
                    <p className="text-lg font-bold text-red-600">
                      ${(amount as number).toLocaleString()}
                    </p>
                  </div>
                ))}
            </div>
          </Card>
        </div>

        {/* Recent Transactions */}
        <Card className="p-6 bg-white border-0 shadow-lg mt-8">
          <h3 className="text-xl font-semibold text-slate-900 mb-6 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Recent Transactions
          </h3>
          <div className="space-y-3">
            {allTransactions.length === 0 && (
              <p className="text-sm text-slate-600">No transactions were recorded for this period.</p>
            )}
            {[...allTransactions]
              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
              .slice(0, 10)
              .map((transaction) => (
                <div key={transaction.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      transaction.type === 'income' ? 'bg-emerald-100' : 'bg-red-100'
                    }`}>
                      {transaction.type === 'income' ? (
                        <TrendingUp className="w-5 h-5 text-emerald-600" />
                      ) : (
                        <TrendingDown className="w-5 h-5 text-red-600" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">{transaction.description}</p>
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <span>{formatCategory(transaction.category)}</span>
                        <span>•</span>
                        <span>{new Date(transaction.date).toLocaleDateString()}</span>
                        <span>•</span>
                        <span className={`font-medium ${
                          transaction.type === 'income' ? 'text-emerald-600' : 'text-red-600'
                        }`}>
                          {transaction.type === 'income' ? 'Revenue' : 'Expense'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className={`text-lg font-bold ${
                    transaction.type === 'income' ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                    {transaction.type === 'income' ? '+' : '-'}${transaction.amount.toLocaleString()}
                  </p>
                </div>
              ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default ProfitLossDetailScreen;
