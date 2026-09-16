'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TaxCalculationNotice } from '@/components/tax-calculation-notice';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';

interface QuarterlyTaxCalculatorProps { userProfile?: Record<string, unknown>; transactions?: unknown[] }
interface Summary {
  taxYear: number; totalEstimatedTax: number; recordedEstimatedPayments: number; w2Withheld: number; totalFederalWithheld?: number;
  calculationWarnings: string[]; paymentReview: { message: string };
  quarters: { quarter: number; dueDate: string; amountPaid: number }[];
}
const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
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
  return <div className="space-y-4">
    <Card><CardHeader><CardTitle>{year} Quarterly Payment Planning</CardTitle></CardHeader><CardContent className="space-y-3">
      <div role="note" className="rounded-lg border p-3"><h2 className="font-semibold">Payment amount needs review</h2><p className="mt-1 text-sm">{data.paymentReview.message}</p></div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div><dt>Federal estimate from saved annual records</dt><dd className="font-semibold">{money(data.totalEstimatedTax)}</dd></div>
        <div><dt>Recorded estimated payments</dt><dd className="font-semibold">{money(data.recordedEstimatedPayments)}</dd></div>
        <div><dt>Recorded federal withholding</dt><dd className="font-semibold">{money(data.totalFederalWithheld ?? data.w2Withheld)}</dd></div>
      </dl>
      <p className="text-sm text-muted-foreground">Saved records may cover only part of the year. These figures are not a full-year forecast or an installment amount due.</p>
      <div className="flex flex-wrap gap-3 text-sm underline"><a href="/tools/quarterly-estimate-calculator">Open payment-planning tool</a><a href="https://www.irs.gov/pub/irs-pdf/f1040es.pdf" target="_blank" rel="noopener noreferrer">Official IRS 1040-ES worksheet and vouchers</a><a href="https://www.irs.gov/payments" target="_blank" rel="noopener noreferrer">IRS payment options</a></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Standard payment calendar and recorded payments</CardTitle></CardHeader><CardContent>
      {data.quarters.map(quarter => <div key={quarter.quarter} className="flex flex-wrap justify-between gap-2 border-b py-3"><span>Q{quarter.quarter} · {quarter.dueDate}</span><span>{money(quarter.amountPaid)} recorded</span></div>)}
      <p className="mt-3 text-sm text-muted-foreground">Dates do not establish whether a payment is required, timely or sufficient. Special relief and annualized-income calculations require separate review.</p>
    </CardContent></Card>
    <TaxCalculationNotice warnings={data.calculationWarnings} taxYear={year} />
  </div>;
}
export default QuarterlyTaxCalculator;
