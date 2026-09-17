"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronRight, ChevronLeft, CheckCircle2, Loader2, Save } from "lucide-react";
import { PersonalDeductionFields } from "@/components/personal-deduction-fields";
import { SocialSecurityFields, EMPTY_SOCIAL_SECURITY_ANSWERS, type SocialSecurityAnswers } from "@/components/tax-organizer-social-security";
import { BusinessLossFields } from "@/components/business-loss-fields";
import { OBBBADeductionFields } from "@/components/obbba-deduction-fields";
import { NON_ITEMIZER_CHARITY_FIRST_YEAR, SCHEDULE_1A_FIRST_YEAR, SCHEDULE_1A_LAST_YEAR } from "@/lib/tax-rules/obbba-deductions";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

interface Props { user: { id: string; email?: string }; onBack: () => void; onNavigate?: (screen: string) => void; }

const FILING_STATUSES = [
  { value: "single", label: "Single" },
  { value: "married_filing_jointly", label: "Married Filing Jointly" },
  { value: "married_filing_separately", label: "Married Filing Separately" },
  { value: "head_of_household", label: "Head of Household" },
];

interface OrgAnswers extends SocialSecurityAnswers {
  personalDeductionFacts: string;
  /** JSON declarations for a Schedule C loss year (business-loss-fields.tsx). */
  businessLossFacts: string;
  /** JSON Schedule 1-A / §170(p) intake (obbba-deduction-fields.tsx). */
  obbbaDeductionFacts: string;
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
  /** Legacy combined Schedule D line 16 total; kept equal to the split below when both are entered. */
  amountCapGains: string;
  amountShortTermCapGains: string;
  amountLongTermCapGains: string;
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

export const EMPTY_ORGANIZER_ANSWERS: OrgAnswers = {
  ...EMPTY_SOCIAL_SECURITY_ANSWERS,
  personalDeductionFacts: "", businessLossFacts: "", obbbaDeductionFacts: "",
  filingStatus:"",dateOfBirth:"",taxpayerSSN:"",spouseName:"",spouseDoB:"",spouseSSN:"",dependents:"0",dependentDetails:"",streetAddress:"",city:"",stateAddr:"",zipCode:"",priorYearAGI:"",bankRouting:"",bankAccount:"",bankAccountType:"checking",ipPin:"",
  hasW2:"",hasSEIncome:"yes",has1099K:"",has1099INT:"",amount1099INT:"",has1099DIV:"",amount1099DIV:"",hasCapGains:"",amountCapGains:"",amountShortTermCapGains:"",amountLongTermCapGains:"",hasSocialSecurity:"",amountSocialSecurity:"",hasIRADistributions:"",amountIRADistributions:"",hasRentalIncome:"",amountRentalIncome:"",hasOtherIncome:"",amountOtherIncome:"",
  paidHealthInsurance:"",healthInsurancePremium:"",madeRetirementContrib:"",retirementAmount:"",retirementType:"sep_ira",
  paidStudentLoanInterest:"",studentLoanInterest:"",paidHSA:"",hsaAmount:"",hasHomeMortgage:"",
  marriedThisYear:"",hadChild:"",boughtHome:"",soldHome:"",startedBusiness:"",
  priorYearTax:"",madeQuarterlyPayments:"",quarterlyTotal:"",
};

const EMPTY = EMPTY_ORGANIZER_ANSWERS;

const readOrganizerYear = async (targetYear: number): Promise<OrgAnswers> => {
    const res = await makeAuthenticatedRequest(`/api/tax/organizer?year=${targetYear}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load the organizer. Please retry.');
    if (data.taxYear !== targetYear || (data.organizer !== null && (!data.organizer || typeof data.organizer !== 'object' || Array.isArray(data.organizer)))) {
      throw new Error('The organizer response did not match the selected year. Please retry.');
    }
    return { ...EMPTY, ...(data.organizer || {}) };
  };

const STEPS = ["Personal facts", "Income", "Deductions", "Life events", "Prior year"];

export function TaxOrganizerScreen({ user }: Props) {
  const [year, setYear] = useState(Math.min(2026, Math.max(2024, new Date().getFullYear())));
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<OrgAnswers>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [switchingYear, setSwitchingYear] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const loadedKey = useRef<string | null>(null);
  const baseline = useRef('');
  const savePending = useRef(false);
  const switchPending = useRef(false);
  const currentOwner = useRef(user.id);
  currentOwner.current = user.id;

  const set = (k: keyof OrgAnswers, v: string) => {
    if (savePending.current || switchPending.current) return;
    setAnswers(p => ({ ...p, [k]: v })); setSaved(false);
  };
  const load = useCallback(async () => {
    const key = `${user.id}:${year}`;
    if (loadedKey.current === key) return;
    const operation = ++revision.current;
    setLoading(true); setError(null);
    try {
      const nextAnswers = await readOrganizerYear(year);
      if (revision.current !== operation || currentOwner.current !== user.id) return;
      setAnswers(nextAnswers); baseline.current = JSON.stringify(nextAnswers);
      loadedKey.current = key; setLoadFailed(false); setSaved(false);
    } catch (err) {
      if (revision.current !== operation) return;
      setLoadFailed(true); setError(err instanceof Error ? err.message : 'Could not load the organizer. Please retry.');
    } finally { if (revision.current === operation) setLoading(false); }
  }, [year, user.id]);

  useEffect(() => {
    void load();
    // This is an operation counter, not a DOM ref: cleanup must invalidate the
    // latest retry as well as the first request started by this effect.
    const operationCounter = revision;
    return () => { operationCounter.current++; };
  }, [load]);

  const save = async (): Promise<boolean> => {
    if (savePending.current || loading || loadFailed || loadedKey.current !== `${user.id}:${year}`) return false;
    savePending.current = true; setSaving(true); setError(null);
    const operation = revision.current;
    const savedAnswers = JSON.stringify(answers);
    try {
      const res = await makeAuthenticatedRequest('/api/tax/organizer', { method: 'POST', body: JSON.stringify({ ...answers, taxYear: year }) });
      if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Could not save the organizer. Your edits remain on this page.'); }
      if (revision.current !== operation || currentOwner.current !== user.id) return false;
      baseline.current = savedAnswers; setSaved(true); return true;
    } catch (err) {
      if (revision.current === operation) setError(err instanceof Error ? err.message : 'Could not save the organizer. Your edits remain on this page.');
      return false;
    } finally { savePending.current = false; setSaving(false); }
  };
  const changeYear = async (nextYear: number) => {
    if (![2024, 2025, 2026].includes(nextYear) || nextYear === year || switchPending.current || savePending.current) return;
    switchPending.current = true; setSwitchingYear(true); setError(null);
    const operation = revision.current;
    try {
      if (JSON.stringify(answers) !== baseline.current && !await save()) return;
      const nextAnswers = await readOrganizerYear(nextYear);
      if (revision.current !== operation || currentOwner.current !== user.id) return;
      loadedKey.current = `${user.id}:${nextYear}`; baseline.current = JSON.stringify(nextAnswers);
      setAnswers(nextAnswers); setYear(nextYear); setStep(0); setSaved(false);
    } catch (err) {
      if (revision.current === operation) setError(`Still showing ${year}. ${err instanceof Error ? err.message : 'Could not open the other year. Please retry.'}`);
    } finally { switchPending.current = false; setSwitchingYear(false); }
  };
  const next = async () => { if (await save() && step < STEPS.length - 1) setStep(s => s + 1); };
  const prev = () => setStep(s => s - 1);

  const yesno = (key: keyof OrgAnswers, label: string) => (
    <div role="group" aria-label={label} className="flex items-center justify-between gap-3 py-1">
      <span className="min-w-0 text-sm font-medium leading-snug">{label}</span>
      <div className="flex shrink-0 gap-1">
        {["yes", "no"].map(value => (
          <Button key={value} type="button" aria-pressed={answers[key] === value}
            variant={answers[key] === value ? "default" : "outline"} size="sm"
            onClick={() => set(key, value)} className="min-h-[44px] min-w-[44px] px-3 capitalize">{value}</Button>
        ))}
      </div>
    </div>
  );
  const incomeSummary = (keys: (keyof OrgAnswers)[]) => {
    const selected = keys.filter(key => answers[key] === 'yes').length;
    const unanswered = keys.filter(key => !answers[key]).length;
    return [selected ? `${selected} selected` : '', unanswered ? `${unanswered} to review` : ''].filter(Boolean).join(' · ') || 'No sources selected';
  };
  /** Summary line for a JSON facts field saved for the open year; other years count as unanswered. */
  const factsSummary = (raw: string, keys: string[], noun: string) => {
    let facts: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(raw || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as { taxYear?: unknown }).taxYear === year) facts = parsed as Record<string, unknown>;
    } catch { /* Malformed records read as unanswered. */ }
    const selected = keys.filter(key => facts[key] === 'yes').length;
    const unanswered = keys.filter(key => facts[key] !== 'yes' && facts[key] !== 'no').length;
    return [selected ? `${selected} ${noun}` : '', unanswered ? `${unanswered} to review` : ''].filter(Boolean).join(' · ') || 'Reviewed';
  };
  /** Writes one Schedule D character amount and keeps the legacy combined total consistent with the split. */
  const setCapitalGain = (key: 'amountShortTermCapGains' | 'amountLongTermCapGains', value: string) => {
    const other = answers[key === 'amountShortTermCapGains' ? 'amountLongTermCapGains' : 'amountShortTermCapGains'].trim();
    const valid = (text: string) => /^-?\d+(?:\.\d{1,2})?$/.test(text);
    const combined = valid(value.trim()) && valid(other) ? String(Math.round((Number(value) + Number(other)) * 100) / 100) : '';
    set(key, value); set('amountCapGains', combined);
  };
  const legacyCapitalGainOnly = !!answers.amountCapGains.trim() && !answers.amountShortTermCapGains.trim() && !answers.amountLongTermCapGains.trim();
  const disclosure = (title: string, summary: string, children: React.ReactNode) => (
    <details key={`${year}:${title}`} className="group rounded-xl border border-border bg-card">
      <summary className="flex min-h-[60px] cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-muted-foreground">{summary}</span></span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-border p-4">{children}</div>
    </details>
  );

  if (loading || (!loadFailed && loadedKey.current !== `${user.id}:${year}`)) return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

  if (loadFailed) return <div role="alert" className="mx-auto max-w-2xl space-y-3 p-6"><p>{error}</p><Button onClick={() => void load()}>Retry organizer</Button></div>;

  return (
    <div className="min-h-full bg-background">
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2 sm:px-6">
          <h1 className="min-w-0 flex-1 text-lg font-semibold">Tax organizer</h1>
          <select aria-label="Organizer tax year" value={year} disabled={saving || switchingYear}
            onChange={event => void changeYear(Number(event.target.value))}
            className="min-h-[44px] rounded-lg border bg-background px-2 text-base">
            {[2026, 2025, 2024].map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <Button onClick={save} disabled={saving || switchingYear} variant="outline" size="sm" className="min-h-[44px] gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Save className="h-4 w-4" />}
            {saved ? "Saved" : "Save"}
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-3 px-4 py-3 sm:px-6">
        {error && <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
        <div className="flex items-center gap-3">
          <select aria-label="Organizer section" value={step} disabled={saving || switchingYear}
            onChange={event => setStep(Number(event.target.value))}
            className="min-h-[44px] min-w-0 flex-1 rounded-lg border bg-background px-3 text-base font-medium">
            {STEPS.map((title, index) => <option key={title} value={index}>{index + 1}. {title}</option>)}
          </select>
          <span className="shrink-0 text-xs text-muted-foreground">{step + 1} of {STEPS.length}</span>
        </div>
        {switchingYear && <p role="status" className="text-sm">Saving changes and opening the selected year…</p>}
        <fieldset disabled={saving || switchingYear} className="space-y-3 [&_input]:min-h-[44px] [&_input]:text-base [&_select]:min-h-[44px] [&_select]:text-base [&_button[role=combobox]]:min-h-[44px] [&_button[role=combobox]]:text-base">
        {/* STEP 0: Personal Info */}
        {step === 0 && (
          <div className="space-y-3">
            <Card className="border-border bg-card">
              <CardContent className="space-y-3 p-4">
                <div className="space-y-1.5">
                  <Label htmlFor="organizer-filing-status" className="text-sm font-medium">Filing Status *</Label>
                  <select id="organizer-filing-status" value={answers.filingStatus} onChange={event => set("filingStatus", event.target.value)} className="min-h-[44px] w-full rounded-lg border border-input bg-background px-3 py-2 text-base">
                    <option value="">Select filing status</option>
                    {FILING_STATUSES.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5 pt-2 border-t border-border">
                  <Label htmlFor="organizer-dependents" className="text-sm font-medium">Number of Dependents</Label>
                  <select id="organizer-dependents" value={answers.dependents} onChange={event => set("dependents", event.target.value)} className="min-h-[44px] w-full rounded-lg border border-input bg-background px-3 py-2 text-base">
                    {["0", "1", "2", "3", "4", "5+"].map(count => <option key={count} value={count}>{count}</option>)}
                  </select>
                  {parseInt(answers.dependents) > 0 && <p className="text-xs text-muted-foreground">Dependent credits require review before an annual total or refund is available.</p>}
                </div>
              </CardContent>
            </Card>
            {disclosure("Deduction eligibility", "Required for your estimate · review every answer", (
              <div className="[&_section]:border-0 [&_section]:p-0">
                <PersonalDeductionFields taxYear={year} filingStatus={answers.filingStatus} answers={answers} onChange={set} />
              </div>
            ))}
            {disclosure("Accountant handoff", "Optional · identity, address & refund records", (
              <>
                <p className="text-xs text-muted-foreground">WriteOff does not submit tax returns or arrange refunds. These optional records may appear in your export. Review before sharing.</p>
                <Card className="border-border bg-card">
                  <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Identity records</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Your Social Security Number (optional)</Label>
                    <Input
                      type="password"
                      value={answers.taxpayerSSN}
                      onChange={e => set("taxpayerSSN", e.target.value.replace(/\D/g, "").slice(0, 9))}
                      placeholder="9 digits, no dashes"
                      className="bg-background font-mono"
                      maxLength={9}
                    />
                    <p className="text-xs text-muted-foreground">Optional for the planning estimate. Included in your exported identity information when provided.</p>
                  </div>
                </div>

                {answers.filingStatus === "married_filing_jointly" && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-border">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Spouse Full Name (optional)</Label>
                      <Input value={answers.spouseName} onChange={e => set("spouseName", e.target.value)} placeholder="Legal name" className="bg-background" />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Spouse SSN (optional)</Label>
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

                  {parseInt(answers.dependents) > 0 && (
                    <div className="mt-2 space-y-1.5">
                      <Label className="text-sm font-medium">Dependent Names and SSNs</Label>
                      <textarea
                        value={answers.dependentDetails}
                        onChange={e => set("dependentDetails", e.target.value)}
                        placeholder={"List each dependent on a new line:\nFirst Last, SSN, Date of Birth, Relationship\nExample: Emma Shah, 123-45-6789, 2018-03-15, Daughter"}
                        className="w-full min-h-[96px] text-base rounded-lg border border-border bg-background px-3 py-2 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <p className="text-xs text-muted-foreground">Keep these optional records for your tax preparer. A dependent count or this text does not establish credit eligibility; dependent credits require review before WriteOff can show an annual total or refund.</p>
                    </div>
                  )}
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
                <CardTitle className="text-sm font-semibold">Filing reference records</CardTitle>
                <p className="text-xs text-muted-foreground">Reference records for your tax preparer; WriteOff does not e-file returns.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Prior Year AGI (Form 1040)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      type="number"
                      value={answers.priorYearAGI}
                      onChange={e => set("priorYearAGI", e.target.value)}
                      placeholder="From last year's return"
                      className="pl-7 bg-background"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Use the actual adjusted gross income from your prior-year return (line 11 on 2024; line 11a on 2025). Do not replace it with zero because that was your first return. If you did not file, ask your preparer how to complete their filing verification.</p>
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
                  <p className="text-xs text-muted-foreground">If the IRS assigned you an IP PIN, confirm the current PIN with your tax preparer. This optional record does not authorize WriteOff to file a return.</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Refund account record</CardTitle>
                <p className="text-xs text-muted-foreground">Optional information to review with your tax preparer.</p>
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
                <p className="text-xs text-muted-foreground">These details may appear in your PDF export. Verify them with your preparer; WriteOff does not submit refund instructions or predict IRS refund timing.</p>
              </CardContent>
            </Card>
              </>
            ))}
          </div>
        )}

        {/* STEP 1: Income */}
        {step === 1 && (
          <Card className="bg-card border-border">
            <CardContent className="p-4 space-y-3">
              <p className="text-sm text-muted-foreground">Review your income for {year}. Blank answers still need review.</p>
              {yesno("hasSEIncome", "Freelance or self-employment income (including cash)")}
              {yesno("hasW2", "W-2 wages from an employer")}
              {yesno("has1099K", "Platform payments (1099-K)")}
              {answers.hasSEIncome === "yes" && disclosure("Business loss facts", `Only for a Schedule C loss year · ${factsSummary(answers.businessLossFacts, ["allInvestmentAtRisk", "materialParticipation", "profitMotive"], "answered yes")}`, (
                <div className="[&_section]:border-0 [&_section]:p-0">
                  <BusinessLossFields taxYear={year} value={answers.businessLossFacts} onChange={value => set("businessLossFacts", value)} />
                </div>
              ))}

              {disclosure("Savings & investments", incomeSummary(["has1099INT", "has1099DIV", "hasCapGains"]), (<>
              {yesno("has1099INT", "Bank interest income (1099-INT)")}
              {answers.has1099INT === "yes" && (
                <div className="ml-4 border-l-2 border-primary/30 pl-4 space-y-1.5">
                  <Label className="text-sm font-medium">Taxable interest (Form1040 line2b, after any savings-bond exclusion)</Label>
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
              {(answers.hasCapGains === "yes" || legacyCapitalGainOnly) && (
                <div className="ml-4 border-l-2 border-primary/30 pl-4 space-y-3">
                  {legacyCapitalGainOnly && (
                    <p role="alert" className="text-sm">{`A combined total of $${answers.amountCapGains} was saved earlier. Enter the short-term and long-term amounts separately; the estimate no longer assumes a combined total is long-term.`}</p>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="organizer-short-term-gains" className="text-sm font-medium">Net short-term capital gain or (loss) — Schedule D line 7</Label>
                    <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input id="organizer-short-term-gains" type="number" step="0.01" value={answers.amountShortTermCapGains} onChange={e => setCapitalGain("amountShortTermCapGains", e.target.value)} placeholder="0.00 (negative if net loss; enter 0 when none)" className="pl-7 bg-background" /></div>
                    <p className="text-xs text-muted-foreground">Assets held one year or less. Taxed as ordinary income.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="organizer-long-term-gains" className="text-sm font-medium">Net long-term capital gain or (loss) — Schedule D line 15</Label>
                    <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input id="organizer-long-term-gains" type="number" step="0.01" value={answers.amountLongTermCapGains} onChange={e => setCapitalGain("amountLongTermCapGains", e.target.value)} placeholder="0.00 (negative if net loss; enter 0 when none)" className="pl-7 bg-background" /></div>
                    <p className="text-xs text-muted-foreground">Assets held more than one year; net gains use the 0%/15%/20% rates. Blank is unanswered, not 0.</p>
                  </div>
                  <p className="text-xs text-muted-foreground">The combined result flows to Form 1040 line 7. A net loss offsets at most $3,000 of other income per year ($1,500 married filing separately); the rest carries forward and needs review. Collectibles, unrecaptured section 1250 gain and prior-year carryovers are not calculated.</p>
                </div>
              )}

              </>))}

              {disclosure("Social Security & retirement", incomeSummary(["hasSocialSecurity", "hasIRADistributions"]), (<>
              {yesno("hasSocialSecurity", "Social Security benefits (SSA-1099)")}
              {answers.hasSocialSecurity === "yes" && (
                <div className="ml-4 border-l-2 border-primary/30 pl-4 space-y-1.5">
                  <Label className="text-sm font-medium">Benefits paid (SSA-1099 Box 3, for your records)</Label>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input type="number" min={0} value={answers.amountSocialSecurity} onChange={e => set("amountSocialSecurity", e.target.value)} placeholder="0.00" className="pl-7 bg-background" /></div>
                  <SocialSecurityFields answers={answers} set={set} filingStatus={answers.filingStatus} hasRetirementIncome={answers.hasIRADistributions === "yes" || !!Number(answers.amountIRADistributions)} />
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

              </>))}

              {disclosure("Rental & other income", incomeSummary(["hasRentalIncome", "hasOtherIncome"]), (<>
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

              </>))}

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
            <CardContent className="p-4 space-y-3">
              <p className="text-sm text-muted-foreground">Enter amounts paid. Eligibility and limits still require review.</p>
              {yesno("paidHealthInsurance", "Health insurance you paid for (not through an employer)")}
              {answers.paidHealthInsurance === "yes" && (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Total health insurance premiums paid in {year} ($)</Label>
                  <Input type="number" min="0" step="0.01" value={answers.healthInsurancePremium} onChange={e => set("healthInsurancePremium", e.target.value)} placeholder="e.g. 7200" className="bg-background" />
                </div>
              )}
              {yesno("madeRetirementContrib", "Retirement contributions (SEP-IRA, Solo 401(k), SIMPLE IRA)")}
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
              {yesno("paidStudentLoanInterest", "Student loan interest paid")}
              {answers.paidStudentLoanInterest === "yes" && (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Student loan interest paid ($)</Label>
                  <Input type="number" min="0" step="0.01" value={answers.studentLoanInterest} onChange={e => set("studentLoanInterest", e.target.value)} placeholder="Amount paid" className="bg-background" />
                </div>
              )}
              {yesno("paidHSA", "HSA contributions")}
              {answers.paidHSA === "yes" && (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">HSA contributions in {year} ($)</Label>
                  <Input type="number" min="0" step="0.01" value={answers.hsaAmount} onChange={e => set("hsaAmount", e.target.value)} placeholder="0.00" className="bg-background" />
                </div>
              )}
              {yesno("hasHomeMortgage", "Home mortgage interest")}
              {disclosure("Working Families Tax Cuts deductions", year >= SCHEDULE_1A_FIRST_YEAR && year <= SCHEDULE_1A_LAST_YEAR
                ? `Tips, overtime, vehicle loan interest${year >= NON_ITEMIZER_CHARITY_FIRST_YEAR ? ", charitable gifts" : ""} · ${factsSummary(answers.obbbaDeductionFacts, ["hasQualifiedTips", "hasW2Overtime", "hasVehicleLoanInterest", ...(year >= NON_ITEMIZER_CHARITY_FIRST_YEAR ? ["hasNonItemizerCharity"] : [])], "claimed")}`
                : `Apply to ${SCHEDULE_1A_FIRST_YEAR}–${SCHEDULE_1A_LAST_YEAR} returns only`, (
                <div className="[&_section]:border-0 [&_section]:p-0">
                  <OBBBADeductionFields taxYear={year} filingStatus={answers.filingStatus} value={answers.obbbaDeductionFacts} onChange={value => set("obbbaDeductionFacts", value)} />
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* STEP 3: Life Events */}
        {step === 3 && (
          <Card className="bg-card border-border">
            <CardContent className="p-4 space-y-3">
              <p className="text-sm text-muted-foreground">Review changes in {year} that may affect your return.</p>
              {yesno("marriedThisYear", "Married or divorced")}
              {yesno("hadChild", "Had or adopted a child")}
              {yesno("boughtHome", "Bought a home")}
              {yesno("soldHome", "Sold a home")}
              {yesno("startedBusiness", "Started or acquired a business")}
            </CardContent>
          </Card>
        )}

        {/* STEP 4: Prior Year */}
        {step === 4 && (
          <Card className="bg-card border-border">
            <CardContent className="p-4 space-y-3">
              <p className="text-sm text-muted-foreground">Keep prior-year records for your preparer. Quarterly payment planning separately requires review of prior-year tax, AGI and eligibility facts.</p>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Prior year total tax ({year - 1} Form 1040, Line 24)</Label>
                <Input type="number" min="0" step="0.01" value={answers.priorYearTax} onChange={e => set("priorYearTax", e.target.value)} placeholder="e.g. 8500" className="bg-background" />
                <p className="text-xs text-muted-foreground">A prior-year tax amount alone does not establish a safe-harbor payment amount.</p>
              </div>
              {yesno("madeQuarterlyPayments", `Did you make estimated tax payments in ${year}?`)}
              {answers.madeQuarterlyPayments === "yes" && (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Total quarterly payments made in {year} ($)</Label>
                  <Input type="number" min="0" step="0.01" value={answers.quarterlyTotal} onChange={e => set("quarterlyTotal", e.target.value)} placeholder="Sum of all 4 payments" className="bg-background" />
                </div>
              )}
              <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 px-4 py-3 text-sm text-green-800 dark:text-green-300">
                <p className="font-medium mb-1">Review and save your records</p>
                <p>Your answers support the deductions and estimates currently available in WriteOff. Some situations still require tax review. Save your changes, then review the calculation and any messages before using an export.</p>
              </div>
            </CardContent>
          </Card>
        )}

        </fieldset>
        {/* Navigation */}
        <div className="sticky bottom-0 z-10 flex gap-3 border-t bg-background/95 py-3 backdrop-blur">
          {step > 0 && (
            <Button variant="outline" disabled={saving || switchingYear} onClick={prev} className="flex-1 gap-2 min-h-[44px]"><ChevronLeft className="w-4 h-4" />Back</Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button onClick={next} disabled={saving || switchingYear} className="flex-1 gap-2 min-h-[44px]">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Next<ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={save} disabled={saving || switchingYear} className="flex-1 gap-2 min-h-[44px]">
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
