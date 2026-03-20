"use client";

import React, { useState, useEffect, useCallback } from "react";
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
  ArrowLeft, Plus, Trash2, Loader2, DollarSign, FileText,
  TrendingUp, Building2, Receipt, CheckCircle2,
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

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ─── component ─────────────────────────────────────────────────────────────── */
export function IncomeTrackingScreen({ user, onBack }: IncomeTrackingScreenProps) {
  const currentYear = new Date().getFullYear();
  const [taxYear, setTaxYear] = useState(currentYear);
  const [activeTab, setActiveTab] = useState("receipts");
  const [error, setError] = useState<string | null>(null);

  // 1099 forms state
  const [forms, setForms]             = useState<Form1099[]>([]);
  const [formsLoading, setFormsLoading] = useState(true);
  const [showAddForm, setShowAddForm]   = useState(false);
  const [submittingForm, setSubmittingForm] = useState(false);
  const [deletingFormId, setDeletingFormId] = useState<string | null>(null);
  const [newForm, setNewForm] = useState({ formType: "1099-NEC" as Form1099Type, payerName: "", amount: "", taxYear: currentYear });

  // Gross receipts state
  const [receipts, setReceipts]           = useState<GrossReceiptEntry[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(true);
  const [showAddReceipt, setShowAddReceipt]   = useState(false);
  const [submittingReceipt, setSubmittingReceipt] = useState(false);
  const [deletingReceiptId, setDeletingReceiptId] = useState<string | null>(null);
  const [newReceipt, setNewReceipt] = useState({
    source: "", amount: "", date: new Date().toISOString().slice(0, 10),
    type: "freelance", description: "", taxYear: currentYear,
  });

  /* fetches */
  const fetchForms = useCallback(async () => {
    setFormsLoading(true);
    try {
      const res = await makeAuthenticatedRequest(`/api/income/1099?year=${taxYear}`);
      const data = await res.json();
      setForms(data.forms || []);
    } catch { setForms([]); } finally { setFormsLoading(false); }
  }, [taxYear]);

  const fetchReceipts = useCallback(async () => {
    setReceiptsLoading(true);
    try {
      const res = await makeAuthenticatedRequest(`/api/income/gross-receipts?year=${taxYear}`);
      const data = await res.json();
      setReceipts(data.entries || []);
    } catch { setReceipts([]); } finally { setReceiptsLoading(false); }
  }, [taxYear]);

  useEffect(() => { fetchForms(); fetchReceipts(); }, [fetchForms, fetchReceipts]);

  /* totals */
  const total1099    = forms.reduce((s, f) => s + f.amount, 0);
  const totalReceipts = receipts.reduce((s, r) => s + r.amount, 0);
  const totalIncome  = total1099 + totalReceipts;
  const estimatedSE  = totalIncome * 0.153;

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
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      const data = await res.json();
      setForms(prev => [data.form, ...prev]);
      setNewForm({ formType: "1099-NEC", payerName: "", amount: "", taxYear: currentYear });
      setShowAddForm(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setSubmittingForm(false); }
  };

  const handleDeleteForm = async (id: string) => {
    setDeletingFormId(id); setError(null);
    try {
      await makeAuthenticatedRequest(`/api/income/1099?id=${encodeURIComponent(id)}`, { method: "DELETE" });
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
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      setNewReceipt({ source: "", amount: "", date: new Date().toISOString().slice(0, 10), type: "freelance", description: "", taxYear: currentYear });
      setShowAddReceipt(false);
      fetchReceipts();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setSubmittingReceipt(false); }
  };

  const handleDeleteReceipt = async (id: string) => {
    setDeletingReceiptId(id); setError(null);
    try {
      await makeAuthenticatedRequest(`/api/income/gross-receipts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setReceipts(prev => prev.filter(r => r.id !== id));
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setDeletingReceiptId(null); }
  };

  /* render */
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
          <Button onClick={onBack} variant="ghost" size="icon" className="shrink-0 min-h-[44px] min-w-[44px]">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg sm:text-xl font-semibold text-foreground truncate">Income Tracking</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">All income flows to Schedule C Line 1</p>
          </div>
          <Select value={String(taxYear)} onValueChange={v => setTaxYear(parseInt(v, 10))}>
            <SelectTrigger className="w-[100px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 5 }, (_, i) => currentYear - i).map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Income", value: `$${fmt(totalIncome)}`, accent: "text-green-600 dark:text-green-400" },
            { label: "1099 Forms", value: `$${fmt(total1099)}`, accent: "text-foreground" },
            { label: "Direct Receipts", value: `$${fmt(totalReceipts)}`, accent: "text-foreground" },
            { label: "Est. SE Tax (15.3%)", value: `$${fmt(estimatedSE)}`, accent: "text-orange-600 dark:text-orange-400" },
          ].map(({ label, value, accent }) => (
            <Card key={label} className="bg-card border-border">
              <CardContent className="p-3 sm:p-4">
                <p className="text-xs text-muted-foreground mb-1">{label}</p>
                <p className={`text-base sm:text-lg font-semibold tabular-nums ${accent}`}>{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Schedule C callout */}
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-3 text-sm text-blue-800 dark:text-blue-300">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <p>All income you enter here is automatically included on <strong>Schedule C Line 1</strong> when you export your tax return.</p>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full bg-muted/50 border border-border p-1 rounded-lg grid grid-cols-3">
            <TabsTrigger value="receipts" className="rounded-md text-xs sm:text-sm">
              <Receipt className="w-3.5 h-3.5 mr-1.5" />Direct Income
            </TabsTrigger>
            <TabsTrigger value="forms" className="rounded-md text-xs sm:text-sm">
              <FileText className="w-3.5 h-3.5 mr-1.5" />1099 Forms
            </TabsTrigger>
            <TabsTrigger value="sources" className="rounded-md text-xs sm:text-sm">
              <TrendingUp className="w-3.5 h-3.5 mr-1.5" />By Source
            </TabsTrigger>
          </TabsList>

          {/* Direct Income (Gross Receipts) */}
          <TabsContent value="receipts" className="mt-4">
            <Card className="bg-card border-border">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div>
                  <CardTitle className="text-base font-semibold">Direct Income</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Cash payments, direct deposits, client invoices</p>
                </div>
                <Button onClick={() => setShowAddReceipt(!showAddReceipt)} size="sm" variant={showAddReceipt ? "outline" : "default"} className="gap-1.5 min-h-[40px]">
                  <Plus className="w-4 h-4" />Add Income
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {showAddReceipt && (
                  <form onSubmit={handleAddReceipt} className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Client / Source *</Label>
                        <Input value={newReceipt.source} onChange={e => setNewReceipt(p => ({ ...p, source: e.target.value }))}
                          placeholder="e.g. Acme Corp" className="bg-background" required />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Amount ($) *</Label>
                        <Input type="number" min="0" step="0.01" value={newReceipt.amount}
                          onChange={e => setNewReceipt(p => ({ ...p, amount: e.target.value }))}
                          placeholder="0.00" className="bg-background" required />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Date *</Label>
                        <Input type="date" value={newReceipt.date}
                          onChange={e => setNewReceipt(p => ({ ...p, date: e.target.value }))}
                          className="bg-background" required />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Income Type</Label>
                        <Select value={newReceipt.type} onValueChange={v => setNewReceipt(p => ({ ...p, type: v }))}>
                          <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {INCOME_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Description (optional)</Label>
                      <Input value={newReceipt.description}
                        onChange={e => setNewReceipt(p => ({ ...p, description: e.target.value }))}
                        placeholder="Project name, invoice #, etc." className="bg-background" />
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
                ) : receipts.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <DollarSign className="w-10 h-10 mx-auto mb-2 opacity-40" />
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
                          <p className="text-sm font-semibold text-green-600 dark:text-green-400 tabular-nums whitespace-nowrap">${fmt(r.amount)}</p>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteReceipt(r.id)} disabled={deletingReceiptId === r.id}
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 w-8">
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
          <TabsContent value="forms" className="mt-4">
            <Card className="bg-card border-border">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div>
                  <CardTitle className="text-base font-semibold">1099 Forms</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Enter each form you received from payers</p>
                </div>
                <Button onClick={() => setShowAddForm(!showAddForm)} size="sm" variant={showAddForm ? "outline" : "default"} className="gap-1.5 min-h-[40px]">
                  <Plus className="w-4 h-4" />Add 1099
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {showAddForm && (
                  <form onSubmit={handleAddForm} className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Form Type</Label>
                        <Select value={newForm.formType} onValueChange={v => setNewForm(p => ({ ...p, formType: v as Form1099Type }))}>
                          <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                          <SelectContent>{FORM_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Tax Year</Label>
                        <Select value={String(newForm.taxYear)} onValueChange={v => setNewForm(p => ({ ...p, taxYear: parseInt(v, 10) }))}>
                          <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                          <SelectContent>{Array.from({ length: 5 }, (_, i) => currentYear - i).map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Payer Name *</Label>
                        <Input value={newForm.payerName} onChange={e => setNewForm(p => ({ ...p, payerName: e.target.value }))}
                          placeholder="e.g. Acme Corp" className="bg-background" required />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Amount ($) *</Label>
                        <Input type="number" min="0" step="0.01" value={newForm.amount}
                          onChange={e => setNewForm(p => ({ ...p, amount: e.target.value }))}
                          placeholder="0.00" className="bg-background" required />
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
                ) : forms.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
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
                          <p className="text-sm font-semibold text-green-600 dark:text-green-400 tabular-nums">${fmt(f.amount)}</p>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteForm(f.id)} disabled={deletingFormId === f.id}
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 w-8">
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
          <TabsContent value="sources" className="mt-4">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-primary" />All Income by Source
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(formsLoading || receiptsLoading) ? (
                  <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
                ) : (total1099 + totalReceipts === 0) ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <TrendingUp className="w-10 h-10 mx-auto mb-2 opacity-40" />
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
                          <span className="text-sm font-semibold text-green-600 dark:text-green-400 tabular-nums whitespace-nowrap">${fmt(amt)}</span>
                        </li>
                      ))}
                      <li className="flex justify-between px-3 py-2.5 rounded-lg bg-primary/10 border border-primary/20">
                        <span className="text-sm font-semibold text-foreground">Total</span>
                        <span className="text-sm font-bold tabular-nums text-primary">${fmt(totalIncome)}</span>
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
