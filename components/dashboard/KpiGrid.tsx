'use client';

import React from 'react';
import { KpiCard } from './KpiCard';
import {
  DollarSign,
  TrendingUp,
  Receipt,
} from 'lucide-react';

interface KpiGridProps {
  netSpend: number;
  totalTransactions: number;
  totalDeductions: number;
  deductibleCount: number;
  estimatedTaxRate: number;
  taxSavings: number;
  projectedAnnual: number;
  loadingTaxSavings: boolean;
}

function formatUSD(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function KpiGrid({
  netSpend,
  totalTransactions,
  totalDeductions,
  deductibleCount,
  estimatedTaxRate,
  taxSavings,
  projectedAnnual,
  loadingTaxSavings,
}: KpiGridProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <KpiCard
        title="Net Spend"
        value={formatUSD(netSpend)}
        subtitle={`${totalTransactions} transactions`}
        accent="blue"
        icon={<DollarSign className="h-5 w-5" />}
      />
      <KpiCard
        title="Total Deductions"
        value={formatUSD(totalDeductions)}
        subtitle={`${deductibleCount} deductible`}
        accent="emerald"
        icon={<TrendingUp className="h-5 w-5" />}
      />
      <KpiCard
        title="Estimated Taxes"
        value={estimatedTaxRate > 0 ? `${estimatedTaxRate.toFixed(1)}%` : '--'}
        subtitle={estimatedTaxRate > 0 ? `Effective rate on deductions` : 'Connect data to estimate'}
        accent="amber"
        icon={<Receipt className="h-5 w-5" />}
      />
      <KpiCard
        title="Tax Savings"
        value={formatUSD(taxSavings)}
        subtitle={`Projected: ${formatUSD(projectedAnnual)} annually`}
        loading={loadingTaxSavings}
        accent="emeraldStrong"
        icon={<DollarSign className="h-5 w-5" />}
      />
    </div>
  );
}
