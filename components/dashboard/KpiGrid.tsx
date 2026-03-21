'use client';

import React from 'react';
import { KpiCard } from './KpiCard';
import type { KpiTooltipContent } from '@/components/ui/kpi-tooltip';
import { DollarSign, TrendingUp, Percent, Target, AlertTriangle, BarChart3 } from 'lucide-react';
import { calcCombinedSERate, calcDeductionCaptureRate, calcUncapturedDeductions, calcQuarterlyStatus } from '@/lib/tax-rules/kpi-calculations';

interface KpiGridProps {
  grossReceipts: number;
  scheduleCNetProfit: number;
  w2Wages: number;
  totalDeductions: number;
  deductibleCount: number;
  totalTransactions: number;
  reviewedCount: number;
  unreviewedTransactions: { amount: number }[];
  filingStatus: string;
  aboveLineDeductions?: number;
  estimatedAnnualTax?: number;
  totalQuarterlyPaid?: number;
  priorYearTax?: number;
  onNavigate: (screen: string) => void;
  loadingTaxSavings?: boolean;
}

function fmt(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const TOOLTIPS: Record<string, KpiTooltipContent> = {
  scheduleCProfit: {
    what: 'Your Schedule C net profit  -  the bottom line of your business.',
    how: 'Gross receipts minus all confirmed deductible expenses. This is IRS Schedule C Line 31  -  the exact number that determines both your income tax and self-employment tax.',
    action: 'Review and confirm more transactions to make this accurate. Every dollar of legitimate expense reduces this number and reduces your tax.',
    irsRef: 'IRS Schedule C (Form 1040) Line 31',
  },
  totalDeductions: {
    what: 'Total confirmed business deductions captured so far.',
    how: 'Sum of all transactions marked deductible. Reduces Schedule C profit dollar for dollar  -  saving you tax at both your income tax rate AND the 14.13% SE tax rate combined.',
    action: 'Review unconfirmed transactions to capture more. A missed $500 deduction costs you ~$140 at a 28% combined rate.',
    irsRef: 'IRS Schedule C Part II, Lines 8-30',
  },
  combinedTaxRate: {
    what: 'Your true all-in effective tax rate on self-employment income.',
    how: 'Income tax + SE tax (15.3% on 92.35% of net profit = ~14.13%) divided by net profit. Most self-employed people are surprised  -  SE tax alone adds 14 points on top of your income bracket.',
    action: 'Lower this with deductions, SEP-IRA or Solo 401k contributions, and the QBI deduction. Each $1,000 deduction saves you this rate times $1,000.',
    irsRef: 'IRS Topic 554 (SE Tax) + Rev. Proc. 2024-40 (brackets)',
  },
  quarterlyStatus: {
    what: 'Whether you are on track with IRS quarterly estimated tax payments.',
    how: 'IRS requires quarterly payments if you expect to owe $1,000+ at filing. Shows estimated tax divided by 4, compared to what you have paid. Underpayment triggers Form 2210 penalty.',
    action: 'Pay at irs.gov/payments (IRS Direct Pay, free). Due dates: Q1 Apr 15, Q2 Jun 16, Q3 Sep 15, Q4 Jan 15. Pay an estimate even if unsure of the exact amount.',
    irsRef: 'IRS Publication 505, Form 1040-ES',
  },
  captureRate: {
    what: 'Percentage of your reviewed transactions that are deductible.',
    how: 'Confirmed deductible divided by total confirmed (yes and no). Does not include unreviewed transactions. A typical freelancer deducts 40-65% of transactions.',
    action: 'Below 30%: you may be missing deductions. Above 80%: double-check each deduction has a clear business purpose.',
    irsRef: null as any,
  },
  uncaptured: {
    what: 'Estimated tax savings sitting in your unreviewed transactions.',
    how: 'Unreviewed transactions times your current capture rate times your effective tax rate. Estimate only  -  actual savings depend on which transactions are truly business-related.',
    action: 'Tap to review now. The AI pre-classifies each one  -  you just confirm or reject in 2-3 seconds per transaction.',
    irsRef: null as any,
  },
};

export function KpiGrid({
  grossReceipts, scheduleCNetProfit, w2Wages, totalDeductions, deductibleCount,
  totalTransactions, reviewedCount, unreviewedTransactions, filingStatus,
  aboveLineDeductions = 0, estimatedAnnualTax, totalQuarterlyPaid = 0, priorYearTax,
  onNavigate, loadingTaxSavings,
}: KpiGridProps) {
  const taxRates = calcCombinedSERate(scheduleCNetProfit, filingStatus || 'single', aboveLineDeductions);
  const { captureRate, unreviewedCount, unreviewedPct } = calcDeductionCaptureRate(deductibleCount, reviewedCount, totalTransactions);
  const uncaptured = calcUncapturedDeductions(unreviewedTransactions, captureRate / 100, taxRates.combinedEffectiveRate / 100);
  const annualTaxEstimate = estimatedAnnualTax ?? taxRates.totalTaxDollars;
  const quarterly = calcQuarterlyStatus(annualTaxEstimate, totalQuarterlyPaid, priorYearTax);
  const showQuarterly = annualTaxEstimate > 200;

  const profitSubtitle = grossReceipts > 0
    ? `${fmt(grossReceipts)} gross - ${fmt(totalDeductions)} expenses`
    : 'Add income to see your profit';
  const savingsDollars = totalDeductions * (taxRates.combinedEffectiveRate / 100);
  const deductionsSubtitle = savingsDollars > 0
    ? `Saving ~${fmt(savingsDollars)} at ${taxRates.combinedEffectiveRate.toFixed(0)}% combined rate`
    : `${deductibleCount} transactions confirmed`;
  const rateValue = taxRates.combinedEffectiveRate > 0 ? `${taxRates.combinedEffectiveRate.toFixed(1)}%` : '--';
  const rateSubtitle = taxRates.combinedEffectiveRate > 0
    ? `${taxRates.seTaxRate.toFixed(1)}% SE + ${taxRates.incomeTaxEffectiveRate.toFixed(1)}% income tax`
    : 'Add income to calculate';

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
      <KpiCard
        title="Schedule C Profit"
        value={scheduleCNetProfit > 0 ? fmt(scheduleCNetProfit) : grossReceipts > 0 ? fmt(grossReceipts) : '--'}
        subtitle={profitSubtitle}
        accent="blue"
        icon={<DollarSign className="h-5 w-5" />}
        tooltip={TOOLTIPS.scheduleCProfit}
      />
      <KpiCard
        title="Total Deductions"
        value={totalDeductions > 0 ? fmt(totalDeductions) : '--'}
        subtitle={deductionsSubtitle}
        accent="emeraldStrong"
        icon={<TrendingUp className="h-5 w-5" />}
        loading={loadingTaxSavings}
        tooltip={TOOLTIPS.totalDeductions}
      />
      <KpiCard
        title="Combined Tax Rate"
        value={rateValue}
        subtitle={rateSubtitle}
        accent="amber"
        icon={<Percent className="h-5 w-5" />}
        tooltip={TOOLTIPS.combinedTaxRate}
      />
      {showQuarterly ? (
        <KpiCard
          title="Quarterly Taxes"
          value={quarterly.onTrack ? 'On Track' : `${fmt(quarterly.behindBy)} behind`}
          subtitle={`${quarterly.quarterLabel} due ${quarterly.quarterDueDate.split(',')[0]} - ${fmt(quarterly.quarterAmount)}/qtr`}
          accent={quarterly.onTrack ? 'emerald' : 'orange'}
          icon={quarterly.onTrack ? <Target className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          tooltip={TOOLTIPS.quarterlyStatus}
        />
      ) : unreviewedCount > 0 ? (
        <div onClick={() => onNavigate('review-transactions')} className="cursor-pointer">
          <KpiCard
            title="Unreviewed"
            value={`${unreviewedCount} txns`}
            subtitle={uncaptured.estimatedTaxSavings > 0 ? `~${fmt(uncaptured.estimatedTaxSavings)} est. savings` : `${unreviewedPct}% not yet reviewed`}
            accent="orange"
            icon={<AlertTriangle className="h-5 w-5" />}
            tooltip={TOOLTIPS.uncaptured}
          />
        </div>
      ) : (
        <KpiCard
          title="Capture Rate"
          value={captureRate > 0 ? `${captureRate}%` : '--'}
          subtitle={`${deductibleCount} of ${reviewedCount} reviewed`}
          accent="violet"
          icon={<BarChart3 className="h-5 w-5" />}
          tooltip={TOOLTIPS.captureRate}
        />
      )}
    </div>
  );
}
