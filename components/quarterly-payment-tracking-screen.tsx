"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DollarSign,
  Calendar,
  CheckCircle,
  AlertCircle,
  Clock,
  CreditCard,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

interface QuarterlyPaymentTrackingScreenProps {
  user: { id: string; email?: string };
  onBack: () => void;
}

interface Payment {
  quarter: number;
  year: number;
  deadline: string;
  estimatedAmount: number;
  paidAmount: number;
  paidDate: string | null;
  confirmationNumber: string | null;
  paymentMethod: string | null;
  status: "recorded" | "no_record";
  notes: string;
  penalty?: null;
}

interface Summary {
  totalEstimated: number;
  totalPaid: number;
  totalRemaining: number;
  totalPenalty: null;
}

const PAYMENT_METHODS = [
  "IRS Direct Pay",
  "EFTPS",
  "Check",
  "Other",
] as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: Payment["status"] }) {
  return <Badge variant="outline">{status === 'recorded' ? 'Payment recorded' : 'No payment recorded'}</Badge>;
}

export function QuarterlyPaymentTrackingScreen({
  user,
  onBack,
}: QuarterlyPaymentTrackingScreenProps) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedQuarter, setExpandedQuarter] = useState<number | null>(null);
  const [submittingQuarter, setSubmittingQuarter] = useState<number | null>(null);

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);

  // Payment form state (per quarter)
  const [formAmount, setFormAmount] = useState("");
  const [formDate, setFormDate] = useState(() =>
    new Date().toISOString().split("T")[0]
  );
  const [formConfirmation, setFormConfirmation] = useState("");
  const [formPaymentMethod, setFormPaymentMethod] = useState<string>("");
  const [formNotes, setFormNotes] = useState("");

  const fetchPayments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await makeAuthenticatedRequest(
        `/api/tax/quarterly-payments?year=${selectedYear}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to fetch payments");
      }
      const data = await res.json();
      setPayments(data.payments ?? []);
      setSummary(data.summary ?? null);
    } catch (err) {
      console.error("Error fetching quarterly payments:", err);
      setError(err instanceof Error ? err.message : "Failed to load payments");
      setPayments([]);
      setSummary(null);
    } finally {
      setIsLoading(false);
    }
  }, [selectedYear]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const resetForm = () => {
    setFormAmount("");
    setFormDate(new Date().toISOString().split("T")[0]);
    setFormConfirmation("");
    setFormPaymentMethod("");
    setFormNotes("");
    setExpandedQuarter(null);
  };

  const handleRecordPayment = async (quarter: number) => {
    const amount = parseFloat(formAmount);
    if (isNaN(amount) || amount <= 0 || !formDate) {
      setError("Please enter a valid amount and date.");
      return;
    }

    setSubmittingQuarter(quarter);
    setError(null);
    try {
      const res = await makeAuthenticatedRequest("/api/tax/quarterly-payments", {
        method: "POST",
        body: JSON.stringify({
          quarter,
          year: selectedYear,
          paidAmount: amount,
          paidDate: formDate,
          confirmationNumber: formConfirmation || undefined,
          paymentMethod: formPaymentMethod || undefined,
          notes: formNotes || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to record payment");
      }
      await fetchPayments();
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setSubmittingQuarter(null);
    }
  };

  const handleUpdateEstimated = async (quarter: number, estimatedAmount: number) => {
    if (isNaN(estimatedAmount) || estimatedAmount < 0) return;
    setError(null);
    try {
      const res = await makeAuthenticatedRequest("/api/tax/quarterly-payments", {
        method: "PUT",
        body: JSON.stringify({
          quarter,
          year: selectedYear,
          estimatedAmount,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update estimated amount");
      }
      await fetchPayments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const expandForm = (quarter: number) => {
    setExpandedQuarter(quarter);
    setFormAmount("");
    setFormDate(new Date().toISOString().split("T")[0]);
    setFormConfirmation("");
    setFormPaymentMethod("");
    setFormNotes("");
  };

  return (
    <div className="min-h-full bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <div>
              <h1 className="text-lg sm:text-xl font-semibold text-foreground">
                Quarterly Tax Payments
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Track your estimated tax payments
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Year selector */}
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">Year:</Label>
          <Select
            value={String(selectedYear)}
            onValueChange={(v) => setSelectedYear(parseInt(v, 10))}
          >
            <SelectTrigger className="w-[120px] min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={String(currentYear)}>{currentYear}</SelectItem>
              <SelectItem value={String(currentYear - 1)}>
                {currentYear - 1}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Targets are amounts you entered. Recording a payment does not prove it was timely or sufficient. This screen does not calculate tax penalties.</p>
            {/* Summary bar */}
            {summary && (
              <Card className="bg-card border border-border">
                <CardContent className="p-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="rounded-lg bg-muted/50 p-3 sm:p-4">
                      <p className="text-xs text-muted-foreground mb-0.5">
                        Your Payment Targets
                      </p>
                      <p className="text-lg font-semibold text-foreground flex items-center gap-1">
                        <DollarSign className="w-4 h-4" />
                        {summary.totalEstimated.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3 sm:p-4">
                      <p className="text-xs text-muted-foreground mb-0.5">
                        Payments Recorded
                      </p>
                      <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <DollarSign className="w-4 h-4" />
                        {summary.totalPaid.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3 sm:p-4">
                      <p className="text-xs text-muted-foreground mb-0.5">
                        Remaining Against Targets
                      </p>
                      <p className="text-lg font-semibold text-foreground flex items-center gap-1">
                        <DollarSign className="w-4 h-4" />
                        {summary.totalRemaining.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3 sm:p-4"><p className="text-xs text-muted-foreground">Penalty / payment sufficiency</p><p className="mt-1 text-sm">Requires review of tax liability and dated payments.</p></div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* IRS Direct Pay link */}
            <Button
              variant="outline"
              className="w-full sm:w-auto border-border"
              asChild
            >
              <a
                href="https://www.irs.gov/payments"
                target="_blank"
                rel="noopener noreferrer"
              >
                <CreditCard className="w-4 h-4 mr-2" />
                IRS Direct Pay
                <ExternalLink className="w-4 h-4 ml-2" />
              </a>
            </Button>

            {/* Quarter cards */}
            <div className="grid items-start gap-3 xl:grid-cols-2">
              {payments.map((payment) => (
                <Card
                  key={`Q${payment.quarter}_${payment.year}`}
                  className="bg-card border border-border"
                >
                  <CardHeader className="pb-2">
                    <div className="flex flex-col gap-2">
                      <div>
                        <CardTitle className="text-base font-medium text-foreground flex items-center gap-2">
                          Q{payment.quarter}
                          <span className="text-muted-foreground font-normal">
                            · {formatDate(payment.deadline)}
                          </span>
                        </CardTitle>
                        <div className="flex items-center gap-2 mt-1">
                          <StatusBadge status={payment.status} />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">
                            Your target:{" "}
                          </span>
                          <span className="font-medium text-foreground">
                            $
                            {payment.estimatedAmount.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Recorded: </span>
                          <span className="font-medium text-foreground">
                            $
                            {payment.paidAmount.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {payment.status === "recorded" && payment.paidDate && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          Paid {formatDate(payment.paidDate)}
                        </span>
                        {payment.confirmationNumber && (
                          <span>Confirmation: {payment.confirmationNumber}</span>
                        )}
                      </div>
                    )}

                    {(
                      <>
                        {expandedQuarter === payment.quarter ? (
                          <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <Label>Amount paid</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="0.00"
                                  value={formAmount}
                                  onChange={(e) => setFormAmount(e.target.value)}
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label>Date paid</Label>
                                <Input
                                  type="date"
                                  value={formDate}
                                  onChange={(e) => setFormDate(e.target.value)}
                                  className="mt-1"
                                />
                              </div>
                            </div>
                            <div>
                              <Label>Confirmation number (optional)</Label>
                              <Input
                                type="text"
                                placeholder="e.g. IRS confirmation #"
                                value={formConfirmation}
                                onChange={(e) =>
                                  setFormConfirmation(e.target.value)
                                }
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label>Payment method</Label>
                              <Select
                                value={formPaymentMethod}
                                onValueChange={setFormPaymentMethod}
                              >
                                <SelectTrigger className="mt-1">
                                  <SelectValue placeholder="Select method" />
                                </SelectTrigger>
                                <SelectContent>
                                  {PAYMENT_METHODS.map((m) => (
                                    <SelectItem key={m} value={m}>
                                      {m}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label>Notes (optional)</Label>
                              <Input
                                type="text"
                                placeholder="Any notes"
                                value={formNotes}
                                onChange={(e) => setFormNotes(e.target.value)}
                                className="mt-1"
                              />
                            </div>
                            <div className="flex gap-2">
                              <Button
                                onClick={() =>
                                  handleRecordPayment(payment.quarter)
                                }
                                disabled={
                                  submittingQuarter === payment.quarter
                                }
                              >
                                {submittingQuarter === payment.quarter ? (
                                  <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Saving...
                                  </>
                                ) : (
                                  "Save Payment"
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() => setExpandedQuarter(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => expandForm(payment.quarter)}
                            className="border-border"
                          >
                            Record Payment
                          </Button>
                        )}
                      </>
                    )}

                    {/* Quick edit estimated amount */}
                    <div className="flex items-center gap-2 pt-2 border-t border-border">
                      <Label className="text-xs text-muted-foreground">
                        Your payment target:
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-32 min-h-11 text-base"
                        defaultValue={payment.estimatedAmount}
                        onBlur={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v) && v >= 0 && v !== payment.estimatedAmount) {
                            handleUpdateEstimated(payment.quarter, v);
                          }
                        }}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
