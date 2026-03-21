"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, ChevronRight, ChevronLeft, CheckCircle2, Circle, Loader2, Save, Info } from "lucide-react";
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
  taxpayerSSN: string;
  spouseName: string;
  spouseDoB: string;
  spouseSSN: string;
  dependents: string;
  dependentDetails: string;  // JSON: [{name, ssn, dob, relationship}]
  // Address
  streetAddress: string;
  city: string;
  stateAddr: string;
  zipCode: string;
  // Filing info
  priorYearAGI: string;
  bankRouting: string;
  bankAccount: string;
  bankAccountType: string;
  ipPin: string;
  // Income
  hasW2: string;
  hasSEIncome: string;
  has1099K: string;
  has1099INT: string;
  amount1099INT: string;
  has1099DIV: string;
  amount1099DIV: string;
  hasCapGains: string;
  amountCapGains: string;
  hasSocialSecurity: string;
  amountSocialSecurity: string;
  hasIRADistributions: string;
  amountIRADistributions: string;
  hasRentalIncome: string;
  amountRentalIncome: string;
  hasOtherIncome: string;
  amountOtherIncome: string;
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
  filingStatus:"",dateOfBirth:"",taxpayerSSN:"",spouseName:"",spouseDoB:"",spouseSSN:"",dependents:"0",dependentDetails:"",streetAddress:"",city:"",stateAddr:"",zipCode:"",priorYearAGI:"",bankRouting:"",bankAccount:"",bankAccountType:"checking",ipPin:"",
  hasW2:"",hasSEIncome:"yes",has1099K:"",has1099INT:"",amount1099INT:"",has1099DIV:"",amount1099DIV:"",hasCapGains:"",amountCapGains:"",hasSocialSecurity:"",amountSocialSecurity:"",hasIRADistributions:"",amountIRADistributions:"",hasRentalIncome:"",amountRentalIncome:"",hasOtherIncome:"",amountOtherIncome:"",
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
          <div className="space-y-4">
            {/* SSN notice */}
            <div className="flex items-start gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30 px-4 py-3 text-xs text-blue-800 dark:text-blue-300">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <p>Your SSN is required on Form 1040, Schedule C, and all supporting schedules. WriteOff stores it encrypted and only uses it to pre-fill your PDF exports. We never transmit it anywhere without your explicit authorization via Form 8879.</p>
            </div>

            <Card className="bg-card border-border">
              <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Identity</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Filing Status *</Label>
                  <Select value={answers.filingStatus} onValueChange={v => set("filingStatus", v)}>
                    <SelectTrigger className="bg-background"><SelectValue placeholder="Select filing status" /></SelectTrigger>
                    <SelectContent>{FILING_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Your Date of Birth *</Label>
                    <Input type="date" value={answers.dateOfBirth} onChange={e => set("dateOfBirth", e.target.value)} className="bg-background" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Your Social Security Number *</Label>
                    <Input
                      type="password"
                      value={answers.taxpayerSSN}
                      onChange={e => set("taxpayerSSN", e.target.value.replace(/\D/g, "").slice(0, 9))}
                      placeholder="9 digits, no dashes"
                      className="bg-background font-mono"
                      maxLength={9}
                    />
                    <p className="text-xs text-muted-foreground">Required on Form 1040, Line 1. Format: XXX-XX-XXXX on the form.</p>
                  </div>
                </div>

                {answers.filingStatus === "married_filing_jointly" && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-border">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Spouse Full Name *</Label>
                      <Input value={answers.spouseName} onChange={e => set("spouseName", e.target.value)} placeholder="Legal name" className="bg-background" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Spouse Date of Birth *</Label>
                      <Input type="date" value={answers.spouseDoB} onChange={e => set("spouseDoB", e.target.value)} className="bg-background" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Spouse SSN *</Label>
                      <Input
                        type="password"
                        value={answers.spouseSSN}
                        onChange={e => set("spouseSSN", e.target.value.replace(/\D/g, "").slice(0, 9))}
                        placeholder="9 digits"
                        className="bg-background font-mono"
                        maxLength={9}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1.5 pt-2 border-t border-border">
                  <Label className="text-sm font-medium">Number of Dependents</Label>
                  <Select value={answers.dependents} onValueChange={v => set("dependents", v)}>
                    <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent>{["0","1","2","3","4","5+"].map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                  </Select>
                  {parseInt(answers.dependents) > 0 && (
                    <div className="mt-2 space-y-1.5">
                      <Label className="text-sm font-medium">Dependent Names and SSNs</Label>
                      <textarea
                        value={answers.dependentDetails}
                        onChange={e => set("dependentDetails", e.target.value)}
                        placeholder={"List each dependent on a new line:\nFirst Last, SSN, Date of Birth, Relationship\nExample: Emma Shah, 123-45-6789, 2018-03-15, Daughter"}
                        className="w-full min-h-[96px] text-xs rounded-lg border border-border bg-background px-3 py-2 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <p className="text-xs text-muted-foreground">Required for child tax credit (Line 19), dependent care credit, and EIC. SSN required for each dependent claimed.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Mailing Address</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <Input value={answers.streetAddress} onChange={e => set("streetAddress", e.target.value)} placeholder="Street address and apt/unit" className="bg-background" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs text-muted-foreground">City</Label>
                    <Input value={answers.city} onChange={e => set("city", e.target.value)} placeholder="City" className="bg-background" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">State</Label>
                    <Input value={answers.stateAddr} onChange={e => set("stateAddr", e.target.value.toUpperCase().slice(0,2))} placeholder="IL" maxLength={2} className="bg-background" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">ZIP</Label>
                    <Input value={answers.zipCode} onChange={e => set("zipCode", e.target.value.replace(/\D/g, "").slice(0,5))} placeholder="60601" maxLength={5} className="bg-background" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">E-File Identity Verification</CardTitle>
                <p className="text-xs text-muted-foreground">Required by the IRS to submit your return electronically</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Prior Year AGI (Form 1040, Line 11) *</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      type="number" min={0}
                      value={answers.priorYearAGI}
                      onChange={e => set("priorYearAGI", e.target.value)}
                      placeholder="From last year's return"
                      className="pl-7 bg-background"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Found on last year's Form 1040, Line 11. Required by the IRS to verify your identity when e-filing. If you filed for the first time last year, enter $0.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">IRS Identity Protection PIN (IP PIN)</Label>
                  <Input
                    value={answers.ipPin}
                    onChange={e => set("ipPin", e.target.value.replace(/\D/g, "").slice(0,6))}
                    placeholder="6-digit PIN (if assigned by IRS)"
                    className="bg-background font-mono"
                    maxLength={6}
                  />
                  <p className="text-xs text-muted-foreground">Only if the IRS has sent you an IP PIN letter. If you have one and don't enter it, your return will be rejected. Get yours at irs.gov/identity-theft-central.</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Refund Direct Deposit</CardTitle>
                <p className="text-xs text-muted-foreground">Optional - only needed if you expect a refund</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Routing Number</Label>
                    <Input
                      value={answers.bankRouting}
                      onChange={e => set("bankRouting", e.target.value.replace(/\D/g, "").slice(0,9))}
                      placeholder="9 digits"
                      className="bg-background font-mono"
                      maxLength={9}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Account Number</Label>
                    <Input
                      type="password"
                      value={answers.bankAccount}
                      onChange={e => set("bankAccount", e.target.value.replace(/\D/g, ""))}
                      placeholder="Account number"
                      className="bg-background font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Account Type</Label>
                    <Select value={answers.bankAccountType} onValueChange={v => set("bankAccountType", v)}>
                      <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="checking">Checking</SelectItem>
                        <SelectItem value="savings">Savings</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Pre-fills Form 1040 Lines 35b-35d for direct deposit. The IRS deposits refunds in 10-21 days for e-filed returns.</p>
              </CardContent>
            </Card>
          </div>
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
              {answers.has1099INT === "yes" && (
                <div className="ml-4 border-l-2 border-primary/30 pl-4 space-y-1.5">
                  <Label className="text-sm font-medium">Total interest income (all 1099-INT forms, Box 1)</Label>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input type="number" min={0} value={answers.amount1099INT} onChange={e => set("amount1099INT", e.target.value)} placeholder="0.00" className="pl-7 bg-background" /></div>
                  <p className="text-xs text-muted-foreground">Flows to Form 1040 Line 2b.</p>
                </div>
              )}

              {yesno("has1099DIV", "Dividends or investment income (1099-DIV)")}
              {answers.has1099DIV === "yes" && (
                <div className="ml-4 border-l-2 border-primary/30 pl-4 space-y-1.5">
                  <Label className="text-sm font-medium">Total ordinary dividends (Box 1a of all 1099-DIV forms)</Label>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input type="number" min={0} value={answers.amount1099DIV} onChange={e => set("amount1099DIV", e.target.value)} placeholder="0.00" className="pl-7 bg-background" /></div>
                  <p className="text-xs text-muted-foreground">Flows to Form 1040 Line 3b.</p>
                </div>
              )}

              {yesno("hasCapGains", "Capital gains or losses — stocks, crypto, or property sold (1099-B)")}
              {answers.hasCapGains === "yes" && (
                <div className="ml-4 border-l-2 border-primary/30 pl-4 space-y-1.5">
                  <Label className="text-sm font-medium">Net capital gain or (loss) from Schedule D, Line 21</Label>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input type="number" value={answers.amountCapGains} onChange={e => set("amountCapGains", e.target.value)} placeholder="0.00 (enter negative if net loss)" className="pl-7 bg-background" /></div>
                  <p className="text-xs text-muted-foreground">Flows to Form 1040 Line 7. Net losses limited to -$3,000/year; remainder carries forward.</p>
                </div>
              )}

              {yesno("hasSocialSecurity", "Social Security benefits (SSA-1099)")}
              {answers.hasSocialSecurity === "yes" && (
                <div className="ml-4 border-l-2 border-primary/30 pl-4 space-y-1.5">
                  <Label className="text-sm font-medium">Total SS benefits received (Box 3 of SSA-1099)</Label>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input type="number" min={0} value={answers.amountSocialSecurity} onChange={e => set("amountSocialSecurity", e.target.value)} placeholder="0.00" className="pl-7 bg-background" /></div>
                  <p className="text-xs text-muted-foreground">Up to 85% may be taxable depending on combined income. Flows to Form 1040 Line 6a.</p>
                </div>
              )}

              {yesno("hasIRADistributions", "IRA, 401(k), or pension distributions (1099-R)")}
              {answers.hasIRADistributions === "yes" && (
                <div className="ml-4 border-l-2 border-primary/30 pl-4 space-y-1.5">
                  <Label className="text-sm font-medium">Taxable amount distributed (Box 2a of 1099-R)</Label>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input type="number" min={0} value={answers.amountIRADistributions} onChange={e => set("amountIRADistributions", e.target.value)} placeholder="0.00" className="pl-7 bg-background" /></div>
                  <p className="text-xs text-muted-foreground">Flows to Form 1040 Line 4b or 5b. Early distributions (before age 59.5) may add a 10% penalty on Schedule 2.</p>
                </div>
              )}

              {yesno("hasRentalIncome", "Rental income from property you own")}
              {answers.hasRentalIncome === "yes" && (
                <div className="ml-4 border-l-2 border-primary/30 pl-4 space-y-1.5">
                  <Label className="text-sm font-medium">Net rental income after expenses (from Schedule E)</Label>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input type="number" value={answers.amountRentalIncome} onChange={e => set("amountRentalIncome", e.target.value)} placeholder="0.00 (negative if net loss)" className="pl-7 bg-background" /></div>
                  <p className="text-xs text-muted-foreground">Flows to Form 1040 Line 8 via Schedule E. Passive activity loss rules may limit deductible losses.</p>
                </div>
              )}

              {yesno("hasOtherIncome", "Other income (gambling, prizes, alimony pre-2019, etc.)")}
              {answers.hasOtherIncome === "yes" && (
                <div className="ml-4 border-l-2 border-primary/30 pl-4 space-y-1.5">
                  <Label className="text-sm font-medium">Total other income amount</Label>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input type="number" min={0} value={answers.amountOtherIncome} onChange={e => set("amountOtherIncome", e.target.value)} placeholder="0.00" className="pl-7 bg-background" /></div>
                  <p className="text-xs text-muted-foreground">Flows to Schedule 1 and then Form 1040 Line 8.</p>
                </div>
              )}

              {answers.hasW2 === "yes" && (
                <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-3 text-sm text-blue-800 dark:text-blue-300 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>Add your W-2 details in the W-2 Income section so we can calculate combined withholding and bracket interaction.</span>
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
