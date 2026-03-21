"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, RefreshCw, TrendingUp, TrendingDown, DollarSign, Calculator, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Loader2, Info } from "lucide-react";
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
const fmtDec = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const pct = (n: number) => `${n.toFixed(1)}%`;

export function TaxPreviewScreen({ user, onBack, onNavigate }: Props) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [showDetails, setShowDetails] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await makeAuthenticatedRequest(`/api/tax/compute-1040?year=${year}`);
      if (!res.ok) throw new Error("Failed to compute return");
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tax preview");
    } finally { setLoading(false); }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const f1040 = data?.form1040;
  const hasRefund = f1040?.refund > 0;
  const hasBalance = f1040?.balanceDue > 0;
  const isEven = !hasRefund && !hasBalance;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
          <Button onClick={onBack} variant="ghost" size="icon" className="shrink-0 min-h-[44px] min-w-[44px]">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold text-foreground">Tax Preview</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Your estimated federal return, updated in real time</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-[90px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 4 }, (_, i) => currentYear - i).map(y => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={load} variant="ghost" size="icon" className="h-9 w-9" disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Computing your return…</p>
          </div>
        ) : f1040 ? (
          <>
            {/* Big result card */}
            <Card className={`border-2 ${hasRefund ? "border-green-500/40 bg-green-50/30 dark:bg-green-950/20" : hasBalance ? "border-orange-500/40 bg-orange-50/30 dark:bg-orange-950/20" : "border-border"}`}>
              <CardContent className="p-6 text-center">
                {hasRefund ? (
                  <>
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <TrendingUp className="w-5 h-5 text-green-600 dark:text-green-400" />
                      <p className="text-sm font-medium text-green-700 dark:text-green-400">Estimated Federal Refund</p>
                    </div>
                    <p className="text-5xl font-bold text-green-600 dark:text-green-400 tabular-nums">{fmt(f1040.refund)}</p>
                    <p className="mt-2 text-xs text-muted-foreground">You overpaid by this much through withholding and quarterly payments</p>
                  </>
                ) : hasBalance ? (
                  <>
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <TrendingDown className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                      <p className="text-sm font-medium text-orange-700 dark:text-orange-400">Estimated Balance Due</p>
                    </div>
                    <p className="text-5xl font-bold text-orange-600 dark:text-orange-400 tabular-nums">{fmt(f1040.balanceDue)}</p>
                    <p className="mt-2 text-xs text-muted-foreground">Additional amount owed on top of payments already made</p>
                    {f1040.quarterlyRecommended && (
                      <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-orange-100 dark:bg-orange-900/30 px-3 py-1.5 text-xs text-orange-800 dark:text-orange-300">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        Quarterly payment recommended: {fmt(f1040.quarterlyRecommended)}/quarter
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-10 h-10 text-primary mx-auto mb-2" />
                    <p className="text-xl font-bold text-foreground">Perfectly balanced</p>
                    <p className="text-xs text-muted-foreground mt-1">Payments match tax liability</p>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Key numbers row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total Income", value: fmt(f1040.totalIncome), icon: DollarSign, accent: "text-green-600 dark:text-green-400" },
                { label: "AGI", value: fmt(f1040.agi), icon: Calculator, accent: "text-blue-600 dark:text-blue-400" },
                { label: "Total Tax", value: fmt(f1040.totalTax), icon: TrendingDown, accent: "text-red-500 dark:text-red-400" },
                { label: "Eff. Rate", value: pct(f1040.effectiveRate), icon: TrendingUp, accent: "text-foreground" },
              ].map(({ label, value, icon: Icon, accent }) => (
                <Card key={label} className="bg-card border-border">
                  <CardContent className="p-3 sm:p-4">
                    <Icon className="w-4 h-4 text-muted-foreground mb-1" />
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className={`text-base sm:text-lg font-semibold tabular-nums mt-0.5 ${accent}`}>{value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Line-by-line 1040 breakdown */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold">Form 1040 Line-by-Line</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setShowDetails(!showDetails)} className="text-xs gap-1 h-8">
                    {showDetails ? <><ChevronUp className="w-3.5 h-3.5" />Hide</> : <><ChevronDown className="w-3.5 h-3.5" />Show</>}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Estimated — based on your current data. Review with a tax professional before filing.</p>
              </CardHeader>

              {showDetails && (
                <CardContent className="pt-0 space-y-0">
                  {([
                    { section: "INCOME" as string, lines: [
                      { num: "1a", label: "W-2 wages", value: f1040.totalIncome - data.income.scheduleCNetProfit },
                      { num: "3", label: "Schedule C net profit", value: data.income.scheduleCNetProfit },
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
                      { num: "13", label: "QBI deduction (§199A)", value: f1040.qbiDeduction, negative: true },
                      { num: "15", label: "Taxable income", value: f1040.taxableIncome, bold: true },
                    ]},
                    { section: "TAX", lines: [
                      { num: "16", label: "Federal income tax", value: f1040.incomeTax },
                      { num: "SE", label: "Self-employment tax (Sch. SE)", value: f1040.selfEmploymentTax },
                      { num: "24", label: "Total tax", value: f1040.totalTax, bold: true },
                    ]},
                    { section: "PAYMENTS", lines: [
                      { num: "25a", label: "W-2 federal withholding", value: f1040.w2FederalWithheld, negative: true },
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
                        <div key={i} className={`flex items-center justify-between px-4 py-2 border-b border-border/50 last:border-0 ${line.highlight === 'green' ? 'bg-green-50/50 dark:bg-green-950/20' : line.highlight === 'orange' ? 'bg-orange-50/50 dark:bg-orange-950/20' : ''}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs text-muted-foreground font-mono w-6 shrink-0">{line.num}</span>
                            <span className={`text-sm truncate ${line.bold ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{line.label}</span>
                          </div>
                          <span className={`text-sm font-mono tabular-nums ml-4 shrink-0 ${line.bold ? "font-bold" : ""} ${line.highlight === 'green' ? "text-green-600 dark:text-green-400" : line.highlight === 'orange' ? "text-orange-600 dark:text-orange-400" : line.negative ? "text-muted-foreground" : ""}`}>
                            {(line.value || 0) > 0 ? (line.negative ? `(${fmt(line.value!, { abs: true })})` : fmt(line.value!)) : "$0"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>

            {/* Data gaps */}
            {(() => {
              const gaps = [];
              if (data.income.grossReceipts === 0 && data.income.w2Wages === 0) gaps.push({ msg: "No income recorded yet", screen: "income-tracking" });
              if (data.income.totalDeductible === 0) gaps.push({ msg: "No confirmed expenses", screen: "transactions" });
              if (data.w2.count === 0 && data.income.w2Wages === 0) gaps.push({ msg: "Add W-2 income if you have a day job", screen: "w2-income" });
              if (!data.deductions.healthInsurancePremiums && !data.deductions.sepIraContribution) gaps.push({ msg: "Enter health insurance and retirement deductions to reduce your bill", screen: "tax-organizer" });
              return gaps.length > 0 ? (
                <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />Data gaps that could change this estimate</CardTitle></CardHeader>
                  <CardContent className="space-y-2 pt-0">
                    {gaps.map((g, i) => (
                      <div key={i} className="flex items-center justify-between gap-3">
                        <p className="text-xs text-amber-800 dark:text-amber-300">{g.msg}</p>
                        {onNavigate && <Button variant="outline" size="sm" onClick={() => onNavigate(g.screen)} className="text-xs h-7 shrink-0 border-amber-300 dark:border-amber-700">Fix</Button>}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null;
            })()}

            <p className="text-xs text-center text-muted-foreground pb-4">
              This is an estimate based on current data only. Actual tax may differ. Rates: 2025 IRS Rev. Proc. 2024-40 + OBBB P.L. 119-21.
              <br />Always verify with a tax professional before filing.
            </p>
          </>
        ) : !loading && (
          <div className="text-center py-20">
            <DollarSign className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="font-medium text-foreground">No data yet</p>
            <p className="text-sm text-muted-foreground mt-1">Add income and confirm expenses to see your tax estimate</p>
            {onNavigate && <Button onClick={() => onNavigate("income-tracking")} className="mt-4">Add Income</Button>}
          </div>
        )}
      </div>
    </div>
  );
}

export default TaxPreviewScreen;
