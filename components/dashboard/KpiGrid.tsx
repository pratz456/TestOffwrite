'use client';

import React from 'react';
import { ArrowUpRight, ChevronDown, FileText, Info } from 'lucide-react';
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
    return <section role="status" aria-live="polite" className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-5 text-white shadow-sm sm:p-6">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-300"><FileText className="h-4 w-4" aria-hidden="true" /> {taxYear} · Federal taxes</div>
      <p className="mt-5 text-lg font-semibold">Loading your {taxYear} federal estimate…</p>
      <div aria-hidden="true" className="mt-4 h-9 w-40 animate-pulse rounded-md bg-white/10" />
      <p className="mt-4 text-xs text-slate-300">Using your saved income, expenses and tax profile.</p>
    </section>;
  }
  if (state.status !== 'ready') {
    const target = reviewTargetForCode(state.code);
    const netRefunds = confirmedDeductions?.totalDeductible != null && confirmedDeductions.totalDeductible < 0;
    return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-card shadow-sm" aria-label={`${taxYear} federal tax overview`}>
      <div className="bg-slate-900 px-5 py-4 text-white sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-xs font-medium text-slate-300"><FileText className="h-4 w-4" aria-hidden="true" /> {taxYear} · Federal taxes</p>
          <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">{state.status === 'review' ? 'Needs review' : 'Estimate unavailable'}</span>
        </div>
        <div role="alert">
          <h2 className="mt-3 max-w-md text-xl font-semibold leading-tight tracking-tight sm:text-2xl">{taxYear} federal estimate {state.status === 'review' ? 'needs review' : 'unavailable'}</h2>
          {state.status === 'review' ? <>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-300">{state.code === 'INCOME_RECONCILIATION_REQUIRED'
              ? 'Check overlapping income so the same payment is counted once.'
              : 'Resolve the flagged details to see your estimated balance or refund.'}</p>
          </> : <p className="mt-2 text-sm leading-relaxed text-slate-300">{state.message}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            {state.status === 'review' && <button className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-white px-3 text-sm font-semibold text-slate-900 transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900" onClick={() => onReview(target.screen)}>{target.label}</button>}
            <button className="min-h-11 rounded-md text-xs font-medium text-slate-300 underline underline-offset-4 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" onClick={onRetry}>Retry estimate</button>
          </div>
        </div>
      </div>
      {confirmedDeductions && <div className="px-5 py-3 sm:px-6"><dl className="flex flex-wrap items-baseline justify-between gap-2"><dt className="text-xs font-medium text-muted-foreground">{taxYear} confirmed expenses</dt><dd className="text-xl font-semibold tracking-tight tabular-nums text-foreground">{confirmedDeductions.totalDeductible === null ? 'Needs review' : formatUSD(confirmedDeductions.totalDeductible)}</dd></dl>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{confirmedDeductions.reviewMessage || (netRefunds ? 'Recorded refunds exceed confirmed expenses. Assets and home office are separate.' : 'After category limits and refunds. Assets and home office are separate.')}</p></div>}
      {state.status === 'review' && <details className="group border-t border-border/60">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-5 py-2 text-xs text-muted-foreground sm:px-6 [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="flex-1">Why review is needed</span><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
        <p className="px-5 pb-4 text-xs leading-relaxed text-muted-foreground sm:px-6">{state.message}</p>
      </details>}
    </section>;
  }
  const { income, form1040 } = state.snapshot;
  const warningCount = new Set(form1040.calculationWarnings.filter(note => note.trim())).size;
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-card shadow-sm" aria-label={`${taxYear} preliminary federal estimate`}>
    <div className="bg-slate-900 px-5 py-4 text-white sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xs font-medium text-slate-300"><FileText className="h-4 w-4" aria-hidden="true" />{taxYear} · Federal taxes</h2>
        <button className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-xs font-semibold text-blue-200 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" onClick={() => onReview('tax-preview')}>Tax details <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
      </div>
      <dl className="mt-2">
        <div>
          <dt className="text-sm text-slate-300">{form1040.refund > 0 ? 'Estimated federal refund' : 'Estimated federal balance'}</dt>
          <dd className="mt-1 break-words text-4xl font-semibold tracking-tight tabular-nums">{formatUSD(form1040.refund > 0 ? form1040.refund : form1040.balanceDue)}</dd>
          <p className="mt-2 text-xs text-slate-300">After recorded payments and withholding</p>
        </div>
      </dl>
    </div>
    <dl className="grid grid-cols-2 divide-x divide-border/60 px-5 py-3 sm:px-6">
      <div className="min-w-0 pr-3">
        <dt className="text-xs text-muted-foreground">Schedule C profit</dt>
        <dd className="mt-1 break-words text-lg font-semibold tracking-tight tabular-nums">{formatUSD(income.scheduleCNetProfit)}</dd>
      </div>
      <div className="min-w-0 pl-4">
        <dt className="text-xs text-muted-foreground">Confirmed expenses</dt>
        <dd className="mt-1 break-words text-lg font-semibold tracking-tight tabular-nums">{formatUSD(income.totalDeductible)}</dd>
      </div>
    </dl>
    <details className="group border-t border-border/60">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-5 py-2 text-xs text-muted-foreground sm:px-6 [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1 leading-snug"><span className="font-medium text-foreground">Preliminary.</span>{' '}{warningCount > 0 ? `Review ${warningCount} calculation ${warningCount === 1 ? 'limit' : 'limits'}` : 'Review assumptions'} before filing.</span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-3 border-t border-border/60 px-5 py-3 sm:px-6">
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
