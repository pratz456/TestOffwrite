"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Shield, CheckCircle2, AlertCircle, Loader2,
  FileText, Lock, Eye, EyeOff, Info,
} from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

interface Props {
  user: { id: string; email?: string };
  onBack: () => void;
  onNavigate?: (screen: string) => void;
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export function Form8879Screen({ user, onBack, onNavigate }: Props) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<any>(null);
  const [taxData, setTaxData] = useState<any>(null);
  const [showPin, setShowPin] = useState(false);
  const [signed, setSigned] = useState(false);

  const [form, setForm] = useState({
    taxpayerName: "",
    pin: "",
    consentToEFile: false,
    consentToDisclosure: false,
  });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [authRes, taxRes] = await Promise.all([
        makeAuthenticatedRequest(`/api/tax/form-8879?year=${year}`),
        makeAuthenticatedRequest(`/api/tax/compute-1040?year=${year}`),
      ]);
      if (authRes.ok) {
        const d = await authRes.json();
        setExisting(d.authorization);
        if (d.authorization?.taxpayerName) {
          setForm(p => ({ ...p, taxpayerName: d.authorization.taxpayerName }));
        }
      }
      if (taxRes.ok) setTaxData(await taxRes.json());
    } catch { setError("Failed to load tax data"); }
    finally { setLoading(false); }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const handleSign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.pin || form.pin.length !== 5 || !/^\d+$/.test(form.pin)) {
      setError("PIN must be exactly 5 digits"); return;
    }
    if (form.pin === "00000") { setError("PIN cannot be all zeros"); return; }
    if (!form.consentToEFile || !form.consentToDisclosure) {
      setError("You must check both consent boxes to proceed"); return;
    }
    if (!form.taxpayerName.trim()) { setError("Your name is required"); return; }

    setSaving(true); setError(null);
    try {
      const f1040 = taxData?.form1040 || {};
      const res = await makeAuthenticatedRequest("/api/tax/form-8879", {
        method: "POST",
        body: JSON.stringify({
          taxYear: parseInt(year),
          taxpayerName: form.taxpayerName.trim(),
          selfSelectPin: form.pin,
          adjustedGrossIncome: f1040.agi || 0,
          totalTax: f1040.totalTax || 0,
          federalIncomeTaxWithheld: f1040.w2FederalWithheld || 0,
          refundAmount: f1040.refund || 0,
          amountOwed: f1040.balanceDue || 0,
          consentToEFile: true,
          consentToDisclosure: true,
        }),
      });
      if (!res.ok) { let m = "Failed to authorize"; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
      setSigned(true);
      load(); // Refresh to show signed status
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save authorization");
    } finally { setSaving(false); }
  };

  const f1040 = taxData?.form1040;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold text-foreground">Form 8879 — PIN Consent</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Store your PIN for later partner filing. WriteOff does not e-file.</p>
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
        {/* Already signed banner */}
        {(existing?.status === "signed" || signed) && (
          <div className="flex items-start gap-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50/60 dark:bg-green-950/30 px-4 py-3">
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                Form 8879 consent saved for {year}
              </p>
              <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                {existing?.signedAt
                  ? `Saved on ${new Date(existing.signedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
                  : "Consent saved"
                }
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {/* What this is */}
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20">
              <CardContent className="p-4 flex items-start gap-3">
                <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div className="text-xs text-blue-800 dark:text-blue-300 space-y-1">
                  <p className="font-semibold text-sm">What is Form 8879?</p>
                  <p>Form 8879 is the IRS e-file signature authorization. WriteOff stores your PIN and consent here so they can be used later if you file through a partner such as TurboTax or Column Tax. WriteOff prepares and exports your return — it does not transmit to the IRS today.</p>
                  <p>By saving this form, you confirm the return summary is correct and consent to store your 5-digit self-selected PIN. Treat it like a password. A filing partner uses this PIN if they e-file on your behalf.</p>
                  <a href="https://www.irs.gov/forms-pubs/about-form-8879" target="_blank" rel="noopener noreferrer" className="underline font-medium">IRS Form 8879 instructions →</a>
                </div>
              </CardContent>
            </Card>

            {/* Return summary to review before signing */}
            {f1040 && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary" />
                    Return Summary - {year}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">Verify these numbers match your records before signing.</p>
                </CardHeader>
                <CardContent className="space-y-2 pt-0">
                  {[
                    { label: "Adjusted Gross Income (Line 11)", value: fmt(f1040.agi || 0) },
                    { label: "Total Tax (Line 24)", value: fmt(f1040.totalTax || 0) },
                    { label: "Federal Tax Withheld (W-2 Box 2)", value: fmt(f1040.w2FederalWithheld || 0) },
                    { label: "Estimated Tax Payments Made", value: fmt(f1040.estimatedPayments || 0) },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center py-1.5 border-b border-border/50 last:border-0">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      <span className="text-sm font-semibold tabular-nums">{value}</span>
                    </div>
                  ))}
                  <div className={`flex justify-between items-center py-2 rounded-lg px-3 mt-1 ${f1040.refund > 0 ? "bg-green-50 dark:bg-green-950/30" : "bg-orange-50 dark:bg-orange-950/30"}`}>
                    <span className={`text-sm font-semibold ${f1040.refund > 0 ? "text-green-800 dark:text-green-300" : "text-orange-800 dark:text-orange-300"}`}>
                      {f1040.refund > 0 ? "Estimated Refund (Line 35a)" : "Amount Owed (Line 37)"}
                    </span>
                    <span className={`text-sm font-bold tabular-nums ${f1040.refund > 0 ? "text-green-700 dark:text-green-400" : "text-orange-700 dark:text-orange-400"}`}>
                      {fmt(f1040.refund > 0 ? f1040.refund : f1040.balanceDue || 0)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Signature form */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  Your PIN and Consent
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSign} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">Your full legal name *</Label>
                    <Input
                      value={form.taxpayerName}
                      onChange={e => setForm(p => ({ ...p, taxpayerName: e.target.value }))}
                      placeholder="As it appears on your Social Security card"
                      className="bg-background"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5" />
                      Self-Select PIN (5 digits) *
                    </Label>
                    <div className="relative">
                      <Input
                        type={showPin ? "text" : "password"}
                        value={form.pin}
                        onChange={e => {
                          const v = e.target.value.replace(/\D/g, "").slice(0, 5);
                          setForm(p => ({ ...p, pin: v }));
                        }}
                        placeholder="Choose any 5 digits (not 00000)"
                        className="bg-background pr-10"
                        maxLength={5}
                        pattern="\d{5}"
                        required
                      />
                      <Button
                        type="button" variant="ghost" size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                        onClick={() => setShowPin(!showPin)}
                      >
                        {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This PIN is your electronic signature. Choose any 5-digit number you will remember. Do not share it.
                    </p>
                  </div>

                  {/* Declaration text */}
                  <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                    <p className="text-xs font-medium text-foreground">Declaration and Consent</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Under penalties of perjury, I declare that I have examined a copy of my electronic individual income tax return and accompanying schedules and statements for the tax year shown above, and to the best of my knowledge and belief, it is true, correct, and complete.
                    </p>

                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.consentToDisclosure}
                        onChange={e => setForm(p => ({ ...p, consentToDisclosure: e.target.checked }))}
                        className="mt-0.5 w-4 h-4 rounded border-border"
                      />
                      <span className="text-xs text-foreground">
                        I have reviewed and verified the return summary above. I understand WriteOff prepares and exports my return and does not transmit it to the IRS.
                      </span>
                    </label>

                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.consentToEFile}
                        onChange={e => setForm(p => ({ ...p, consentToEFile: e.target.checked }))}
                        className="mt-0.5 w-4 h-4 rounded border-border"
                      />
                      <span className="text-xs text-foreground">
                        I consent to store this PIN as local consent for later partner filing (TurboTax, Column Tax, or another authorized e-file provider). WriteOff does not e-file my {year} federal return today.
                      </span>
                    </label>
                  </div>

                  <Button
                    type="submit"
                    disabled={saving || !form.taxpayerName.trim() || form.pin.length !== 5 || !form.consentToEFile || !form.consentToDisclosure}
                    className="w-full min-h-[48px] gap-2 text-base font-semibold"
                  >
                    {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Shield className="w-5 h-5" />}
                    {saving ? "Saving consent…" : existing?.status === "signed" ? "Update PIN Consent" : "Save PIN and Consent"}
                  </Button>

                  <p className="text-xs text-center text-muted-foreground">
                    Your PIN and consent are stored securely in WriteOff. This is local consent for later partner filing — not authorization for WriteOff to transmit to the IRS.
                  </p>
                </form>
              </CardContent>
            </Card>

            {/* Next step */}
            {(existing?.status === "signed" || signed) && onNavigate && (
              <Button variant="outline" onClick={() => onNavigate("tax-filing-hub")} className="w-full gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Return to Filing Hub
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default Form8879Screen;
