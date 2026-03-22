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
  status: "paid" | "overdue" | "due" | "upcoming" | "unpaid";
  notes: string;
  penalty?: number;
}

interface Summary {
  totalEstimated: number;
  totalPaid: number;
  totalRemaining: number;
  totalPenalty: number;
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
  const config = {
    paid: { label: "Paid", variant: "default" as const, className: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
    due: { label: "Due Soon", variant: "secondary" as const, className: "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30" },
    overdue: { label: "Overdue", variant: "destructive" as const, className: "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30" },
    upcoming: { label: "Upcoming", variant: "outline" as const, className: "bg-muted text-muted-foreground border-border" },
    unpaid: { label: "Unpaid", variant: "outline" as const, className: "bg-muted text-muted-foreground border-border" },
  };
  const { label, className } = config[status] ?? config.unpaid;
  return (
    <Badge variant="outline" className={className}>
      {status === "paid" && <CheckCircle className="w-3 h-3 mr-1" />}
      {status === "due" && <Clock className="w-3 h-3 mr-1" />}
      {status === "overdue" && <AlertCircle className="w-3 h-3 mr-1" />}
      {label}
    </Badge>
  );
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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
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

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
        {/* Year selector */}
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">Year:</Label>
          <Select
            value={String(selectedYear)}
            onValueChange={(v) => setSelectedYear(parseInt(v, 10))}
          >
            <SelectTrigger className="w-[120px]">
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
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Summary bar */}
            {summary && (
              <Card className="bg-card border border-border">
                <CardContent className="pt-6">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="rounded-lg bg-muted/50 p-3 sm:p-4">
                      <p className="text-xs text-muted-foreground mb-0.5">
                        Total Estimated
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
                        Total Paid
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
                        Remaining
                      </p>
                      <p className="text-lg font-semibold text-foreground flex items-center gap-1">
                        <DollarSign className="w-4 h-4" />
                        {summary.totalRemaining.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-3 sm:p-4">
                      <p className="text-xs text-muted-foreground mb-0.5">
                        Est. Penalty
                      </p>
                      <p
                        className={`text-lg font-semibold flex items-center gap-1 ${
                          summary.totalPenalty > 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        <DollarSign className="w-4 h-4" />
                        {summary.totalPenalty.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
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
            <div className="space-y-4">
              {payments.map((payment) => (
                <Card
                  key={`Q${payment.quarter}_${payment.year}`}
                  className="bg-card border border-border"
                >
                  <CardHeader className="pb-2">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
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
                            Estimated:{" "}
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
                          <span className="text-muted-foreground">Paid: </span>
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
                    {payment.status === "overdue" && payment.penalty != null && payment.penalty > 0 && (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span className="text-sm">
                          Est. underpayment penalty: $
                          {payment.penalty.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    )}

                    {payment.status === "paid" && payment.paidDate && (
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

                    {payment.status !== "paid" && (
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
                        Update estimated amount:
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-32 h-8 text-sm"
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
