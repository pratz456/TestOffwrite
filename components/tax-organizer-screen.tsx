"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, ChevronRight, ChevronLeft, CheckCircle2, Circle, Loader2, Save } from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

interface Props { user: { id: string; email?: string }; onBack: () => void; onNavigate?: (screen: string) => void; }

const FILING_STATUSES = [
  { value: "single", label: "Single" },
  { value: "married_filing_jointly", label: "Married Filing Jointly" },
  { value: "married_filing_separately", label: "Married Filing Separately" },
  { value: "head_of_household", label: "Head of Household" },
];

interface OrgAnswers {
  // Personal
  filingStatus: string;
  dateOfBirth: string;
  spouseDoB: string;
  dependents: string;
  // Income
  hasW2: string;
  hasSEIncome: string;
  has1099K: string;
  has1099INT: string;
  has1099DIV: string;
  hasRentalIncome: string;
  hasOtherIncome: string;
  // Deductions
  paidHealthInsurance: string;
  healthInsurancePremium: string;
  madeRetirementContrib: string;
  retirementAmount: string;
  retirementType: string;
  paidStudentLoanInterest: string;
  studentLoanInterest: string;
  paidHSA: string;
  hsaAmount: string;
  hasHomeMortgage: string;
  // Life events
  marriedThisYear: string;
  hadChild: string;
  boughtHome: string;
  soldHome: string;
  startedBusiness: string;
  // Prior year
  priorYearTax: string;
  madeQuarterlyPayments: string;
  quarterlyTotal: string;
}

const EMPTY: OrgAnswers = {
  filingStatus:"",dateOfBirth:"",spouseDoB:"",dependents:"0",
  hasW2:"",hasSEIncome:"yes",has1099K:"",has1099INT:"",has1099DIV:"",hasRentalIncome:"",hasOtherIncome:"",
  paidHealthInsurance:"",healthInsurancePremium:"",madeRetirementContrib:"",retirementAmount:"",retirementType:"sep_ira",
  paidStudentLoanInterest:"",studentLoanInterest:"",paidHSA:"",hsaAmount:"",hasHomeMortgage:"",
  marriedThisYear:"",hadChild:"",boughtHome:"",soldHome:"",startedBusiness:"",
  priorYearTax:"",madeQuarterlyPayments:"",quarterlyTotal:"",
};

const STEPS = ["Personal Info","Income Sources","Deductions","Life Events","Prior Year"];

export function TaxOrganizerScreen({ user, onBack, onNavigate }: Props) {
  const currentYear = new Date().getFullYear();
  const [year] = useState(currentYear);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<OrgAnswers>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof OrgAnswers, v: string) => setAnswers(p => ({ ...p, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await makeAuthenticatedRequest(`/api/tax/organizer?year=${year}`);
      const data = await res.json();
      if (data.organizer) setAnswers({ ...EMPTY, ...data.organizer });
    } catch { } finally { setLoading(false); }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await makeAuthenticatedRequest("/api/tax/organizer", { method: "POST", body: JSON.stringify({ ...answers, taxYear: year }) });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to save"); }
    finally { setSaving(false); }
  };

  const next = async () => { await save(); if (step < STEPS.length - 1) setStep(s => s + 1); };
  const prev = () => setStep(s => s - 1);

  const yesno = (key: keyof OrgAnswers, label: string) => (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="flex gap-2">
        {["yes","no"].map(v=>(
          <Button key={v} type="button" variant={answers[key]===v?"default":"outline"} size="sm" onClick={()=>set(key,v)} className="capitalize min-h-[36px] px-5">{v}</Button>
        ))}
      </div>
    </div>
  );

  const completedSteps = STEPS.filter((_, i) => {
    if (i === 0) return !!answers.filingStatus;
    if (i === 1) return !!(answers.hasSEIncome || answers.hasW2);
    if (i === 2) return !!(answers.paidHealthInsurance);
    if (i === 3) return !!(answers.marriedThisYear || answers.hadChild || answers.startedBusiness || answers.boughtHome);
    if (i === 4) return !!(answers.priorYearTax);
    return false;
  }).length;

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
          <Button onClick={onBack} variant="ghost" size="icon" className="shrink-0 min-h-[44px] min-w-[44px]"><ArrowLeft className="w-5 h-5" /></Button>
          <div className="flex-1">
            <h1 className="text-lg sm:text-xl font-semibold">Tax Organizer {year}</h1>
            <p className="text-xs text-muted-foreground">{completedSteps} of {STEPS.length} sections complete</p>
          </div>
          <Button onClick={save} disabled={saving} variant="outline" size="sm" className="gap-1.5 min-h-[36px]">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Save className="w-3.5 h-3.5" />}
            {saved ? "Saved" : "Save"}
          </Button>
        </div>

        {/* Progress steps */}
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pb-3 flex gap-1">
          {STEPS.map((s, i) => (
            <button key={s} onClick={() => setStep(i)} className={`flex-1 h-1.5 rounded-full transition-colors ${i === step ? "bg-primary" : i < step ? "bg-primary/50" : "bg-muted"}`} />
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-foreground">{STEPS[step]}</span>
          <span className="text-sm text-muted-foreground">({step + 1} of {STEPS.length})</span>
        </div>

        {/* STEP 0: Personal Info */}
        {step === 0 && (
          <Card className="bg-card border-border">
            <CardContent className="p-5 space-y-5">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Filing Status *</Label>
                <Select value={answers.filingStatus} onValueChange={v => set("filingStatus", v)}>
                  <SelectTrigger className="bg-background"><SelectValue placeholder="Select filing status" /></SelectTrigger>
                  <SelectContent>{FILING_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Your Date of Birth</Label>
                  <Input type="date" value={answers.dateOfBirth} onChange={e => set("dateOfBirth", e.target.value)} className="bg-background" />
                </div>
                {(answers.filingStatus === "married_filing_jointly") && (
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Spouse Date of Birth</Label>
                    <Input type="date" value={answers.spouseDoB} onChange={e => set("spouseDoB", e.target.value)} className="bg-background" />
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Number of Dependents</Label>
                <Select value={answers.dependents} onValueChange={v => set("dependents", v)}>
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>{["0","1","2","3","4","5+"].map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {/* STEP 1: Income */}
        {step === 1 && (
          <Card className="bg-card border-border">
            <CardContent className="p-5 space-y-5">
              <p className="text-sm text-muted-foreground">Check all income types you had in {year}. This determines which forms we need.</p>
              {yesno("hasSEIncome", "Self-employment or freelance income (1099-NEC, 1099-K, or cash)")}
              {yesno("hasW2", "W-2 wages from an employer")}
              {yesno("has1099K", "Platform payments (Uber, DoorDash, Etsy, Stripe, PayPal, etc.)")}
              {yesno("has1099INT", "Bank interest income (1099-INT)")}
              {yesno("has1099DIV", "Dividends or investment income (1099-DIV)")}
              {yesno("hasRentalIncome", "Rental income from property you own")}
              {yesno("hasOtherIncome", "Other income (alimony pre-2019, gambling, prizes, etc.)")}
              {answers.hasW2 === "yes" && (
                <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-3 text-sm text-blue-800 dark:text-blue-300 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>Don't forget to add your W-2 details in the W-2 Income section so we can calculate combined withholding.</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* STEP 2: Deductions */}
        {step === 2 && (
          <Card className="bg-card border-border">
            <CardContent className="p-5 space-y-5">
              <p className="text-sm text-muted-foreground">These deductions reduce your AGI before taxes are calculated.</p>
              {yesno("paidHealthInsurance", "Did you pay for your own health insurance (not through an employer)?")}
              {answers.paidHealthInsurance === "yes" && (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Total health insurance premiums paid in {year} ($)</Label>
                  <Input type="number" min="0" step="0.01" value={answers.healthInsurancePremium} onChange={e => set("healthInsurancePremium", e.target.value)} placeholder="e.g. 7200" className="bg-background" />
                </div>
              )}
              {yesno("madeRetirementContrib", "Did you contribute to a SEP-IRA, Solo 401(k), or SIMPLE IRA?")}
              {answers.madeRetirementContrib === "yes" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Account Type</Label>
                    <Select value={answers.retirementType} onValueChange={v => set("retirementType", v)}>
                      <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sep_ira">SEP-IRA</SelectItem>
                        <SelectItem value="solo_401k">Solo 401(k)</SelectItem>
                        <SelectItem value="simple_ira">SIMPLE IRA</SelectItem>
                        <SelectItem value="traditional_ira">Traditional IRA</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Contribution Amount ($)</Label>
                    <Input type="number" min="0" step="0.01" value={answers.retirementAmount} onChange={e => set("retirementAmount", e.target.value)} placeholder="0.00" className="bg-background" />
                  </div>
                </div>
              )}
              {yesno("paidStudentLoanInterest", "Did you pay student loan interest?")}
              {answers.paidStudentLoanInterest === "yes" && (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Student loan interest paid ($)</Label>
                  <Input type="number" min="0" step="0.01" value={answers.studentLoanInterest} onChange={e => set("studentLoanInterest", e.target.value)} placeholder="Max deductible: $2,500" className="bg-background" />
                </div>
              )}
              {yesno("paidHSA", "Did you contribute to an HSA (Health Savings Account)?")}
              {answers.paidHSA === "yes" && (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">HSA contributions ($) - 2025 limits: $4,300 self-only / $8,550 family</Label>
                  <Input type="number" min="0" step="0.01" value={answers.hsaAmount} onChange={e => set("hsaAmount", e.target.value)} placeholder="0.00" className="bg-background" />
                </div>
              )}
              {yesno("hasHomeMortgage", "Do you have a home mortgage with interest to deduct?")}
            </CardContent>
          </Card>
        )}

        {/* STEP 3: Life Events */}
        {step === 3 && (
          <Card className="bg-card border-border">
            <CardContent className="p-5 space-y-5">
              <p className="text-sm text-muted-foreground">Life events affect which forms and credits apply to your return.</p>
              {yesno("marriedThisYear", `Did you get married or divorced in ${year}?`)}
              {yesno("hadChild", `Did you have or adopt a child in ${year}?`)}
              {yesno("boughtHome", `Did you buy a home in ${year}?`)}
              {yesno("soldHome", `Did you sell a home in ${year}?`)}
              {yesno("startedBusiness", `Did you start or acquire a new business in ${year}?`)}
            </CardContent>
          </Card>
        )}

        {/* STEP 4: Prior Year */}
        {step === 4 && (
          <Card className="bg-card border-border">
            <CardContent className="p-5 space-y-5">
              <p className="text-sm text-muted-foreground">Prior year information is used to calculate safe harbor quarterly payments and verify your identity when e-filing.</p>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Prior year total tax ({year - 1} Form 1040, Line 24)</Label>
                <Input type="number" min="0" step="0.01" value={answers.priorYearTax} onChange={e => set("priorYearTax", e.target.value)} placeholder="e.g. 8500" className="bg-background" />
                <p className="text-xs text-muted-foreground">Used to calculate your safe harbor quarterly payment amount</p>
              </div>
              {yesno("madeQuarterlyPayments", `Did you make estimated tax payments in ${year}?`)}
              {answers.madeQuarterlyPayments === "yes" && (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Total quarterly payments made in {year} ($)</Label>
                  <Input type="number" min="0" step="0.01" value={answers.quarterlyTotal} onChange={e => set("quarterlyTotal", e.target.value)} placeholder="Sum of all 4 payments" className="bg-background" />
                </div>
              )}
              <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 px-4 py-3 text-sm text-green-800 dark:text-green-300">
                <p className="font-medium mb-1">You're all set!</p>
                <p>Your organizer answers help us generate accurate tax forms and identify every deduction. Your data is saved securely and used only for your tax preparation.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Navigation */}
        <div className="flex gap-3">
          {step > 0 && (
            <Button variant="outline" onClick={prev} className="flex-1 gap-2 min-h-[44px]"><ChevronLeft className="w-4 h-4" />Back</Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button onClick={next} disabled={saving} className="flex-1 gap-2 min-h-[44px]">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Next<ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={save} disabled={saving} className="flex-1 gap-2 min-h-[44px]">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {saved ? "Saved!" : "Save & Finish"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
export default TaxOrganizerScreen;
