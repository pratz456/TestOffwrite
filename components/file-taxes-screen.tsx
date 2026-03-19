"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  FileText,
  Loader2,
  ExternalLink,
  ClipboardCheck,
  Download,
  CheckCircle2,
  DollarSign,
} from "lucide-react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { useAuth } from "@/lib/firebase/auth-context";
import { useTransactions } from "@/lib/react-query/hooks";
import {
  aggregateScheduleC,
  type AggregateScheduleCResult,
} from "@/lib/schedule-c/aggregate";
import { trackTaxFilingEvent } from "@/lib/analytics/tax-filing";
import {
  FILING_PROVIDERS,
  type ExternalFilingProvider,
} from "@/lib/tax-filing/providers";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function FileTaxesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: response, isLoading: txLoading } = useTransactions(
    user?.id || ""
  );
  const transactions = response?.transactions || response?.data || [];

  const [selectedYear, setSelectedYear] = useState(
    String(new Date().getFullYear())
  );

  const [selectedProvider, setSelectedProvider] =
    useState<ExternalFilingProvider | null>(null);

  const aggregation: AggregateScheduleCResult | null = useMemo(() => {
    if (!transactions || transactions.length === 0) return null;
    return aggregateScheduleC(transactions, selectedYear);
  }, [transactions, selectedYear]);

  useEffect(() => {
    trackTaxFilingEvent("file_taxes_tab_viewed", { taxYear: selectedYear });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleProviderClick = (provider: ExternalFilingProvider) => {
    trackTaxFilingEvent("provider_clicked", {
      providerId: provider.id,
      providerName: provider.name,
    });
    setSelectedProvider(provider);
  };

  const handleRedirectConfirm = () => {
    if (!selectedProvider) return;
    trackTaxFilingEvent("redirect_confirmed", {
      providerId: selectedProvider.id,
      providerName: selectedProvider.name,
    });
    window.open(selectedProvider.url, "_blank", "noopener,noreferrer");
    setSelectedProvider(null);
  };

  const handleRedirectCancel = () => {
    if (selectedProvider) {
      trackTaxFilingEvent("redirect_cancelled", {
        providerId: selectedProvider.id,
        providerName: selectedProvider.name,
      });
    }
    setSelectedProvider(null);
  };

  if (txLoading) {
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
              Prepare in WriteOff. File with a trusted provider.
            </p>
          </div>
          <div className="w-12" />
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6 min-w-0">
        {/* Preparation Checklist */}
        <Card className="p-4 sm:p-6 bg-card border border-border shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-1">
            Before You File
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            WriteOff is a tax preparation tool. Filing and submission are
            completed through the external provider you select. Please verify all
            information before filing.
          </p>

          <div className="space-y-3">
            <Link
              href="/protected/transactions"
              className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors group"
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <ClipboardCheck className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                  Review transactions
                </p>
                <p className="text-xs text-muted-foreground">
                  Make sure all your income and expenses are categorized.
                </p>
              </div>
            </Link>

            <Link
              href="/protected/reports"
              className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors group"
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                  Confirm deductions
                </p>
                <p className="text-xs text-muted-foreground">
                  Review your Schedule C summary and verify deductible amounts.
                </p>
              </div>
            </Link>

            <Link
              href="/protected/reports"
              className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors group"
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Download className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                  Download tax summary
                </p>
                <p className="text-xs text-muted-foreground">
                  Export your Schedule C PDF from the Reports tab.
                </p>
              </div>
            </Link>
          </div>
        </Card>

        {/* Schedule C Summary Preview */}
        <Card className="p-4 sm:p-6 bg-card border border-border shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h3 className="text-lg font-semibold text-foreground">
              Schedule C Summary
            </h3>
            <div>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="min-h-[40px] px-3 py-2 border border-input rounded-lg bg-background text-foreground text-sm focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none"
              >
                <option value="2025">2025</option>
                <option value="2024">2024</option>
                <option value="2023">2023</option>
              </select>
            </div>
          </div>

          {aggregation && aggregation.lineItemsArray.length > 0 ? (
            <>
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
                Verify every amount and category before filing.
              </p>
            </>
          ) : (
            <div className="text-center py-8">
              <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/70" />
              <p className="text-foreground font-medium">
                No deductible expenses found for {selectedYear}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Make sure your transactions are categorized and classified as
                business expenses first.
              </p>
            </div>
          )}
        </Card>

        {/* Choose a Filing Provider */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-1">
            Choose a Filing Provider
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            When you&#39;re ready, continue to one of these trusted providers to
            complete your filing.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FILING_PROVIDERS.map((provider) => (
              <Card
                key={provider.id}
                className="p-5 bg-card border border-border shadow-sm flex flex-col justify-between hover:border-primary/40 transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="text-base font-semibold text-foreground">
                      {provider.name}
                    </h4>
                    {provider.badge && (
                      <Badge variant="secondary" className="text-xs">
                        {provider.badge}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    {provider.description}
                  </p>

                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-base font-semibold text-foreground">
                      {provider.pricingEstimate}
                    </span>
                  </div>
                  {provider.pricingNote && (
                    <p className="text-xs text-muted-foreground mb-4 ml-6">
                      {provider.pricingNote}
                    </p>
                  )}
                </div>

                <Button
                  onClick={() => handleProviderClick(provider)}
                  className="w-full min-h-[44px] h-11 font-medium rounded-lg flex items-center justify-center gap-2 mt-2"
                >
                  <span>Continue to {provider.name}</span>
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </Card>
            ))}
          </div>

          {/* Disclaimer */}
          <p className="mt-4 text-xs text-muted-foreground text-center leading-relaxed">
            Prices shown are estimates and may vary based on your situation.
            WriteOff prepares your tax data, filing and payment are
            handled entirely by the provider you choose. Please review all
            information before submitting. Any filing, submission, or
            transactions occur directly with the selected provider. WriteOff
            is not responsible or liable for any third-party websites,
            services, or information.
          </p>
        </div>
      </div>

      {/* Redirect Confirmation Modal */}
      <ConfirmationDialog
        open={!!selectedProvider}
        onOpenChange={(open) => {
          if (!open) handleRedirectCancel();
        }}
        title="You're leaving WriteOff"
        description={
          selectedProvider
            ? `You'll be redirected to ${selectedProvider.name} to complete your tax filing. WriteOff does not submit taxes on your behalf. Please review your return carefully before filing.\n\n${selectedProvider.name} estimated cost: ${selectedProvider.pricingEstimate}`
            : ""
        }
        confirmLabel={
          selectedProvider ? `Continue to ${selectedProvider.name}` : "Continue"
        }
        cancelLabel="Cancel"
        onConfirm={handleRedirectConfirm}
        onCancel={handleRedirectCancel}
      />
    </div>
  );
}
