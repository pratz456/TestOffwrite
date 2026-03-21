"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2, Loader2, Briefcase, CheckCircle2, AlertCircle } from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

interface W2Entry { id: string; employer: string; wages: number; federalWithheld: number; stateWithheld?: number; state?: string; taxYear: number; }
interface Props { user: { id: string; email?: string }; onBack: () => void; }
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

export function W2IncomeScreen({ user, onBack }: Props) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [entries, setEntries] = useState<W2Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ employer: "", wages: "", federalWithheld: "", stateWithheld: "", state: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await makeAuthenticatedRequest(`/api/income/w2?year=${year}`);
      const data = await res.json();
      setEntries(data.entries || []);
    } catch { setEntries([]); } finally { setLoading(false); }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const totalWages = entries.reduce((s, e) => s + e.wages, 0);
  const totalWithheld = entries.reduce((s, e) => s + e.federalWithheld, 0);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.employer.trim() || !form.wages) return;
    setSaving(true); setError(null);
    try {
      const res = await makeAuthenticatedRequest("/api/income/w2", { method: "POST", body: JSON.stringify({ employer: form.employer, wages: parseFloat(form.wages), federalWithheld: parseFloat(form.federalWithheld || "0"), stateWithheld: form.stateWithheld ? parseFloat(form.stateWithheld) : undefined, state: form.state || undefined, taxYear: year }) });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      setForm({ employer: "", wages: "", federalWithheld: "", stateWithheld: "", state: "" });
      setShowForm(false);
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setSaving(false); }
  };

  const del = async (id: string) => {
    setDeleting(id);
    try {
      await makeAuthenticatedRequest(`/api/income/w2?id=${id}`, { method: "DELETE" });
      setEntries(prev => prev.filter(e => e.id !== id));
    } catch { } finally { setDeleting(null); }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
          <Button onClick={onBack} variant="ghost" size="icon" className="shrink-0 min-h-[44px] min-w-[44px]"><ArrowLeft className="w-5 h-5" /></Button>
          <div className="flex-1">
            <h1 className="text-lg sm:text-xl font-semibold">W-2 Income</h1>
            <p className="text-xs text-muted-foreground">Salary income from employers — affects your combined tax bracket</p>
          </div>
          <Select value={String(year)} onValueChange={v => setYear(parseInt(v))}>
            <SelectTrigger className="w-[90px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{Array.from({length:4},(_,i)=>currentYear-i).map(y=><SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* Info banner */}
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-3 text-sm text-blue-800 dark:text-blue-300">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>W-2 income is added to your self-employment income to determine your combined tax bracket. The federal tax withheld by your employer offsets what you owe in April.</p>
        </div>

        {/* Summary */}
        {entries.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <Card className="bg-card border-border"><CardContent className="p-3 sm:p-4"><p className="text-xs text-muted-foreground mb-1">Total W-2 Wages</p><p className="text-base sm:text-lg font-semibold text-foreground tabular-nums">${fmt(totalWages)}</p></CardContent></Card>
            <Card className="bg-card border-border"><CardContent className="p-3 sm:p-4"><p className="text-xs text-muted-foreground mb-1">Federal Withheld</p><p className="text-base sm:text-lg font-semibold text-green-600 dark:text-green-400 tabular-nums">${fmt(totalWithheld)}</p></CardContent></Card>
          </div>
        )}

        {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2"><Briefcase className="w-4 h-4 text-primary" />W-2 Employers</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Enter each W-2 you received for {year}</p>
            </div>
            <Button onClick={() => setShowForm(!showForm)} size="sm" variant={showForm ? "outline" : "default"} className="gap-1.5 min-h-[40px]"><Plus className="w-4 h-4" />Add W-2</Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {showForm && (
              <form onSubmit={save} className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Employer Name *</Label>
                  <Input value={form.employer} onChange={e => setForm(p=>({...p,employer:e.target.value}))} placeholder="e.g. Acme Corporation" className="bg-background" required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Box 1 — Wages ($) *</Label>
                    <Input type="number" min="0" step="0.01" value={form.wages} onChange={e=>setForm(p=>({...p,wages:e.target.value}))} placeholder="0.00" className="bg-background" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Box 2 — Federal Withheld ($)</Label>
                    <Input type="number" min="0" step="0.01" value={form.federalWithheld} onChange={e=>setForm(p=>({...p,federalWithheld:e.target.value}))} placeholder="0.00" className="bg-background" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Box 17 — State Withheld ($)</Label>
                    <Input type="number" min="0" step="0.01" value={form.stateWithheld} onChange={e=>setForm(p=>({...p,stateWithheld:e.target.value}))} placeholder="0.00" className="bg-background" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">State</Label>
                    <Select value={form.state} onValueChange={v=>setForm(p=>({...p,state:v}))}>
                      <SelectTrigger className="bg-background"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{US_STATES.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={()=>setShowForm(false)} className="flex-1">Cancel</Button>
                  <Button type="submit" disabled={saving || !form.employer.trim() || !form.wages} className="flex-1 gap-2">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Save W-2
                  </Button>
                </div>
              </form>
            )}

            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : entries.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Briefcase className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="font-medium text-foreground text-sm">No W-2s entered for {year}</p>
                <p className="text-xs mt-1">If you only have self-employment income, skip this section</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {entries.map(e => (
                  <li key={e.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/20 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground text-sm truncate">{e.employer}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Box 1: ${fmt(e.wages)} · Federal withheld: ${fmt(e.federalWithheld)}{e.state ? ` · ${e.state}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold tabular-nums whitespace-nowrap">${fmt(e.wages)}</p>
                      <Button variant="ghost" size="icon" onClick={() => del(e.id)} disabled={deleting === e.id} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 w-8">
                        {deleting === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </li>
                ))}
                <li className="flex justify-between px-3 py-2 rounded-lg bg-muted/50 border border-border">
                  <span className="text-sm font-medium text-muted-foreground">Total W-2 Wages</span>
                  <span className="text-sm font-semibold tabular-nums">${fmt(totalWages)}</span>
                </li>
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-1 text-xs text-muted-foreground">
          <p className="font-medium text-foreground text-sm">How this affects your taxes</p>
          <p>Your W-2 wages are combined with self-employment income to determine which tax bracket you fall in. The federal tax your employer already withheld (Box 2) counts against what you owe, reducing your April balance due or increasing your refund.</p>
        </div>
      </div>
    </div>
  );
}
export default W2IncomeScreen;
