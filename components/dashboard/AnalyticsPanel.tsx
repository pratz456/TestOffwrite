'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart3 } from 'lucide-react';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface AnalyticsPanelProps {
  transactions: any[];
}

type ViewMode = 'monthly' | 'quarterly';
type DataMode = 'expenses' | 'income' | 'net';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

const GRAD_EXPENSE = 'expenseBarGradient';
const GRAD_INCOME = 'incomeBarGradient';
const GRAD_NET_POS = 'netPosGradient';
const GRAD_NET_NEG = 'netNegGradient';

const DATA_MODE_CONFIG: Record<DataMode, { label: string; tooltipLabel: string; gradient: string; color: string }> = {
  expenses: {
    label: 'Expenses',
    tooltipLabel: 'Expenses',
    gradient: GRAD_EXPENSE,
    color: 'hsl(var(--primary))',
  },
  income: {
    label: 'Income',
    tooltipLabel: 'Income',
    gradient: GRAD_INCOME,
    color: 'hsl(var(--success))',
  },
  net: {
    label: 'Net',
    tooltipLabel: 'Net',
    gradient: GRAD_NET_POS,
    color: 'hsl(var(--success))',
  },
};

export function AnalyticsPanel({ transactions }: AnalyticsPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('monthly');
  const [dataMode, setDataMode] = useState<DataMode>('net');
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const t of transactions) {
      try {
        const y = new Date(t.date).getFullYear();
        if (y >= 2000 && y <= currentYear) years.add(y);
      } catch { /* skip malformed dates */ }
    }
    if (years.size === 0) years.add(currentYear);
    return [...years].sort((a, b) => b - a);
  }, [transactions, currentYear]);

  const chartData = useMemo(() => {
    const yearTx = transactions.filter(t => {
      try { return new Date(t.date).getFullYear() === selectedYear; } catch { return false; }
    });

    const labels = viewMode === 'monthly' ? MONTHS : QUARTERS;
    const buckets = labels.map(name => ({ name, amount: 0 }));

    for (const tx of yearTx) {
      const amt = Number(tx.amount);
      if (isNaN(amt) || amt === 0) continue;

      const d = new Date(tx.date);
      const idx = viewMode === 'monthly' ? d.getMonth() : Math.floor(d.getMonth() / 3);
      const isIncome = amt < 0 || tx.type === 'income';
      const abs = Math.abs(amt);

      if (dataMode === 'expenses' && !isIncome) {
        buckets[idx].amount += abs;
      } else if (dataMode === 'income' && isIncome) {
        buckets[idx].amount += abs;
      } else if (dataMode === 'net') {
        buckets[idx].amount += isIncome ? abs : -abs;
      }
    }

    return buckets;
  }, [transactions, viewMode, selectedYear, dataMode]);

  const hasData = chartData.some(d => d.amount !== 0);
  const cfg = DATA_MODE_CONFIG[dataMode];

  const titleText = dataMode === 'expenses'
    ? 'Expense Trends'
    : dataMode === 'income'
      ? 'Income Trends'
      : 'Net Income Trends';

  return (
    <Card className="h-full">
      <CardHeader className="pb-2 px-4 sm:px-5">
        <div className="flex flex-col gap-2">
          {/* Row 1: Title + year | Monthly/Quarterly */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium">{titleText}</CardTitle>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="min-h-[36px] sm:min-h-0 px-2 py-1 text-xs font-medium rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/30 transition-colors"
                aria-label="Select year"
              >
                {availableYears.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
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

          {/* Row 2: Expenses / Income / Net toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden self-start">
            {(['net', 'income', 'expenses'] as DataMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDataMode(mode)}
                className={`min-h-[36px] min-w-[44px] sm:min-w-0 px-3 py-1.5 sm:py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  dataMode === mode
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                {DATA_MODE_CONFIG[mode].label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 sm:px-5 pb-4">
        {hasData ? (
          <div className="h-[160px] sm:h-[190px] w-full min-w-0 chart-bar-hover">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id={GRAD_EXPENSE} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                  </linearGradient>
                  <linearGradient id={GRAD_INCOME} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0.45} />
                  </linearGradient>
                  <linearGradient id={GRAD_NET_POS} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0.45} />
                  </linearGradient>
                  <linearGradient id={GRAD_NET_NEG} x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0.45} />
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
                  tickFormatter={(v: number) => {
                    const abs = Math.abs(v);
                    if (abs >= 1000) return `${v < 0 ? '-' : ''}$${(abs / 1000).toFixed(0)}k`;
                    return `${v < 0 ? '-' : ''}$${abs.toFixed(0)}`;
                  }}
                  width={56}
                />
                {dataMode === 'net' && <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1.5} />}
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                  wrapperStyle={{ outline: 'none' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;

                    const rawValue = payload[0].value;
                    const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
                    if (isNaN(value)) return null;

                    const prefix = value < 0 ? '-' : '';
                    const formatted = Math.abs(value).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    });

                    const amountColor =
                      dataMode === 'net'
                        ? value >= 0
                          ? 'hsl(var(--success))'
                          : 'hsl(var(--destructive))'
                        : dataMode === 'income'
                          ? 'hsl(var(--success))'
                          : 'hsl(var(--primary))';

                    return (
                      <div
                        style={{
                          background: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          fontSize: '12px',
                          boxShadow: '0 4px 12px rgba(0,0,0,.08)',
                          maxWidth: 'min(280px, 90vw)',
                          padding: '8px 10px',
                        }}
                      >
                        <div style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}>
                          {payload[0].payload?.name ?? label}
                        </div>
                        <div style={{ marginTop: 2, fontWeight: 800, color: amountColor }}>
                          {prefix}${formatted}
                        </div>
                        <div style={{ marginTop: 2, color: 'hsl(var(--muted-foreground))' }}>
                          {cfg.tooltipLabel}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="amount" maxBarSize={40} radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, idx) => {
                    let fill: string;
                    if (dataMode === 'net') {
                      fill = entry.amount >= 0 ? `url(#${GRAD_NET_POS})` : `url(#${GRAD_NET_NEG})`;
                    } else {
                      fill = `url(#${cfg.gradient})`;
                    }
                    return <Cell key={idx} fill={fill} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[160px] sm:h-[190px] flex flex-col items-center justify-center text-muted-foreground">
            <BarChart3 className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">No {cfg.label.toLowerCase()} data for {selectedYear}</p>
            <p className="text-xs mt-1">Connect your bank to see trends</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
