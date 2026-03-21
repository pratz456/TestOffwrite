"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Download, CheckCircle2, Circle, AlertCircle,
  FileText, DollarSign, Home, Car, Calculator, Loader2,
  ChevronRight, TrendingUp, Receipt,
} from "lucide-react";
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
  status: "complete" | "partial" | "missing";
  detail?: string;
  action?: string;
  actionScreen?: string;
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function TaxFilingHubScreen({ user, onBack, onNavigate }: FilingHubProps) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    confirmedCount: 0,
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
    setLoading(true);
    setError(null);
    try {
      const [grossRes, incomeRes, txRes, seRes, form1040Res] = await Promise.all([
        makeAuthenticatedRequest(`/api/income/gross-receipts?year=${year}`),
        makeAuthenticatedRequest(`/api/income/1099?year=${year}`),
        makeAuthenticatedRequest(`/api/tax/schedule-c/calculate?year=${year}`),
        makeAuthenticatedRequest(`/api/tax/schedule-se/auto?year=${year}`),
        makeAuthenticatedRequest(`/api/tax/compute-1040?year=${year}`),
      ]);

      const grossData  = grossRes.ok  ? await grossRes.json()  : { totalGrossReceipts: 0, entries: [] };
      const incomeData = incomeRes.ok ? await incomeRes.json() : { forms: [] };
      const txData     = txRes.ok     ? await txRes.json()     : {};
      const seData     = seRes.ok     ? await seRes.json()     : {};
      const tax1040    = form1040Res.ok ? await form1040Res.json() : {};

      const grossReceipts = grossData.totalGrossReceipts || 0;
      const income1099    = (incomeData.forms || []).reduce((s: number, f: any) => s + f.amount, 0);
      const totalIncome   = grossReceipts + income1099;
      const totalExpenses = txData.totalDeductible || seData.totalExpenses || 0;
      const netProfit     = seData.netProfit ?? Math.max(0, totalIncome - totalExpenses);
      const seTax         = seData.calculation?.totalSETax || 0;
      const confirmedCount = txData.confirmedCount || 0;

      setSummary({
        grossReceipts, income1099,
        w2Wages: seData.w2Income || seData.w2Wages || 0,
        w2Withheld: seData.w2Withheld || 0,
        totalIncome: seData.totalIncome || totalIncome,
        confirmedExpenses: totalExpenses,
        totalExpenses, netProfit, seTax, confirmedCount,
        hasHomeOffice: !!(txData.hasHomeOffice),
        hasVehicle: !!(txData.hasVehicle),
        quarterlyPaid: 0,
        hasDeductions: !!(seData.aboveLineDeductions?.total),
        hasW2: (seData.w2Income || 0) > 0,
        aboveLineDeductions: seData.aboveLineDeductions?.total || 0,
        adjustedNetIncome: seData.adjustedNetIncome || netProfit,
        balanceDue: tax1040?.balanceDue || 0,
        refund: tax1040?.refund || 0,
        totalTax: tax1040?.totalTax || 0,
      });
    } catch (e) {
      setError("Failed to load filing summary. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const checklist: ChecklistItem[] = [
    {
      id: "income",
      label: "Income entered",
      description: "Gross receipts and 1099 forms for the year",
      status: summary.totalIncome > 0 ? "complete" : "missing",
      detail: summary.totalIncome > 0 ? `${fmt(summary.totalIncome)} total income` : "No income recorded yet",
      action: "Add Income",
      actionScreen: "income-tracking",
    },
    {
      id: "expenses",
      label: "Expenses confirmed",
      description: "Transactions reviewed and marked deductible",
      status: summary.confirmedCount > 30 ? "complete" : summary.confirmedCount > 0 ? "partial" : "missing",
      detail: summary.confirmedCount > 0
        ? `${summary.confirmedCount} confirmed · ${fmt(summary.totalExpenses)} deductible`
        : "No confirmed expenses yet",
      action: "Review Transactions",
      actionScreen: "transactions",
    },
    {
      id: "schedule-c",
      label: "Schedule C ready",
      description: "Profit or Loss from Business",
      status: summary.totalIncome > 0 && summary.confirmedCount > 0 ? "complete"
            : summary.totalIncome > 0 || summary.confirmedCount > 0 ? "partial"
            : "missing",
      detail: summary.totalIncome > 0 || summary.totalExpenses > 0
        ? `Net profit: ${fmt(summary.netProfit)}`
        : "Add income and confirm expenses first",
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
  ];

  const handleExport = async (formType: string) => {
    setExporting(formType);
    setError(null);
    try {
      const { auth } = await import("@/lib/firebase/client");
      const cu = auth.currentUser;
      if (!cu) throw new Error("Not authenticated");
      const token = await cu.getIdToken();

      let url = "", body: any = { year };
      if (formType === "schedule-c") url = "/api/tax/schedule-c/export";
      else { url = "/api/reports/export"; body = { type: formType }; }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.requiresSubscription) { setError("Subscription required to export forms."); return; }
        throw new Error(data.error || "Export failed");
      }

      const blob = await res.blob();
      const dl = document.createElement("a");
      dl.href = URL.createObjectURL(blob);
      const names: Record<string, string> = {
        "schedule-c": `Schedule_C_${year}_WriteOff.pdf`,
        "scheduleSE": `Schedule_SE_${year}_WriteOff.pdf`,
        "form8829": `Form_8829_${year}_WriteOff.pdf`,
        "form4562": `Form_4562_${year}_WriteOff.pdf`,
      };
      dl.download = names[formType] || `${formType}_${year}.pdf`;
      document.body.appendChild(dl);
      dl.click();
      document.body.removeChild(dl);
      URL.revokeObjectURL(dl.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(null);
    }
  };

  const statusIcon = (s: ChecklistItem["status"]) => {
    if (s === "complete") return <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />;
    if (s === "partial")  return <AlertCircle  className="w-5 h-5 text-amber-500 shrink-0" />;
    return <Circle className="w-5 h-5 text-muted-foreground/40 shrink-0" />;
  };

  const statusBadge = (s: ChecklistItem["status"]) => {
    if (s === "complete") return <Badge className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-0 text-xs">Done</Badge>;
    if (s === "partial")  return <Badge className="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-0 text-xs">Partial</Badge>;
    return <Badge variant="outline" className="text-xs text-muted-foreground">Needed</Badge>;
  };

  const completeCount = checklist.filter(c => c.status === "complete").length;
  const pct = Math.round((completeCount / checklist.length) * 100);

  const forms = [
    { id: "schedule-c", label: "Schedule C", sub: "Profit or Loss from Business",          icon: FileText,     always: true },
    { id: "scheduleSE", label: "Schedule SE", sub: "Self-Employment Tax",                   icon: Calculator,   always: true },
    { id: "form8829",   label: "Form 8829",   sub: "Home Office Deduction",                 icon: Home,         always: false },
    { id: "form4562",   label: "Form 4562",   sub: "Depreciation & Section 179",            icon: Car,          always: false },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
          <Button onClick={onBack} variant="ghost" size="icon" className="shrink-0 min-h-[44px] min-w-[44px]">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold text-foreground">Tax Filing Hub</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Everything you need to file your self-employment taxes</p>
          </div>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-[100px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 4 }, (_, i) => currentYear - i).map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total Income",    value: fmt(summary.totalIncome + summary.w2Wages), accent: "text-green-600 dark:text-green-400",  icon: TrendingUp },
                { label: "Total Expenses",  value: fmt(summary.totalExpenses), accent: "text-red-500 dark:text-red-400", icon: Receipt },
                { label: "Total Tax",       value: fmt(summary.totalTax), accent: "text-orange-600 dark:text-orange-400", icon: DollarSign },
                { label: summary.refund > 0 ? "Est. Refund" : "Balance Due",
                  value: fmt(summary.refund > 0 ? summary.refund : summary.balanceDue),
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

            {/* Progress bar */}
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-foreground">Filing readiness</p>
                  <span className="text-sm font-semibold text-primary">{pct}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2.5">
                  <div
                    className="h-2.5 rounded-full transition-all duration-700"
                    style={{
                      width: `${pct}%`,
                      background: pct === 100 ? "#22c55e" : pct >= 60 ? "#3b82f6" : "#f59e0b"
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {completeCount} of {checklist.length} steps complete
                  {pct === 100 ? " — ready to export your forms!" : " — complete the steps below to prepare your return."}
                </p>
              </CardContent>
            </Card>

            {/* Checklist */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Filing Checklist</CardTitle>
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
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Export Tax Forms</CardTitle>
                <p className="text-xs text-muted-foreground">IRS-faithful PDFs pre-filled with your data</p>
              </CardHeader>
              <CardContent className="space-y-2 p-4 pt-0">
                {forms.map(form => {
                  const Icon = form.icon;
                  const isLoading = exporting === form.id;
                  const isReady = form.id === "schedule-c"
                    ? summary.totalIncome > 0 || summary.confirmedCount > 0
                    : form.id === "scheduleSE"
                    ? summary.netProfit > 0
                    : true;
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
                        disabled={!!exporting}
                        className="shrink-0 gap-1.5 min-h-[36px] text-xs"
                      >
                        {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                        {isLoading ? "Exporting…" : "Export PDF"}
                      </Button>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground pt-1 px-1">
                  Forms are pre-filled from your confirmed transactions and income. Review all lines before filing with a tax professional or uploading to tax software.
                </p>
              </CardContent>
            </Card>

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
