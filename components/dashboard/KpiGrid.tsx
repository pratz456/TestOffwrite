'use client';

import React from 'react';
import { KpiCard } from './KpiCard';
import {
  DollarSign,
  TrendingUp,
  Receipt,
  AlertTriangle,
  Info,
  CalendarClock,
} from 'lucide-react';

interface KpiGridProps {
  scheduleCProfit: number;
  grossIncome: number;
  totalExpenses: number;
  totalDeductions: number;
  deductibleCount: number;
  estimatedTaxRate: number;
  quarterlyTaxes: number;
}

function formatUSD(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 ? `-$${formatted}` : `$${formatted}`;
}

/** SE tax effective rate: 15.3% on 92.35% of net earnings */
const SE_TAX_EFFECTIVE_RATE = 15.3 * 0.9235; // ~14.13%

/**
 * Determine if the user is behind on quarterly estimated tax payments.
 * Q1: Jan-Mar (due Apr 15), Q2: Apr-May (due Jun 15),
 * Q3: Jun-Aug (due Sep 15), Q4: Sep-Dec (due Jan 15 next year).
 */
function getQuarterlyTaxInfo(): { currentQuarter: number; dueDate: string; isBehind: boolean } {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed

  // Determine which quarter we're in and when payment is due
  if (month <= 2) {
    return { currentQuarter: 1, dueDate: 'Apr 15', isBehind: false };
  } else if (month <= 4) {
    return { currentQuarter: 2, dueDate: 'Jun 15', isBehind: month >= 3 }; // Behind if past Q1 due date
  } else if (month <= 7) {
    return { currentQuarter: 3, dueDate: 'Sep 15', isBehind: month >= 5 };
  } else {
    return { currentQuarter: 4, dueDate: 'Jan 15', isBehind: month >= 8 };
  }
}

export function KpiGrid({
  scheduleCProfit,
  grossIncome,
  totalExpenses,
  totalDeductions,
  deductibleCount,
  estimatedTaxRate,
  quarterlyTaxes,
}: KpiGridProps) {
  const combinedTaxRate = SE_TAX_EFFECTIVE_RATE + estimatedTaxRate;
  const seRateDisplay = SE_TAX_EFFECTIVE_RATE.toFixed(1);
  const incomeRateDisplay = estimatedTaxRate.toFixed(1);
  const { currentQuarter, dueDate, isBehind } = getQuarterlyTaxInfo();

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
      <KpiCard
        title="Schedule C Profit"
        value={formatUSD(scheduleCProfit)}
        subtitle={`${formatUSD(grossIncome)} gross - ${formatUSD(totalExpenses)} expenses`}
        accent="blue"
        icon={
          <div className="relative">
            <DollarSign className="h-5 w-5" />
          </div>
        }
      />
      <KpiCard
        title="Total Deductions"
        value={formatUSD(totalDeductions)}
        subtitle={`${deductibleCount} deductible`}
        accent="emerald"
        icon={<TrendingUp className="h-5 w-5" />}
      />
      <KpiCard
        title="Combined Tax Rate"
        value={combinedTaxRate > 0 ? `${combinedTaxRate.toFixed(1)}%` : '--'}
        subtitle={combinedTaxRate > 0 ? `${seRateDisplay}% SE + ${incomeRateDisplay}% income tax` : 'Connect data to estimate'}
        accent="amber"
        icon={<Receipt className="h-5 w-5" />}
      />
      <KpiCard
        title="Quarterly Taxes"
        value={formatUSD(quarterlyTaxes)}
        subtitle={`Q${currentQuarter} due ${dueDate} - ${formatUSD(quarterlyTaxes)}/qtr`}
        accent="amber"
        icon={
          isBehind ? (
            <AlertTriangle className="h-5 w-5" />
          ) : (
            <CalendarClock className="h-5 w-5" />
          )
        }
      />
    </div>
  );
}
