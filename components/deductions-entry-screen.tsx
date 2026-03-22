"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, CheckCircle2, Heart, PiggyBank, Shield, GraduationCap, Info, DollarSign } from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

interface Props {
  user: { id: string; email?: string };
  onBack: () => void;
  onNavigate?: (screen: string) => void;
}

const num = (v: string) => (v === "" ? 0 : parseFloat(v) || 0);
const fmt = (n: number) => (n > 0 ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "-");

export function DeductionsEntryScreen({ user, onBack, onNavigate }: Props) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fields, setFields] = useState({
    healthInsurancePremiums: "",
    sepIraContribution: "",
    solo401kEmployeeContribution: "",
    solo401kEmployerContribution: "",
    simpleIraContribution: "",
    hsaContribution: "",
    studentLoanInterest: "",
    priorYearTotalTax: "",
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields(p => ({ ...p, [k]: e.target.value }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await makeAuthenticatedRequest(`/api/tax/deductions?year=${year}`);
      if (res.ok) {
        const { deductions } = await res.json();
        if (deductions) {
          setFields({
            healthInsurancePremiums: deductions.healthInsurancePremiums > 0 ? String(deductions.healthInsurancePremiums) : "",
            sepIraContribution: deductions.sepIraContribution > 0 ? String(deductions.sepIraContribution) : "",
            solo401kEmployeeContribution: deductions.solo401kEmployeeContribution > 0 ? String(deductions.solo401kEmployeeContribution) : "",
            solo401kEmployerContribution: deductions.solo401kEmployerContribution > 0 ? String(deductions.solo401kEmployerContribution) : "",
            simpleIraContribution: deductions.simpleIraContribution > 0 ? String(deductions.simpleIraContribution) : "",
            hsaContribution: deductions.hsaContribution > 0 ? String(deductions.hsaContribution) : "",
            studentLoanInterest: deductions.studentLoanInterest > 0 ? String(deductions.studentLoanInterest) : "",
            priorYearTotalTax: deductions.priorYearTotalTax > 0 ? String(deductions.priorYearTotalTax) : "",
          });
        }
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
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
      icon: Heart,
      title: "Health Insurance",
      color: "text-red-500",
      fields: [
        { key: "healthInsurancePremiums", label: "Self-Employed Health Insurance Premiums", hint: "Annual medical, dental, vision premiums paid out-of-pocket. Schedule 1 Line 17. Max: your net SE income.", limit: "100% of net SE income" },
      ],
    },
    {
      icon: PiggyBank,
      title: "Retirement Contributions",
      color: "text-emerald-600",
      fields: [
        { key: "sepIraContribution", label: "SEP-IRA Contribution", hint: "Up to 25% of net SE income, max $70,000 (2025). Schedule 1 Line 16.", limit: "Max $70,000 (2025)" },
        { key: "solo401kEmployeeContribution", label: "Solo 401(k) - Employee Deferral", hint: "Up to $23,500 (or $31,000 if age 50+) for 2025. Schedule 1 Line 16.", limit: "Max $23,500 / $31,000 if 50+" },
        { key: "solo401kEmployerContribution", label: "Solo 401(k) - Employer Contribution", hint: "Up to 25% of net SE income. Combined 401k limit: $70,000 (2025).", limit: "Combined max $70,000" },
        { key: "simpleIraContribution", label: "SIMPLE IRA Contribution", hint: "Up to $16,500 for 2025 ($19,500 if age 50+).", limit: "Max $16,500 (2025)" },
      ],
    },
    {
      icon: Shield,
      title: "Health Savings Account (HSA)",
      color: "text-blue-500",
      fields: [
        { key: "hsaContribution", label: "HSA Contribution", hint: "Requires a high-deductible health plan. 2025 limits: $4,300 self-only / $8,550 family. Schedule 1 Line 13.", limit: "$4,300 / $8,550 family" },
      ],
    },
    {
      icon: GraduationCap,
      title: "Other Deductions",
      color: "text-purple-500",
      fields: [
        { key: "studentLoanInterest", label: "Student Loan Interest Paid", hint: "Up to $2,500 deductible. Phases out above $80,000 AGI ($165,000 MFJ). Schedule 1 Line 21.", limit: "Max $2,500" },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold text-foreground">Above-the-Line Deductions</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Reduce your AGI and tax bill directly</p>
          </div>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-[90px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 4 }, (_, i) => currentYear - i).map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* Impact banner */}
        {totalDeductions > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50/60 dark:bg-green-950/30 px-4 py-3">
            <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                {fmt(totalDeductions)} in above-the-line deductions
              </p>
              <p className="text-xs text-green-700 dark:text-green-400">
                Estimated tax savings: {fmt(totalDeductions * 0.30)} to {fmt(totalDeductions * 0.36)} (at 30-36% combined rate)
              </p>
            </div>
          </div>
        )}

        {/* Explainer */}
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30 px-4 py-3 text-xs text-blue-800 dark:text-blue-300">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <p>These deductions reduce your AGI <strong>before</strong> the standard deduction - every dollar here saves both income tax and affects your QBI deduction threshold. They appear on Schedule 1 of Form 1040.</p>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {sections.map(({ icon: Icon, title, color, fields: sfields }) => (
              <Card key={title} className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${color}`} /> {title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {sfields.map(({ key, label, hint, limit }) => (
                    <div key={key} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">{label}</Label>
                        <span className="text-xs text-muted-foreground">{limit}</span>
                      </div>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                        <Input
                          type="number" min={0} step={1}
                          value={fields[key as keyof typeof fields]}
                          onChange={set(key)}
                          placeholder="0"
                          className="pl-7 bg-background"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">{hint}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}

            {/* Prior year tax for safe harbor */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-amber-500" /> Quarterly Estimate Safe Harbor
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <Label className="text-sm font-medium">Prior Year Total Tax (Form 1040 Line 24)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    type="number" min={0}
                    value={fields.priorYearTotalTax}
                    onChange={set("priorYearTotalTax")}
                    placeholder="e.g. 8500"
                    className="pl-7 bg-background"
                  />
                </div>
                <p className="text-xs text-muted-foreground">From last year's return (Line 24). Used to calculate your safe harbor quarterly payment - pay this ÷ 4 each quarter and you are penalty-free regardless of what you owe in April.</p>
              </CardContent>
            </Card>

            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full min-h-[48px] gap-2 text-base font-semibold"
            >
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : saved ? <CheckCircle2 className="w-5 h-5" /> : <Save className="w-5 h-5" />}
              {saving ? "Saving…" : saved ? "Saved!" : "Save Deductions"}
            </Button>

            {onNavigate && (
              <Button variant="outline" onClick={() => onNavigate("tax-preview")} className="w-full gap-2">
                <DollarSign className="w-4 h-4" />
                See updated tax estimate
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default DeductionsEntryScreen;
