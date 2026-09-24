"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calculator, Info, MapPin } from "lucide-react";
import {
  STATE_REGISTRY_TAX_YEARS,
  US_STATES,
  businessTaxNotices,
  estimateStateTax,
  readProfileLocation,
  resolveStateCode,
  type StateFilingStatus,
  type StateTaxLine,
} from "@/lib/tax-rules/state";

interface StateTaxCalculatorScreenProps {
  user: { id: string; email?: string };
  userProfile?: Record<string, unknown> | null;
  onBack: () => void;
}

const FILING_STATUS_OPTIONS: { value: StateFilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_filing_jointly", label: "Married Filing Jointly" },
  { value: "married_filing_separately", label: "Married Filing Separately" },
  { value: "head_of_household", label: "Head of Household" },
];

const LATEST_YEAR = STATE_REGISTRY_TAX_YEARS[STATE_REGISTRY_TAX_YEARS.length - 1];

function parseAmount(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = parseFloat(value.replace(/[,$\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Tolerant version of the engine normalizer: unknown labels fall back to Single without throwing. */
function normalizeFilingStatus(value: unknown): StateFilingStatus {
  if (typeof value !== "string") return "single";
  const key = value.trim().toLowerCase().replace(/\s+/g, "_");
  return FILING_STATUS_OPTIONS.some(option => option.value === key) ? (key as StateFilingStatus) : "single";
}

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const pct = (n: number) => `${n.toFixed(2)}%`;
const sourceLabel = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

function AmountField({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="text" inputMode="numeric" placeholder="0" value={value} onChange={e => onChange(e.target.value.replace(/[^0-9]/g, ""))} className="min-h-11 text-base" />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function LineRows({ lines, negative }: { lines: readonly StateTaxLine[]; negative?: boolean }) {
  return (
    <>
      {lines.map(line => (
        <React.Fragment key={line.label}>
          <dt className="min-w-0 break-words text-muted-foreground">{line.label}</dt>
          <dd className="text-right tabular-nums">{negative || line.amount < 0 ? `(${fmt(Math.abs(line.amount))})` : fmt(line.amount)}</dd>
        </React.Fragment>
      ))}
    </>
  );
}

export function StateTaxCalculatorScreen({ userProfile }: StateTaxCalculatorScreenProps) {
  const profileLocation = useMemo(() => readProfileLocation(userProfile ?? null), [userProfile]);
  const profileStateCode = resolveStateCode(profileLocation.state);

  const [stateCode, setStateCode] = useState<string>("");
  const [taxYear, setTaxYear] = useState<string>(String(LATEST_YEAR));
  const [filingStatus, setFilingStatus] = useState<StateFilingStatus>(() => normalizeFilingStatus(userProfile?.filing_status));
  const [businessProfit, setBusinessProfit] = useState<string>(() => { const n = parseAmount(userProfile?.business_income); return n > 0 ? String(Math.round(n)) : ""; });
  const [wages, setWages] = useState<string>(() => { const n = parseAmount(userProfile?.w2_income); return n > 0 ? String(Math.round(n)) : ""; });
  const [otherIncome, setOtherIncome] = useState<string>("");

  useEffect(() => {
    if (profileStateCode) setStateCode(prev => prev || profileStateCode);
  }, [profileStateCode]);

  const profit = parseAmount(businessProfit);
  const w2Wages = parseAmount(wages);
  const other = parseAmount(otherIncome);
  const year = Number(taxYear);
  const hasInput = Boolean(stateCode) && profit + w2Wages + other > 0;

  const estimate = useMemo(() => hasInput
    ? estimateStateTax({ stateCode, taxYear: year, filingStatus, federalAGI: profit + w2Wages + other, scheduleCNetProfit: profit, w2Wages, otherIncome: other })
    : null, [hasInput, stateCode, year, filingStatus, profit, w2Wages, other]);

  const notices = useMemo(() => stateCode
    ? businessTaxNotices({ stateCode, city: profileStateCode === stateCode ? profileLocation.city : undefined, taxYear: year })
    : [], [stateCode, profileStateCode, profileLocation.city, year]);

  return (
    <div className="min-h-full bg-background">
      <div className="sticky top-0 z-50 border-b border-border bg-background">
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6 sm:py-4">
          <h1 className="text-lg font-semibold text-foreground sm:text-xl">State tax planning</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">Informational state planning estimate from state department of revenue parameters</p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl grid items-start gap-4 px-4 py-4 sm:px-6 lg:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Calculator className="h-5 w-5" />Your information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Select value={stateCode} onValueChange={setStateCode}>
                  <SelectTrigger className="min-h-11" id="state"><SelectValue placeholder="Select your state" /></SelectTrigger>
                  <SelectContent>
                    {US_STATES.map(s => (
                      <SelectItem key={s.code} value={s.code}>
                        <span className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />{s.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tax-year">Tax year</Label>
                <Select value={taxYear} onValueChange={setTaxYear}>
                  <SelectTrigger className="min-h-11" id="tax-year" aria-label="Tax year"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[...STATE_REGISTRY_TAX_YEARS].reverse().map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="filing">Filing status</Label>
              <Select value={filingStatus} onValueChange={v => setFilingStatus(v as StateFilingStatus)}>
                <SelectTrigger className="min-h-11" id="filing"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FILING_STATUS_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <AmountField id="business-profit" label="Business net profit ($)" value={businessProfit} onChange={setBusinessProfit} hint="Schedule C line 31" />
              <AmountField id="wages" label="W-2 wages ($)" value={wages} onChange={setWages} hint="Box 1" />
              <AmountField id="other-income" label="Other income ($)" value={otherIncome} onChange={setOtherIncome} hint="Interest, dividends, other" />
            </div>
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Federal AGI is approximated as the sum of these amounts; Schedule 1 adjustments are not applied here. The Tax overview uses your saved records instead.
            </p>
          </CardContent>
        </Card>

        {estimate && (
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base">{estimate.stateName} {estimate.taxYear} state planning estimate</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {!estimate.supported ? (
                <div role="status" className="rounded-lg border border-border bg-muted/40 p-4">
                  <p className="font-medium text-foreground">Not available</p>
                  <p className="mt-1 text-muted-foreground">{estimate.reason}</p>
                </div>
              ) : estimate.noIncomeTax ? (
                <div className="rounded-lg border border-border bg-muted/40 p-4">
                  <p className="font-medium text-foreground">No state income tax</p>
                  {estimate.notes.map(note => <p key={note} className="mt-1 text-muted-foreground">{note}</p>)}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-muted/50 p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Informational state planning estimate</p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{fmt(estimate.estimate)}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{pct(estimate.components.effectiveRate)} of federal AGI</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-4">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Marginal rate</p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{pct(estimate.components.marginalRate)}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">On the last dollar of state taxable income</p>
                    </div>
                  </div>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">Federal adjusted gross income</dt><dd className="text-right tabular-nums">{fmt(estimate.components.federalAGI)}</dd>
                    <LineRows lines={estimate.components.modifications} />
                    <dt className="font-medium text-foreground">State adjusted gross income</dt><dd className="text-right font-medium tabular-nums">{fmt(estimate.components.stateAGI)}</dd>
                    <LineRows lines={estimate.components.deductions} negative />
                    <dt className="font-medium text-foreground">State taxable income</dt><dd className="text-right font-medium tabular-nums">{fmt(estimate.components.taxableIncome)}</dd>
                    <LineRows lines={estimate.components.detail} />
                    <dt className="text-muted-foreground">Tax before credits</dt><dd className="text-right tabular-nums">{fmt(estimate.components.taxBeforeCredits)}</dd>
                    <LineRows lines={estimate.components.credits} negative />
                    <LineRows lines={estimate.components.additionalTaxes} />
                    <dt className="font-semibold text-foreground">Informational state planning estimate</dt><dd className="text-right font-semibold tabular-nums">{fmt(estimate.estimate)}</dd>
                  </dl>
                </>
              )}

              {estimate.supported && estimate.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-xs leading-relaxed text-amber-950 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100">
                  <p className="font-semibold">Not included in this estimate</p>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {estimate.warnings.map(warning => <li key={warning}>{warning}</li>)}
                  </ul>
                </div>
              )}

              <p className="text-xs leading-relaxed text-muted-foreground">
                Planning estimate only; it does not prepare a state return and is not combined with any federal amount.
                {estimate.sources.length > 0 && <> Sources: {estimate.sources.map((url, index) => <React.Fragment key={url}>{index > 0 ? ", " : ""}<a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{sourceLabel(url)}</a></React.Fragment>)}.</>}
              </p>
            </CardContent>
          </Card>
        )}

        {notices.length > 0 && (
          <Card className="border-border bg-card lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Separate business taxes to review</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs leading-relaxed text-muted-foreground">
              <p>Informational only, based on the selected state{profileLocation.city && profileStateCode === stateCode ? ` and the city saved in Settings (${profileLocation.city})` : ""}. Nothing here is calculated.</p>
              {notices.map(notice => (
                <div key={notice.id} className="space-y-1">
                  <p className="font-medium text-foreground">{notice.title}</p>
                  <p>{notice.summary}</p>
                  <p>Sources: {notice.sources.map((source, index) => <React.Fragment key={source.url}>{index > 0 ? ", " : ""}<a href={source.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{sourceLabel(source.url)}</a></React.Fragment>)}.</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default StateTaxCalculatorScreen;
