'use client';

import React, { useState } from 'react';
import { LandingHeader } from '@/components/landing/landing-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { calculateRegularEstimatedPayments } from '@/lib/tax-provider/regular-estimated-payments';

const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const moneyInput = (value: string, label: string) => {
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(cleaned)) throw new Error(`Enter ${label}, including zero when applicable.`);
  return Number(cleaned);
};
type Result = ReturnType<typeof calculateRegularEstimatedPayments>;
export function QuarterlyEstimateClient() {
  const [form, setForm] = useState({ taxYear: '2026', filingStatus: 'single', expectedTax: '', withholding: '', priorAvailability: '', priorAGI: '', priorTax: '', reviewed: false, regular: false, priorEligible: false, priorExceptionReviewed: false });
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const change = (key: keyof typeof form, value: string | boolean) => { setForm(previous => ({ ...previous, [key]: value })); setResult(null); setError(null); };
  const calculate = (event: React.FormEvent) => {
    event.preventDefault(); setResult(null); setError(null);
    try {
      if (!form.priorAvailability) throw new Error('Choose whether a full-year prior return is available. Unknown facts need review before comparing methods.');
      setResult(calculateRegularEstimatedPayments({
        taxYear: Number(form.taxYear), filingStatus: form.filingStatus,
        expectedTaxAfterCredits: moneyInput(form.expectedTax, 'your reviewed full-year federal tax'),
        expectedAnnualWithholding: moneyInput(form.withholding, 'expected full-year withholding'),
        reviewedTaxAmounts: form.reviewed, regularMethodConfirmed: form.regular,
        priorYear: form.priorAvailability === 'unavailable' ? { available: false, noPriorTaxExceptionRuledOut: form.priorExceptionReviewed } : {
          available: true, adjustedGrossIncome: moneyInput(form.priorAGI, 'prior-year AGI'),
          taxAfterAdjustments: moneyInput(form.priorTax, 'prior-year tax after worksheet adjustments'),
          fullTwelveMonths: form.priorEligible, sameTaxpayersAndFilingStatus: form.priorEligible, fullYearUSResident: form.priorEligible,
        },
      }));
    } catch (err) { setError(err instanceof Error ? err.message : 'Review the inputs before calculating.'); }
  };
  return <div className="min-h-screen bg-background"><LandingHeader /><main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
    <header><h1 className="text-3xl font-bold">Quarterly Payment Planning</h1><p className="mt-3 text-muted-foreground">Compare ordinary federal estimated-payment methods using a reviewed annual tax forecast. This is a planning estimate: it does not calculate your income tax return or decide what you should pay today.</p></header>
    <div className="grid gap-6 lg:grid-cols-2"><Card><CardHeader><CardTitle>Review your inputs</CardTitle></CardHeader><CardContent>
      <form onSubmit={calculate} className="space-y-4">
        <label className="block">Tax year<select aria-label="Tax year" className="mt-1 w-full rounded border bg-background p-2" value={form.taxYear} onChange={e => change('taxYear', e.target.value)}>{[2026, 2025, 2024].map(year => <option key={year}>{year}</option>)}</select></label>
        <label className="block">Filing status<select aria-label="Filing status" className="mt-1 w-full rounded border bg-background p-2" value={form.filingStatus} onChange={e => change('filingStatus', e.target.value)}>{[['single', 'Single'], ['married_filing_jointly', 'Married Filing Jointly'], ['married_filing_separately', 'Married Filing Separately'], ['head_of_household', 'Head of Household']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block">Expected annual federal tax after refundable credits<input aria-label="Expected annual federal tax" inputMode="decimal" value={form.expectedTax} onChange={e => change('expectedTax', e.target.value)} className="mt-1 w-full rounded border bg-background p-2" /></label>
        <p className="text-xs text-muted-foreground">Use the selected year’s 1040-ES worksheet line 11c. A partial-year dashboard total is not automatically a full-year forecast.</p>
        <label className="block">Expected full-year federal withholding<input aria-label="Expected annual withholding" inputMode="decimal" value={form.withholding} onChange={e => change('withholding', e.target.value)} className="mt-1 w-full rounded border bg-background p-2" /></label>
        <label className="block">Prior-year return<select aria-label="Prior-year return" className="mt-1 w-full rounded border bg-background p-2" value={form.priorAvailability} onChange={e => change('priorAvailability', e.target.value)}><option value="">Choose after reviewing your return</option><option value="eligible">I have a full 12-month prior-year return</option><option value="unavailable">No prior return, or it covered less than 12 months</option></select></label>
        {form.priorAvailability === 'eligible' && <>
          <label className="block">{Number(form.taxYear) - 1} adjusted gross income<input aria-label="Prior-year AGI" inputMode="decimal" value={form.priorAGI} onChange={e => change('priorAGI', e.target.value)} className="mt-1 w-full rounded border bg-background p-2" /></label>
          <label className="block">{Number(form.taxYear) - 1} tax after 1040-ES adjustments<input aria-label="Prior-year tax" inputMode="decimal" value={form.priorTax} onChange={e => change('priorTax', e.target.value)} className="mt-1 w-full rounded border bg-background p-2" /></label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.priorEligible} onChange={e => change('priorEligible', e.target.checked)} />My prior return covers 12 months, the taxpayer(s) and filing status are unchanged, and I was a U.S. citizen or resident for the entire prior year.</label>
        </>}
        {form.priorAvailability === 'unavailable' && <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.priorExceptionReviewed} onChange={e => change('priorExceptionReviewed', e.target.checked)} />I reviewed the no-prior-tax exception and it does not exempt me. A full 12-month prior year with no tax liability and full-year U.S. citizenship/residency can qualify even if no return was required.</label>}
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.reviewed} onChange={e => change('reviewed', e.target.checked)} />I reviewed tax adjustments, refundable credits and full-year withholding using the 1040-ES instructions. These are not just a balance due or payments made.</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.regular} onChange={e => change('regular', e.target.checked)} />The ordinary calendar-year regular method applies, with income from the first period. I do not need annualization, farming/fishing, nonresident, fiscal-year, section 1062 or special-relief rules.</label>
        <Button type="submit">Compare original installments</Button>
      </form>
    </CardContent></Card>
    <div className="space-y-4">
      {error && <p role="alert" className="rounded border p-4">{error}</p>}
      {result ? <Card><CardHeader><CardTitle>{result.taxYear} Regular-method illustration</CardTitle></CardHeader><CardContent className="space-y-4">
        <dl className="space-y-2"><div><dt>90% current-year tax target</dt><dd>{money(result.currentYearTarget)}</dd></div><div><dt>Prior-year target using prior-year AGI</dt><dd>{result.priorYearTarget === null ? 'Unavailable; current-year method only' : money(result.priorYearTarget)}</dd></div><div><dt>Annual estimated payments after expected withholding</dt><dd className="text-2xl font-semibold">{money(result.annualEstimatedPayments)}</dd></div></dl>
        {result.installments.map(item => <div key={item.quarter} className="flex justify-between gap-2 border-t pt-2"><span>Q{item.quarter} · {item.dueDate}</span><span>{money(item.amount)}</span></div>)}
        <p className="text-sm">{result.note}</p>
      </CardContent></Card> : <p className="rounded border p-4 text-sm">Complete the facts to show an illustration. Missing inputs are not treated as zero.</p>}
      <div className="space-y-3 text-sm"><p>Keep a record of each actual payment date and amount. Prior payments are not subtracted and redistributed across four past deadlines. No “paid,” “on track” or penalty verdict is produced.</p><a className="block underline" href="https://www.irs.gov/publications/p505" target="_blank" rel="noopener noreferrer">IRS Publication 505: estimated-tax rules</a><a className="block underline" href="https://www.irs.gov/forms-pubs/about-form-1040-es" target="_blank" rel="noopener noreferrer">IRS Form 1040-ES worksheet and official vouchers (choose the {form.taxYear} edition)</a><p className="text-xs text-muted-foreground">Installment dates shown already move to the next business day when the 15th falls on a weekend or legal holiday.</p></div>
    </div></div>
  </main></div>;
}
