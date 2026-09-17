'use client';

import React from 'react';
import { DollarSign, TrendingUp, Receipt, Wallet, ChevronDown, Info } from 'lucide-react';
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
      : ['SOCIAL_SECURITY_REVIEW_REQUIRED', 'PERSONAL_DEDUCTION_REVIEW_REQUIRED', 'DEPENDENT_CREDIT_REVIEW_REQUIRED'].includes(state.code ?? '') ? 'tax-organizer'
      : state.code === 'INCOME_RECONCILIATION_REQUIRED' ? 'income-tracking' : 'tax-preview';
    return <div role="alert" className="rounded-xl border p-4 text-sm">
      <h2 className="font-medium">{taxYear} federal estimate {state.status === 'review' ? 'needs review' : 'unavailable'}</h2>
      <p className="mt-1">{state.message}</p>
      <div className="mt-2 flex flex-wrap gap-x-4">
        {state.status === 'review' && <button className="min-h-[44px] underline underline-offset-4" onClick={() => onReview(target)}>{target === 'settings' ? 'Review profile' : target === 'income-tracking' ? 'Review income sources' : state.code === 'PERSONAL_DEDUCTION_REVIEW_REQUIRED' ? 'Review personal deductions' : state.code === 'DEPENDENT_CREDIT_REVIEW_REQUIRED' ? 'Review dependent eligibility' : target === 'tax-organizer' ? 'Review Social Security records' : 'Review tax inputs'}</button>}
        <button className="min-h-[44px] underline underline-offset-4" onClick={onRetry}>Retry estimate</button>
      </div>
    </div>;
  }
  const { income, form1040 } = state.snapshot;
  const warningCount = new Set(form1040.calculationWarnings.filter(note => note.trim())).size;
  return <section className="space-y-2" aria-label={`${taxYear} preliminary federal estimate`}>
    <div className="flex items-center justify-between gap-3 text-sm">
      <h2 className="font-medium">{taxYear} tax overview</h2>
      <button className="min-h-[44px] shrink-0 text-xs text-primary underline underline-offset-4" onClick={() => onReview('tax-preview')}>Review estimate</button>
    </div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
      <KpiCard compact title="Schedule C Profit" compactTitle="Schedule C profit" value={formatUSD(income.scheduleCNetProfit)}
        subtitle={`${formatUSD(income.grossReceipts)} receipts − ${formatUSD(income.totalDeductible)} expenses; before depreciation`}
        accent="blue" icon={<DollarSign className="h-5 w-5" />} />
      <KpiCard compact title="Confirmed Business Expenses" compactTitle="Confirmed expenses" value={formatUSD(income.totalDeductible)}
        subtitle="Posted, confirmed deductions for this tax year; includes category limits and refunds, excludes depreciation"
        accent="emerald" icon={<TrendingUp className="h-5 w-5" />} />
      <KpiCard compact title="Federal Tax Estimate" compactTitle="Federal tax estimate" value={formatUSD(form1040.totalTax)}
        subtitle="Annual federal estimate from saved records; excludes state tax"
        accent="amber" icon={<Receipt className="h-5 w-5" />} />
      <KpiCard compact title={form1040.refund > 0 ? 'Estimated Federal Refund' : 'Estimated Federal Balance'}
        compactTitle={form1040.refund > 0 ? 'Est. federal refund' : 'Est. federal balance'}
        value={formatUSD(form1040.refund > 0 ? form1040.refund : form1040.balanceDue)}
        subtitle="After recorded withholding and payments; not a quarterly payment schedule"
        accent="amber" icon={<Wallet className="h-5 w-5" />} />
    </div>
    <details className="group rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
        <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 leading-relaxed">
          <span className="font-medium">Preliminary · federal only.</span>{' '}
          {warningCount > 0 ? `${warningCount} calculation ${warningCount === 1 ? 'limit' : 'limits'} to review` : 'Review assumptions'} before filing or paying.
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-3 border-t border-amber-200/70 px-3 py-3 dark:border-amber-800">
        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div><dt className="font-semibold">Schedule C profit</dt><dd className="mt-1 leading-relaxed">{formatUSD(income.grossReceipts)} receipts minus {formatUSD(income.totalDeductible)} expenses, before depreciation.</dd></div>
          <div><dt className="font-semibold">Confirmed business expenses</dt><dd className="mt-1 leading-relaxed">Posted, confirmed deductions for {taxYear}, after category limits and refunds. Depreciation is separate.</dd></div>
          <div><dt className="font-semibold">Federal tax estimate</dt><dd className="mt-1 leading-relaxed">Annual estimate from saved records. State tax is excluded.</dd></div>
          <div><dt className="font-semibold">Federal balance or refund</dt><dd className="mt-1 leading-relaxed">After recorded withholding and payments. This is not a quarterly payment schedule.</dd></div>
        </dl>
        <TaxCalculationNotice warnings={form1040.calculationWarnings} taxYear={taxYear} />
      </div>
    </details>
  </section>;
}
