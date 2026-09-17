"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, CheckCircle2, Heart, PiggyBank, Shield, GraduationCap, ChevronDown, DollarSign } from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

interface Props {
  user: { id: string; email?: string };
  onBack: () => void;
  onNavigate?: (screen: string) => void;
}

const num = (v: string) => (v === "" ? 0 : parseFloat(v) || 0);
const fmt = (n: number) => (n > 0 ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "$0");

const emptyDeductions = {
    healthInsurancePremiums: "",
    sepIraContribution: "",
    solo401kEmployeeContribution: "",
    solo401kEmployerContribution: "",
    simpleIraContribution: "",
    hsaContribution: "",
    studentLoanInterest: "",
    priorYearTotalTax: "",
    charitableCashDonations: "",
    charitableNonCashDonations: "",
};

export function DeductionsEntryScreen({ user, onBack, onNavigate }: Props) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fields, setFields] = useState({ ...emptyDeductions });
  const [loadedYear, setLoadedYear] = useState<string | null>(null);
  const loadRequestId = useRef(0);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields(p => ({ ...p, [k]: e.target.value }));

  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    setLoading(true); setError(null); setSaved(false);
    setLoadedYear(null); setFields({ ...emptyDeductions });
    try {
      const res = await makeAuthenticatedRequest(`/api/tax/deductions?year=${year}`);
      if (!res.ok) throw new Error("Could not load deductions. Try again before making changes.");
      const { deductions } = await res.json();
      if (requestId !== loadRequestId.current) return;
      const next = { ...emptyDeductions };
      for (const key of Object.keys(next) as (keyof typeof next)[]) {
        next[key] = deductions?.[key] > 0 ? String(deductions[key]) : "";
      }
      setFields(next); setLoadedYear(year);
    } catch {
      if (requestId === loadRequestId.current) setError("Could not load deductions. Try again before making changes.");
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    load();
    const generation = loadRequestId;
    return () => { generation.current++; };
  }, [load]);

  const handleSave = async () => {
    if (loading || loadedYear !== year || saving) return;
    setSaving(true); setError(null);
    try {
      const res = await makeAuthenticatedRequest("/api/tax/deductions", {
        method: "POST",
        body: JSON.stringify({
          taxYear: parseInt(year),
          healthInsurancePremiums: num(fields.healthInsurancePremiums),
          sepIraContribution: num(fields.sepIraContribution),
          solo401kEmployeeContribution: num(fields.solo401kEmployeeContribution),
          solo401kEmployerContribution: num(fields.solo401kEmployerContribution),
          simpleIraContribution: num(fields.simpleIraContribution),
          hsaContribution: num(fields.hsaContribution),
          studentLoanInterest: num(fields.studentLoanInterest),
          priorYearTotalTax: num(fields.priorYearTotalTax),
          charitableCashDonations: num(fields.charitableCashDonations),
          charitableNonCashDonations: num(fields.charitableNonCashDonations),
        }),
      });
      if (!res.ok) { let m = "Save failed"; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally { setSaving(false); }
  };

  const totalDeductions = [
    num(fields.healthInsurancePremiums),
    num(fields.sepIraContribution),
    num(fields.solo401kEmployeeContribution),
    num(fields.solo401kEmployerContribution),
    num(fields.simpleIraContribution),
    num(fields.hsaContribution),
    num(fields.studentLoanInterest),
  ].reduce((a, b) => a + b, 0);

  const sections = [
    {
      icon: Heart, title: "Health insurance", kind: "Income adjustment",
      fields: [
        { key: "healthInsurancePremiums", label: "Self-employed health insurance premiums", hint: "Enter premiums paid out of pocket. Eligibility and earned-income limits still need review." },
      ],
    },
    {
      icon: PiggyBank, title: "Retirement", kind: "Income adjustment",
      fields: [
        { key: "sepIraContribution", label: "SEP-IRA contribution", hint: "Enter your contribution for this tax year. Earned income and plan limits apply." },
        { key: "solo401kEmployeeContribution", label: "Solo 401(k) employee deferral", hint: "Check this year's deferral limit and contributions to other employer plans." },
        { key: "solo401kEmployerContribution", label: "Solo 401(k) employer contribution", hint: "Earned income and combined contribution limits apply." },
        { key: "simpleIraContribution", label: "SIMPLE IRA contribution", hint: "Check the limit for your plan, age, and selected tax year." },
      ],
    },
    {
      icon: Shield, title: "Health savings account", kind: "Income adjustment",
      fields: [
        { key: "hsaContribution", label: "HSA contribution", hint: "Review eligible health coverage and annual limits before claiming an HSA deduction." },
      ],
    },
    {
      icon: GraduationCap, title: "Student loans", kind: "Income adjustment",
      fields: [
        { key: "studentLoanInterest", label: "Student loan interest paid", hint: "Deductibility depends on eligibility, income, and filing status." },
      ],
    },
    {
      icon: Heart, title: "Charitable donations", kind: "Itemized deduction records",
      fields: [
        { key: "charitableCashDonations", label: "Cash donations", hint: "Cash or check donations to qualified organizations. Keep supporting records." },
        { key: "charitableNonCashDonations", label: "Non-cash donations", hint: "Fair market value of donated property. Valuation and documentation rules apply." },
      ],
    },
    {
      icon: DollarSign, title: "Prior-year tax", kind: "Quarterly payment reference",
      fields: [
        { key: "priorYearTotalTax", label: "Prior-year total tax", hint: "Form 1040, line 24. This amount alone does not establish a safe-harbor payment or prevent penalties." },
      ],
    },
  ];

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-2xl px-4 py-3 sm:px-6">
        <header className="mb-3 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Deductions</h1>
          <Select value={year} onValueChange={setYear} disabled={saving}>
            <SelectTrigger aria-label="Deduction tax year" className="min-h-11 w-[100px] bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 4 }, (_, i) => currentYear - i).map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </header>

        <section aria-label="Entered deduction amounts" className="mb-3 rounded-xl border border-border bg-card p-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Income adjustments</p>
              <p className="text-lg font-semibold tabular-nums">{loading || loadedYear !== year ? "—" : fmt(totalDeductions)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Charitable donations</p>
              <p className="text-lg font-semibold tabular-nums">{loading || loadedYear !== year ? "—" : fmt(num(fields.charitableCashDonations) + num(fields.charitableNonCashDonations))}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Amounts entered, subject to eligibility and limits.</p>
        </section>

        {error && <p role="alert" className="mb-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

        {loading ? (
          <div className="flex justify-center py-8" role="status" aria-label="Loading deductions"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : loadedYear !== year ? (
          <Button variant="outline" onClick={load} className="min-h-11">Retry deductions</Button>
        ) : (
          <>
            <p className="mb-2 text-sm text-muted-foreground">Open only what applies to you.</p>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {sections.map(({ icon: Icon, title, kind, fields: sectionFields }) => {
                const subtotal = sectionFields.reduce((sum, field) => sum + num(fields[field.key as keyof typeof fields]), 0);
                return (
                  <details key={title} className="group border-b border-border last:border-b-0">
                    <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 text-sm font-medium">{title}</span>
                      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{subtotal > 0 ? fmt(subtotal) : "Add"}</span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <div className="space-y-3 border-t border-border px-3 pb-4 pt-3">
                      <p className="text-xs font-medium text-muted-foreground">{kind}</p>
                      {sectionFields.map(({ key, label, hint }) => (
                        <div key={key} className="space-y-1.5">
                          <Label htmlFor={`deduction-${key}`} className="text-sm font-medium">{label}</Label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden="true">$</span>
                            <Input
                              id={`deduction-${key}`} aria-describedby={`deduction-${key}-hint`}
                              type="number" min={0} step={1}
                              value={fields[key as keyof typeof fields]}
                              onChange={set(key)} placeholder="0"
                              className="min-h-11 bg-background pl-7 text-base"
                            />
                          </div>
                          <p id={`deduction-${key}-hint`} className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })}
            </div>
            <div className="sticky bottom-0 z-10 -mx-4 mt-3 flex gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
              {onNavigate && (
                <Button variant="outline" onClick={() => onNavigate("tax-preview")} className="min-h-11 flex-1">
                  Tax estimate
                </Button>
              )}
              <Button onClick={handleSave} disabled={saving || loading || loadedYear !== year} className="min-h-11 flex-1 gap-2" aria-live="polite">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {saving ? "Saving…" : saved ? "Saved!" : "Save deductions"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default DeductionsEntryScreen;
