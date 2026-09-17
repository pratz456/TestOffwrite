'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TaxCalculationNotice } from '@/components/tax-calculation-notice';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import type { MissingFact, QuarterlyPlan, QuarterlyPlannerResponse } from '@/lib/tax-provider/quarterly-planner';

interface QuarterlyTaxCalculatorProps { userProfile?: Record<string, unknown>; transactions?: unknown[] }
interface Summary {
  taxYear: number; totalEstimatedTax: number; recordedEstimatedPayments: number; w2Withheld: number; totalFederalWithheld?: number;
  calculationWarnings: string[]; paymentReview: { code?: string; message: string; missingFacts?: MissingFact[]; notes?: string[] };
  quarters: { quarter: number; dueDate: string; amountPaid: number }[];
  planner?: QuarterlyPlannerResponse | null;
}
const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const percent = (rate: number) => `${Math.round(rate * 10000) / 100}%`;
const STATUS_LABEL = { upcoming: 'Upcoming', payment_recorded: 'Payment recorded', no_payment_recorded: 'No payment recorded' } as const;
const recordedLabel = (amountPaid: number) => amountPaid > 0 ? `Payment recorded: ${money(amountPaid)}` : 'No payment recorded';

function basisSummary(plan: QuarterlyPlan): string {
  const required = plan.requiredAnnualPayment;
  if (required.basis === 'current_year_90') return `90% of the ${plan.taxYear} federal estimate (${money(required.ninetyPercentOfCurrentYear)})`;
  return `${required.basis === 'prior_year_110' ? '110%' : '100%'} of ${plan.taxYear - 1} tax (${money(required.priorYear?.target ?? 0)})`;
}

function nextDueSection(plan: QuarterlyPlan) {
  if (plan.nextDue) {
    const next = plan.nextDue;
    return <div className="rounded-lg border p-3">
      <h2 className="font-semibold">Next due date: {next.dueDate} (Q{next.quarter})</h2>
      <p className="mt-1 text-sm">Planning estimate to pay by that date under the regular method: <span className="text-2xl font-semibold">{money(next.amountToPay)}</span></p>
      {next.amountToPay === 0 && <p className="mt-1 text-sm text-muted-foreground">Recorded payments and credited withholding already cover the installments through this date under the regular method.</p>}
      {next.includesEarlierShortfall && <p className="mt-1 text-sm text-muted-foreground">Includes earlier installments with less than the planned payment recorded; the Q{next.quarter} installment alone is {money(next.installmentOnly)}.</p>}
    </div>;
  }
  const after = plan.afterFinalDueDate;
  return <div className="rounded-lg border p-3">
    <h2 className="font-semibold">All {plan.taxYear} installment dates have passed</h2>
    <p className="mt-1 text-sm">Remaining regular-method shortfall (planning estimate): <span className="font-semibold">{money(after?.remainingShortfall ?? 0)}</span>. The return is due {after?.returnDueDate}; any penalty is figured on the return.</p>
  </div>;
}

function interestIllustration(plan: QuarterlyPlan) {
  const illustration = plan.underpaymentInterestIllustration;
  return <Card><CardHeader><CardTitle>Underpayment interest illustration (not a penalty determination)</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
    <p className="text-muted-foreground">{illustration.label}. Figured as of {illustration.asOf} through {illustration.penaltyPeriodEnd} at most.</p>
    <p>Illustrated interest so far: <span className="font-semibold">{illustration.total === null ? 'not available yet' : money(illustration.total)}</span>{illustration.total === null && ` — the IRS has not published the §6621 rate for ${illustration.unpublishedRatePeriods.join(', ')}.`}</p>
    <ul className="space-y-1">
      {illustration.byInstallment.map(item => <li key={item.quarter} className="flex flex-wrap justify-between gap-2 border-b py-1">
        <span>Q{item.quarter} · due {item.dueDate}</span>
        <span>{item.interest === null ? 'Rate not yet published' : `${money(item.interest)} illustrated`}{item.unpaidAsOf > 0 && ` · ${money(item.unpaidAsOf)} of this installment not covered as of ${illustration.asOf}`}</span>
      </li>)}
    </ul>
    <p className="text-muted-foreground">§6621 underpayment rates used: {illustration.ratePeriods.map(period => `${period.label}: ${period.rate === null ? 'not yet published' : percent(period.rate)}`).join('; ')}.</p>
    <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{illustration.notes.map(note => <li key={note}>{note}</li>)}</ul>
  </CardContent></Card>;
}

export function QuarterlyTaxCalculator({ userProfile, transactions }: QuarterlyTaxCalculatorProps) {
  const year = new Date().getFullYear();
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify({ year, userProfile, transactions, retry });
  const [result, setResult] = useState<{ key: string; data?: Summary; error?: string } | null>(null);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setResult(null);
    void (async () => {
      try {
        const response = await makeAuthenticatedRequest(`/api/tax/quarterly-reminders?year=${year}`, { signal: controller.signal, cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load your quarterly planning records. Please retry.');
        if (data.taxYear !== year || ![data.totalEstimatedTax, data.recordedEstimatedPayments, data.w2Withheld].every(value => typeof value === 'number' && Number.isFinite(value)) || (data.totalFederalWithheld !== undefined && (typeof data.totalFederalWithheld !== 'number' || !Number.isFinite(data.totalFederalWithheld))) || !Array.isArray(data.quarters) || !data.paymentReview?.message) throw new Error('The quarterly summary is incomplete. Please retry.');
        if (data.planner != null && data.planner.status !== 'ready' && data.planner.status !== 'review_required') throw new Error('The quarterly summary is incomplete. Please retry.');
        if (data.planner?.status === 'ready' && (!Array.isArray(data.planner.installments) || !data.planner.requiredAnnualPayment || !data.planner.underpaymentInterestIllustration)) throw new Error('The quarterly summary is incomplete. Please retry.');
        if (current) setResult({ key, data });
      } catch (error) {
        if (current) setResult({ key, error: error instanceof Error ? error.message : 'Could not load your quarterly planning records.' });
      }
    })();
    return () => { current = false; controller.abort(); };
  }, [key, year]);
  if (result?.key !== key) return <p role="status">Loading your {year} tax and payment records…</p>;
  if (!result.data) return <div role="alert"><p>{result.error}</p><Button onClick={() => setRetry(value => value + 1)}>Retry summary</Button></div>;
  const data = result.data;
  const plan = data.planner?.status === 'ready' ? data.planner : null;
  const missingFacts = data.planner?.status === 'review_required' ? data.planner.missingFacts : data.paymentReview.missingFacts ?? [];
  const reviewNotes = data.planner?.status === 'review_required' ? data.planner.notes : data.paymentReview.notes ?? [];
  const required = plan?.requiredAnnualPayment;
  return <div className="space-y-4">
    <Card><CardHeader><CardTitle>{year} Quarterly Payment Planning</CardTitle></CardHeader><CardContent className="space-y-3">
      {plan && required ? <>
        <div role="note" className="rounded-lg border p-3"><h2 className="font-semibold">Planning estimate from reviewed facts</h2><p className="mt-1 text-sm">{data.paymentReview.message}</p></div>
        {nextDueSection(plan)}
        <div className="rounded-lg border p-3 text-sm">
          <h3 className="font-semibold">Safe-harbor basis used: {basisSummary(plan)}</h3>
          <p className="mt-1">Required annual payment {money(required.requiredAnnualPayment)} = lesser of 90% of the {year} estimate ({money(required.ninetyPercentOfCurrentYear)}) and {required.priorYear ? `${required.priorYear.multiplier === 1.1 ? '110%' : '100%'} of ${year - 1} tax (${money(required.priorYear.target)}; ${year - 1} AGI ${money(required.priorYear.agi)} vs. ${money(required.priorYear.agiThreshold)} threshold)` : `the prior-year target (unavailable: the ${year - 1} return did not cover 12 months)`}.</p>
          <p className="mt-1">Withholding credited {money(required.withholding)} · estimated payments planned for the year {money(required.estimatedPaymentsRequired)}{required.deMinimis.applies && ` · tax less withholding ${money(required.deMinimis.taxLessWithholding)} is under $1,000, so no estimated payments are required by the regular method`}.</p>
        </div>
      </> : <>
        <div role="note" className="rounded-lg border p-3"><h2 className="font-semibold">Payment amount needs review</h2><p className="mt-1 text-sm">{data.paymentReview.message}</p>
          {missingFacts.length > 0 && <div className="mt-2 text-sm"><p className="font-medium">Save these facts to see planning figures:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">{missingFacts.map(fact => <li key={fact.key}><span className="font-medium">{fact.label}</span> — {fact.detail} <span className="whitespace-nowrap">Enter it in {fact.enterAt.map((item, index) => <React.Fragment key={item.href}>{index > 0 && ' or '}<a className="underline" href={item.href}>{item.label}</a></React.Fragment>)}.</span></li>)}</ul>
          </div>}
          {reviewNotes.map(note => <p key={note} className="mt-2 text-sm text-muted-foreground">{note}</p>)}
        </div>
      </>}
      <dl className="grid gap-3 sm:grid-cols-3">
        <div><dt>Federal estimate from saved annual records</dt><dd className="font-semibold">{money(data.totalEstimatedTax)}</dd></div>
        <div><dt>Recorded estimated payments</dt><dd className="font-semibold">{money(data.recordedEstimatedPayments)}</dd></div>
        <div><dt>Recorded federal withholding</dt><dd className="font-semibold">{money(data.totalFederalWithheld ?? data.w2Withheld)}</dd></div>
      </dl>
      <p className="text-sm text-muted-foreground">{plan
        ? `Planning estimate only. The ${year} estimate treats your saved records as the full-year forecast; if they cover only part of the year the 90% target is understated. The IRS figures any balance or penalty on the filed return.`
        : 'Saved records may cover only part of the year. These figures are not a full-year forecast or an installment amount due.'}</p>
      <div className="flex flex-wrap gap-3 text-sm underline"><a href="/tools/quarterly-estimate-calculator">Open payment-planning tool</a><a href="https://www.irs.gov/pub/irs-pdf/f1040es.pdf" target="_blank" rel="noopener noreferrer">Official IRS 1040-ES worksheet and vouchers</a><a href="https://www.irs.gov/payments" target="_blank" rel="noopener noreferrer">IRS payment options</a></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>{plan ? 'Regular-method installments and recorded payments' : 'Standard payment calendar and recorded payments'}</CardTitle></CardHeader><CardContent>
      {plan ? plan.installments.map(installment => {
        const recorded = data.quarters.find(quarter => quarter.quarter === installment.quarter)?.amountPaid ?? 0;
        return <div key={installment.quarter} className="grid gap-1 border-b py-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
          <span className="font-medium">Q{installment.quarter} · {installment.dueDate}</span>
          <span>{STATUS_LABEL[installment.status]}{installment.status !== 'upcoming' && ` · ${recordedLabel(installment.paymentsMatchedTotal)} for this period`}</span>
          <span className="text-muted-foreground">Installment (25%) {money(installment.requiredInstallment)} · withholding credited {money(installment.withholdingCredited)} · planned payment {money(installment.plannedEstimatedPayment)}</span>
          <span className="text-muted-foreground">{recordedLabel(recorded)} under Q{installment.quarter}{installment.paymentsMatchedTotal !== recorded && ` · ${money(installment.paymentsMatchedTotal)} matched to this period by payment date`}{installment.underpayment > 0 && installment.status !== 'upcoming' && ` · ${money(installment.underpayment)} of the cumulative installments not covered by recorded payments`}</span>
        </div>;
      }) : data.quarters.map(quarter => <div key={quarter.quarter} className="flex flex-wrap justify-between gap-2 border-b py-3"><span>Q{quarter.quarter} · {quarter.dueDate}</span><span>{recordedLabel(quarter.amountPaid)}</span></div>)}
      <p className="mt-3 text-sm text-muted-foreground">{plan
        ? `Installments follow the Pub 505 regular method; recorded payments are matched to periods by payment date. ${plan.annualizedIncomeMethod.note}`
        : 'Dates do not establish whether a payment is required, timely or sufficient. Special relief and annualized-income calculations require separate review.'}</p>
    </CardContent></Card>
    {plan && interestIllustration(plan)}
    {plan && <Card><CardHeader><CardTitle>Assumptions behind this planning estimate</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
      <ul className="list-disc space-y-1 pl-5">{plan.assumptions.map(assumption => <li key={assumption}>{assumption}</li>)}</ul>
      <p className="flex flex-wrap gap-3 underline"><a href={plan.sources.publication505} target="_blank" rel="noopener noreferrer">IRS Publication 505</a><a href={plan.sources.form2210Instructions} target="_blank" rel="noopener noreferrer">Form 2210 instructions</a><a href={plan.sources.quarterlyInterestRates} target="_blank" rel="noopener noreferrer">IRS quarterly interest rates</a></p>
    </CardContent></Card>}
    <TaxCalculationNotice warnings={data.calculationWarnings} taxYear={year} />
  </div>;
}
export default QuarterlyTaxCalculator;
