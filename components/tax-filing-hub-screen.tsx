"use client";

import { EmbeddedFilingCard } from '@/components/embedded-filing-card';
import { PreparerPackageCard } from '@/components/preparer-package-card';
import { SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
import { PremiumFeatureGate } from '@/components/premium-feature-gate';
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import * as FilingTabs from "@radix-ui/react-tabs";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2, Circle, AlertCircle,
  FileText, DollarSign, Calculator, Loader2,
  ChevronRight, ChevronDown, ArrowLeft, Receipt, Shield, Upload,
} from "lucide-react";
import { TaxCalculationNotice } from "@/components/tax-calculation-notice";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

interface FilingHubProps {
  user: { id: string; email?: string };
  onBack: () => void;
  onNavigate?: (screen: string) => void;
}

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  status: "complete" | "partial" | "missing" | "unavailable";
  detail?: string;
  action?: string;
  actionScreen?: string;
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function TaxFilingHubScreen({ user, onBack, onNavigate }: FilingHubProps) {
  const currentYear = SUPPORTED_TAX_YEARS.at(-1)!;
  const [year, setYear] = useState(String(currentYear));
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState("prepare");
  const [exporting, setExporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calculationWarnings, setCalculationWarnings] = useState<unknown>([]);
  const [hasTaxEstimate, setHasTaxEstimate] = useState(false);
  const loadRequest = useRef(0);
  const exportBusy = useRef(false);
  const context = `${user.id}:${year}`;
  const active = useRef(context); active.current = context;

  const [summary, setSummary] = useState({
    grossReceipts: 0,
    income1099: 0,
    w2Wages: 0,
    w2Withheld: 0,
    totalIncome: 0,
    confirmedExpenses: 0,
    totalExpenses: 0,
    netProfit: 0,
    seTax: 0,
    hasHomeOffice: false,
    hasVehicle: false,
    quarterlyPaid: 0,
    hasDeductions: false,
    hasW2: false,
    // Computed fields from SE auto endpoint
    aboveLineDeductions: 0,
    adjustedNetIncome: 0,
    // 1040 result
    balanceDue: 0,
    refund: 0,
    totalTax: 0,
  });

  const loadSummary = useCallback(async () => {
    const request = ++loadRequest.current;
    setLoading(true);
    setError(null);
    setHasTaxEstimate(false);
    setCalculationWarnings([]);
    try {
      const [txRes, form1040Res] = await Promise.all([
        makeAuthenticatedRequest(`/api/tax/schedule-c/calculate?year=${year}`),
        makeAuthenticatedRequest(`/api/tax/compute-1040?year=${year}`),
      ]);

      const tax1040 = await form1040Res.json().catch(() => ({}));
      if (!form1040Res.ok) throw new Error(tax1040.error || "The federal estimate could not be loaded. Open Tax Preview to retry before using these figures.");
      const txData = await txRes.json().catch(() => ({}));
      if (!txRes.ok) throw new Error(txData.error || "Expense review could not be loaded. Please retry before reviewing these figures.");
      const federalEstimate = tax1040.form1040;
      const income = tax1040.income;
      if (Number(tax1040.taxYear) !== Number(year) || ![
        federalEstimate?.totalIncome, federalEstimate?.totalTax, federalEstimate?.balanceDue, federalEstimate?.refund,
        income?.grossReceipts, income?.income1099, income?.scheduleCLine31NetProfit, income?.totalDeductible, income?.w2Wages,
        tax1040.seCalc?.totalSETax, tax1040.w2?.withheld, tax1040.payments?.estimatedPayments,
      ].every(value => typeof value === "number" && Number.isFinite(value))) {
        throw new Error("The federal estimate is incomplete or belongs to another year. Open Tax Preview to retry.");
      }
      if (request !== loadRequest.current) return;
      setHasTaxEstimate(true);
      setCalculationWarnings(federalEstimate.calculationWarnings);

      const totalExpenses = income.totalDeductible;
      const netProfit = income.scheduleCLine31NetProfit;
      const seTax = tax1040.seCalc.totalSETax;

      setSummary({
        grossReceipts: income.grossReceipts,
        // Receipts documented by NEC/K forms in the reconciled estimate, not a second income source.
        income1099: income.income1099,
        w2Wages: income.w2Wages,
        w2Withheld: tax1040.w2.withheld,
        totalIncome: federalEstimate.totalIncome,
        confirmedExpenses: totalExpenses,
        totalExpenses, netProfit, seTax,
        hasHomeOffice: !!(txData.hasHomeOffice),
        hasVehicle: !!(txData.hasVehicle),
        quarterlyPaid: tax1040.payments.estimatedPayments,
        hasDeductions: Object.values(tax1040.deductions || {}).some(value => typeof value === "number" && value > 0),
        hasW2: income.w2Wages > 0,
        aboveLineDeductions: federalEstimate.adjustments || 0,
        adjustedNetIncome: federalEstimate.agi ?? netProfit,
        balanceDue: federalEstimate?.balanceDue ?? 0,
        refund: federalEstimate?.refund ?? 0,
        totalTax: federalEstimate?.totalTax ?? 0,
      });
    } catch (e) {
      if (request === loadRequest.current) setError(e instanceof Error ? e.message : "Failed to load filing summary. Please try again.");
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    const requests = loadRequest;
    void loadSummary();
    return () => { ++requests.current; };
  }, [loadSummary, user.id]);

  const checklist: ChecklistItem[] = ([
    {
      id: "income",
      label: "Income recorded",
      description: "Income reconciled in the federal planning estimate",
      status: summary.totalIncome > 0 ? "complete" : "missing",
      detail: summary.totalIncome > 0
        ? `${fmt(summary.totalIncome)} total income${summary.income1099 > 0 ? ` · ${fmt(summary.income1099)} documented on 1099 forms` : ""}`
        : "No income recorded yet",
      action: "Add Income",
      actionScreen: "income-tracking",
    },
    {
      id: "expenses",
      label: "Expenses confirmed",
      description: "Transactions reviewed and marked deductible",
      status: summary.confirmedExpenses > 0 ? "complete" : "partial",
      // The calculation APIs return a net amount, not a confirmed record count.
      // A zero subtotal can include expenses offset by refunds.
      detail: summary.confirmedExpenses > 0
        ? `${fmt(summary.confirmedExpenses)} net confirmed expense amount`
        : `${fmt(summary.confirmedExpenses)} net confirmed expense amount · Review expenses and refunds if applicable`,
      action: "Review Transactions",
      actionScreen: "transactions",
    },
    {
      id: "schedule-c",
      label: "Business profit estimate",
      description: "Profit or Loss from Business",
      status: summary.grossReceipts > 0 && summary.confirmedExpenses > 0 ? "complete"
            : summary.grossReceipts !== 0 || summary.confirmedExpenses !== 0 ? "partial"
            : "missing",
      detail: summary.grossReceipts !== 0 || summary.confirmedExpenses !== 0
        ? `Net profit: ${fmt(summary.netProfit)}`
        : "Review business income, expenses and refunds if applicable",
      action: "Export Schedule C",
      actionScreen: "schedule-c-export",
    },
    {
      id: "schedule-se",
      label: "Schedule SE calculated",
      description: "Self-Employment Tax",
      status: summary.netProfit > 0 ? "complete" : summary.totalIncome > 0 ? "partial" : "missing",
      detail: summary.seTax > 0 ? `SE tax: ${fmt(summary.seTax)}` : "Calculated automatically from net profit",
      action: "View Schedule SE",
      actionScreen: undefined,
    },
    {
      id: "quarterly",
      label: "Quarterly payments logged",
      description: "Estimated tax payments made during the year",
      status: summary.quarterlyPaid > 0 ? "complete" : "partial",
      detail: summary.quarterlyPaid > 0
        ? `${fmt(summary.quarterlyPaid)} in recorded estimated payments · credited in the federal estimate`
        : "Review if you made quarterly payments",
      action: "Quarterly Payments",
      actionScreen: "quarterly-payments",
    },
    {
      id: "w2",
      label: "W-2 income entered",
      description: "Wages from employer jobs this year",
      status: summary.hasW2 ? "complete" : "partial",
      detail: summary.hasW2 ? `${fmt(summary.w2Wages)} in W-2 wages · ${fmt(summary.w2Withheld)} withheld` : "Add any employer W-2s for complete tax picture",
      action: "Tax Organizer",
      actionScreen: "w2-income",
    },
    {
      id: "deductions",
      label: "Deductions entered",
      description: "Health insurance, retirement, HSA contributions",
      status: summary.hasDeductions ? "complete" : "partial",
      detail: summary.hasDeductions ? "Above-the-line deductions recorded" : "Enter health insurance and retirement contributions to reduce taxes",
      action: "Tax Organizer",
      actionScreen: "deductions-entry",
    },
  ] satisfies ChecklistItem[]).map(item => hasTaxEstimate ? item : {
    ...item,
    status: "unavailable" as const,
    detail: "Resolve the calculation issue before reviewing these figures.",
  });

  const handleExport = async (formType: string) => {
    if (exportBusy.current || active.current !== context) return;
    exportBusy.current = true; setExporting(formType); setError(null);
    try {
      const routes: Record<string, string> = { 'schedule-c': '/api/tax/schedule-c/export', 'form-1040': '/api/tax/form-1040', archive: '/api/user/export' };
      const url = routes[formType] || '/api/reports/export';
      const res = await makeAuthenticatedRequest(url, { method: 'POST',
        body: JSON.stringify(routes[formType] ? { year: Number(year) } : { type: formType, year: Number(year) }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Export failed. Please retry.');
      }
      const blob = await res.blob();
      if (active.current !== context) return;
      const objectUrl = URL.createObjectURL(blob);
      const dl = document.createElement('a'); dl.href = objectUrl;
      dl.download = formType === 'archive' ? `WriteOff_records_${year}.json` : `WriteOff_${formType}_preparer_${year}.pdf`;
      document.body.appendChild(dl); dl.click(); dl.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) { if (active.current === context) setError(e instanceof Error ? e.message : 'Export failed'); }
    finally { exportBusy.current = false; if (active.current === context) setExporting(null); }
  };

  const statusIcon = (s: ChecklistItem["status"]) => {
    if (s === "unavailable") return <AlertCircle className="w-5 h-5 text-muted-foreground shrink-0" />;
    if (s === "complete") return <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />;
    if (s === "partial")  return <AlertCircle  className="w-5 h-5 text-amber-500 shrink-0" />;
    return <Circle className="w-5 h-5 text-muted-foreground/40 shrink-0" />;
  };

  const statusBadge = (s: ChecklistItem["status"]) => {
    if (s === "unavailable") return <Badge variant="outline" className="text-xs text-muted-foreground">Unavailable</Badge>;
    if (s === "complete") return <Badge className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-0 text-xs">Recorded</Badge>;
    if (s === "partial")  return <Badge className="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-0 text-xs">Review</Badge>;
    return <Badge variant="outline" className="text-xs text-muted-foreground">Review if applicable</Badge>;
  };

  const forms = [
    { id: "form-1040", label: "Form 1040", sub: "Federal planning summary", icon: DollarSign },
    { id: "schedule-c", label: "Schedule C", sub: "Business income & expenses", icon: FileText },
    { id: "scheduleSE", label: "Schedule SE", sub: "Self-employment tax worksheet", icon: Calculator },
  ];

  const nextAction = !hasTaxEstimate
    ? { label: "Review Tax Preview", detail: "Resolve the calculation issue to see your estimate.", screen: "tax-preview" }
    : summary.totalIncome <= 0
      ? { label: "Add your income", detail: "Start with business income and any employer wages.", screen: "income-tracking" }
      : summary.confirmedExpenses <= 0
        ? { label: "Review your transactions", detail: "Confirm business expenses and any related refunds.", screen: "transactions" }
        : { label: "Review your estimate", detail: "Check your federal estimate against the records below.", screen: "tax-preview" };

  const renderChecklistItem = (item: ChecklistItem) => {
    const content = <>
      <span className="mt-0.5">{statusIcon(item.status)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-foreground">{item.label}</p>
          {statusBadge(item.status)}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.detail || item.description}</p>
      </div>
    </>;
    const rowClass = "flex w-full items-start gap-2.5 px-3.5 py-3 text-left sm:px-4";
    return item.actionScreen && onNavigate ? (
      <button key={item.id} type="button" aria-label={`${item.action}: ${item.label}`} onClick={() => onNavigate(item.actionScreen!)}
        className={`${rowClass} transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary`}>
        {content}<ChevronRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    ) : <div key={item.id} className={rowClass}>{content}</div>;
  };

  return (
    <div className="min-h-full bg-background">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-2.5 sm:px-6">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back" className="-ml-2 h-11 w-11 shrink-0 rounded-full">
            <ArrowLeft aria-hidden="true" className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Tax Filing Hub</h1>
          </div>
          <Select value={year} onValueChange={value => { active.current = `${user.id}:${value}`; setExporting(null); setYear(value); }}>
            <SelectTrigger aria-label="Tax year" className="h-11 w-[92px] rounded-xl text-base"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[...SUPPORTED_TAX_YEARS].reverse().map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-3 px-4 py-4 pb-6 sm:px-6">
        <p className="text-xs leading-relaxed text-muted-foreground">Prepare records for your tax preparer. WriteOff does not currently submit IRS or state returns.</p>

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-sm text-destructive" role="alert">
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={loadSummary} disabled={loading} className="mt-2">Retry filing summary</Button>
          </div>
        )}

        <FilingTabs.Root value={section} onValueChange={setSection} className="space-y-3">
          <FilingTabs.List aria-label="Tax preparation sections" className="grid grid-cols-3 gap-1 rounded-xl bg-muted/70 p-1">
            {[
              { value: "prepare", label: "Prepare" },
              { value: "review", label: "Review" },
              { value: "export", label: "Export" },
            ].map(tab => (
              <FilingTabs.Trigger key={tab.value} value={tab.value}
                className="min-h-11 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                {tab.label}
              </FilingTabs.Trigger>
            ))}
          </FilingTabs.List>

          <FilingTabs.Content value="prepare" className="space-y-3 focus-visible:outline-none">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />Loading your records…</div>
            ) : (
              <>
                <section className="flex items-center gap-3 rounded-2xl border border-primary/15 bg-primary/[0.04] p-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-primary">Next step</p>
                    <p className="mt-1 text-sm font-semibold">{nextAction.label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{nextAction.detail}</p>
                  </div>
                  {onNavigate && <Button size="icon" aria-label={nextAction.label} className="h-11 w-11 shrink-0 rounded-full" onClick={() => onNavigate(nextAction.screen)}><ChevronRight aria-hidden="true" className="h-5 w-5" /></Button>}
                </section>

                <section className="overflow-hidden rounded-2xl border border-border/70 bg-card" aria-labelledby="filing-records-heading">
                  <div className="border-b border-border/60 px-3.5 py-3 sm:px-4">
                    <h2 id="filing-records-heading" className="text-sm font-semibold">Records and estimates</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">Recorded amounts still need your review.</p>
                  </div>
                  <div className="divide-y divide-border/60">{checklist.slice(0, 3).map(renderChecklistItem)}</div>
                  <details className="group border-t border-border/60">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-4 [&::-webkit-details-marker]:hidden">
                      Wages, deductions & payments
                      <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="divide-y divide-border/60 border-t border-border/60">{checklist.slice(3).map(renderChecklistItem)}</div>
                  </details>
                </section>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="min-h-11 rounded-lg" onClick={() => onNavigate?.("document-import")} disabled={!onNavigate}><Upload className="mr-1.5 h-4 w-4" />Import document</Button>
                  <Button variant="ghost" size="sm" className="min-h-11 rounded-lg" onClick={() => onNavigate?.("add-manual-transaction")} disabled={!onNavigate}><Receipt className="mr-1.5 h-4 w-4" />Add transaction</Button>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">These are recorded inputs and planning estimates. They do not establish that your return is complete or ready to file. Review missing income, adjustments, credits and state requirements with your filing provider.</p>
              </>
            )}
          </FilingTabs.Content>

          <FilingTabs.Content value="review" className="space-y-3 focus-visible:outline-none">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />Loading your estimate…</div>
            ) : (
              <>
                <section className="overflow-hidden rounded-2xl border border-border/70 bg-card">
                  <div className="border-b border-border/60 p-4">
                    <p className="text-xs text-muted-foreground">{year} federal planning estimate</p>
                    <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <h2 className="text-sm font-medium">{summary.refund > 0 ? "Estimated refund" : "Estimated balance due"}</h2>
                      <p className="text-2xl font-semibold tracking-tight tabular-nums">{hasTaxEstimate ? fmt(summary.refund > 0 ? summary.refund : summary.balanceDue) : "Unavailable"}</p>
                    </div>
                    {hasTaxEstimate && <p className="mt-1 text-xs text-muted-foreground">After {fmt(summary.quarterlyPaid)} in recorded estimated payments and {fmt(summary.w2Withheld)} in W-2 withholding.</p>}
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-border/60 py-3">
                    {[
                      { label: "Total Income", value: summary.totalIncome },
                      { label: "Total Expenses", value: summary.totalExpenses },
                      { label: "Total Tax", value: summary.totalTax },
                    ].map(metric => <div key={metric.label} className="min-w-0 px-3 text-center">
                      <p className="text-xs text-muted-foreground">{metric.label}</p>
                      <p className="mt-1 break-words text-sm font-semibold tabular-nums sm:text-base">{hasTaxEstimate ? fmt(metric.value) : "Unavailable"}</p>
                    </div>)}
                  </div>
                  {/* The refund/balance figure is never shown without its calculation limits. */}
                  {hasTaxEstimate && <div className="border-t border-border/60 p-3"><TaxCalculationNotice taxYear={year} warnings={calculationWarnings} /></div>}
                </section>
                <Button className="min-h-11 w-full rounded-xl" onClick={() => onNavigate?.("tax-preview")} disabled={!onNavigate}>Open detailed Tax Preview<ChevronRight className="ml-1.5 h-4 w-4" /></Button>
                <p className="text-xs leading-relaxed text-muted-foreground">Federal planning only. Confirm all income, payments and eligibility with your filing provider; these figures do not include a state return.</p>
              </>
            )}
          </FilingTabs.Content>

          <FilingTabs.Content value="export" className="space-y-3 focus-visible:outline-none">
            <PreparerPackageCard year={Number(year)} userId={user.id} />
            <h2 className="text-sm font-semibold">Share with your tax preparer</h2>
            <section className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card px-3.5 py-3 sm:px-4">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">Saved records archive</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">All plans · once per hour</p>
              </div>
              <Button variant="outline" className="min-h-11 min-w-[80px] shrink-0 rounded-xl px-3 text-sm" onClick={() => handleExport('archive')} disabled={!!exporting}>
                {exporting === 'archive' ? <><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /><span className="sr-only">Preparing archive…</span></> : <><span className="sr-only">Download records archive (</span>JSON<span className="sr-only">)</span></>}
              </Button>
            </section>

            <PremiumFeatureGate feature="exports" featureName="tax form exports">
              <section className="overflow-hidden rounded-2xl border border-border/70 bg-card">
                <h3 className="border-b border-border/60 px-3.5 py-2.5 text-sm font-semibold sm:px-4">Preparer worksheets</h3>
                <div className="divide-y divide-border/60">
                  {forms.map(form => {
                    const isLoading = exporting === form.id;
                    const isReady = form.id !== 'form-1040' || hasTaxEstimate;
                    return (
                      <div key={form.id} className="flex items-center gap-3 px-3.5 py-3 sm:px-4">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{form.label}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{form.sub}</p>
                        </div>
                        <Button size="sm" variant="outline" aria-label={`Export ${form.label} PDF`} onClick={() => handleExport(form.id)} disabled={!!exporting || !isReady}
                          className="min-h-11 min-w-[80px] shrink-0 rounded-xl px-2.5 text-xs text-primary">
                          {isLoading ? <><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /><span className="sr-only">Exporting…</span></> : "Export PDF"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </section>
            </PremiumFeatureGate>

            <details className="group rounded-2xl border border-border/70 bg-card">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                What’s included & export limits
                <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-3 border-t border-border/60 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
                <p><span className="font-medium text-foreground">Records archive:</span> Saved income forms, transactions, organizer answers and receipt metadata for {year}. The JSON includes a manifest and transaction CSV. Receipt images and filed returns are not included.</p>
                <p><span className="font-medium text-foreground">PDF worksheets:</span> Form 1040 is a federal planning summary with documented limitations. Schedule C summarizes reconciled receipts and confirmed business expenses. Schedule SE uses recorded business profit and W-2 wages to estimate self-employment tax.</p>
                <p><span className="font-medium text-foreground">Before filing:</span> These are preparer summaries, not IRS-fileable forms or tax software import files. Each export validates its required data. Home-office and depreciation forms need additional review and are not offered as filing-ready downloads. Only supported federal scenarios are included; no state return or TXF import is generated. Exporting does not file your return.</p>
              </div>
            </details>

            <details className="group rounded-2xl border border-border/70 bg-card">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                Filing availability & authorization
                <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-2 border-t border-border/60 p-3">
                <EmbeddedFilingCard userId={user.id} taxYear={Number(year)} />
                <Button variant="ghost" className="min-h-11 w-full rounded-xl text-xs" onClick={() => onNavigate?.("form-8879")} disabled={!onNavigate}><Shield className="mr-1.5 h-4 w-4" />Filing Authorization<ChevronRight className="ml-auto h-4 w-4" /></Button>
              </div>
            </details>
          </FilingTabs.Content>
        </FilingTabs.Root>
      </div>
    </div>
  );
}

export default TaxFilingHubScreen;
