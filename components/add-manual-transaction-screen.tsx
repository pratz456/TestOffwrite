"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Plus, Loader2, TrendingUp, TrendingDown, CheckCircle2 } from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

const EXPENSE_CATEGORIES = [
  { value: "SERVICE_ADVERTISING",                      label: "Advertising & Marketing" },
  { value: "TRANSPORTATION_RIDESHARE",                 label: "Car & Truck Expenses" },
  { value: "BANK_FEES_OTHER_BANK_FEES",                label: "Commissions & Fees" },
  { value: "SERVICE_FREELANCE_SERVICES",               label: "Contract Labor" },
  { value: "SERVICE_INSURANCE",                        label: "Insurance" },
  { value: "SERVICE_LEGAL",                            label: "Legal & Professional" },
  { value: "GENERAL_MERCHANDISE_COMPUTERS_AND_ELECTRONICS", label: "Office Expense" },
  { value: "RENT_RENT",                                label: "Rent (Business Property)" },
  { value: "GENERAL_MERCHANDISE_OFFICE_SUPPLIES",      label: "Supplies" },
  { value: "TRAVEL_FLIGHTS",                           label: "Travel" },
  { value: "FOOD_AND_DRINK_RESTAURANT",                label: "Meals (50% deductible)" },
  { value: "SERVICE_UTILITIES",                        label: "Utilities / Phone / Internet" },
  { value: "COMMUNITY_EDUCATION",                      label: "Education & Training" },
  { value: "SERVICE_MEMBERSHIPS",                      label: "Dues & Memberships" },
  { value: "SERVICE_SUBSCRIPTION",                     label: "Software & Subscriptions" },
  { value: "TRANSPORTATION_FUEL",                      label: "Fuel" },
  { value: "other",                                    label: "Other Business Expense" },
];

const INCOME_TYPES = [
  { value: "freelance",          label: "Freelance / Contract work" },
  { value: "consulting",         label: "Consulting" },
  { value: "product_sales",      label: "Product sales" },
  { value: "rental",             label: "Rental income" },
  { value: "interest_dividends", label: "Interest / Dividends" },
  { value: "other",              label: "Other income" },
];

interface AddManualTransactionScreenProps {
  user: { id: string; email?: string };
  onBack: () => void;
  onSaved?: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AddManualTransactionScreen({ user, onBack, onSaved }: AddManualTransactionScreenProps) {
  const [mode, setMode] = useState<"expense" | "income">("expense");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Expense fields
  const [exp, setExp] = useState({
    merchant_name: "", amount: "", date: today(),
    category: "other", notes: "", business_purpose: "",
    is_deductible: true as boolean,
  });

  // Income fields
  const [inc, setInc] = useState({
    source: "", amount: "", date: today(),
    type: "freelance", description: "",
  });

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(exp.amount);
    if (!exp.merchant_name.trim() || isNaN(amt) || amt <= 0) { setError("Name and amount are required."); return; }
    setSaving(true); setError(null);
    try {
      const res = await makeAuthenticatedRequest("/api/transactions/manual", {
        method: "POST",
        body: JSON.stringify({
          merchant_name: exp.merchant_name.trim(),
          amount: amt,
          date: exp.date,
          category: exp.category,
          notes: exp.notes,
          business_purpose: exp.business_purpose,
          type: "expense",
          is_deductible: exp.is_deductible,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to save");
      setSaved(true);
      setExp({ merchant_name: "", amount: "", date: today(), category: "other", notes: "", business_purpose: "", is_deductible: true });
      setTimeout(() => { setSaved(false); onSaved?.(); }, 1800);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to save"); }
    finally { setSaving(false); }
  };

  const handleSaveIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(inc.amount);
    if (!inc.source.trim() || isNaN(amt) || amt <= 0) { setError("Source and amount are required."); return; }
    setSaving(true); setError(null);
    try {
      // Save as gross receipt (flows to Schedule C Line 1)
      const res = await makeAuthenticatedRequest("/api/income/gross-receipts", {
        method: "POST",
        body: JSON.stringify({
          source: inc.source.trim(),
          amount: amt,
          date: inc.date,
          type: inc.type,
          description: inc.description,
          taxYear: parseInt(inc.date.slice(0, 4), 10),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to save");
      setSaved(true);
      setInc({ source: "", amount: "", date: today(), type: "freelance", description: "" });
      setTimeout(() => { setSaved(false); onSaved?.(); }, 1800);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to save"); }
    finally { setSaving(false); }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
          <Button onClick={onBack} variant="ghost" size="icon" className="shrink-0 min-h-[44px] min-w-[44px]">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold text-foreground">Add Transaction</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Manually enter income or expenses</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Mode switcher */}
        <Tabs value={mode} onValueChange={(v) => { setMode(v as "expense" | "income"); setError(null); setSaved(false); }}>
          <TabsList className="w-full grid grid-cols-2 bg-muted/50 border border-border rounded-lg p-1">
            <TabsTrigger value="expense" className="rounded-md flex items-center gap-2 text-sm">
              <TrendingDown className="w-4 h-4" /> Expense
            </TabsTrigger>
            <TabsTrigger value="income" className="rounded-md flex items-center gap-2 text-sm">
              <TrendingUp className="w-4 h-4" /> Income
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {saved && (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 px-4 py-3 text-sm text-green-800 dark:text-green-300">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {mode === "expense" ? "Expense saved and queued for AI analysis." : "Income saved - it will appear on Schedule C Line 1."}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {/* Expense form */}
        {mode === "expense" && (
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-red-500" /> Business Expense
              </CardTitle>
              <p className="text-xs text-muted-foreground">Saved expenses are auto-analyzed by AI and flow to Schedule C Part II.</p>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveExpense} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Merchant / Vendor *</Label>
                    <Input value={exp.merchant_name} onChange={e => setExp(p => ({ ...p, merchant_name: e.target.value }))}
                      placeholder="e.g. Adobe, Staples, AWS" className="bg-background" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Amount ($) *</Label>
                    <Input type="number" min="0.01" step="0.01" value={exp.amount}
                      onChange={e => setExp(p => ({ ...p, amount: e.target.value }))}
                      placeholder="0.00" className="bg-background" required />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Date *</Label>
                    <Input type="date" value={exp.date} onChange={e => setExp(p => ({ ...p, date: e.target.value }))}
                      className="bg-background" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Schedule C Category</Label>
                    <Select value={exp.category} onValueChange={v => setExp(p => ({ ...p, category: v }))}>
                      <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {EXPENSE_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Business Purpose</Label>
                  <Input value={exp.business_purpose} onChange={e => setExp(p => ({ ...p, business_purpose: e.target.value }))}
                    placeholder="Why was this necessary for your business?" className="bg-background" />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <Input value={exp.notes} onChange={e => setExp(p => ({ ...p, notes: e.target.value }))}
                    placeholder="Receipt #, project name, client, etc." className="bg-background" />
                </div>

                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border">
                  <input type="checkbox" id="deductible" checked={exp.is_deductible}
                    onChange={e => setExp(p => ({ ...p, is_deductible: e.target.checked }))}
                    className="rounded border-border w-4 h-4" />
                  <Label htmlFor="deductible" className="text-sm cursor-pointer">
                    Mark as confirmed deductible (will appear in Schedule C totals)
                  </Label>
                </div>

                <Button type="submit" disabled={saving || !exp.merchant_name.trim() || !exp.amount} className="w-full gap-2 min-h-[44px]">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Save Expense
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Income form */}
        {mode === "income" && (
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-500" /> Business Income
              </CardTitle>
              <p className="text-xs text-muted-foreground">Income is saved as gross receipts and flows directly to Schedule C Line 1.</p>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveIncome} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Client / Payer *</Label>
                    <Input value={inc.source} onChange={e => setInc(p => ({ ...p, source: e.target.value }))}
                      placeholder="e.g. Acme Corp, Client Name" className="bg-background" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Amount ($) *</Label>
                    <Input type="number" min="0.01" step="0.01" value={inc.amount}
                      onChange={e => setInc(p => ({ ...p, amount: e.target.value }))}
                      placeholder="0.00" className="bg-background" required />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Date *</Label>
                    <Input type="date" value={inc.date} onChange={e => setInc(p => ({ ...p, date: e.target.value }))}
                      className="bg-background" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Income Type</Label>
                    <Select value={inc.type} onValueChange={v => setInc(p => ({ ...p, type: v }))}>
                      <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {INCOME_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Description (optional)</Label>
                  <Input value={inc.description} onChange={e => setInc(p => ({ ...p, description: e.target.value }))}
                    placeholder="Invoice #, project name, service provided" className="bg-background" />
                </div>

                <Button type="submit" disabled={saving || !inc.source.trim() || !inc.amount} className="w-full gap-2 min-h-[44px]">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Save Income
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Help text */}
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-1.5 text-xs text-muted-foreground">
          <p className="font-medium text-foreground text-sm">How this works</p>
          {mode === "expense" ? (
            <>
              <p>• Expenses are stored and AI-analyzed automatically.</p>
              <p>• Confirmed deductible expenses flow to the correct Schedule C line based on category.</p>
              <p>• You can review and edit these under Transactions at any time.</p>
            </>
          ) : (
            <>
              <p>• Income entries appear on Schedule C Line 1 (Gross Receipts) when you export.</p>
              <p>• For 1099 forms, use Income Tracking to enter each form separately.</p>
              <p>• All income sources are combined automatically for your Schedule C.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AddManualTransactionScreen;
