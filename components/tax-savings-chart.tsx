"use client";

import React from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { getUserTaxRate } from '@/lib/tax-rules/federal-brackets';
import { TrendingUp, Calendar, DollarSign } from 'lucide-react';

interface TaxSavingsData {
  day: number;
  date: string;
  deductibleAmount: number;
  taxSavings: number;
  cumulativeSavings: number;
}

interface TaxSavingsChartProps {
  transactions?: any[];
}

export const TaxSavingsChart: React.FC<TaxSavingsChartProps> = ({ transactions = [] }) => {
  // Generate data from real transactions instead of mock data
  const generateChartData = (): TaxSavingsData[] => {
    if (!transactions || transactions.length === 0) {
      return [];
    }

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    
    const data: TaxSavingsData[] = [];
    let cumulativeSavings = 0;
    
    for (let day = 1; day <= Math.min(daysInMonth, 31); day++) {
      const date = new Date(currentYear, currentMonth, day);
      const dateString = date.toISOString().split('T')[0];
      
      // Find transactions for this day
      const dayTransactions = transactions.filter(t => {
        const txnDate = new Date(t.date).toISOString().split('T')[0];
        return txnDate === dateString;
      });
      
      // Calculate deductible amount and tax savings for this day
      const deductibleTransactions = dayTransactions.filter(t => t.is_deductible === true);
      const deductibleAmount = deductibleTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
      const taxSavings = deductibleAmount * getUserTaxRate();
      
      cumulativeSavings += taxSavings;
      
      data.push({
        day,
        date: dateString,
        deductibleAmount,
        taxSavings,
        cumulativeSavings
      });
    }
    
    return data;
  };

  const chartData = generateChartData();
  const maxDailySavings = chartData.length > 0 ? Math.max(...chartData.map(d => d.taxSavings)) : 0;
  const safeMax = maxDailySavings || 1;
  const totalSavings = chartData.length > 0 ? chartData[chartData.length - 1]?.cumulativeSavings || 0 : 0;
  const activeDays = chartData.filter(d => d.taxSavings > 0).length;
  const avgDailySavings = activeDays > 0 ? totalSavings / activeDays : 0;

  const deductibleTransactions = transactions.filter(t => t.is_deductible === true);

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthProgress = (now.getDate() / daysInMonth) * 100;

  if (deductibleTransactions.length === 0) {
    return (
      <Card className="p-4 sm:p-6 bg-white border-0 shadow-xl">
        <div className="text-center py-8 px-4">
          <TrendingUp className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="text-sm font-medium text-muted-foreground mb-1">No tax savings data yet</h3>
          <p className="text-xs text-muted-foreground">Deductible transactions will appear here as they are classified.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-6 bg-white border-0 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6 gap-3">
        <div>
          <h3 className="text-lg sm:text-xl font-semibold text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600" />
            Daily Tax Savings
          </h3>
          <p className="text-sm sm:text-base text-slate-600">Individual daily tax savings from deductible expenses</p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-2">
          <div className="text-left sm:text-right">
            <p className="text-xl sm:text-2xl font-bold text-emerald-600">${totalSavings.toFixed(2)}</p>
            <p className="text-xs sm:text-sm text-slate-500">Total This Month</p>
          </div>
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
            <span>Daily Savings</span>
          </div>
        </div>
      </div>

      {/* Chart Container */}
      <div className="relative h-64 mb-6" role="img" aria-label="Bar chart showing daily tax savings for the current month">
        {/* Y-axis labels - Hidden on mobile, shown on desktop */}
        <div className="hidden sm:block absolute left-0 top-0 h-full flex flex-col justify-between text-xs text-muted-foreground -ml-12">
          <span>${maxDailySavings.toFixed(0)}</span>
          <span>${(maxDailySavings * 0.75).toFixed(0)}</span>
          <span>${(maxDailySavings * 0.5).toFixed(0)}</span>
          <span>${(maxDailySavings * 0.25).toFixed(0)}</span>
          <span>$0</span>
        </div>

        {/* Scrollable chart area for mobile */}
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
          <div className="inline-flex items-end h-full gap-1 sm:gap-0.5 min-w-full sm:min-w-0" style={{ minWidth: `${chartData.length * 24}px` }}>
            {chartData.map((data, index) => {
              const handleBarAction = () => {
                const dayTransactions = transactions.filter(t => {
                  const txnDate = new Date(t.date).toISOString().split('T')[0];
                  return txnDate === data.date && t.is_deductible === true;
                });

                if (dayTransactions.length > 0) {
                  const transactionList = dayTransactions
                    .map(t => `${t.merchant_name || 'Unknown'} - $${Math.abs(t.amount || 0).toFixed(2)}`)
                    .join(', ');

                  toast.info(`Day ${data.day} Breakdown`, {
                    description: `Deductible: $${data.deductibleAmount.toFixed(2)} · Savings: $${data.taxSavings.toFixed(2)} · Cumulative: $${data.cumulativeSavings.toFixed(2)} - ${transactionList}`,
                    duration: 6000,
                  });
                } else {
                  toast.info(`Day ${data.day}`, { description: 'No deductible transactions found.' });
                }
              };

              return (
              <div key={data.day} className="flex flex-col items-center touch-target" style={{ minWidth: '24px', width: '24px' }}>
                {/* Bar */}
                <div 
                  role="button"
                  tabIndex={0}
                  className="w-full bg-accent hover:bg-accent/90 active:bg-accent/80 transition-all duration-300 cursor-pointer relative group shadow-sm touch-target focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  style={{
                    height: `${(data.taxSavings / safeMax) * 100}%`,
                    minHeight: data.taxSavings > 0 ? '4px' : '0px',
                    minWidth: '20px',
                    width: '20px',
                    animationDelay: `${index * 50}ms`
                  }}
                  onClick={handleBarAction}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleBarAction();
                    }
                  }}
                  aria-label={`Day ${data.day}: $${data.taxSavings.toFixed(2)} tax savings`}
                >
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 sm:px-3 py-1 sm:py-2 bg-foreground text-white text-[10px] sm:text-xs rounded-lg opacity-0 group-hover:opacity-100 sm:group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                    <div className="font-medium">Day {data.day}</div>
                    <div>Daily Savings: ${data.taxSavings.toFixed(2)}</div>
                    <div>Running Total: ${data.cumulativeSavings.toFixed(2)}</div>
                    {data.deductibleAmount > 0 && (
                      <div className="text-accent/80">
                        Expenses: ${data.deductibleAmount.toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Day Label */}
                {index % 3 === 0 && (
                  <span className="text-[10px] sm:text-xs text-muted-foreground mt-1 sm:mt-2">{data.day}</span>
                )}
                
                {/* Mobile value indicator */}
                <div className="sm:hidden text-[9px] text-muted-foreground mt-0.5 text-center" style={{ minHeight: '16px' }}>
                  {data.taxSavings > 0 && data.taxSavings > maxDailySavings * 0.1 && (
                    <span>${data.taxSavings > 99 ? (data.taxSavings / 100).toFixed(0) + '0' : data.taxSavings.toFixed(0)}</span>
                  )}
                </div>
              </div>
            );
            })}
          </div>
        </div>
        
        {/* Mobile Y-axis labels on the right */}
        <div className="sm:hidden absolute right-0 top-0 h-full flex flex-col justify-between text-[10px] text-muted-foreground w-10 text-right pr-2">
          <span>${maxDailySavings.toFixed(0)}</span>
          <span>${(maxDailySavings * 0.75).toFixed(0)}</span>
          <span>${(maxDailySavings * 0.5).toFixed(0)}</span>
          <span>${(maxDailySavings * 0.25).toFixed(0)}</span>
          <span>$0</span>
        </div>
      </div>
      
      {/* Scroll hint on mobile */}
      <div className="sm:hidden text-center mb-2 text-xs text-slate-500">
        ← Swipe to see all days →
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 border-t pt-3 sm:pt-4">
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Calendar className="w-3 h-3 sm:w-4 sm:h-4 text-accent" />
            <span className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide">Days Active</span>
          </div>
          <p className="text-base sm:text-lg font-semibold text-foreground">
            {chartData.filter(d => d.taxSavings > 0).length}
          </p>
        </div>
        
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <DollarSign className="w-3 h-3 sm:w-4 sm:h-4 text-accent" />
            <span className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide">Avg Daily</span>
          </div>
          <p className="text-base sm:text-lg font-semibold text-foreground">
            ${avgDailySavings.toFixed(2)}
          </p>
        </div>
        
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4 text-accent" />
            <span className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide">Best Day</span>
          </div>
          <p className="text-base sm:text-lg font-semibold text-foreground">
            ${maxDailySavings.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Progress indicator */}
      <div className="mt-3 sm:mt-4">
        <div className="flex justify-between text-xs sm:text-sm text-muted-foreground mb-2">
          <span>Monthly Progress</span>
          <span>{Math.round(monthProgress)}% of month</span>
        </div>
        <div className="w-full bg-muted rounded-full h-2">
          <div 
            className="bg-accent h-2 rounded-full transition-all duration-300"
            style={{ width: `${monthProgress}%` }}
          />
        </div>
      </div>
      
      <div className="mt-3 text-[10px] sm:text-xs text-muted-foreground text-center">
        💡 Based on {Math.round(getUserTaxRate() * 100)}% effective tax rate. Each bar shows daily tax savings.
      </div>

      {/* Insights */}
      <div className="mt-4 p-4 bg-accent/5 rounded-lg border border-accent/20">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 bg-accent rounded-full animate-pulse"></div>
          <span className="text-sm font-medium text-foreground">Smart Insights</span>
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          {avgDailySavings > 50 && (
            <p>🚀 Great job! You're averaging ${avgDailySavings.toFixed(2)} in daily tax savings.</p>
          )}
          {maxDailySavings > 100 && (
            <p>🎯 Your best day saved ${maxDailySavings.toFixed(2)} in taxes!</p>
          )}
          <p>📊 Each bar represents the tax savings from that day's deductible expenses.</p>
        </div>
      </div>
    </Card>
  );
};

export default TaxSavingsChart;
