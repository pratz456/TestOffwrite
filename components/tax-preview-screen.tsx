"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, DollarSign, ArrowRight, ChevronDown, ChevronUp, AlertCircle, Loader2, Info } from "lucide-react";
import { TaxCalculationNotice } from "@/components/tax-calculation-notice";
import { SUPPORTED_TAX_YEARS } from "@/lib/tax-rules/federal-year-rules";
import type { BusinessTaxNotice, StateTaxComponents, StateTaxLine } from "@/lib/tax-rules/state";
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
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
};
const pct = (n: number) => `${n.toFixed(1)}%`;
const sourceLabel = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
const stringList = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0))]
  : [];

interface StateLine { label: string; amount: number; negative?: boolean }

const lineList = (value: unknown): Partial<StateTaxLine>[] =>
  Array.isArray(value) ? value.filter((line): line is Partial<StateTaxLine> => !!line && typeof line === "object") : [];

/** Flatten the state estimate components (as received over the wire) into display rows; zero-amount deduction/credit rows are kept so the base is visible. */
function stateComponentLines(value: unknown): StateLine[] {
  if (!value || typeof value !== "object") return [];
  const components = value as Partial<StateTaxComponents>;
  const lines: StateLine[] = [];
  const push = (label: unknown, amount: unknown, negative?: boolean) => {
    if (typeof label === "string" && typeof amount === "number" && Number.isFinite(amount)) lines.push({ label, amount, negative });
  };
  push("Federal adjusted gross income", components.federalAGI);
  for (const line of lineList(components.modifications)) push(line.label, Math.abs(line.amount ?? NaN), (line.amount ?? 0) < 0);
  push("State adjusted gross income", components.stateAGI);
  for (const line of lineList(components.deductions)) push(line.label, line.amount, true);
  push("State taxable income", components.taxableIncome);
  push("Tax before credits", components.taxBeforeCredits);
  for (const line of lineList(components.credits)) push(line.label, line.amount, true);
  for (const line of lineList(components.additionalTaxes)) push(line.label, line.amount);
  return lines;
}

const isBusinessTaxNotice = (notice: unknown): notice is BusinessTaxNotice =>
  !!notice && typeof notice === "object"
  && typeof (notice as BusinessTaxNotice).id === "string"
  && typeof (notice as BusinessTaxNotice).title === "string"
  && typeof (notice as BusinessTaxNotice).summary === "string";

export function TaxPreviewScreen({ user, onNavigate }: Props) {
  const [year, setYear] = useState(String(SUPPORTED_TAX_YEARS[SUPPORTED_TAX_YEARS.length - 1]));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewCode, setReviewCode] = useState<string | null>(null);
  const [reviewConflicts, setReviewConflicts] = useState<Array<{ message: string; sources: Array<{ label: string; amount: number }> }>>([]);
  const [data, setData] = useState<any>(null);
  const [showDetails, setShowDetails] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true); setError(null); setReviewCode(null); setReviewConflicts([]); setData(null);
    try {
      const res = await makeAuthenticatedRequest(`/api/tax/compute-1040?year=${year}`);
      const result = await res.json();
      if (!res.ok) {
        if (currentRequest === requestId.current && res.status === 422 && typeof result.code === 'string') {
          setReviewCode(result.code);
          // The income gate names conflicting records by reference so the owner knows what to reconcile.
          setReviewConflicts(Array.isArray(result.conflicts) ? result.conflicts.filter((c: unknown) => c && typeof c === 'object' && typeof (c as { message?: unknown }).message === 'string') : []);
        }
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

  const calculationWarnings = stringList(f1040?.calculationWarnings);
  // Informational state planning estimate: { supported: true, estimate, components, warnings, sources } or { supported: false, reason }.
  const stateTax = data?.stateTax && typeof data.stateTax === "object" && typeof data.stateTax.supported === "boolean" ? data.stateTax : null;
  const stateLines = stateTax?.supported && !stateTax.noIncomeTax ? stateComponentLines(stateTax.components) : [];
  const stateWarnings = stateTax?.supported ? stringList(stateTax.warnings) : [];
  const stateNotes = stateTax?.supported ? stringList(stateTax.notes) : [];
  const stateSources = stateTax ? stringList(stateTax.sources) : [];
  const businessTaxNotices: BusinessTaxNotice[] = Array.isArray(data?.businessTaxNotices)
    ? (data.businessTaxNotices as unknown[]).filter(isBusinessTaxNotice)
    : [];
  const gaps: { msg: string; screen: string }[] = [];
  if (f1040) {
    if (data.income.grossReceipts === 0 && data.income.w2Wages === 0) gaps.push({ msg: "No income recorded yet", screen: "income-tracking" });
    if (data.income.totalDeductible === 0) gaps.push({ msg: "Review expenses and refunds", screen: "transactions" });
    if (data.w2.count === 0 && data.income.w2Wages === 0) gaps.push({ msg: "Add W-2 income if you have a day job", screen: "w2-income" });
    if (!stateTax) gaps.push({ msg: "Add your state to see its informational state planning estimate", screen: "settings" });
    if (!data.income.grossReceipts && !data.income.w2Wages) gaps.push({ msg: "Complete the Tax Organizer to ensure all income is captured", screen: "tax-organizer" });
    if (!data.deductions.healthInsurancePremiums && !data.deductions.sepIraContribution) gaps.push({ msg: "Review eligible health insurance and retirement deductions", screen: "tax-organizer" });
  }
  const nextStep = gaps[0] ?? { msg: "Review your saved income and tax details", screen: "tax-organizer" };
  const amountOrDash = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? fmt(value) : "—";

  return (
    <div className="min-h-full bg-background">
      <header className="border-b border-border/70 bg-background">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 sm:px-6">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Tax overview</h1>
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

      <div className="mx-auto max-w-6xl space-y-3 px-4 py-3 sm:px-6 sm:py-4">
        {error && (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>
            {onNavigate && ['PERSONAL_DEDUCTION_REVIEW_REQUIRED', 'SOCIAL_SECURITY_REVIEW_REQUIRED', 'DEPENDENT_CREDIT_REVIEW_REQUIRED', 'CAPITAL_GAIN_REVIEW_REQUIRED', 'BUSINESS_LOSS_REVIEW_REQUIRED', 'OBBBA_DEDUCTION_REVIEW_REQUIRED'].includes(reviewCode ?? '') &&
              <Button className="mt-3 min-h-11" variant="outline" onClick={() => onNavigate('tax-organizer')}>Review Tax Organizer</Button>}
            {onNavigate && reviewCode === 'FILING_STATUS_REVIEW_REQUIRED' &&
              <Button className="mt-3 min-h-11" variant="outline" onClick={() => onNavigate('settings')}>Review profile</Button>}
            {reviewCode === 'QBI_REVIEW_REQUIRED' && <p className="mt-3 text-xs">A tax professional needs to review your business type, qualified wages and property for the QBI deduction at this income level. WriteOff cannot calculate this case from the information currently collected.</p>}
            {reviewCode === 'TAX_CALCULATION_SCOPE_REVIEW_REQUIRED' && <p className="mt-3 text-xs">This return needs a calculation that WriteOff does not yet support. Have a tax professional review the issue above and your supporting records before relying on a tax amount.</p>}
            {reviewCode === 'INCOME_RECONCILIATION_REQUIRED' && reviewConflicts.length > 0 && (
              <ul aria-label="Records that need a reconciliation decision" className="mt-2 space-y-1 text-xs text-foreground">
                {reviewConflicts.map((conflict, index) => (
                  <li key={index}>{conflict.message}{Array.isArray(conflict.sources) && conflict.sources.length > 0
                    ? ` (${conflict.sources.map(s => `${s.label} ${s.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}`).join('; ')})` : ''}</li>
                ))}
              </ul>
            )}
            {onNavigate && reviewCode === 'HOME_OFFICE_REVIEW_REQUIRED' &&
              <Button className="mt-3 min-h-11" variant="outline" onClick={() => onNavigate('settings')}>Review home office settings</Button>}
            {reviewCode === 'DEPRECIATION_REVIEW_REQUIRED' &&
              <Button asChild className="mt-3 min-h-11" variant="outline"><Link href="/protected/tax-forms-setup?tab=assets">Review asset records</Link></Button>}
            {onNavigate && reviewCode === 'INCOME_RECONCILIATION_REQUIRED' &&
              <Button className="mt-3 min-h-11" variant="outline" onClick={() => onNavigate(`income-tracking?tab=reconcile&year=${year}`)}>Reconcile income sources</Button>}
            <Button className="mt-2 min-h-11" variant="ghost" onClick={load}>Retry estimate</Button>
          </div>
        )}

        {error && !loading && (
          <section aria-labelledby="estimate-preparation" className="rounded-xl border border-border bg-card p-4">
            <h2 id="estimate-preparation" className="text-base font-semibold">Keep preparing your {year} estimate</h2>
            <p className="mt-1 text-sm text-muted-foreground">Your saved records are available. Resolve the issue above, then refresh to calculate your totals.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {[
                { title: 'Income records', detail: 'Check payments and reconcile 1099 forms.', href: `/protected?screen=income-tracking&year=${year}` },
                { title: 'Expense review', detail: 'Confirm business use and AI categories.', href: '/protected/transactions' },
                { title: 'Tax organizer', detail: 'Review your filing details and deductions.', href: '/protected?screen=tax-organizer' },
              ].map(item => <Link key={item.title} href={item.href} className="group flex min-h-11 items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.detail}</span></span>
                <ArrowRight aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              </Link>)}
            </div>
          </section>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Calculating your estimate…</p>
          </div>
        ) : f1040 ? (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className="space-y-3">
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

            </div>
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

              {stateTax && (
                <details className="group">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                    <span className="min-w-0 flex-1 font-medium">{stateTax.stateName} state planning estimate</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {!stateTax.supported ? "Not available" : stateTax.noIncomeTax ? "No income tax" : fmt(stateTax.estimate)}
                    </span>
                    <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="space-y-1.5 px-4 pb-3 text-xs leading-relaxed text-muted-foreground">
                    {!stateTax.supported ? (
                      <>
                        <p className="font-medium text-foreground">No validated {stateTax.taxYear} estimate for {stateTax.stateName}</p>
                        <p>{stateTax.reason}</p>
                      </>
                    ) : stateTax.noIncomeTax ? (
                      <>
                        <p className="font-medium text-foreground">No state income tax for {stateTax.taxYear}</p>
                        {stateNotes.map(note => <p key={note}>{note}</p>)}
                      </>
                    ) : (
                      <>
                        <p className="font-medium text-foreground">
                          {fmt(stateTax.estimate)} informational state planning estimate ({pct(stateTax.components?.effectiveRate ?? 0)} of federal AGI, {pct(stateTax.components?.marginalRate ?? 0)} marginal)
                        </p>
                        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 tabular-nums">
                          {stateLines.map(line => (
                            <React.Fragment key={line.label}>
                              <dt className="min-w-0 break-words">{line.label}</dt>
                              <dd className="text-right text-foreground">{line.negative ? `(${fmt(line.amount, { abs: true })})` : fmt(line.amount)}</dd>
                            </React.Fragment>
                          ))}
                        </dl>
                        {typeof stateTax.stateWithheld === "number" && stateTax.stateWithheld > 0 && (
                          <p>W-2 state withholding recorded: {fmt(stateTax.stateWithheld)}. Remaining state planning balance: {fmt(stateTax.stateBalanceDue ?? 0)}. W-2 state codes are not reconciled against your saved state.</p>
                        )}
                      </>
                    )}
                    {stateWarnings.length > 0 && (
                      <ul className="list-disc space-y-1 pl-4">
                        {stateWarnings.map(warning => <li key={warning}>{warning}</li>)}
                      </ul>
                    )}
                    <p>
                      {stateTax.supported ? "Shown separately from the federal figures above and not added to Total Tax. This does not prepare a state return." : "State figures are omitted until the department publishes the parameters for this year."}
                      {stateSources.length > 0 && <> Sources: {stateSources.map((url, index) => <React.Fragment key={url}>{index > 0 ? ", " : ""}<a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{sourceLabel(url)}</a></React.Fragment>)}.</>}
                    </p>
                  </div>
                </details>
              )}

              {businessTaxNotices.length > 0 && (
                <details className="group">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                    <span className="min-w-0 flex-1 font-medium">Separate business taxes to review</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{businessTaxNotices.length} {businessTaxNotices.length === 1 ? "notice" : "notices"}</span>
                    <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="space-y-3 px-4 pb-3 text-xs leading-relaxed text-muted-foreground">
                    <p>Informational only, based on the state and city saved in Settings. Nothing below is calculated or added to your federal or state figures.</p>
                    {businessTaxNotices.map(notice => (
                      <div key={notice.id} className="space-y-1">
                        <p className="font-medium text-foreground">{notice.title}</p>
                        <p>{notice.summary}</p>
                        {Array.isArray(notice.sources) && notice.sources.length > 0 && (
                          <p>Sources: {notice.sources.map((source, index) => <React.Fragment key={source.url}>{index > 0 ? ", " : ""}<a href={source.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{sourceLabel(source.url)}</a></React.Fragment>)}.</p>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <div>
                <div className="flex min-h-12 items-center justify-between gap-3 pl-4 pr-2">
                  <div className="min-w-0 py-2">
                    <h2 className="text-sm font-medium">Federal estimate breakdown</h2>
                    <p className="text-xs text-muted-foreground">Modeled income, deductions, tax and payments</p>
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
                      <p>The rate is total modeled federal tax divided by total income, including self-employment and Additional Medicare tax and after nonrefundable credits.</p>
                      <p>Estimated — based on your current data. Review with a tax professional before filing.</p>
                    </div>
                  {([
                    { section: "INCOME" as string, lines: [
                      { num: "1a", label: "W-2 wages", value: data.income.w2Wages },
                      { num: "2b", label: "Taxable interest", value: data.income.interest },
                      { num: "3b", label: "Dividends", value: data.income.dividends },
                      { num: "4b", label: "Taxable retirement distributions", value: data.income.iraDist },
                      { num: "6a", label: "Net Social Security benefits", value: data.income.socialSecurityNetBenefits },
                      { num: "6b", label: "Taxable Social Security benefits", value: data.income.socialSecurity },
                      { num: "7", label: "Capital gain or (loss) after the annual loss limit", value: data.income.capGains || undefined },
                      { num: "8", label: "Schedule C profit or allowed loss", value: f1040.scheduleCAllowed },
                      { num: "8", label: "Rental income", value: data.income.rental },
                      { num: "8", label: "Other ordinary income", value: data.income.otherOrdinaryIncome },
                      { num: "9", label: "Total income", value: f1040.totalIncome, bold: true },
                    ]},
                    { section: "ADJUSTMENTS (Schedule 1)", lines: [
                      { num: "15", label: "Half of SE tax deduction", value: f1040.appliedAdjustments?.halfSEDeduction },
                      { num: "17", label: "Allowed self-employed health insurance", value: f1040.appliedAdjustments?.healthInsuranceDeduction },
                      { num: "16", label: "SEP-IRA / 401(k) / SIMPLE contributions", value: f1040.appliedAdjustments?.retirementContributions },
                      { num: "13", label: "Allowed HSA deduction", value: f1040.appliedAdjustments?.hsaDeduction },
                      { num: "21", label: "Allowed student loan interest", value: f1040.appliedAdjustments?.studentLoanInterestDeduction },
                      { num: "26", label: "Total adjustments", value: f1040.adjustments, bold: true, negative: true },
                    ]},
                    { section: "AGI & DEDUCTIONS", lines: [
                      { num: "11", label: "Adjusted Gross Income", value: f1040.agi, bold: true },
                      { num: "12", label: `${f1040.usingStandardDeduction ? "Standard" : "Itemized"} deduction`, value: f1040.deductionUsed, negative: true },
                      { num: Number(year) >= 2025 ? "13a" : "13", label: "QBI deduction (§199A)", value: f1040.qbiDeduction, negative: true },
                      { num: "1-A", label: "Enhanced senior deduction", value: Number(year) >= 2025 ? f1040.enhancedSeniorDeduction : undefined, negative: true },
                      { num: "1-A", label: "Qualified tips deduction", value: f1040.qualifiedTipsDeduction || undefined, negative: true },
                      { num: "1-A", label: "Qualified overtime deduction", value: f1040.qualifiedOvertimeDeduction || undefined, negative: true },
                      { num: "1-A", label: "Vehicle loan interest deduction", value: f1040.vehicleLoanInterestDeduction || undefined, negative: true },
                      { num: "12", label: "Non-itemizer charitable deduction (§170(p))", value: f1040.nonItemizerCharitableDeduction || undefined, negative: true },
                      { num: "15", label: "Taxable income", value: f1040.taxableIncome, bold: true },
                    ]},
                    { section: "TAX", lines: [
                      { num: "16", label: "Federal income tax", value: f1040.incomeTax },
                      { num: "21", label: "Nonrefundable credits", value: f1040.totalCredits, negative: true },
                      { num: "SE", label: "Self-employment tax (Sch. SE)", value: f1040.selfEmploymentTax },
                      { num: "8959", label: "Additional Medicare tax", value: f1040.additionalMedicareTax },
                      { num: "24", label: "Total tax", value: f1040.totalTax, bold: true },
                    ]},
                    { section: "PAYMENTS", lines: [
                      { num: "25a", label: "W-2 federal withholding", value: f1040.w2FederalWithheld, negative: true },
                      { num: "25b", label: "Social Security / RRB withholding", value: f1040.socialSecurityFederalWithheld, negative: true },
                      { num: "26", label: "Estimated tax payments", value: f1040.estimatedPayments, negative: true },
                      { num: "32", label: "Refundable credits (EITC / additional child tax credit)", value: f1040.totalRefundableCredits, negative: true },
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
                            {(line.value || 0) > 0 ? (line.negative ? `(${fmt(line.value!, { abs: true })})` : fmt(line.value!)) : (line.value || 0) < 0 ? fmt(line.value!) : "$0"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                  </div>
                )}
              </div>
            </section>
            <p className="px-1 text-xs leading-relaxed text-muted-foreground lg:col-span-2">
              Uses published federal rules for {f1040.taxYear ?? year} and information saved in WriteOff. Actual tax may differ. Always verify with a tax professional before filing or making a tax payment.
            </p>
          </div>
        ) : !loading && !error && (
          <div className="rounded-xl border border-border bg-card px-4 py-8 text-center">
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
