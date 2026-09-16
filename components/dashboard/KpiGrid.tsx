'use client';

import React from 'react';
import { DollarSign, TrendingUp, Receipt, Wallet } from 'lucide-react';
import { KpiCard } from './KpiCard';
import { TaxCalculationNotice } from '@/components/tax-calculation-notice';
import type { DashboardTaxState } from '@/lib/tax/dashboard-snapshot';

interface KpiGridProps {
  state: DashboardTaxState;
  taxYear: number;
  onRetry: () => void;
  onReview: (screen: string) => void;
}

const formatUSD = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function KpiGrid({ state, taxYear, onRetry, onReview }: KpiGridProps) {
  if (state.status === 'loading') {
    return <div role="status" aria-live="polite" className="rounded-xl border p-4 text-sm">Loading your {taxYear} federal estimate…</div>;
  }
  if (state.status !== 'ready') {
    const target = state.code === 'FILING_STATUS_REVIEW_REQUIRED' ? 'settings'
      : state.code === 'SOCIAL_SECURITY_REVIEW_REQUIRED' ? 'tax-organizer'
      : state.code === 'INCOME_RECONCILIATION_REQUIRED' ? 'income-tracking' : 'tax-preview';
    return <div role="alert" className="rounded-xl border p-4 text-sm">
      <h2 className="font-medium">{taxYear} federal estimate {state.status === 'review' ? 'needs review' : 'unavailable'}</h2>
      <p className="mt-1">{state.message}</p>
      <div className="mt-2 flex flex-wrap gap-4">
        {state.status === 'review' && <button className="underline" onClick={() => onReview(target)}>{target === 'settings' ? 'Review profile' : target === 'income-tracking' ? 'Review income sources' : target === 'tax-organizer' ? 'Review Social Security records' : 'Review tax inputs'}</button>}
        <button className="underline" onClick={onRetry}>Retry estimate</button>
      </div>
    </div>;
  }
  const { income, form1040 } = state.snapshot;
  return <section className="space-y-3" aria-label={`${taxYear} preliminary federal estimate`}>
    <div className="flex items-center justify-between gap-3 text-sm">
      <h2 className="font-medium">{taxYear} · Preliminary federal estimate</h2>
      <button className="shrink-0 text-xs underline" onClick={() => onReview('tax-preview')}>Review estimate</button>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
      <KpiCard title="Schedule C Profit" value={formatUSD(income.scheduleCNetProfit)}
        subtitle={`${formatUSD(income.grossReceipts)} receipts − ${formatUSD(income.totalDeductible)} expenses; before depreciation`}
        accent="blue" icon={<DollarSign className="h-5 w-5" />} />
      <KpiCard title="Confirmed Business Expenses" value={formatUSD(income.totalDeductible)}
        subtitle="Posted, confirmed deductions for this tax year; includes category limits and refunds, excludes depreciation"
        accent="emerald" icon={<TrendingUp className="h-5 w-5" />} />
      <KpiCard title="Federal Tax Estimate" value={formatUSD(form1040.totalTax)}
        subtitle="Annual federal estimate from saved records; excludes state tax"
        accent="amber" icon={<Receipt className="h-5 w-5" />} />
      <KpiCard title={form1040.refund > 0 ? 'Estimated Federal Refund' : 'Estimated Federal Balance'}
        value={formatUSD(form1040.refund > 0 ? form1040.refund : form1040.balanceDue)}
        subtitle="After recorded withholding and payments; not a quarterly payment schedule"
        accent="amber" icon={<Wallet className="h-5 w-5" />} />
    </div>
    <TaxCalculationNotice warnings={form1040.calculationWarnings} taxYear={taxYear} />
  </section>;
}
