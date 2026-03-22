"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Download,
  TrendingUp,
  TrendingDown,
  DollarSign,
  FileText,
  BarChart3,
  Loader2,
} from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

interface ProfitLossReportScreenProps {
  user: { id: string; email?: string };
  onBack: () => void;
}

interface IncomeSource {
  source: string;
  amount: number;
}

interface ExpenseCategory {
  category: string;
  label: string;
  amount: number;
}

interface PLData {
  year: number;
  month: number | null;
  periodLabel: string;
  income: IncomeSource[];
  costOfGoodsSold: number;
  grossProfit: number;
  operatingExpenses: ExpenseCategory[];
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  effectiveTaxRate: number | null;
  priorPeriod: {
    totalIncome: number;
    totalExpenses: number;
    netProfit: number;
  } | null;
  transactionCount: number;
}

export function ProfitLossReportScreen({ user, onBack }: ProfitLossReportScreenProps) {
  const [data, setData] = useState<PLData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [viewMode, setViewMode] = useState<"annual" | "monthly">("annual");
  const [month, setMonth] = useState<number | null>(null);

  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1];

  const effectiveMonth = viewMode === "monthly" ? (month ?? new Date().getMonth() + 1) : undefined;

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await makeAuthenticatedRequest("/api/reports/profit-loss", {
        method: "POST",
        body: JSON.stringify({
          year,
          month: effectiveMonth,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load report");
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [year, effectiveMonth]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      params.set("format", "pdf");
      params.set("year", String(year));
      if (viewMode === "monthly" && effectiveMonth != null) {
        params.set("month", String(effectiveMonth));
      }
      const url = `/api/reports/profit-loss?${params.toString()}`;
      const res = await makeAuthenticatedRequest(url, { method: "GET" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `profit-loss-${data?.periodLabel ?? year}.pdf`;
      a.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const maxExpenseAmount =
    data?.operatingExpenses?.reduce((m, e) => Math.max(m, e.amount), 0) ?? 1;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-lg sm:text-xl font-semibold text-foreground truncate">
                Profit & Loss Report
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground truncate">
                Income and expense breakdown
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
        {/* Period selector */}
        <Card className="bg-card border-border">
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Year:</span>
                <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v, 10))}>
                  <SelectTrigger className="w-[100px] h-9 bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">View:</span>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setViewMode("annual")}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      viewMode === "annual"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Annual
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("monthly")}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors border-l border-border ${
                      viewMode === "monthly"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Monthly
                  </button>
                </div>
              </div>
              {viewMode === "monthly" && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Month:</span>
                  <Select
                    value={String(effectiveMonth ?? new Date().getMonth() + 1)}
                    onValueChange={(v) => setMonth(v ? parseInt(v, 10) : null)}
                  >
                    <SelectTrigger className="w-[140px] h-9 bg-background border-border">
                      <SelectValue placeholder="Select month" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          {new Date(2000, m - 1, 1).toLocaleString("default", { month: "long" })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <Card key={i} className="bg-card border-border">
                  <CardContent className="pt-4">
                    <div className="h-4 w-20 bg-muted rounded animate-pulse mb-2" />
                    <div className="h-8 w-28 bg-muted rounded animate-pulse" />
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card className="bg-card border-border">
              <CardContent className="pt-4">
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </div>
        ) : error ? (
          <Card className="bg-card border-border">
            <CardContent className="pt-6">
              <p className="text-destructive text-center">{error}</p>
              <div className="flex justify-center mt-4">
                <Button variant="outline" onClick={fetchReport}>
                  Retry
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : !data || data.transactionCount === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <FileText className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No transactions found for this period.</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Connect your bank or add transactions to see your P&L report.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card className="bg-card border-border">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-500" />
                    <span className="text-xs sm:text-sm">Total Income</span>
                  </div>
                  <p className="text-lg sm:text-xl font-semibold text-foreground tabular-nums">
                    ${fmt(data.totalIncome)}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-500" />
                    <span className="text-xs sm:text-sm">Total Expenses</span>
                  </div>
                  <p className="text-lg sm:text-xl font-semibold text-foreground tabular-nums">
                    ${fmt(data.totalExpenses)}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <DollarSign
                      className={`w-4 h-4 ${
                        data.netProfit >= 0
                          ? "text-green-600 dark:text-green-500"
                          : "text-red-600 dark:text-red-500"
                      }`}
                    />
                    <span className="text-xs sm:text-sm">Net Profit/Loss</span>
                  </div>
                  <p
                    className={`text-lg sm:text-xl font-semibold tabular-nums ${
                      data.netProfit >= 0 ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-500"
                    }`}
                  >
                    {data.netProfit >= 0 ? "" : "("}${fmt(Math.abs(data.netProfit))}
                    {data.netProfit >= 0 ? "" : ")"}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <BarChart3 className="w-4 h-4" />
                    <span className="text-xs sm:text-sm">Effective Tax Rate</span>
                  </div>
                  <p className="text-lg sm:text-xl font-semibold text-foreground tabular-nums">
                    {data.effectiveTaxRate != null
                      ? `${data.effectiveTaxRate.toFixed(1)}%`
                      : "-"}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Prior period comparison */}
            {data.priorPeriod && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold text-foreground">
                    Prior Period Comparison
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Income</p>
                      <p className="font-medium">${fmt(data.priorPeriod.totalIncome)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Expenses</p>
                      <p className="font-medium">${fmt(data.priorPeriod.totalExpenses)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Net</p>
                      <p
                        className={`font-medium ${
                          data.priorPeriod.netProfit >= 0
                            ? "text-green-600 dark:text-green-500"
                            : "text-red-600 dark:text-red-500"
                        }`}
                      >
                        ${fmt(data.priorPeriod.netProfit)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Income section */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-600 dark:text-green-500" />
                  Income by Source
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.income.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No income transactions</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 font-medium text-foreground">Source</th>
                          <th className="text-right py-2 font-medium text-foreground">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.income.map(({ source, amount }) => (
                          <tr key={source} className="border-b border-border/50">
                            <td className="py-2 text-foreground">{source}</td>
                            <td className="py-2 text-right tabular-nums text-green-600 dark:text-green-500">
                              ${fmt(amount)}
                            </td>
                          </tr>
                        ))}
                        <tr className="font-medium">
                          <td className="py-2 text-foreground">Total Income</td>
                          <td className="py-2 text-right tabular-nums">
                            ${fmt(data.totalIncome)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Expense breakdown */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-red-600 dark:text-red-500" />
                  Expense Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.operatingExpenses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No expense transactions</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 font-medium text-foreground">Category</th>
                          <th className="text-right py-2 font-medium text-foreground">Amount</th>
                          <th className="text-right py-2 font-medium text-foreground">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.operatingExpenses.map(({ label, amount }) => (
                          <tr key={label} className="border-b border-border/50">
                            <td className="py-2 text-foreground">{label}</td>
                            <td className="py-2 text-right tabular-nums text-red-600 dark:text-red-500">
                              ${fmt(amount)}
                            </td>
                            <td className="py-2 text-right tabular-nums text-muted-foreground">
                              {data.totalExpenses > 0
                                ? ((amount / data.totalExpenses) * 100).toFixed(1)
                                : "0"}
                              %
                            </td>
                          </tr>
                        ))}
                        <tr className="font-medium">
                          <td className="py-2 text-foreground">Total Expenses</td>
                          <td className="py-2 text-right tabular-nums">
                            ${fmt(data.totalExpenses)}
                          </td>
                          <td className="py-2 text-right tabular-nums">100%</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Horizontal bar chart */}
            {data.operatingExpenses.length > 0 && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" />
                    Top Expense Categories
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {data.operatingExpenses
                      .slice()
                      .sort((a, b) => b.amount - a.amount)
                      .slice(0, 8)
                      .map(({ label, amount }) => {
                        const pct = (amount / maxExpenseAmount) * 100;
                        return (
                          <div key={label} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className="text-foreground truncate">{label}</span>
                              <span className="text-muted-foreground tabular-nums shrink-0">
                                ${fmt(amount)} (
                                {data.totalExpenses > 0
                                  ? ((amount / data.totalExpenses) * 100).toFixed(0)
                                  : 0}
                                %)
                              </span>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-red-500/70 dark:bg-red-600/70 rounded-full transition-all"
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Export button */}
            <div className="flex justify-end">
              <Button
                onClick={handleExportPDF}
                disabled={exporting}
                variant="outline"
                className="gap-2"
              >
                {exporting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Export as PDF
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
