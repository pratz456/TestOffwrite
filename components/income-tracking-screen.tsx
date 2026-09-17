"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, Trash2, Loader2, DollarSign, FileText,
  TrendingUp, Building2, ChevronDown, ArrowUpRight,
} from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

/* ─── types ─────────────────────────────────────────────────────────────────── */
const FORM_TYPES = ["1099-NEC","1099-K","1099-MISC","1099-INT","1099-DIV","1099-B"] as const;
type Form1099Type = (typeof FORM_TYPES)[number];

interface Form1099 {
  id: string; formType: Form1099Type; payerName: string;
  amount: number; taxYear: number; createdAt?: string;
}

interface GrossReceiptEntry {
  id: string; source: string; amount: number; date: string;
  type: string; description?: string; taxYear: number;
}

interface IncomeTrackingScreenProps {
  user: { id: string; email?: string };
  onBack: () => void;
}

const INCOME_TYPES = [
  { value: "freelance",          label: "Freelance / Contract work" },
  { value: "consulting",         label: "Consulting" },
  { value: "product_sales",      label: "Product sales" },
  { value: "rental",             label: "Rental income" },
  { value: "interest_dividends", label: "Interest / Dividends" },
  { value: "other",              label: "Other income" },
];

const emptyForm = (taxYear: number) => ({ formType: "1099-NEC" as Form1099Type, payerName: "", amount: "", taxYear });
const emptyReceipt = (taxYear: number) => ({
  source: "", amount: "", date: taxYear === new Date().getFullYear() ? new Date().toISOString().slice(0, 10) : `${taxYear}-01-01`,
  type: "freelance", description: "", taxYear,
});

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ─── component ─────────────────────────────────────────────────────────────── */
export function IncomeTrackingScreen({ user, onBack }: IncomeTrackingScreenProps) {
  const currentYear = new Date().getFullYear();
  const [taxYear, setTaxYear] = useState(currentYear);
  const [activeTab, setActiveTab] = useState("receipts");
  const [error, setError] = useState<string | null>(null);
  const [formsLoadError, setFormsLoadError] = useState<string | null>(null);
  const [receiptsLoadError, setReceiptsLoadError] = useState<string | null>(null);
  const formsRequestId = useRef(0);
  const receiptsRequestId = useRef(0);

  // 1099 forms state
  const [forms, setForms]             = useState<Form1099[]>([]);
  const [formsLoading, setFormsLoading] = useState(true);
  const [showAddForm, setShowAddForm]   = useState(false);
  const [submittingForm, setSubmittingForm] = useState(false);
  const [deletingFormId, setDeletingFormId] = useState<string | null>(null);
  const [newForm, setNewForm] = useState(() => emptyForm(currentYear));

  // Gross receipts state
  const [receipts, setReceipts]           = useState<GrossReceiptEntry[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(true);
  const [showAddReceipt, setShowAddReceipt]   = useState(false);
  const [submittingReceipt, setSubmittingReceipt] = useState(false);
  const [deletingReceiptId, setDeletingReceiptId] = useState<string | null>(null);
  const [newReceipt, setNewReceipt] = useState(() => emptyReceipt(currentYear));

  /* Ignore old-year responses if the user changes years while loading. */
  const fetchForms = useCallback(async () => {
    const requestId = ++formsRequestId.current;
    setFormsLoading(true); setFormsLoadError(null);
    try {
      const res = await makeAuthenticatedRequest(`/api/income/1099?year=${taxYear}`);
      if (!res.ok) throw new Error("Could not load 1099 forms. Try again.");
      const data = await res.json();
      if (requestId === formsRequestId.current) setForms(data.forms || []);
    } catch {
      if (requestId === formsRequestId.current) setFormsLoadError("Could not load 1099 forms. Try again.");
    } finally {
      if (requestId === formsRequestId.current) setFormsLoading(false);
    }
  }, [taxYear]);

  const fetchReceipts = useCallback(async () => {
    const requestId = ++receiptsRequestId.current;
    setReceiptsLoading(true); setReceiptsLoadError(null);
    try {
      const res = await makeAuthenticatedRequest(`/api/income/gross-receipts?year=${taxYear}`);
      if (!res.ok) throw new Error("Could not load direct income. Try again.");
      const data = await res.json();
      if (requestId === receiptsRequestId.current) setReceipts(data.entries || []);
    } catch {
      if (requestId === receiptsRequestId.current) setReceiptsLoadError("Could not load direct income. Try again.");
    } finally {
      if (requestId === receiptsRequestId.current) setReceiptsLoading(false);
    }
  }, [taxYear]);

  useEffect(() => {
    setForms([]); setReceipts([]); setError(null);
    setNewForm(emptyForm(taxYear)); setNewReceipt(emptyReceipt(taxYear));
    setShowAddForm(false); setShowAddReceipt(false);
    fetchForms(); fetchReceipts();
    const formsGeneration = formsRequestId;
    const receiptsGeneration = receiptsRequestId;
    return () => { formsGeneration.current++; receiptsGeneration.current++; };
  }, [taxYear, fetchForms, fetchReceipts]);

  /* totals */
  const total1099    = forms.reduce((s, f) => s + f.amount, 0);
  const totalReceipts = receipts.reduce((s, r) => s + r.amount, 0);
  // Record totals can overlap; they are not reconciled taxable income.
  const totalRecordedAmount = total1099 + totalReceipts;

  /* 1099 handlers */
  const handleAddForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(newForm.amount);
    if (!newForm.payerName.trim() || isNaN(amount) || amount <= 0) return;
    setSubmittingForm(true); setError(null);
    try {
      const res = await makeAuthenticatedRequest("/api/income/1099", {
        method: "POST",
        body: JSON.stringify({ formType: newForm.formType, payerName: newForm.payerName.trim(), amount, taxYear: newForm.taxYear }),
      });
      if (!res.ok) { let m = "Failed"; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
      const data = await res.json();
      if (data.form.taxYear === taxYear) setForms(prev => [data.form, ...prev]);
      setNewForm(emptyForm(taxYear));
      setShowAddForm(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setSubmittingForm(false); }
  };

  const handleDeleteForm = async (id: string) => {
    setDeletingFormId(id); setError(null);
    try {
      const res = await makeAuthenticatedRequest(`/api/income/1099?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not delete this 1099 form. Try again.");
      setForms(prev => prev.filter(f => f.id !== id));
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setDeletingFormId(null); }
  };

  /* gross receipt handlers */
  const handleAddReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(newReceipt.amount);
    if (!newReceipt.source.trim() || isNaN(amount) || amount <= 0) return;
    setSubmittingReceipt(true); setError(null);
    try {
      const res = await makeAuthenticatedRequest("/api/income/gross-receipts", {
        method: "POST",
        body: JSON.stringify({ ...newReceipt, amount }),
      });
      if (!res.ok) { let m = "Failed"; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
      setNewReceipt(emptyReceipt(taxYear));
      setShowAddReceipt(false);
      fetchReceipts();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setSubmittingReceipt(false); }
  };

  const handleDeleteReceipt = async (id: string) => {
    setDeletingReceiptId(id); setError(null);
    try {
      const res = await makeAuthenticatedRequest(`/api/income/gross-receipts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not delete this income record. Try again.");
      setReceipts(prev => prev.filter(r => r.id !== id));
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setDeletingReceiptId(null); }
  };

  /* render */
  return (
    <div className="min-h-full bg-background">
      {/* Header */}
      <div className="min-h-11 bg-background text-base">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Income</h1>
          </div>
          <Select value={String(taxYear)} onValueChange={v => setTaxYear(parseInt(v, 10))} disabled={submittingForm || submittingReceipt || deletingFormId !== null || deletingReceiptId !== null}>
            <SelectTrigger aria-label="Income tax year" className="w-[100px] min-h-11 bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 5 }, (_, i) => currentYear - i).map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-4 space-y-3">
        <section aria-label="Saved income records" className="rounded-xl border border-border bg-card p-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Direct income · {receipts.length}</p>
              <p className="text-lg font-semibold tabular-nums">{receiptsLoading || receiptsLoadError ? "—" : `$${fmt(totalReceipts)}`}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">1099 forms · {forms.length}</p>
              <p className="text-lg font-semibold tabular-nums">{formsLoading || formsLoadError ? "—" : `$${fmt(total1099)}`}</p>
            </div>
          </div>
          <div className="mt-2 flex items-start justify-between gap-2 border-t border-border pt-2">
            <p className="text-xs leading-relaxed text-muted-foreground">Record totals may overlap.</p>
            <Link href="/protected?screen=tax-preview" className="-my-2 inline-flex min-h-11 shrink-0 items-center gap-1 text-xs font-medium text-primary">
              Tax estimate <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </section>

        <details className="group rounded-lg border border-border bg-card">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
            How these records affect your taxes
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="space-y-2 px-3 pb-3 text-xs leading-relaxed text-muted-foreground">
            <p>A 1099 and a direct receipt may describe the same payment. Review overlaps and income types before using estimates or exports.</p>
            <p>Bank transactions are excluded from these record totals. Tax Preview uses your saved income, expenses, and tax details; select the same year there. Saving records here does not file a return.</p>
          </div>
        </details>

        {error && (
          <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full h-auto bg-muted/50 border border-border p-1 rounded-lg grid grid-cols-3">
            <TabsTrigger value="receipts" className="min-h-11 rounded-md px-1 text-xs sm:text-sm">
              Direct income
            </TabsTrigger>
            <TabsTrigger value="forms" className="min-h-11 rounded-md px-1 text-xs sm:text-sm">
              1099 forms
            </TabsTrigger>
            <TabsTrigger value="sources" className="min-h-11 rounded-md px-1 text-xs sm:text-sm">
              By source
            </TabsTrigger>
          </TabsList>

          {/* Direct Income (Gross Receipts) */}
          <TabsContent value="receipts" className="mt-3">
            <Card className="bg-card border-border">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 p-3">
                <div>
                  <CardTitle className="text-sm font-semibold">Direct income</CardTitle>
                </div>
                <Button onClick={() => setShowAddReceipt(!showAddReceipt)} size="sm" variant={showAddReceipt ? "outline" : "default"} className="gap-1.5 min-h-11">
                  <Plus className="w-4 h-4" />Add Income
                </Button>
              </CardHeader>
              <CardContent className="space-y-3 p-3 pt-0">
                {showAddReceipt && (
                  <form onSubmit={handleAddReceipt} className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="income-source" className="text-xs text-muted-foreground">Client / Source *</Label>
                        <Input id="income-source" value={newReceipt.source} onChange={e => setNewReceipt(p => ({ ...p, source: e.target.value }))}
                          placeholder="e.g. Acme Corp" className="min-h-11 bg-background text-base" required />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="income-amount" className="text-xs text-muted-foreground">Amount ($) *</Label>
                        <Input id="income-amount" type="number" min="0" step="0.01" value={newReceipt.amount}
                          onChange={e => setNewReceipt(p => ({ ...p, amount: e.target.value }))}
                          placeholder="0.00" className="min-h-11 bg-background text-base" required />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="income-date" className="text-xs text-muted-foreground">Date *</Label>
                        <Input id="income-date" type="date" value={newReceipt.date}
                          onChange={e => setNewReceipt(p => ({ ...p, date: e.target.value }))}
                          className="min-h-11 bg-background text-base" required />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="income-type" className="text-xs text-muted-foreground">Income Type</Label>
                        <Select value={newReceipt.type} onValueChange={v => setNewReceipt(p => ({ ...p, type: v }))}>
                          <SelectTrigger id="income-type" className="min-h-11 bg-background text-base"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {INCOME_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="income-description" className="text-xs text-muted-foreground">Description (optional)</Label>
                      <Input id="income-description" value={newReceipt.description}
                        onChange={e => setNewReceipt(p => ({ ...p, description: e.target.value }))}
                        placeholder="Project name, invoice #, etc." className="min-h-11 bg-background text-base" />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button type="button" variant="outline" onClick={() => setShowAddReceipt(false)} className="flex-1">Cancel</Button>
                      <Button type="submit" disabled={submittingReceipt || !newReceipt.source.trim() || !newReceipt.amount} className="flex-1 gap-2">
                        {submittingReceipt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Save Income
                      </Button>
                    </div>
                  </form>
                )}
                {receiptsLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
                 ) : receiptsLoadError ? (
                  <div role="alert" className="rounded-lg bg-muted/40 p-3 text-sm">
                    <p>{receiptsLoadError}</p>
                    <Button variant="outline" onClick={fetchReceipts} className="mt-2 min-h-11">Retry direct income</Button>
                  </div>
                ) : receipts.length === 0 ? (
                  <div className="rounded-lg bg-muted/40 px-3 py-5 text-center text-muted-foreground">
                    <DollarSign className="w-5 h-5 mx-auto mb-2 opacity-50" />
                    <p className="font-medium text-foreground text-sm">No income entries yet</p>
                    <p className="text-xs mt-1">Add client payments, project invoices, or any cash income</p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {receipts.map(r => (
                      <li key={r.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/20 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-foreground text-sm truncate">{r.source}</span>
                            <Badge variant="secondary" className="text-xs capitalize">{r.type.replace("_", " ")}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{r.date}{r.description ? ` · ${r.description}` : ""}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-foreground tabular-nums whitespace-nowrap">${fmt(r.amount)}</p>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteReceipt(r.id)} disabled={deletingReceiptId === r.id} aria-label={`Delete income from ${r.source}`}
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 min-h-11 min-w-11">
                            {deletingReceiptId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </Button>
                        </div>
                      </li>
                    ))}
                    <li className="flex justify-between px-3 py-2 rounded-lg bg-muted/50 border border-border">
                      <span className="text-sm font-medium text-muted-foreground">Subtotal</span>
                      <span className="text-sm font-semibold tabular-nums">${fmt(totalReceipts)}</span>
                    </li>
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 1099 Forms */}
          <TabsContent value="forms" className="mt-3">
            <Card className="bg-card border-border">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 p-3">
                <div>
                  <CardTitle className="text-sm font-semibold">1099 forms</CardTitle>
                </div>
                <Button onClick={() => setShowAddForm(!showAddForm)} size="sm" variant={showAddForm ? "outline" : "default"} className="gap-1.5 min-h-11">
                  <Plus className="w-4 h-4" />Add 1099
                </Button>
              </CardHeader>
              <CardContent className="space-y-3 p-3 pt-0">
                {showAddForm && (
                  <form onSubmit={handleAddForm} className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="income-form-type" className="text-xs text-muted-foreground">Form Type</Label>
                        <Select value={newForm.formType} onValueChange={v => setNewForm(p => ({ ...p, formType: v as Form1099Type }))}>
                          <SelectTrigger id="income-form-type" className="min-h-11 bg-background text-base"><SelectValue /></SelectTrigger>
                          <SelectContent>{FORM_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="income-form-year" className="text-xs text-muted-foreground">Tax Year</Label>
                        <Select value={String(newForm.taxYear)} onValueChange={v => setNewForm(p => ({ ...p, taxYear: parseInt(v, 10) }))}>
                          <SelectTrigger id="income-form-year" className="min-h-11 bg-background text-base"><SelectValue /></SelectTrigger>
                          <SelectContent>{Array.from({ length: 5 }, (_, i) => currentYear - i).map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="income-payer" className="text-xs text-muted-foreground">Payer Name *</Label>
                        <Input id="income-payer" value={newForm.payerName} onChange={e => setNewForm(p => ({ ...p, payerName: e.target.value }))}
                          placeholder="e.g. Acme Corp" className="min-h-11 bg-background text-base" required />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="income-form-amount" className="text-xs text-muted-foreground">Amount ($) *</Label>
                        <Input id="income-form-amount" type="number" min="0" step="0.01" value={newForm.amount}
                          onChange={e => setNewForm(p => ({ ...p, amount: e.target.value }))}
                          placeholder="0.00" className="min-h-11 bg-background text-base" required />
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button type="button" variant="outline" onClick={() => setShowAddForm(false)} className="flex-1">Cancel</Button>
                      <Button type="submit" disabled={submittingForm || !newForm.payerName.trim() || !newForm.amount} className="flex-1 gap-2">
                        {submittingForm ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Add Form
                      </Button>
                    </div>
                  </form>
                )}
                {formsLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
                 ) : formsLoadError ? (
                  <div role="alert" className="rounded-lg bg-muted/40 p-3 text-sm">
                    <p>{formsLoadError}</p>
                    <Button variant="outline" onClick={fetchForms} className="mt-2 min-h-11">Retry 1099 forms</Button>
                  </div>
                ) : forms.length === 0 ? (
                  <div className="rounded-lg bg-muted/40 px-3 py-5 text-center text-muted-foreground">
                    <FileText className="w-5 h-5 mx-auto mb-2 opacity-50" />
                    <p className="font-medium text-foreground text-sm">No 1099 forms yet</p>
                    <p className="text-xs mt-1">Add each 1099 you received for the year</p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {forms.map(f => (
                      <li key={f.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/20 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="secondary" className="font-mono text-xs">{f.formType}</Badge>
                            <span className="font-medium text-foreground text-sm truncate">{f.payerName}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-foreground tabular-nums">${fmt(f.amount)}</p>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteForm(f.id)} disabled={deletingFormId === f.id} aria-label={`Delete ${f.formType} from ${f.payerName}`}
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 min-h-11 min-w-11">
                            {deletingFormId === f.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </Button>
                        </div>
                      </li>
                    ))}
                    <li className="flex justify-between px-3 py-2 rounded-lg bg-muted/50 border border-border">
                      <span className="text-sm font-medium text-muted-foreground">Subtotal</span>
                      <span className="text-sm font-semibold tabular-nums">${fmt(total1099)}</span>
                    </li>
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* By Source */}
          <TabsContent value="sources" className="mt-3">
            <Card className="bg-card border-border">
              <CardHeader className="p-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-primary" />Saved Records by Source
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                {(formsLoading || receiptsLoading) ? (
                  <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
                 ) : formsLoadError || receiptsLoadError ? (
                  <div role="alert" className="rounded-lg bg-muted/40 p-3 text-sm">
                    <p>Some income records could not load. Retry to see complete totals.</p>
                    <Button variant="outline" onClick={() => { fetchForms(); fetchReceipts(); }} className="mt-2 min-h-11">Retry income records</Button>
                  </div>
                ) : (total1099 + totalReceipts === 0) ? (
                  <div className="rounded-lg bg-muted/40 px-3 py-5 text-center text-muted-foreground">
                    <TrendingUp className="w-5 h-5 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No income recorded for {taxYear}</p>
                  </div>
                ) : (() => {
                  const bySource: Record<string, number> = {};
                  receipts.forEach(r => { bySource[r.source] = (bySource[r.source] || 0) + r.amount; });
                  forms.forEach(f => { const key = `${f.payerName} (${f.formType})`; bySource[key] = (bySource[key] || 0) + f.amount; });
                  return (
                    <ul className="space-y-2">
                      {Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([src, amt]) => (
                        <li key={src} className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30">
                          <span className="font-medium text-foreground text-sm truncate pr-4">{src}</span>
                          <span className="text-sm font-semibold text-foreground tabular-nums whitespace-nowrap">${fmt(amt)}</span>
                        </li>
                      ))}
                      <li className="flex justify-between px-3 py-2.5 rounded-lg bg-primary/10 border border-primary/20">
                        <span className="text-sm font-semibold text-foreground">Recorded subtotal</span>
                        <span className="text-sm font-bold tabular-nums text-primary">${fmt(totalRecordedAmount)}</span>
                      </li>
                    </ul>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default IncomeTrackingScreen;
