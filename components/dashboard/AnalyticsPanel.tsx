'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart3 } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface AnalyticsPanelProps {
  transactions: any[];
}

type ViewMode = 'monthly' | 'quarterly';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

const BAR_GRADIENT_ID = 'expenseBarGradient';

export function AnalyticsPanel({ transactions }: AnalyticsPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('monthly');
  const currentYear = new Date().getFullYear();

  const chartData = useMemo(() => {
    const yearTx = transactions.filter(t => {
      try { return new Date(t.date).getFullYear() === currentYear; } catch { return false; }
    });

    if (viewMode === 'monthly') {
      const buckets = MONTHS.map((name, i) => ({ name, amount: 0 }));
      for (const tx of yearTx) {
        if (tx.amount > 0) {
          const m = new Date(tx.date).getMonth();
          buckets[m].amount += tx.amount;
        }
      }
      return buckets;
    } else {
      const buckets = QUARTERS.map(name => ({ name, amount: 0 }));
      for (const tx of yearTx) {
        if (tx.amount > 0) {
          const q = Math.floor(new Date(tx.date).getMonth() / 3);
          buckets[q].amount += tx.amount;
        }
      }
      return buckets;
    }
  }, [transactions, viewMode, currentYear]);

  const hasData = chartData.some(d => d.amount > 0);

  return (
    <Card className="h-full">
      <CardHeader className="pb-2 px-4 sm:px-5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">Expense Trends</CardTitle>
          <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('monthly')}
              className={`min-h-[44px] min-w-[44px] sm:min-w-0 px-3 py-2.5 sm:py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                viewMode === 'monthly'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setViewMode('quarterly')}
              className={`min-h-[44px] min-w-[44px] sm:min-w-0 px-3 py-2.5 sm:py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                viewMode === 'quarterly'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              Quarterly
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 sm:px-5 pb-5">
        {hasData ? (
          <div className="h-[180px] sm:h-[220px] w-full min-w-0 chart-bar-hover">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id={BAR_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  interval={viewMode === 'monthly' ? 1 : 0}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  width={32}
                />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                    boxShadow: '0 4px 12px rgba(0,0,0,.08)',
                    maxWidth: 'min(280px, 90vw)',
                  }}
                  wrapperStyle={{ outline: 'none' }}
                  formatter={(value: number) => [`$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 'Expenses']}
                />
                <Bar
                  dataKey="amount"
                  fill={`url(#${BAR_GRADIENT_ID})`}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[180px] sm:h-[220px] flex flex-col items-center justify-center text-muted-foreground">
            <BarChart3 className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">No transaction data yet</p>
            <p className="text-xs mt-1">Connect your bank to see trends</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
