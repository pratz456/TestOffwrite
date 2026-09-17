"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";
import {
  DECISION_LABELS, INCOME_SOURCE_KINDS, RECONCILIATION_DECISION_TYPES, SOURCE_KIND_LABELS, sourceKey, toCents, validateReconciliationDecision,
  type IncomeSourceKind, type ReconciliationDecisionType,
} from "@/lib/tax-rules/income-reconciliation";
import type { IncomeReconciliationSummary, SavedDecisionView } from "@/lib/tax-rules/income-reconciliation-response";

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
};
const LOAD_ERROR = "Could not load income sources. Try again.";

export function IncomeReconciliationPanel({ taxYear, onChanged }: IncomeReconciliationPanelProps) {
  const [summary, setSummary] = useState<IncomeReconciliationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [decision, setDecision] = useState<ReconciliationDecisionType>("same_payments");
  const [fee, setFee] = useState("");
  const [note, setNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const requestId = useRef(0);

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

  const resetForm = useCallback(() => { setEditingId(null); setSelected([]); setFee(""); setNote(""); setDecision("same_payments"); setFormError(null); }, []);

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
  const feeValue = decision === "k_includes_fees" && fee.trim() !== "" ? Number(fee) : 0;
  const draft = {
    id: editingId ?? "pending", taxYear, decision,
    platformFeeAmount: Number.isFinite(feeValue) && feeValue >= 0 ? feeValue : 0,
    sources: selected.flatMap(key => { const c = byKey.get(key); return c ? [{ kind: c.kind, id: c.id, amount: c.amount }] : []; }),
  };
  const preview = draft.sources.length ? validateReconciliationDecision(draft, byKey, claimedBy) : null;
  const projected = (() => {
    if (!summary || !preview?.ok) return null;
    let baseCents = toCents(summary.reconciledAmount) + toCents(summary.unclaimedAmount);
    const editing = editingId ? summary.decisions.find(d => d.id === editingId) : undefined;
    if (editing?.applied) {
      // Its sources return to the pool and its counted amount leaves it before the new decision applies.
      baseCents += candidates.filter(c => c.decisionId === editing.id).reduce((sum, c) => sum + toCents(c.amount), 0) - toCents(editing.countedAmount ?? 0);
    }
    const selectedCents = draft.sources.reduce((sum, source) => sum + toCents(source.amount), 0);
    return (baseCents - selectedCents + preview.countedCents) / 100;
  })();
  const appliedCount = summary?.decisions.filter(d => d.applied).length ?? 0;
  const busy = saving || removingId !== null;

  /* handlers */
  const toggle = (key: string) => setSelected(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  const startEdit = (saved: SavedDecisionView) => {
    setEditingId(saved.id);
    setDecision(saved.decision === "unknown" ? "same_payments" : saved.decision);
    setFee(saved.platformFeeAmount ? String(saved.platformFeeAmount) : "");
    setNote(saved.note);
    setSelected(saved.sources.map(sourceKey).filter(key => byKey.has(key)));
    setFormError(null);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview) { setFormError("Select the records this decision covers."); return; }
    if (!preview.ok) { setFormError(preview.reason); return; }
    setSaving(true); setFormError(null);
    try {
      const res = await makeAuthenticatedRequest("/api/income/reconciliation", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify({ ...(editingId ? { id: editingId } : {}), taxYear, decision, sources: draft.sources, platformFeeAmount: draft.platformFeeAmount, note: note.trim() }),
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

  const decisionTitle = (saved: SavedDecisionView) => saved.decision === "unknown" ? "Unrecognized decision" : DECISION_LABELS[saved.decision];
  const sourceLine = (sources: SavedDecisionView["sources"]) => sources.map(s => `${s.label || SOURCE_KIND_LABELS[s.kind] || String(s.kind)} ${fmt(s.amount)}`).join(" · ");
  const optionLabel = (type: ReconciliationDecisionType) => type === "same_payments" ? "These are the same payments"
    : type === "separate_income" ? "This is separate income"
    : `1099-K includes fees${draft.platformFeeAmount > 0 ? ` of ${fmt(draft.platformFeeAmount)}` : ""}`;

  return (
    <div className="space-y-3">
      <section aria-label="How reconciliation works" className="rounded-lg border border-border bg-card p-3 text-xs leading-relaxed text-muted-foreground">
        <p className="text-sm font-semibold text-foreground">Count each payment once</p>
        <p className="mt-1">A 1099, a direct income entry and a bank deposit can all describe one payment. Choose the records that belong together and say how they relate. {summary?.policy ?? "WriteOff never merges, edits or deletes income records automatically."}</p>
        <p className="mt-1">All business income is taxable whether or not a 1099 arrives. For 2025 and later, a platform sends a 1099-K only above $20,000 and 200 transactions, and it reports gross amounts before fees.</p>
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
              <p className="text-xs text-muted-foreground">
                Each payment counted once across {summary.candidates.length} record{summary.candidates.length === 1 ? "" : "s"}{appliedCount ? ` and ${appliedCount} saved decision${appliedCount === 1 ? "" : "s"}` : ""}.
              </p>
              {summary.feeExpenseCandidates.map(candidate => (
                <p key={candidate.decisionId} className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Platform fee of {fmt(candidate.amount)} recorded with {candidate.label} is an expense candidate for your review. It is not deducted until you add and confirm it as an expense.
                </p>
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

              <form onSubmit={submit} aria-label={editingId ? "Edit reconciliation decision" : "Record a reconciliation decision"} className="space-y-3 rounded-lg border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{editingId ? "Edit decision" : "Record a decision"}</p>
                  <p className="text-xs text-muted-foreground">{selected.length} selected</p>
                </div>
                <fieldset className="space-y-1.5">
                  <legend className="text-xs text-muted-foreground">How do the selected records relate?</legend>
                  {RECONCILIATION_DECISION_TYPES.map(type => (
                    <label key={type} className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-xs ${decision === type ? "border-primary bg-primary/5" : "border-border"}`}>
                      <input type="radio" name="reconciliation-decision" value={type} checked={decision === type} onChange={() => setDecision(type)} className="mt-0.5 h-4 w-4" disabled={busy} />
                      <span>
                        <span className="block font-medium text-foreground">{optionLabel(type)}</span>
                        <span className="block leading-relaxed text-muted-foreground">{DECISION_HELP[type]}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                {decision === "k_includes_fees" && (
                  <div className="space-y-1">
                    <Label htmlFor="reconciliation-fee" className="text-xs text-muted-foreground">Platform fee amount ($)</Label>
                    <Input id="reconciliation-fee" type="number" min="0" step="0.01" inputMode="decimal" value={fee} onChange={e => setFee(e.target.value)}
                      placeholder="0.00" className="min-h-11 bg-background text-base" disabled={busy} />
                  </div>
                )}
                <div className="space-y-1">
                  <Label htmlFor="reconciliation-note" className="text-xs text-muted-foreground">Note (optional)</Label>
                  <Input id="reconciliation-note" value={note} maxLength={500} onChange={e => setNote(e.target.value)}
                    placeholder="e.g. Platform payouts, January to December" className="min-h-11 bg-background text-base" disabled={busy} />
                </div>
                <p aria-live="polite" className="text-xs leading-relaxed text-muted-foreground">
                  {preview === null ? "Select the records this decision covers."
                    : preview.ok ? `Counts ${fmt(preview.countedCents / 100)} once.${projected === null ? "" : ` Gross receipts for ${taxYear} would be ${fmt(projected)} if no other conflicts remain.`}`
                    : preview.reason}
                </p>
                {formError && <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</div>}
                <div className="flex gap-2">
                  {editingId && <Button type="button" variant="outline" onClick={resetForm} disabled={busy} className="min-h-11 flex-1">Cancel</Button>}
                  <Button type="submit" disabled={busy || !preview?.ok} className="min-h-11 flex-1 gap-2">
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
                {summary.decisions.map(saved => (
                  <li key={saved.id} className="rounded-md border border-border p-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-foreground">{decisionTitle(saved)}</span>
                          {saved.applied ? <Badge variant="success">Applied</Badge> : <Badge variant="warning">Needs review</Badge>}
                        </div>
                        <p className="mt-0.5 leading-relaxed text-muted-foreground">{sourceLine(saved.sources)}</p>
                        <p className="mt-0.5 text-muted-foreground">
                          {saved.countedAmount !== null ? `Counted ${fmt(saved.countedAmount)} once` : "Counted amount unavailable"}
                          {saved.platformFeeAmount ? ` · ${fmt(saved.platformFeeAmount)} fee flagged for review` : ""}
                          {saved.decidedAt ? ` · ${saved.decidedAt.slice(0, 10)}` : ""}
                        </p>
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
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default IncomeReconciliationPanel;
