"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Plus, Loader2, DollarSign, TrendingDown, TrendingUp, CheckCircle2 } from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

interface AddManualEntryScreenProps {
  user: { id: string; email?: string };
  onBack: () => void;
  onSaved?: () => void;
  defaultType?: "expense" | "income";
}

const EXPENSE_CATEGORIES = [
  { value: "SERVICE_ADVERTISING",    label: "Advertising & Marketing" },
  { value: "SOFTWARE",               label: "Software / Subscriptions" },
  { value: "SERVICE_FREELANCE_SERVICES", label: "Contract Labor" },
  { value: "GENERAL_MERCHANDISE_COMPUTERS_AND_ELECTRONICS", label: "Equipment / Electronics" },
  { value: "TRANSPORTATION_FUEL",    label: "Fuel / Transportation" },
  { value: "SERVICE_INSURANCE",      label: "Insurance" },
  { value: "SERVICE_LEGAL",          label: "Legal & Professional" },
  { value: "GENERAL_MERCHANDISE_OFFICE_SUPPLIES", label: "Office Supplies" },
  { value: "RENT_RENT",              label: "Rent / Coworking" },
  { value: "SERVICE_UTILITIES",      label: "Utilities / Phone / Internet" },
  { value: "TRAVEL_FLIGHTS",         label: "Travel" },
  { value: "FOOD_AND_DRINK_RESTAURANT", label: "Meals (50%)" },
  { value: "COMMUNITY_EDUCATION",    label: "Education / Training" },
  { value: "other",                  label: "Other" },
];

export function AddManualEntryScreen({ user, onBack, onSaved, defaultType = "expense" }: AddManualEntryScreenProps) {
  const [entryType, setEntryType] = useState<"expense" | "income">(defaultType);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    merchant_name: "",
    amount: "",
    date: today,
    category: "other",
    notes: "",
    business_purpose: "",
    is_deductible: null as boolean | null,
  });

  const reset = () => {
    setForm({ merchant_name: "", amount: "", date: today, category: "other", notes: "", business_purpose: "", is_deductible: null });
    setSaved(false);
    setError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!form.merchant_name.trim() || isNaN(amount) || amount <= 0) return;
    setSaving(true); setError(null);
    try {
      const res = await makeAuthenticatedRequest("/api/transactions/manual", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          amount,
          type: entryType,
          is_deductible: entryType === "expense" ? form.is_deductible : null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to save");
      setSaved(true);
      if (onSaved) onSaved();
      setTimeout(() => { reset(); }, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
          <Button onClick={onBack} variant="ghost" size="icon" className="shrink-0 min-h-[44px] min-w-[44px]">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-foreground">Add Entry</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Manually record income or an expense</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4">
        {/* Type toggle */}
        <Tabs value={entryType} onValueChange={v => { setEntryType(v as "expense" | "income"); reset(); }} className="mb-4">
          <TabsList className="w-full grid grid-cols-2 bg-muted/50 border border-border p-1 rounded-lg">
            <TabsTrigger value="expense" className="rounded-md gap-2 data-[state=active]:bg-background">
              <TrendingDown className="w-4 h-4" />Expense
            </TabsTrigger>
            <TabsTrigger value="income" className="rounded-md gap-2 data-[state=active]:bg-background">
              <TrendingUp className="w-4 h-4" />Income
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {saved ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <CheckCircle2 className="w-14 h-14 text-green-500" />
            <p className="text-lg font-semibold text-foreground">{entryType === "expense" ? "Expense" : "Income"} saved!</p>
            <p className="text-sm text-muted-foreground text-center">
              {entryType === "expense" ? "AI analysis running in the background." : "Added to your income for Schedule C Line 1."}
            </p>
            <Button onClick={reset} className="mt-2">Add another</Button>
          </div>
        ) : (
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-primary" />
                {entryType === "expense" ? "New Business Expense" : "New Income Entry"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSave} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      {entryType === "expense" ? "Merchant / Vendor *" : "Client / Source *"}
                    </Label>
                    <Input
                      value={form.merchant_name}
                      onChange={e => setForm(p => ({ ...p, merchant_name: e.target.value }))}
                      placeholder={entryType === "expense" ? "e.g. Adobe, FedEx" : "e.g. Acme Corp"}
                      className="bg-background" required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Amount ($) *</Label>
                    <Input
                      type="number" min="0.01" step="0.01" value={form.amount}
                      onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                      placeholder="0.00" className="bg-background" required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Date *</Label>
                    <Input
                      type="date" value={form.date}
                      onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                      className="bg-background" required
                    />
                  </div>
                  {entryType === "expense" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Category</Label>
                      <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
                        <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {EXPENSE_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {entryType === "expense" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Business Purpose</Label>
                    <Input
                      value={form.business_purpose}
                      onChange={e => setForm(p => ({ ...p, business_purpose: e.target.value }))}
                      placeholder="Why was this a business expense?"
                      className="bg-background"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
                  <Textarea
                    value={form.notes}
                    onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                    placeholder={entryType === "expense" ? "Invoice #, project name..." : "Description, payment method..."}
                    className="bg-background resize-none" rows={2}
                  />
                </div>

                {entryType === "expense" && (
                  <div className="flex gap-3">
                    {([
                      { val: true, label: "Mark as deductible", cls: "border-green-500 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400" },
                      { val: false, label: "Not deductible", cls: "border-red-400 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400" },
                      { val: null, label: "Let AI decide", cls: "border-blue-400 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400" },
                    ] as const).map(({ val, label, cls }) => (
                      <button key={label} type="button"
                        onClick={() => setForm(p => ({ ...p, is_deductible: val }))}
                        className={`flex-1 text-xs font-medium py-2 px-2 rounded-lg border transition-all ${
                          form.is_deductible === val ? cls : "border-border text-muted-foreground hover:bg-muted/50"
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                {error && <p className="text-sm text-destructive">{error}</p>}

                <div className="flex gap-3 pt-1">
                  <Button type="button" variant="outline" onClick={onBack} className="flex-1">Cancel</Button>
                  <Button type="submit" disabled={saving || !form.merchant_name.trim() || !form.amount} className="flex-1 gap-2">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Save {entryType === "expense" ? "Expense" : "Income"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default AddManualEntryScreen;
