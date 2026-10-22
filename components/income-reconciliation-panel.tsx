"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";
import {
  DECISION_LABELS, INCOME_SOURCE_KINDS, RECONCILIATION_DECISION_TYPES, SOURCE_KIND_LABELS, samePaymentsAllowed, sourceKey, toCents, validateReconciliationDecision,
  type IncomeSourceCandidate, type IncomeSourceKind, type NotBusinessPart, type PaymentMethodHint, type ReconciliationDecisionType,
} from "@/lib/tax-rules/income-reconciliation";
import {
  DECISION_HELP_NOT_BUSINESS, DECISION_LABEL_NOT_BUSINESS, ERR_REASON_AMOUNT, GUIDE_ANSWER_APP, GUIDE_ANSWER_BANK, GUIDE_ANSWER_NOT_SURE,
  GUIDE_HINT_APP, GUIDE_HINT_BANK, GUIDE_HINT_NOT_SURE, GUIDE_QUESTION, LEGACY_RECONFIRM_BODY, LEGACY_RECONFIRM_CHANGE, LEGACY_RECONFIRM_TITLE,
  LEGACY_RECONFIRM_YES, LINE_1_COUNTED, LINE_2_AMOUNT, LIVE_SUM_DIFFER, LIVE_SUM_LINE, LIVE_SUM_MATCH, NO_CHOICE_YET, NO_FORM_NO_INCOME,
  OUTSIDE_SC_AMOUNT, PANEL_FORMS_NOTE, PANEL_SUMMARY_COUNTED, REASON_PERSONAL, REASON_PERSONAL_HELP, REASON_REFUNDS, REASON_REFUNDS_HELP,
  fillIncomeCopy,
} from "@/lib/tax-rules/income-reconciliation-copy";
import type { IncomeReconciliationSummary, SavedDecisionView } from "@/lib/tax-rules/income-reconciliation-response";
import { kNotBusinessIncomeEnabled } from "@/lib/tax-rules/reconciliation-feature";

interface IncomeReconciliationPanelProps {
  taxYear: number;
  /** Fired after a decision is saved or removed so callers can refresh dependent totals. */
  onChanged?: () => void;
}

const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const KIND_TITLES: Record<IncomeSourceKind, string> = { form_1099: "1099 forms", gross_receipt: "Direct income", transaction: "Bank income" };
const DECISION_HELP: Record<ReconciliationDecisionType, string> = {
  same_payments: "The selected records report the same payments, so they count once.",
  separate_income: "No other record reports this income, so it counts in addition to everything else.",
  k_includes_fees: "The 1099-K reports gross amounts and the platform kept fees before depositing. Gross receipts use the 1099-K amount; the fee is listed for your review, not deducted.",
  k_not_business_income: DECISION_HELP_NOT_BUSINESS,
};
const LOAD_ERROR = "Could not load income sources. Try again.";
const GUIDE_ANSWERS: Array<{ hint: PaymentMethodHint; label: string; text: string }> = [
  { hint: "app_or_card", label: GUIDE_ANSWER_APP, text: GUIDE_HINT_APP },
  { hint: "check_ach_wire", label: GUIDE_ANSWER_BANK, text: GUIDE_HINT_BANK },
  { hint: "not_sure", label: GUIDE_ANSWER_NOT_SURE, text: GUIDE_HINT_NOT_SURE },
];

export function IncomeReconciliationPanel({ taxYear, onChanged }: IncomeReconciliationPanelProps) {
  const [summary, setSummary] = useState<IncomeReconciliationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [decision, setDecision] = useState<ReconciliationDecisionType | null>(null);
  const [fee, setFee] = useState("");
  const [note, setNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [paymentHint, setPaymentHint] = useState<PaymentMethodHint | null>(null);
  const [refundsOn, setRefundsOn] = useState(false);
  const [refundsAmount, setRefundsAmount] = useState("");
  const [personalOn, setPersonalOn] = useState(false);
  const [personalAmount, setPersonalAmount] = useState("");
  const requestId = useRef(0);
  const decisionChoices = RECONCILIATION_DECISION_TYPES.filter(type => type !== "k_not_business_income" || kNotBusinessIncomeEnabled());

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true); setLoadError(null);
    try {
      const res = await makeAuthenticatedRequest(`/api/income/reconciliation?year=${taxYear}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : LOAD_ERROR);
      if (current === requestId.current) setSummary(body);
    } catch (e) {
      if (current === requestId.current) { setSummary(null); setLoadError(e instanceof Error ? e.message : LOAD_ERROR); }
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [taxYear]);

  const resetForm = useCallback(() => {
    setEditingId(null); setSelected([]); setFee(""); setNote(""); setDecision(null); setFormError(null);
    setPaymentHint(null); setRefundsOn(false); setRefundsAmount(""); setPersonalOn(false); setPersonalAmount("");
  }, []);

  useEffect(() => {
    resetForm();
    load();
    const generation = requestId;
    return () => { generation.current += 1; };
  }, [load, resetForm]);

  /* derived state */
  const candidates = summary?.candidates ?? [];
  const byKey = new Map(candidates.map(candidate => [sourceKey(candidate), candidate] as const));
  const conflictKeys = new Set((summary?.conflicts ?? []).flatMap(conflict => conflict.sources.map(sourceKey)));
  const claimedBy = new Map(candidates.flatMap(candidate => candidate.decisionId ? [[sourceKey(candidate), candidate.decisionId] as const] : []));
  const selectedCandidates = selected.flatMap(key => { const candidate = byKey.get(key); return candidate ? [candidate] : []; });
  const blockSamePayments = selectedCandidates.length > 0 && !samePaymentsAllowed(selectedCandidates);
  const activeDecision: ReconciliationDecisionType | null = decision === "same_payments" && blockSamePayments ? null : decision;
  const feeApplies = activeDecision === "k_includes_fees" || activeDecision === "k_not_business_income";
  const feeValue = feeApplies && fee.trim() !== "" ? Number(fee) : 0;
  const positive = (raw: string) => { const amount = Number(raw); return Number.isFinite(amount) && amount > 0 ? amount : null; };
  const notBusinessParts: NotBusinessPart[] = activeDecision === "k_not_business_income" ? [
    ...(refundsOn && positive(refundsAmount) !== null ? [{ reason: "refunds_credits" as const, amount: positive(refundsAmount)! }] : []),
    ...(personalOn && positive(personalAmount) !== null ? [{ reason: "personal" as const, amount: positive(personalAmount)! }] : []),
  ] : [];
  const reasonAmountError = activeDecision === "k_not_business_income" && (refundsOn || personalOn)
    && ((refundsOn && positive(refundsAmount) === null) || (personalOn && positive(personalAmount) === null))
    ? ERR_REASON_AMOUNT : null;
  const draft = {
    id: editingId ?? "pending", taxYear, decision: activeDecision ?? "separate_income",
    platformFeeAmount: Number.isFinite(feeValue) && feeValue >= 0 ? feeValue : 0,
    notBusinessParts,
    sources: selectedCandidates.map(candidate => ({ kind: candidate.kind, id: candidate.id, amount: candidate.amount })),
  };
  const enginePreview = activeDecision && draft.sources.length && !reasonAmountError
    ? validateReconciliationDecision(draft, byKey, claimedBy) : null;
  const preview = reasonAmountError ? { ok: false as const, reason: reasonAmountError } : enginePreview;
  const projected = (() => {
    if (!summary || !preview?.ok) return null;
    let baseCents = toCents(summary.reconciledAmount) + toCents(summary.unclaimedAmount);
    const editing = editingId ? summary.decisions.find(item => item.id === editingId) : undefined;
    if (editing?.applied) {
      baseCents += candidates.filter(candidate => candidate.decisionId === editing.id).reduce((sum, candidate) => sum + toCents(candidate.amount), 0) - toCents(editing.countedAmount ?? 0);
    }
    const selectedCents = draft.sources.reduce((sum, source) => sum + toCents(source.amount), 0);
    return (baseCents - selectedCents + preview.countedCents) / 100;
  })();
  const appliedCount = summary?.decisions.filter(item => item.applied).length ?? 0;
  const busy = saving || removingId !== null;
  const selectedForms = selectedCandidates.filter(candidate => candidate.kind === "form_1099");
  const selectedK = selectedForms.find(candidate => candidate.formType === "1099-K");

  /* handlers */
  const toggle = (key: string) => setSelected(prev => prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key]);
  const applySavedParts = (saved: SavedDecisionView) => {
    const refunds = saved.notBusinessParts.find(part => part.reason === "refunds_credits");
    const personal = saved.notBusinessParts.find(part => part.reason === "personal");
    setRefundsOn(Boolean(refunds)); setRefundsAmount(refunds ? String(refunds.amount) : "");
    setPersonalOn(Boolean(personal)); setPersonalAmount(personal ? String(personal.amount) : "");
    setPaymentHint(saved.paymentMethodHint ?? null);
  };
  const startEdit = (saved: SavedDecisionView) => {
    setEditingId(saved.id);
    setDecision(saved.decision === "unknown" ? null : saved.decision);
    setFee(saved.platformFeeAmount ? String(saved.platformFeeAmount) : "");
    setNote(saved.note);
    setSelected(saved.sources.map(sourceKey).filter(key => byKey.has(key)));
    applySavedParts(saved);
    setFormError(null);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDecision) { setFormError(NO_CHOICE_YET); return; }
    if (reasonAmountError) { setFormError(reasonAmountError); return; }
    if (!preview) { setFormError("Select the records this decision covers."); return; }
    if (!preview.ok) { setFormError(preview.reason); return; }
    setSaving(true); setFormError(null);
    try {
      const res = await makeAuthenticatedRequest("/api/income/reconciliation", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify({
          ...(editingId ? { id: editingId } : {}), taxYear, decision: activeDecision, sources: draft.sources,
          platformFeeAmount: draft.platformFeeAmount, note: note.trim(), explicitChoice: true,
          ...(paymentHint ? { paymentMethodHint: paymentHint } : {}),
          ...(activeDecision === "k_not_business_income" ? { notBusinessParts } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "Could not save this decision. Try again.");
      }
      resetForm();
      await load();
      onChanged?.();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save this decision. Try again.");
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id: string) => {
    setRemovingId(id); setFormError(null);
    try {
      const res = await makeAuthenticatedRequest(`/api/income/reconciliation?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not remove this decision. Try again.");
      if (editingId === id) resetForm();
      await load();
      onChanged?.();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not remove this decision. Try again.");
    } finally {
      setRemovingId(null);
    }
  };
  const reconfirmYes = async (saved: SavedDecisionView) => {
    setSaving(true); setFormError(null);
    try {
      const res = await makeAuthenticatedRequest("/api/income/reconciliation", {
        method: "PATCH",
        body: JSON.stringify({
          id: saved.id, taxYear, decision: "same_payments", explicitChoice: true,
          sources: saved.sources.map(source => ({ kind: source.kind, id: source.id, amount: source.amount })),
          platformFeeAmount: saved.platformFeeAmount, note: saved.note,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "Could not save this decision. Try again.");
      }
      await load();
      onChanged?.();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save this decision. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const decisionTitle = (saved: SavedDecisionView) => saved.decision === "unknown" ? "Unrecognized decision" : DECISION_LABELS[saved.decision];
  const sourceLine = (sources: Array<{ kind?: IncomeSourceKind; label?: string; amount?: number }>) => sources.map(source => `${source.label || (source.kind ? SOURCE_KIND_LABELS[source.kind] : "") || "Record"} ${fmt(source.amount ?? 0)}`).join(" · ");
  const optionLabel = (type: ReconciliationDecisionType) => type === "same_payments" ? "These are the same payments"
    : type === "separate_income" ? "This is separate income"
    : type === "k_not_business_income" ? DECISION_LABEL_NOT_BUSINESS
    : `1099-K includes fees${draft.platformFeeAmount > 0 ? ` of ${fmt(draft.platformFeeAmount)}` : ""}`;
  const partAmount = (reason: NotBusinessPart["reason"]) => notBusinessParts.find(part => part.reason === reason)?.amount ?? 0;
  const businessPart = selectedK ? selectedK.amount - partAmount("refunds_credits") - partAmount("personal") - (Number.isFinite(feeValue) ? feeValue : 0) : null;
  const businessEvidence = (kind: IncomeSourceCandidate["kind"]) => selectedCandidates.filter(candidate => candidate.kind === kind).reduce((sum, candidate) => sum + candidate.amount, 0);
  const businessMatches = businessPart !== null && (
    (businessPart === 0 && selectedCandidates.every(candidate => candidate.kind === "form_1099"))
    || (businessPart > 0 && selectedCandidates.some(candidate => candidate.kind !== "form_1099")
      && ["gross_receipt", "transaction"].every(kind => {
        const group = selectedCandidates.filter(candidate => candidate.kind === kind);
        return group.length === 0 || Math.round(businessEvidence(kind as IncomeSourceCandidate["kind"]) * 100) === Math.round(businessPart * 100);
      }))
  );

  return (
    <div className="space-y-3">
      <section aria-label="How reconciliation works" className="rounded-lg border border-border bg-card p-3 text-xs leading-relaxed text-muted-foreground">
        <p className="text-sm font-semibold text-foreground">Count each payment once</p>
        <p className="mt-1">A 1099, a direct income entry and a bank deposit can all describe one payment. Choose the records that belong together and say how they relate. {summary?.policy ?? "WriteOff never merges, edits or deletes income records automatically."}</p>
        <p className="mt-1">{PANEL_FORMS_NOTE}</p>
        <p className="mt-1">{NO_FORM_NO_INCOME}</p>
      </section>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading income sources" /></div>
      ) : loadError || !summary ? (
        <div role="alert" className="rounded-lg bg-muted/40 p-3 text-sm">
          <p>{loadError ?? LOAD_ERROR}</p>
          <Button variant="outline" onClick={load} className="mt-2 min-h-11">Retry income sources</Button>
        </div>
      ) : (
        <>
          {summary.unsupported ? (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-foreground">A saved record needs review before {taxYear} can be reconciled</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{summary.unsupported}</p>
            </div>
          ) : summary.conflicts.length > 0 ? (
            <div role="alert" className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
              <p className="font-medium text-foreground">Tax totals for {taxYear} are on hold until these records are reconciled</p>
              <ul className="mt-2 space-y-2">
                {summary.conflicts.map((conflict, index) => (
                  <li key={`${conflict.reason}-${conflict.decisionId ?? index}`} className="text-xs leading-relaxed">
                    <p>{conflict.message}</p>
                    {conflict.sources.length > 0 && <p className="mt-0.5 text-muted-foreground">{sourceLine(conflict.sources)}</p>}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-xs text-muted-foreground">Gross receipts for {taxYear} (Schedule C line 1)</p>
              <p className="text-lg font-semibold tabular-nums">{summary.grossReceipts === null ? "—" : fmt(summary.grossReceipts)}</p>
              {summary.returnsAndAllowances !== null && summary.returnsAndAllowances > 0 && (
                <p className="text-xs text-muted-foreground">Returns and allowances (Schedule C line 2) {fmt(summary.returnsAndAllowances)}. Net receipts (Schedule C line 3) {summary.netReceipts === null ? "—" : fmt(summary.netReceipts)}.</p>
              )}
              <p className="text-xs text-muted-foreground">
                {fillIncomeCopy(PANEL_SUMMARY_COUNTED, { n: summary.candidates.length, m: appliedCount })}
              </p>
              {summary.feeExpenseCandidates.map(candidate => (
                <p key={candidate.decisionId} className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Platform fee of {fmt(candidate.amount)} recorded with {candidate.label} is an expense candidate for your review. It is not deducted until you add and confirm it as an expense.
                </p>
              ))}
              {summary.outsideScheduleC.map(item => (
                <p key={item.decisionId} className="mt-1 text-xs leading-relaxed text-muted-foreground">{fillIncomeCopy(OUTSIDE_SC_AMOUNT, { amount: fmt(item.amount) })}</p>
              ))}
            </div>
          )}

          {!summary.unsupported && (
            <>
              <section aria-label={`Income records for ${taxYear}`} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {INCOME_SOURCE_KINDS.map(kind => {
                  const list = candidates.filter(candidate => candidate.kind === kind);
                  return (
                    <div key={kind} className="rounded-lg border border-border bg-card p-2">
                      <p className="px-1 text-xs font-medium text-muted-foreground">{KIND_TITLES[kind]} · {list.length}</p>
                      {list.length === 0 ? (
                        <p className="px-1 py-2 text-xs text-muted-foreground">None for {taxYear}</p>
                      ) : (
                        <ul className="mt-1 space-y-1">
                          {list.map(candidate => {
                            const key = sourceKey(candidate);
                            const claimed = Boolean(candidate.decisionId) && candidate.decisionId !== editingId;
                            const disabled = Boolean(candidate.linkedImport) || claimed || busy;
                            const checked = selected.includes(key);
                            return (
                              <li key={key}>
                                <label className={`flex min-h-11 items-start gap-2 rounded-md px-1.5 py-1.5 text-xs ${disabled ? "opacity-60" : "cursor-pointer hover:bg-muted/40"} ${checked ? "bg-primary/10" : ""}`}>
                                  <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border" checked={checked} disabled={disabled}
                                    onChange={() => toggle(key)} aria-label={`Select ${candidate.label} ${fmt(candidate.amount)}`} />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium text-foreground">{candidate.label}</span>
                                    <span className="block tabular-nums text-muted-foreground">{fmt(candidate.amount)}{candidate.date ? ` · ${candidate.date}` : ""}</span>
                                    {candidate.linkedImport ? <Badge variant="secondary" className="mt-1">Linked import · counted once</Badge>
                                      : claimed ? <Badge variant="success" className="mt-1">Reconciled</Badge>
                                      : conflictKeys.has(key) ? <Badge variant="warning" className="mt-1">Needs a decision</Badge> : null}
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </section>

              {selectedForms.length >= 2 && (
                <section aria-label="1099 comparison" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {selectedForms.map(form => (
                    <div key={sourceKey(form)} className="rounded-lg border border-border bg-card p-2 text-xs">
                      <p className="font-medium text-foreground">{form.formType || "1099"}</p>
                      <p className="text-muted-foreground">{form.label}</p>
                      <p className="tabular-nums">{fmt(form.amount)}</p>
                    </div>
                  ))}
                </section>
              )}

              <form onSubmit={submit} aria-label={editingId ? "Edit reconciliation decision" : "Record a reconciliation decision"} className="space-y-3 rounded-lg border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{editingId ? "Edit decision" : "Record a decision"}</p>
                  <p className="text-xs text-muted-foreground">{selected.length} selected</p>
                </div>
                {selectedForms.length > 0 && (
                  <fieldset className="space-y-1.5">
                    <legend className="text-xs text-muted-foreground">{GUIDE_QUESTION}</legend>
                    <div className="flex flex-wrap gap-2">
                      {GUIDE_ANSWERS.map(answer => (
                        <button key={answer.hint} type="button" disabled={busy} aria-pressed={paymentHint === answer.hint}
                          onClick={() => setPaymentHint(answer.hint)}
                          className={`min-h-11 rounded-full border px-3 text-xs ${paymentHint === answer.hint ? "border-primary bg-primary/5" : "border-border"}`}>
                          {answer.label}
                        </button>
                      ))}
                    </div>
                    {paymentHint && <p className="rounded-md bg-muted/50 p-2 text-xs leading-relaxed text-muted-foreground">{GUIDE_ANSWERS.find(answer => answer.hint === paymentHint)?.text}</p>}
                  </fieldset>
                )}
                <fieldset className="space-y-1.5">
                  <legend className="text-xs text-muted-foreground">How do the selected records relate?</legend>
                  {decisionChoices.map(type => {
                    const disallowed = type === "same_payments" && blockSamePayments;
                    return (
                      <label key={type} className={`flex min-h-11 items-start gap-2 rounded-md border px-2 py-1.5 text-xs ${disallowed ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${activeDecision === type ? "border-primary bg-primary/5" : "border-border"}`}>
                        <input type="radio" name="reconciliation-decision" value={type} checked={activeDecision === type} onChange={() => setDecision(type)} className="mt-0.5 h-4 w-4" disabled={busy || disallowed} />
                        <span>
                          <span className="block font-medium text-foreground">{optionLabel(type)}</span>
                          <span className="block leading-relaxed text-muted-foreground">{DECISION_HELP[type]}</span>
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
                {activeDecision === "k_not_business_income" && (
                  <div className="space-y-2">
                    <label className="flex min-h-11 items-start gap-2 text-xs">
                      <input type="checkbox" className="mt-0.5 h-4 w-4" checked={refundsOn} disabled={busy} onChange={() => setRefundsOn(value => !value)} aria-label={REASON_REFUNDS} />
                      <span><span className="block font-medium text-foreground">{REASON_REFUNDS}</span><span className="block text-muted-foreground">{REASON_REFUNDS_HELP}</span></span>
                    </label>
                    {refundsOn && (
                      <div className="space-y-1 pl-6">
                        <Label htmlFor="reconciliation-refunds" className="text-xs text-muted-foreground">{REASON_REFUNDS} ($)</Label>
                        <Input id="reconciliation-refunds" type="number" min="0" step="0.01" inputMode="decimal" value={refundsAmount} onChange={event => setRefundsAmount(event.target.value)}
                          placeholder="0.00" className="min-h-11 bg-background text-base" disabled={busy} />
                      </div>
                    )}
                    <label className="flex min-h-11 items-start gap-2 text-xs">
                      <input type="checkbox" className="mt-0.5 h-4 w-4" checked={personalOn} disabled={busy} onChange={() => setPersonalOn(value => !value)} aria-label={REASON_PERSONAL} />
                      <span><span className="block font-medium text-foreground">{REASON_PERSONAL}</span><span className="block text-muted-foreground">{REASON_PERSONAL_HELP}</span></span>
                    </label>
                    {personalOn && (
                      <div className="space-y-1 pl-6">
                        <Label htmlFor="reconciliation-personal" className="text-xs text-muted-foreground">{REASON_PERSONAL} ($)</Label>
                        <Input id="reconciliation-personal" type="number" min="0" step="0.01" inputMode="decimal" value={personalAmount} onChange={event => setPersonalAmount(event.target.value)}
                          placeholder="0.00" className="min-h-11 bg-background text-base" disabled={busy} />
                      </div>
                    )}
                  </div>
                )}
                {feeApplies && (
                  <div className="space-y-1">
                    <Label htmlFor="reconciliation-fee" className="text-xs text-muted-foreground">Platform fee amount ($)</Label>
                    <Input id="reconciliation-fee" type="number" min="0" step="0.01" inputMode="decimal" value={fee} onChange={e => setFee(e.target.value)}
                      placeholder="0.00" className="min-h-11 bg-background text-base" disabled={busy} />
                  </div>
                )}
                {activeDecision === "k_not_business_income" && selectedK && businessPart !== null && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {fillIncomeCopy(LIVE_SUM_LINE, { gross: fmt(selectedK.amount), refunds: fmt(partAmount("refunds_credits")), personal: fmt(partAmount("personal")), fee: fmt(Number.isFinite(feeValue) ? feeValue : 0), business: fmt(businessPart) })}
                    {" "}{businessMatches ? LIVE_SUM_MATCH : LIVE_SUM_DIFFER}
                  </p>
                )}
                <div className="space-y-1">
                  <Label htmlFor="reconciliation-note" className="text-xs text-muted-foreground">Note (optional)</Label>
                  <Input id="reconciliation-note" value={note} maxLength={500} onChange={e => setNote(e.target.value)}
                    placeholder="e.g. Platform payouts, January to December" className="min-h-11 bg-background text-base" disabled={busy} />
                </div>
                <p aria-live="polite" className="text-xs leading-relaxed text-muted-foreground">
                  {draft.sources.length === 0 ? "Select the records this decision covers."
                    : !activeDecision ? NO_CHOICE_YET
                    : preview && preview.ok ? `Counts ${fmt(preview.countedCents / 100)} once.${projected === null ? "" : ` Gross receipts for ${taxYear} would be ${fmt(projected)} if no other conflicts remain.`}`
                    : preview && !preview.ok ? preview.reason
                    : NO_CHOICE_YET}
                </p>
                {formError && <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</div>}
                <div className="flex gap-2">
                  {editingId && <Button type="button" variant="outline" onClick={resetForm} disabled={busy} className="min-h-11 flex-1">Cancel</Button>}
                  <Button type="submit" disabled={busy || !activeDecision || !preview?.ok} className="min-h-11 flex-1 gap-2">
                    {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {editingId ? "Save changes" : "Save decision"}
                  </Button>
                </div>
              </form>
            </>
          )}

          <section aria-label="Saved reconciliation decisions" className="rounded-lg border border-border bg-card p-3">
            <p className="text-sm font-semibold">Saved decisions · {summary.decisions.length}</p>
            {summary.decisions.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">No decisions recorded for {taxYear}. Records are never linked without your confirmation.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {summary.decisions.map(saved => {
                  const refunds = saved.notBusinessParts.find(part => part.reason === "refunds_credits")?.amount ?? 0;
                  const personal = saved.notBusinessParts.find(part => part.reason === "personal")?.amount ?? 0;
                  return (
                    <li key={saved.id} className="rounded-md border border-border p-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-foreground">{decisionTitle(saved)}</span>
                            {saved.needsReconfirm ? <Badge variant="warning">{LEGACY_RECONFIRM_TITLE}</Badge>
                              : saved.applied ? <Badge variant="success">Applied</Badge> : <Badge variant="warning">Needs review</Badge>}
                          </div>
                          <p className="mt-0.5 leading-relaxed text-muted-foreground">{sourceLine(saved.sources)}</p>
                          {saved.decision === "k_not_business_income" ? (
                            <p className="mt-0.5 text-muted-foreground">
                              {saved.countedAmount !== null ? fillIncomeCopy(LINE_1_COUNTED, { amount: fmt(saved.countedAmount) }) : "Counted amount unavailable"}
                              {refunds > 0 ? ` · ${fillIncomeCopy(LINE_2_AMOUNT, { amount: fmt(refunds) })}` : ""}
                              {personal > 0 ? ` · ${fillIncomeCopy(OUTSIDE_SC_AMOUNT, { amount: fmt(personal) })}` : ""}
                            </p>
                          ) : (
                            <p className="mt-0.5 text-muted-foreground">
                              {saved.countedAmount !== null ? `Counted ${fmt(saved.countedAmount)} once` : "Counted amount unavailable"}
                              {saved.platformFeeAmount ? ` · ${fmt(saved.platformFeeAmount)} fee flagged for review` : ""}
                              {saved.decidedAt ? ` · ${saved.decidedAt.slice(0, 10)}` : ""}
                            </p>
                          )}
                          {saved.needsReconfirm && (
                            <div className="mt-2 space-y-2 rounded-md border border-warning/40 bg-warning/5 p-2">
                              <p className="font-medium text-foreground">{LEGACY_RECONFIRM_TITLE}</p>
                              <p className="leading-relaxed text-muted-foreground">{LEGACY_RECONFIRM_BODY}</p>
                              <div className="flex flex-wrap gap-2">
                                <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => reconfirmYes(saved)}>{LEGACY_RECONFIRM_YES}</Button>
                                <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => { startEdit(saved); setDecision(null); }}>{LEGACY_RECONFIRM_CHANGE}</Button>
                              </div>
                            </div>
                          )}
                          {saved.note && <p className="mt-0.5 italic text-muted-foreground">{saved.note}</p>}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          {!summary.unsupported && (
                            <Button variant="ghost" size="icon" onClick={() => startEdit(saved)} disabled={busy} aria-label={`Edit decision: ${decisionTitle(saved)}`} className="min-h-11 min-w-11">
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" onClick={() => remove(saved.id)} disabled={busy} aria-label={`Remove decision: ${decisionTitle(saved)}`}
                            className="min-h-11 min-w-11 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                            {removingId === saved.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default IncomeReconciliationPanel;
