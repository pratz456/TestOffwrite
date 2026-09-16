"use client";

import { EmbeddedFilingCard } from '@/components/embedded-filing-card';
import { SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
import { PremiumFeatureGate } from '@/components/premium-feature-gate';
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Download, CheckCircle2, Circle, AlertCircle,
  FileText, DollarSign, Calculator, Loader2,
  ChevronRight, TrendingUp, Receipt, Shield, Upload,
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
        income?.grossReceipts, income?.scheduleCNetProfit, income?.totalDeductible, income?.w2Wages,
        tax1040.seCalc?.totalSETax, tax1040.w2?.withheld,
      ].every(value => typeof value === "number" && Number.isFinite(value))) {
        throw new Error("The federal estimate is incomplete or belongs to another year. Open Tax Preview to retry.");
      }
      if (request !== loadRequest.current) return;
      setHasTaxEstimate(true);
      setCalculationWarnings(federalEstimate.calculationWarnings);

      const totalExpenses = income.totalDeductible;
      const netProfit = income.scheduleCNetProfit;
      const seTax = tax1040.seCalc.totalSETax;

      setSummary({
        grossReceipts: income.grossReceipts, income1099: 0,
        w2Wages: income.w2Wages,
        w2Withheld: tax1040.w2.withheld,
        totalIncome: federalEstimate.totalIncome,
        confirmedExpenses: totalExpenses,
        totalExpenses, netProfit, seTax,
        hasHomeOffice: !!(txData.hasHomeOffice),
        hasVehicle: !!(txData.hasVehicle),
        quarterlyPaid: 0,
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
      detail: summary.totalIncome > 0 ? `${fmt(summary.totalIncome)} total income` : "No income recorded yet",
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
      status: "partial",
      detail: "Review if you made quarterly payments",
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
    { id: "form-1040", label: "Form 1040 planning summary", sub: "Federal estimate and its documented limitations", icon: DollarSign },
    { id: "schedule-c", label: "Schedule C preparer summary", sub: "Reconciled receipts and confirmed business expenses", icon: FileText },
    { id: "scheduleSE", label: "Schedule SE worksheet", sub: "Self-employment tax with recorded W-2 wages", icon: Calculator },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>Back</Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold text-foreground">Tax Filing Hub</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Prepare records, review estimates and check filing availability</p>
          </div>
          <Select value={year} onValueChange={value => { active.current = `${user.id}:${value}`; setExporting(null); setYear(value); }}>
            <SelectTrigger className="w-[100px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[...SUPPORTED_TAX_YEARS].reverse().map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        <EmbeddedFilingCard userId={user.id} taxYear={Number(year)} />
        <section className="rounded-xl border p-4 space-y-2">
          <h2 className="font-semibold">Tax records handoff</h2>
          <p className="text-sm text-muted-foreground">Download your saved records for this year, including income forms, transactions, organizer answers and receipt metadata. This JSON archive includes a manifest and transaction CSV; it does not include receipt images or a filed return. Available on every plan, once per hour.</p>
          <Button variant="outline" onClick={() => handleExport('archive')} disabled={!!exporting}>{exporting === 'archive' ? 'Preparing archive…' : 'Download records archive (JSON)'}</Button>
        </section>
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={loadSummary} disabled={loading} className="mt-2">Retry filing summary</Button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total Income",    value: hasTaxEstimate ? fmt(summary.totalIncome) : "Unavailable", accent: "text-green-600 dark:text-green-400",  icon: TrendingUp },
                { label: "Total Expenses",  value: hasTaxEstimate ? fmt(summary.totalExpenses) : "Unavailable", accent: "text-red-500 dark:text-red-400", icon: Receipt },
                { label: "Total Tax",       value: hasTaxEstimate ? fmt(summary.totalTax) : "Unavailable", accent: "text-orange-600 dark:text-orange-400", icon: DollarSign },
                { label: summary.refund > 0 ? "Est. Refund" : "Balance Due",
                  value: hasTaxEstimate ? fmt(summary.refund > 0 ? summary.refund : summary.balanceDue) : "Unavailable",
                  accent: summary.refund > 0 ? "text-green-600 dark:text-green-400" : "text-orange-600 dark:text-orange-400",
                  icon: Calculator },
              ].map(({ label, value, accent, icon: Icon }) => (
                <Card key={label} className="bg-card border-border">
                  <CardContent className="p-3 sm:p-4">
                    <Icon className="w-4 h-4 text-muted-foreground mb-1" />
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className={`text-base sm:text-lg font-semibold tabular-nums mt-0.5 ${accent}`}>{value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {hasTaxEstimate && <TaxCalculationNotice taxYear={year} warnings={calculationWarnings} />}

            <p className="text-sm text-muted-foreground">These are recorded inputs and planning estimates. They do not establish that your return is complete or ready to file. Review missing income, adjustments, credits and state requirements with your filing provider.</p>

            {/* Checklist */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Records and estimates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 p-4 pt-0">
                {checklist.map((item, i) => (
                  <div key={item.id}>
                    {i > 0 && <div className="border-t border-border/50 my-1" />}
                    <div className="flex items-start gap-3 py-2">
                      {statusIcon(item.status)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-foreground">{item.label}</span>
                          {statusBadge(item.status)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                        {item.detail && (
                          <p className={`text-xs mt-1 font-medium ${item.status === "complete" ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                            {item.detail}
                          </p>
                        )}
                      </div>
                      {item.action && item.actionScreen && onNavigate && (
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => onNavigate(item.actionScreen!)}
                          className="shrink-0 text-xs gap-1 text-primary hover:text-primary/80 h-8 px-2"
                        >
                          {item.action} <ChevronRight className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Export forms */}
            <PremiumFeatureGate feature="exports" featureName="tax form exports">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Export preparer worksheets</CardTitle>
                <p className="text-xs text-muted-foreground">Preparer summaries, not IRS-fileable forms or tax software import files</p>
              </CardHeader>
              <CardContent className="space-y-2 p-4 pt-0">
                {forms.map(form => {
                  const Icon = form.icon;
                  const isLoading = exporting === form.id;
                  const isReady = form.id !== 'form-1040' || hasTaxEstimate;
                  return (
                    <div key={form.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition-colors">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{form.label}</p>
                        <p className="text-xs text-muted-foreground">{form.sub}</p>
                      </div>
                      <Button
                        size="sm"
                        variant={isReady ? "default" : "outline"}
                        onClick={() => handleExport(form.id)}
                        disabled={!!exporting || !isReady}
                        className="shrink-0 gap-1.5 min-h-[36px] text-xs"
                      >
                        {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                        {isLoading ? "Exporting…" : "Export PDF"}
                      </Button>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground pt-1 px-1">
                  Each export validates its own required data. Home-office and depreciation forms need additional review and are not offered as filing-ready downloads. The federal summary includes only supported tax scenarios; no state return or TXF import is generated.
                </p>
              </CardContent>
            </Card>
            </PremiumFeatureGate>

            {/* Quick actions */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 p-4 pt-0">
                {[
                  { label: "Tax Preview",       screen: "tax-preview",            icon: DollarSign },
                  { label: "Add Income",        screen: "income-tracking",        icon: TrendingUp },
                  { label: "Add Transaction",   screen: "add-manual-transaction", icon: Receipt },
                  { label: "Deductions",        screen: "deductions-entry",       icon: Receipt },
                  { label: "Review Expenses",   screen: "transactions",           icon: FileText },
                  { label: "Schedule C Export", screen: "schedule-c-export",      icon: Download },
                  { label: "Filing Authorization",   screen: "form-8879",              icon: Shield },
                  { label: "Import Document",  screen: "document-import",        icon: Upload },
                ].map(({ label, screen, icon: Icon }) => (
                  <Button
                    key={screen}
                    variant="outline"
                    className="h-auto py-3 flex flex-col items-center gap-1.5 text-xs font-medium border-border hover:bg-muted/50"
                    onClick={() => onNavigate?.(screen)}
                  >
                    <Icon className="w-4 h-4 text-primary" />
                    {label}
                  </Button>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

export default TaxFilingHubScreen;
