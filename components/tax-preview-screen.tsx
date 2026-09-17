"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, DollarSign, ArrowRight, ChevronDown, ChevronUp, AlertCircle, Loader2, Info } from "lucide-react";
import { TaxCalculationNotice } from "@/components/tax-calculation-notice";
import { SUPPORTED_TAX_YEARS } from "@/lib/tax-rules/federal-year-rules";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

interface Props {
  user: { id: string; email?: string };
  onBack: () => void;
  onNavigate?: (screen: string) => void;
}

interface TaxLine {
  num: string;
  label: string;
  value?: number;
  bold?: boolean;
  negative?: boolean;
  highlight?: 'green' | 'orange';
}

const fmt = (n: number, opts?: { abs?: boolean }) => {
  const v = opts?.abs ? Math.abs(n) : n;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
};
const pct = (n: number) => `${n.toFixed(1)}%`;

export function TaxPreviewScreen({ user, onNavigate }: Props) {
  const [year, setYear] = useState(String(SUPPORTED_TAX_YEARS[SUPPORTED_TAX_YEARS.length - 1]));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewCode, setReviewCode] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [showDetails, setShowDetails] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true); setError(null); setReviewCode(null); setData(null);
    try {
      const res = await makeAuthenticatedRequest(`/api/tax/compute-1040?year=${year}`);
      const result = await res.json();
      if (!res.ok) {
        if (currentRequest === requestId.current && res.status === 422 && typeof result.code === 'string') setReviewCode(result.code);
        throw new Error(result.error || "Failed to compute estimate");
      }
      if (currentRequest === requestId.current) setData(result);
    } catch (e) {
      if (currentRequest === requestId.current) setError(e instanceof Error ? e.message : "Failed to load tax preview");
    } finally { if (currentRequest === requestId.current) setLoading(false); }
  }, [year, user.id]);

  useEffect(() => { load(); return () => { requestId.current += 1; }; }, [load]);

  const f1040 = data?.form1040;
  const hasRefund = f1040?.refund > 0;
  const hasBalance = f1040?.balanceDue > 0;

  const calculationWarnings = Array.isArray(f1040?.calculationWarnings)
    ? [...new Set(f1040.calculationWarnings.filter((note: unknown): note is string => typeof note === "string" && note.trim().length > 0))]
    : [];
  const gaps: { msg: string; screen: string }[] = [];
  if (f1040) {
    if (data.income.grossReceipts === 0 && data.income.w2Wages === 0) gaps.push({ msg: "No income recorded yet", screen: "income-tracking" });
    if (data.income.totalDeductible === 0) gaps.push({ msg: "Review expenses and refunds", screen: "transactions" });
    if (data.w2.count === 0 && data.income.w2Wages === 0) gaps.push({ msg: "Add W-2 income if you have a day job", screen: "w2-income" });
    if (!data.stateTax) gaps.push({ msg: "Add your state to see its tax estimate", screen: "settings" });
    if (!data.income.grossReceipts && !data.income.w2Wages) gaps.push({ msg: "Complete the Tax Organizer to ensure all income is captured", screen: "tax-organizer" });
    if (!data.deductions.healthInsurancePremiums && !data.deductions.sepIraContribution) gaps.push({ msg: "Review eligible health insurance and retirement deductions", screen: "tax-organizer" });
  }
  const nextStep = gaps[0] ?? { msg: "Review your saved income and tax details", screen: "tax-organizer" };
  const amountOrDash = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? fmt(value) : "—";

  return (
    <div className="min-h-full bg-background">
      <header className="border-b border-border/70 bg-background">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2 sm:px-6">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">Tax overview</h1>
            <p className="text-xs text-muted-foreground">Your saved records, explained</p>
          </div>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger aria-label="Tax year" className="h-11 w-[92px] rounded-xl text-base"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[...SUPPORTED_TAX_YEARS].reverse().map(y => <SelectItem key={y} value={String(y)} className="min-h-11 text-base">{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={load} aria-label="Refresh tax estimate" variant="ghost" size="icon" className="h-11 w-11 shrink-0 rounded-xl" disabled={loading}>
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-3 px-4 py-3 sm:px-6 sm:py-4">
        {error && (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>
            {onNavigate && ['PERSONAL_DEDUCTION_REVIEW_REQUIRED', 'SOCIAL_SECURITY_REVIEW_REQUIRED', 'DEPENDENT_CREDIT_REVIEW_REQUIRED'].includes(reviewCode ?? '') &&
              <Button className="mt-3 min-h-11" variant="outline" onClick={() => onNavigate('tax-organizer')}>Review Tax Organizer</Button>}
            {onNavigate && reviewCode === 'FILING_STATUS_REVIEW_REQUIRED' &&
              <Button className="mt-3 min-h-11" variant="outline" onClick={() => onNavigate('settings')}>Review profile</Button>}
            {onNavigate && reviewCode === 'HOME_OFFICE_REVIEW_REQUIRED' &&
              <Button className="mt-3 min-h-11" variant="outline" onClick={() => onNavigate('settings')}>Review home office settings</Button>}
            {onNavigate && reviewCode === 'INCOME_RECONCILIATION_REQUIRED' &&
              <Button className="mt-3 min-h-11" variant="outline" onClick={() => onNavigate('income-tracking')}>Review income sources</Button>}
            <Button className="mt-2 min-h-11" variant="ghost" onClick={load}>Retry estimate</Button>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Calculating your estimate…</p>
          </div>
        ) : f1040 ? (
          <>
            <Card className="overflow-hidden rounded-2xl border-border/70 bg-card shadow-none">
              <CardContent className="p-4 sm:p-5">
                <p className="text-sm font-medium text-muted-foreground">
                  {hasRefund ? "Estimated federal refund" : hasBalance ? "Estimated federal balance due" : "Estimated federal balance"}
                </p>
                <p className="mt-1 text-4xl font-semibold tracking-tight text-foreground tabular-nums">
                  {fmt(hasRefund ? f1040.refund : hasBalance ? f1040.balanceDue : 0)}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {hasRefund
                    ? "Includes recorded payments and estimated refundable credits."
                    : hasBalance
                      ? "Additional amount owed after recorded payments and estimated credits."
                      : "Recorded payments and estimated credits cover the modeled tax."}
                </p>
                {hasBalance && f1040.quarterlyRecommended && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Info className="h-3.5 w-3.5 shrink-0" />Quarterly payment recommended: {fmt(f1040.quarterlyRecommended)}/quarter
                  </p>
                )}
                <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                  <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Planning estimate, not a filed return. {calculationWarnings.length > 0 ? `${calculationWarnings.length} calculation ${calculationWarnings.length === 1 ? "limit needs" : "limits need"} review below.` : "Your records and eligibility still need review."}
                </p>
              </CardContent>
              <dl className="grid grid-cols-3 divide-x divide-border/70 border-t border-border/70">
                <div className="min-w-0 p-3 sm:px-5">
                  <dt className="text-xs text-muted-foreground">Total income</dt>
                  <dd className="mt-1 break-words text-base font-semibold tracking-tight tabular-nums sm:text-lg">{fmt(f1040.totalIncome)}</dd>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">After business expenses</p>
                </div>
                <div className="min-w-0 p-3 sm:px-5">
                  <dt className="text-xs text-muted-foreground">Personal deduction</dt>
                  <dd className="mt-1 break-words text-base font-semibold tracking-tight tabular-nums sm:text-lg">{amountOrDash(f1040.deductionUsed)}</dd>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{f1040.usingStandardDeduction ? "Standard deduction" : "Itemized deduction"}</p>
                </div>
                <div className="min-w-0 p-3 sm:px-5">
                  <dt className="text-xs text-muted-foreground">Payments + credits</dt>
                  <dd className="mt-1 break-words text-base font-semibold tracking-tight tabular-nums sm:text-lg">{amountOrDash(f1040.totalPayments)}</dd>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">Withholding included</p>
                </div>
              </dl>
            </Card>

            {onNavigate && (
              <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next step</p>
                  <p className="mt-0.5 text-sm font-medium leading-snug">{nextStep.msg}</p>
                </div>
                <Button className="min-h-11 shrink-0 rounded-xl px-3" onClick={() => onNavigate(nextStep.screen)}>
                  Review <ArrowRight aria-hidden="true" className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            <section aria-label="Estimate details" className="overflow-hidden rounded-2xl border border-border/70 bg-card divide-y divide-border/70">
              <details className="group">
                <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                  <span className="min-w-0 flex-1">What could change this estimate</span>
                  {calculationWarnings.length > 0 && <span className="text-xs font-normal text-muted-foreground">{calculationWarnings.length} limits</span>}
                  <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="px-3 pb-3">
                  <TaxCalculationNotice taxYear={f1040.taxYear ?? year} warnings={f1040.calculationWarnings} />
                </div>
              </details>

              {gaps.length > 0 && (
                <details className="group">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                    <span className="flex-1">Information to review</span>
                    <span className="text-xs font-normal text-muted-foreground">{gaps.length} items</span>
                    <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="px-4 pb-2">
                    <p className="pb-2 text-xs text-muted-foreground">These gaps could change your estimate.</p>
                    {gaps.map((gap, index) => (
                      <div key={index} className="flex min-h-12 items-center justify-between gap-3 border-t border-border/50 py-1">
                        <p className="text-xs leading-relaxed text-muted-foreground">{gap.msg}</p>
                        {onNavigate && <Button variant="ghost" size="sm" onClick={() => onNavigate(gap.screen)} className="min-h-11 shrink-0 px-3 text-xs" aria-label={`Review: ${gap.msg}`}>Review</Button>}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {data?.stateTax && (
                <details className="group">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                    <span className="min-w-0 flex-1 font-medium">{data.stateTax.stateName} state estimate</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{data.stateTax.type === 'no_tax' ? 'No income tax' : fmt(data.stateTax.stateWithheld > 0 ? data.stateTax.stateBalanceDue : data.stateTax.estimatedTax)}</span>
                    <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="space-y-1.5 px-4 pb-3 text-xs leading-relaxed text-muted-foreground">
                    <p className="font-medium text-foreground">{data.stateTax.type === 'no_tax' ? 'No state income tax' : `${fmt(data.stateTax.estimatedTax)} estimated tax (${pct(data.stateTax.effectiveRate)} effective rate)`}</p>
                    {data.stateTax.stateWithheld > 0 && data.stateTax.type !== 'no_tax' && <>
                      <p>W-2 state withholding applied: {fmt(data.stateTax.stateWithheld)}</p>
                      <p>State balance due: {fmt(data.stateTax.stateBalanceDue)}</p>
                    </>}
                    <p>{data.stateTax.note}</p>
                  </div>
                </details>
              )}

              <div>
                <div className="flex min-h-12 items-center justify-between gap-3 pl-4 pr-2">
                  <div className="min-w-0 py-2">
                    <h2 className="text-sm font-medium">Full tax calculation</h2>
                    <p className="text-xs text-muted-foreground">Form 1040 line-by-line</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setShowDetails(!showDetails)} aria-expanded={showDetails} aria-controls="tax-calculation-breakdown" className="min-h-11 gap-1.5 px-3 text-xs">
                    {showDetails ? <><ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />Hide</> : <><ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />Show</>}
                  </Button>
                </div>
                {showDetails && (
                  <div id="tax-calculation-breakdown" className="pb-2">
                    <div className="space-y-2 border-t border-border/70 px-4 py-3 text-xs text-muted-foreground">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <p>AGI <span className="font-semibold text-foreground tabular-nums">{fmt(f1040.agi)}</span></p>
                        <p>Total Tax <span className="font-semibold text-foreground tabular-nums">{fmt(f1040.totalTax)}</span></p>
                        <p>Effective federal rate (incl. SE tax) <span className="font-semibold text-foreground tabular-nums">{pct(f1040.effectiveRate)}</span></p>
                      </div>
                      <p>The rate is federal income tax divided by total income. Total Tax also includes modeled self-employment and other federal taxes.</p>
                      <p>Estimated — based on your current data. Review with a tax professional before filing.</p>
                    </div>
                  {([
                    { section: "INCOME" as string, lines: [
                      { num: "1a", label: "W-2 wages", value: data.income.w2Wages },
                      { num: "6a", label: "Net Social Security benefits", value: data.income.socialSecurityNetBenefits },
                      { num: "6b", label: "Taxable Social Security benefits", value: data.income.socialSecurity },
                      { num: "8", label: "Schedule C net profit", value: data.income.scheduleCNetProfit },
                      { num: "9", label: "Total income", value: f1040.totalIncome, bold: true },
                    ]},
                    { section: "ADJUSTMENTS (Schedule 1)", lines: [
                      { num: "15", label: "Half of SE tax deduction", value: data.seCalc?.halfSEDeduction },
                      { num: "17", label: "Self-employed health insurance", value: data.deductions?.healthInsurancePremiums },
                      { num: "16", label: "SEP-IRA / 401(k) contributions", value: (data.deductions?.sepIraContribution || 0) + (data.deductions?.solo401kContribution || 0) },
                      { num: "13", label: "HSA contribution", value: data.deductions?.hsaContribution },
                      { num: "21", label: "Student loan interest", value: data.deductions?.studentLoanInterest },
                      { num: "26", label: "Total adjustments", value: f1040.adjustments, bold: true, negative: true },
                    ]},
                    { section: "AGI & DEDUCTIONS", lines: [
                      { num: "11", label: "Adjusted Gross Income", value: f1040.agi, bold: true },
                      { num: "12", label: `${f1040.usingStandardDeduction ? "Standard" : "Itemized"} deduction`, value: f1040.deductionUsed, negative: true },
                      { num: Number(year) >= 2025 ? "13a" : "13", label: "QBI deduction (§199A)", value: f1040.qbiDeduction, negative: true },
                      { num: "1-A", label: "Enhanced senior deduction", value: Number(year) >= 2025 ? f1040.enhancedSeniorDeduction : undefined, negative: true },
                      { num: "15", label: "Taxable income", value: f1040.taxableIncome, bold: true },
                    ]},
                    { section: "TAX", lines: [
                      { num: "16", label: "Federal income tax", value: f1040.incomeTax },
                      { num: "SE", label: "Self-employment tax (Sch. SE)", value: f1040.selfEmploymentTax },
                      { num: "24", label: "Total tax", value: f1040.totalTax, bold: true },
                    ]},
                    { section: "PAYMENTS", lines: [
                      { num: "25a", label: "W-2 federal withholding", value: f1040.w2FederalWithheld, negative: true },
                      { num: "25b", label: "Social Security / RRB withholding", value: f1040.socialSecurityFederalWithheld, negative: true },
                      { num: "26", label: "Estimated tax payments", value: f1040.estimatedPayments, negative: true },
                      { num: "33", label: "Total payments", value: f1040.totalPayments, bold: true, negative: true },
                    ]},
                    { section: "RESULT", lines: [
                      f1040.refund > 0
                        ? { num: "35a", label: "Refund", value: f1040.refund, bold: true, highlight: "green" }
                        : { num: "37", label: "Amount you owe", value: f1040.balanceDue, bold: true, highlight: "orange" },
                    ]},
                  ] as { section: string; lines: TaxLine[] }[]).map(({ section, lines }) => (
                    <div key={section} className="mb-2">
                      <div className="px-4 py-1.5 bg-muted/40 border-y border-border">
                        <p className="text-xs font-semibold text-muted-foreground tracking-wide uppercase">{section}</p>
                      </div>
                      {lines.map((line, i) => (
                        (!line.value && line.value !== 0) ? null :
                        <div key={i} className={`flex items-center justify-between px-4 py-2 border-b border-border/50 last:border-0 ${line.highlight ? 'bg-muted/40' : ''}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs text-muted-foreground font-mono w-6 shrink-0">{line.num}</span>
                            <span className={`text-sm leading-snug ${line.bold ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{line.label}</span>
                          </div>
                          <span className={`text-sm font-mono tabular-nums ml-4 shrink-0 ${line.bold ? "font-bold" : ""} ${line.highlight === 'green' ? "text-foreground" : line.highlight === 'orange' ? "text-foreground" : line.negative ? "text-muted-foreground" : ""}`}>
                            {(line.value || 0) > 0 ? (line.negative ? `(${fmt(line.value!, { abs: true })})` : fmt(line.value!)) : "$0"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                  </div>
                )}
              </div>
            </section>
            <p className="px-1 text-xs leading-relaxed text-muted-foreground">
              Uses published federal rules for {f1040.taxYear ?? year} and information saved in WriteOff. Actual tax may differ. Always verify with a tax professional before filing or making a tax payment.
            </p>
          </>
        ) : !loading && !error && (
          <div className="py-12 text-center">
            <DollarSign className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
            <p className="font-medium text-foreground">No data yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Add income and confirm expenses to see your tax estimate</p>
            {onNavigate && <Button onClick={() => onNavigate("income-tracking")} className="mt-4 min-h-11">Add Income</Button>}
          </div>
        )}
      </div>
    </div>
  );
}

export default TaxPreviewScreen;
