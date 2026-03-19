"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  FileText,
  AlertCircle,
  Loader2,
  Sparkles,
  ShieldCheck,
  Send,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "@/lib/firebase/auth-context";
import { useSubscription } from "@/lib/hooks/use-subscription";
import { useTransactions } from "@/lib/react-query/hooks";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";
import {
  aggregateScheduleC,
  type AggregateScheduleCResult,
} from "@/lib/schedule-c/aggregate";
import { trackTaxFilingEvent } from "@/lib/analytics/tax-filing";

type FilingStep = "review" | "confirm" | "redirecting" | "error";

interface RedirectStartResponse {
  success: boolean;
  redirectUrl?: string;
  sessionId?: string;
  requiresSubscription?: boolean;
  error?: string;
  details?: string;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function FileTaxesScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const { hasAccess, isLoading: subscriptionLoading } = useSubscription();

  const { data: response, isLoading: txLoading } = useTransactions(
    user?.id || ""
  );
  const transactions = response?.transactions || response?.data || [];

  const [selectedYear, setSelectedYear] = useState(
    String(new Date().getFullYear())
  );
  const [step, setStep] = useState<FilingStep>("review");
  const [confirmed, setConfirmed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const aggregation: AggregateScheduleCResult | null = useMemo(() => {
    if (!transactions || transactions.length === 0) return null;
    return aggregateScheduleC(transactions, selectedYear);
  }, [transactions, selectedYear]);

  const isLoading = txLoading || subscriptionLoading;

  // Analytics (GA via gtag stub in app/layout.tsx)
  useEffect(() => {
    trackTaxFilingEvent("file_taxes_tab_viewed", {
      providerName: "taxbandits",
      taxYear: selectedYear,
    });
  }, []);

  const startTaxFiling = useCallback(async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      // Important: explicit external redirect flow
      const res = await makeAuthenticatedRequest(
        "/api/tax/taxbandits/start-filing",
        {
          method: "POST",
          body: JSON.stringify({ year: parseInt(selectedYear, 10) }),
        }
      );

      const data = (await res.json()) as RedirectStartResponse;

      if (!res.ok) {
        if (data.requiresSubscription) {
          router.push("/protected/subscriptions");
          return;
        }
        throw new Error(data.error || data.details || "Failed to start filing");
      }

      if (!data.redirectUrl) {
        throw new Error("Missing redirect URL from TaxBandits session.");
      }

      trackTaxFilingEvent("redirect_confirmed", {
        providerName: "taxbandits",
        taxYear: selectedYear,
        sessionId: data.sessionId,
      });

      setStep("redirecting");

      // Hard navigation: leave the app.
      window.location.assign(data.redirectUrl);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong";
      setErrorMessage(msg);
      setStep("error");
    } finally {
      setIsSubmitting(false);
    }
  }, [router, selectedYear]);

  const onContinueClicked = useCallback(() => {
    trackTaxFilingEvent("taxbandits_cta_clicked", {
      providerName: "taxbandits",
      taxYear: selectedYear,
    });
    setStep("confirm");
  }, [selectedYear]);

  const onCancelRedirect = useCallback(() => {
    trackTaxFilingEvent("redirect_cancelled", {
      providerName: "taxbandits",
      taxYear: selectedYear,
    });

    setStep("review");
    setConfirmed(false);
  }, [selectedYear]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background min-w-0 overflow-x-hidden">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-50 shadow-sm min-w-0">
        <div className="flex items-center justify-between p-4 sm:p-6 min-w-0">
          <button
            onClick={() => router.push("/protected/reports")}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded min-h-[44px] min-w-[44px] justify-center"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground">
              File Your Taxes
            </h1>
            <p className="text-sm text-muted-foreground">
              Filing handled externally by TaxBandits
            </p>
          </div>
          <div className="w-12" />
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6 min-w-0">
        {/* Redirect transparency banner */}
        <Card className="p-4 sm:p-6 bg-card border border-border shadow-sm">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-muted/60 rounded-lg shrink-0">
              <ExternalLink className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-foreground">
                You are leaving WriteOff
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                You will be redirected to <span className="font-medium">TaxBandits</span>{" "}
                to complete filing workflows externally. WriteOff prepares your
                expense summary; you must verify details before submission.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="secondary">External partner</Badge>
                <Badge variant="outline">Verify before submitting</Badge>
              </div>
            </div>
          </div>
        </Card>

        {/* Subscription Gate */}
        {!subscriptionLoading && !hasAccess && (
          <Card className="p-6 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/30 dark:to-blue-900/30 border border-purple-200 dark:border-purple-700 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-purple-100 dark:bg-purple-800/50 rounded-xl">
                <Sparkles className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground mb-1">
                  Unlock Tax Filing
                </h3>
                <p className="text-muted-foreground mb-4">
                  Subscribe to access the TaxBandits filing workflow. Your
                  Schedule C-style expense summary will be prepared in WriteOff.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => router.push("/protected/subscriptions")}
                    className="bg-gradient-to-r from-purple-500 to-purple-600 dark:from-purple-500 dark:to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white font-medium shadow-md shadow-purple-500/20 dark:shadow-purple-500/30 transition-all duration-200"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Subscribe Now
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* ── Step: Review ─────────────────────────────────────────── */}
        {step === "review" && hasAccess && (
          <>
            {/* Year Selector */}
            <Card className="p-4 sm:p-6 bg-card border border-border shadow-sm">
              <div className="min-w-0 w-full">
                <label className="block text-sm font-medium text-foreground mb-2">
                  Tax Year
                </label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="w-full max-w-xs min-h-[44px] p-3 border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none"
                >
                  <option value="2025">2025</option>
                  <option value="2024">2024</option>
                  <option value="2023">2023</option>
                </select>
              </div>
            </Card>

            {/* Schedule C Preview */}
            {aggregation && aggregation.lineItemsArray.length > 0 ? (
              <Card className="p-4 sm:p-6 bg-card border border-border shadow-sm overflow-hidden">
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  Schedule C Summary — Tax Year {selectedYear}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Use this summary to review your deductible expense categories.
                  TaxBandits handles the filing workflow externally.
                </p>

                <div className="overflow-x-auto max-w-full rounded-lg border border-border">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead className="bg-muted text-muted-foreground text-xs uppercase">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Line</th>
                        <th className="px-3 py-2 text-left font-medium">
                          Description
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Transactions
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Deductible
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card/60">
                      {aggregation.lineItemsArray.map((item) => (
                        <tr
                          key={item.lineCode}
                          className="hover:bg-muted/50 transition-colors"
                        >
                          <td className="px-3 py-2 font-mono text-xs text-foreground tabular-nums">
                            {item.lineCode}
                          </td>
                          <td className="px-3 py-2 text-foreground">
                            {item.lineCode === "24b"
                              ? "Meals (50%)"
                              : item.lineName}
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                            {item.transactionCount}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-foreground tabular-nums">
                            {formatCurrency(item.deductible)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-muted font-semibold">
                        <td className="px-3 py-2 font-mono text-xs tabular-nums">
                          28
                        </td>
                        <td className="px-3 py-2">Total Expenses</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {aggregation.counts.deductible}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCurrency(aggregation.totalDeductible)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="mt-3 text-xs text-muted-foreground">
                  This preview is generated from your classified transactions.
                  Verify every amount and category before submitting.
                </p>

                <div className="mt-6">
                  <Button
                    onClick={onContinueClicked}
                    className="w-full sm:w-auto min-h-[44px] h-12 font-medium rounded-lg flex items-center justify-center gap-2"
                  >
                    <FileText className="w-5 h-5" />
                    Continue to TaxBandits
                  </Button>
                </div>
              </Card>
            ) : (
              <Card className="p-8 bg-card border border-border shadow-sm">
                <div className="text-center">
                  <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/70" />
                  <p className="text-foreground font-medium">
                    No deductible expenses found for {selectedYear}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Make sure your transactions are categorized and classified as
                    business expenses first.
                  </p>
                </div>
              </Card>
            )}

            {/* How It Works */}
            <Card className="p-4 sm:p-6 bg-card border border-border shadow-sm">
              <h4 className="text-lg font-semibold text-foreground mb-3">
                How It Works
              </h4>
              <div className="space-y-3 text-sm text-muted-foreground">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                    1
                  </div>
                  <p>
                    <span className="text-foreground font-medium">Review</span>{" "}
                    — Check your expense summary in WriteOff.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                    2
                  </div>
                  <p>
                    <span className="text-foreground font-medium">Confirm</span>{" "}
                    — Review and confirm you want to leave WriteOff.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                    3
                  </div>
                  <p>
                    <span className="text-foreground font-medium">File</span>{" "}
                    — TaxBandits handles the filing workflow externally. Verify everything before submission.
                  </p>
                </div>
              </div>
            </Card>
          </>
        )}

        {/* ── Step: Confirm ────────────────────────────────────────── */}
        {step === "confirm" && hasAccess && (
          <Card className="p-4 sm:p-6 bg-card border border-border shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <ShieldCheck className="w-6 h-6 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">
                Confirm You Want to Leave WriteOff
              </h3>
            </div>

            <div className="bg-muted/50 rounded-lg p-4 mb-6 border border-border">
              <p className="text-sm text-foreground mb-2">
                You will be redirected to TaxBandits for tax year{" "}
                <span className="font-semibold">{selectedYear}</span>.
              </p>

              <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
                <li>
                  {aggregation?.lineItemsArray.length || 0} expense categories
                  totaling{" "}
                  <span className="font-medium text-foreground">
                    {formatCurrency(aggregation?.totalDeductible || 0)}
                  </span>
                </li>
                <li>
                  {aggregation?.counts.deductible || 0} classified transactions
                </li>
                <li>
                  You are responsible for verifying details before submission.
                </li>
              </ul>
            </div>

            <label className="flex items-start gap-3 cursor-pointer select-none mb-6">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-input text-primary focus:ring-primary"
              />
              <span className="text-sm text-foreground">
                I confirm the preview summary is accurate to the best of my
                knowledge, and I understand I will be redirected to an external
                filing partner (TaxBandits).
              </span>
            </label>

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => {
                  // Fire analytics for the CTA click (handled in review)
                  startTaxFiling();
                }}
                disabled={!confirmed || isSubmitting}
                className="min-h-[44px] h-12 font-medium rounded-lg flex items-center gap-2"
              >
                {isSubmitting ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
                {isSubmitting ? "Starting..." : "Continue to TaxBandits"}
              </Button>

              <Button
                variant="outline"
                onClick={onCancelRedirect}
                disabled={isSubmitting}
                className="min-h-[44px] h-12"
              >
                Cancel
              </Button>
            </div>
          </Card>
        )}

        {/* ── Step: Redirecting ───────────────────────────────────── */}
        {step === "redirecting" && hasAccess && (
          <Card className="p-8 bg-card border border-border shadow-sm">
            <div className="text-center">
              <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-foreground mb-2">
                Redirecting to TaxBandits…
              </h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Leave this page open until the redirect completes.
              </p>
            </div>
          </Card>
        )}

        {/* ── Step: Error ──────────────────────────────────────────── */}
        {step === "error" && hasAccess && (
          <Card className="p-6 bg-card border border-destructive/30 shadow-sm">
            <div className="flex items-start gap-4">
              <AlertCircle className="w-6 h-6 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground mb-1">
                  Something went wrong
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {errorMessage ||
                    "An unexpected error occurred while starting the filing process."}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => {
                      setStep("review");
                      setErrorMessage(null);
                      setConfirmed(false);
                    }}
                    className="min-h-[44px]"
                  >
                    Try Again
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => router.push("/protected/help")}
                    className="min-h-[44px]"
                  >
                    Get Help
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* No embedding: TaxBandits is opened externally */}
      </div>
    </div>
  );
}

