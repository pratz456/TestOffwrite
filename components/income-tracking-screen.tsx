"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Loader2,
  DollarSign,
  FileText,
  TrendingUp,
  Building2,
} from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

const FORM_TYPES = [
  "1099-NEC",
  "1099-K",
  "1099-MISC",
  "1099-INT",
  "1099-DIV",
  "1099-B",
] as const;

type Form1099Type = (typeof FORM_TYPES)[number];

interface Form1099 {
  id: string;
  formType: Form1099Type;
  payerName: string;
  amount: number;
  taxYear: number;
  userId?: string;
  createdAt?: string;
}

interface IncomeTrackingScreenProps {
  user: { id: string; email?: string };
  onBack: () => void;
}

const SELF_EMPLOYMENT_TAX_RATE = 0.153; // 15.3%

export function IncomeTrackingScreen({ user, onBack }: IncomeTrackingScreenProps) {
  const [forms, setForms] = useState<Form1099[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("forms");

  const currentYear = new Date().getFullYear();
  const [taxYear, setTaxYear] = useState(currentYear);

  const [newForm, setNewForm] = useState({
    formType: "1099-NEC" as Form1099Type,
    payerName: "",
    amount: "",
    taxYear: currentYear,
  });

  const fetchForms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await makeAuthenticatedRequest(
        `/api/income/1099?year=${taxYear}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load 1099 forms");
      }
      const data = await res.json();
      setForms(data.forms || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load 1099 forms");
      setForms([]);
    } finally {
      setLoading(false);
    }
  }, [taxYear]);

  useEffect(() => {
    fetchForms();
  }, [fetchForms]);

  const totalIncome = forms.reduce((sum, f) => sum + f.amount, 0);
  const estimatedTax = totalIncome * SELF_EMPLOYMENT_TAX_RATE;

  const handleAddForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(newForm.amount);
    if (!newForm.payerName.trim() || isNaN(amount) || amount <= 0) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await makeAuthenticatedRequest("/api/income/1099", {
        method: "POST",
        body: JSON.stringify({
          formType: newForm.formType,
          payerName: newForm.payerName.trim(),
          amount,
          taxYear: newForm.taxYear,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add 1099 form");
      }

      const data = await res.json();
      setForms((prev) => [data.form, ...prev]);
      setNewForm({
        formType: "1099-NEC",
        payerName: "",
        amount: "",
        taxYear: currentYear,
      });
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add 1099 form");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      const res = await makeAuthenticatedRequest(
        `/api/income/1099?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete 1099 form");
      }

      setForms((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete 1099 form");
    } finally {
      setDeletingId(null);
    }
  };

  const incomeBySource = forms.reduce<Record<string, { total: number; count: number }>>(
    (acc, f) => {
      const key = f.payerName || "Unknown";
      if (!acc[key]) acc[key] = { total: 0, count: 0 };
      acc[key].total += f.amount;
      acc[key].count += 1;
      return acc;
    },
    {}
  );

  const incomeSources = Object.entries(incomeBySource).sort(
    (a, b) => b[1].total - a[1].total
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <Button
              onClick={onBack}
              variant="ghost"
              size="icon"
              className="shrink-0 min-h-[44px] min-w-[44px] sm:min-h-9 sm:min-w-9"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg sm:text-xl font-semibold text-foreground truncate">
                Income & 1099 Tracking
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground truncate">
                Track all your income sources for tax filing
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
        {/* Income Summary Card */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base sm:text-lg font-semibold text-foreground flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-primary" />
              Income Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-muted/50 rounded-lg p-4 border border-border">
                    <p className="text-xs sm:text-sm text-muted-foreground mb-1">
                      Total 1099 Income
                    </p>
                    <p className="text-xl sm:text-2xl font-semibold text-foreground tabular-nums">
                      ${totalIncome.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-4 border border-border">
                    <p className="text-xs sm:text-sm text-muted-foreground mb-1">
                      Forms Tracked
                    </p>
                    <p className="text-xl sm:text-2xl font-semibold text-foreground tabular-nums">
                      {forms.length}
                    </p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-4 border border-border">
                    <p className="text-xs sm:text-sm text-muted-foreground mb-1">
                      Est. Self-Employment Tax (15.3%)
                    </p>
                    <p className="text-xl sm:text-2xl font-semibold text-foreground tabular-nums">
                      ${estimatedTax.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <Label className="text-sm text-muted-foreground">Tax year:</Label>
                  <Select
                    value={String(taxYear)}
                    onValueChange={(v) => setTaxYear(parseInt(v, 10))}
                  >
                    <SelectTrigger className="w-[120px] h-9 bg-background border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 5 }, (_, i) => currentYear - i).map(
                        (y) => (
                          <SelectItem key={y} value={String(y)}>
                            {y}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full sm:w-auto bg-muted/50 border border-border p-1 rounded-lg">
            <TabsTrigger
              value="forms"
              className="flex-1 sm:flex-initial data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-sm rounded-md px-4 py-2"
            >
              <FileText className="w-4 h-4 mr-2 sm:inline-block" />
              1099 Forms
            </TabsTrigger>
            <TabsTrigger
              value="sources"
              className="flex-1 sm:flex-initial data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-sm rounded-md px-4 py-2"
            >
              <Building2 className="w-4 h-4 mr-2 sm:inline-block" />
              Income Sources
            </TabsTrigger>
          </TabsList>

          <TabsContent value="forms" className="mt-4">
            <Card className="bg-card border-border">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base font-semibold text-foreground">
                  1099 Forms
                </CardTitle>
                <Button
                  onClick={() => setShowAddForm(!showAddForm)}
                  size="sm"
                  variant={showAddForm ? "outline" : "default"}
                  className="gap-2 min-h-[40px]"
                >
                  <Plus className="w-4 h-4" />
                  Add 1099 Form
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {showAddForm && (
                  <form
                    onSubmit={handleAddForm}
                    className="rounded-lg border border-border bg-muted/30 p-4 space-y-4"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="formType" className="text-foreground">
                          Form Type
                        </Label>
                        <Select
                          value={newForm.formType}
                          onValueChange={(v) =>
                            setNewForm((prev) => ({
                              ...prev,
                              formType: v as Form1099Type,
                            }))
                          }
                        >
                          <SelectTrigger
                            id="formType"
                            className="bg-background border-border"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FORM_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="taxYear" className="text-foreground">
                          Tax Year
                        </Label>
                        <Select
                          value={String(newForm.taxYear)}
                          onValueChange={(v) =>
                            setNewForm((prev) => ({
                              ...prev,
                              taxYear: parseInt(v, 10),
                            }))
                          }
                        >
                          <SelectTrigger
                            id="taxYear"
                            className="bg-background border-border"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from(
                              { length: 5 },
                              (_, i) => currentYear - i
                            ).map((y) => (
                              <SelectItem key={y} value={String(y)}>
                                {y}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="payerName" className="text-foreground">
                          Payer Name
                        </Label>
                        <Input
                          id="payerName"
                          value={newForm.payerName}
                          onChange={(e) =>
                            setNewForm((prev) => ({
                              ...prev,
                              payerName: e.target.value,
                            }))
                          }
                          placeholder="e.g. Acme Corp"
                          className="bg-background border-border text-foreground"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="amount" className="text-foreground">
                          Amount ($)
                        </Label>
                        <Input
                          id="amount"
                          type="number"
                          min="0"
                          step="0.01"
                          value={newForm.amount}
                          onChange={(e) =>
                            setNewForm((prev) => ({
                              ...prev,
                              amount: e.target.value,
                            }))
                          }
                          placeholder="0.00"
                          className="bg-background border-border text-foreground"
                          required
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowAddForm(false)}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={
                          submitting ||
                          !newForm.payerName.trim() ||
                          !newForm.amount ||
                          parseFloat(newForm.amount) <= 0
                        }
                        className="flex-1 gap-2"
                      >
                        {submitting ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Plus className="w-4 h-4" />
                        )}
                        Add Form
                      </Button>
                    </div>
                  </form>
                )}

                {forms.length === 0 && !loading ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="font-medium text-foreground">No 1099 forms yet</p>
                    <p className="text-sm mt-1">
                      Click &quot;Add 1099 Form&quot; to track your income
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {forms.map((form) => (
                      <li
                        key={form.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg border border-border bg-card hover:bg-muted/20 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <Badge
                              variant="secondary"
                              className="font-mono text-xs"
                            >
                              {form.formType}
                            </Badge>
                            <span className="font-medium text-foreground truncate">
                              {form.payerName}
                            </span>
                          </div>
                          <p className="text-lg font-semibold text-foreground tabular-nums">
                            $
                            {form.amount.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(form.id)}
                          disabled={deletingId === form.id}
                          className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 min-h-[40px] min-w-[40px]"
                          aria-label="Delete"
                        >
                          {deletingId === form.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sources" className="mt-4">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  Income by Source
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Income grouped by payer
                </p>
              </CardHeader>
              <CardContent>
                {incomeSources.length === 0 && !loading ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Building2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="font-medium text-foreground">
                      No income sources yet
                    </p>
                    <p className="text-sm mt-1">
                      Add 1099 forms to see income grouped by payer
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {incomeSources.map(([payer, { total, count }]) => (
                      <li
                        key={payer}
                        className="flex items-center justify-between p-4 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <div>
                          <p className="font-medium text-foreground">{payer}</p>
                          <p className="text-sm text-muted-foreground">
                            {count} form{count !== 1 ? "s" : ""}
                          </p>
                        </div>
                        <p className="text-lg font-semibold text-foreground tabular-nums">
                          $
                          {total.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
