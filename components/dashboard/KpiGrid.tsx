'use client';

import React from 'react';
import { ArrowUpRight, ChevronDown, Info } from 'lucide-react';
import { TaxCalculationNotice } from '@/components/tax-calculation-notice';
import { reviewTargetForCode, type DashboardTaxState } from '@/lib/tax/dashboard-snapshot';

interface KpiGridProps {
  state: DashboardTaxState;
  taxYear: number;
  confirmedDeductions?: { totalDeductible: number | null; reviewMessage: string | null };
  onRetry: () => void;
  onReview: (screen: string) => void;
}

const formatUSD = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function KpiGrid({ state, taxYear, confirmedDeductions, onRetry, onReview }: KpiGridProps) {
  if (state.status === 'loading') {
    return <div role="status" aria-live="polite" className="rounded-xl border p-4 text-sm">Loading your {taxYear} federal estimate…</div>;
  }
  if (state.status !== 'ready') {
    const target = reviewTargetForCode(state.code);
    return <div className="rounded-xl border p-4 text-sm">
      {confirmedDeductions && <dl className="mb-3 border-b pb-3"><dt className="text-xs text-muted-foreground">{taxYear} confirmed expenses</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{confirmedDeductions.totalDeductible === null ? 'Needs review' : formatUSD(confirmedDeductions.totalDeductible)}</dd>
        <p className="mt-1 text-xs text-muted-foreground">{confirmedDeductions.reviewMessage || 'After category limits and refunds. Assets and home office are separate.'}</p></dl>}
      <div role="alert">
      <h2 className="font-medium">{taxYear} federal estimate {state.status === 'review' ? 'needs review' : 'unavailable'}</h2>
      {state.status === 'review' ? <>
        <p className="mt-1 text-muted-foreground">{state.code === 'INCOME_RECONCILIATION_REQUIRED'
          ? 'Check overlapping income so the same payment is counted once.'
          : 'Resolve the flagged details before we calculate your estimate.'}</p>
        <details className="mt-1">
          <summary className="min-h-11 cursor-pointer py-3 text-xs text-muted-foreground">Why review is needed</summary>
          <p className="pb-2 text-xs leading-relaxed text-muted-foreground">{state.message}</p>
        </details>
      </> : <p className="mt-1">{state.message}</p>}
      <div className="mt-2 flex flex-wrap gap-x-4">
        {state.status === 'review' && <button className="min-h-[44px] underline underline-offset-4" onClick={() => onReview(target.screen)}>{target.label}</button>}
        <button className="min-h-[44px] underline underline-offset-4" onClick={onRetry}>Retry estimate</button>
      </div>
      </div>
    </div>;
  }
  const { income, form1040 } = state.snapshot;
  const warningCount = new Set(form1040.calculationWarnings.filter(note => note.trim())).size;
  return <section className="overflow-hidden rounded-2xl border border-border/70 bg-card" aria-label={`${taxYear} preliminary federal estimate`}>
    <div className="px-4 pt-1 pb-3">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 className="text-xs font-medium text-muted-foreground">{taxYear} · Federal taxes</h2>
        <button className="inline-flex min-h-11 shrink-0 items-center gap-1 text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md" onClick={() => onReview('tax-preview')}>
          Tax details <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <dl>
        <div>
          <dt className="text-sm text-muted-foreground">{form1040.refund > 0 ? 'Estimated federal refund' : 'Estimated federal balance'}</dt>
          <dd className="mt-0.5 break-words text-3xl font-semibold tracking-tight tabular-nums">{formatUSD(form1040.refund > 0 ? form1040.refund : form1040.balanceDue)}</dd>
          <p className="mt-1 text-xs text-muted-foreground">After recorded payments and withholding</p>
        </div>
      </dl>
      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border/60 pt-3">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Schedule C profit</dt>
            <dd className="mt-0.5 break-words text-base font-semibold tabular-nums">{formatUSD(income.scheduleCNetProfit)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Confirmed expenses</dt>
            <dd className="mt-0.5 break-words text-base font-semibold tabular-nums">{formatUSD(income.totalDeductible)}</dd>
          </div>
      </dl>
    </div>
    <details className="group border-t border-border/60">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1 leading-snug"><span className="font-medium text-foreground">Preliminary.</span>{' '}{warningCount > 0 ? `Review ${warningCount} calculation ${warningCount === 1 ? 'limit' : 'limits'}` : 'Review assumptions'} before filing.</span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-3 border-t border-border/60 px-4 py-3">
        <dl className="space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2"><dt className="font-medium">Annual federal tax estimate</dt><dd className="font-semibold tabular-nums">{formatUSD(form1040.totalTax)}</dd></div>
          <div><dt className="font-medium">Schedule C profit</dt><dd className="mt-1 leading-relaxed">{formatUSD(income.grossReceipts)} receipts and confirmed expenses, with supported depreciation and home-office adjustments included in the profit calculation.</dd></div>
          <div><dt className="font-medium">Confirmed business expenses</dt><dd className="mt-1 leading-relaxed">Posted, confirmed deductions for {taxYear}, after category limits and refunds. Depreciation and the home office deduction are separate.</dd></div>
        </dl>
        <p className="text-xs leading-relaxed text-muted-foreground">Federal only, based on saved records. This balance is not a quarterly payment schedule. Review assumptions before filing or paying.</p>
        <TaxCalculationNotice warnings={form1040.calculationWarnings} taxYear={taxYear} />
      </div>
    </details>
  </section>;
}
