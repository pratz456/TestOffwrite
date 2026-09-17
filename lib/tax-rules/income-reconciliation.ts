/**
 * Owner-recorded income reconciliation decisions.
 *
 * Gross receipts, classified bank income and 1099-NEC/K forms are overlapping
 * evidence of the same payments. The owner records how specific records relate;
 * this module validates those decisions against the current records and counts
 * each reconciled payment stream once. Nothing here matches by payer or amount on
 * its own, and no record is edited or deleted.
 *
 * IRS grounding: all business income is taxable whether or not an information
 * return arrives; a 1099-K reports gross amounts before platform fees, and for
 * 2025 and later a third-party settlement organization files one only above
 * $20,000 and 200 transactions (Gig Economy Tax Center; Form 1099-K FAQs).
 */
export const INCOME_SOURCE_KINDS = ['form_1099', 'gross_receipt', 'transaction'] as const;
export type IncomeSourceKind = (typeof INCOME_SOURCE_KINDS)[number];

export const RECONCILIATION_DECISION_TYPES = ['same_payments', 'separate_income', 'k_includes_fees'] as const;
export type ReconciliationDecisionType = (typeof RECONCILIATION_DECISION_TYPES)[number];

export const SOURCE_KIND_LABELS: Record<IncomeSourceKind, string> = {
  form_1099: '1099 form', gross_receipt: 'direct income', transaction: 'bank income',
};
export const DECISION_LABELS: Record<ReconciliationDecisionType, string> = {
  same_payments: 'Same payments', separate_income: 'Separate income', k_includes_fees: '1099-K includes fees',
};

export interface IncomeSourceRef { kind: IncomeSourceKind; id: string; amount: number }
export interface IncomeSourceCandidate extends IncomeSourceRef {
  label: string;
  date?: string;
  formType?: string;
  /** A server-created import link already counts this form with its receipt. */
  linkedImport?: boolean;
}
export interface IncomeReconciliationDecision {
  id: string;
  taxYear: number;
  decision: ReconciliationDecisionType;
  sources: IncomeSourceRef[];
  platformFeeAmount: number;
  note?: string;
}
export interface FeeExpenseCandidate { decisionId: string; formId: string; label: string; amount: number }
export interface IncomeReconciliationConflict {
  reason: 'overlapping_sources' | 'multiple_forms' | 'unreconciled_against_decision' | 'stale_decision';
  message: string;
  sources: Array<IncomeSourceRef & { label: string }>;
  decisionId?: string;
}

export const sourceKey = (ref: Pick<IncomeSourceRef, 'kind' | 'id'>) => `${ref.kind}:${ref.id}`;
export const toCents = (amount: number) => Math.round(amount * 100);
const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isFiniteAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const publicRef = (candidate: IncomeSourceCandidate) => ({ kind: candidate.kind, id: candidate.id, amount: candidate.amount, label: candidate.label });

/** Shape-check a saved decision; malformed records are reported as stale, never applied. */
export function normalizeReconciliationDecision(record: Record<string, unknown>): IncomeReconciliationDecision | null {
  const { id, taxYear, decision, sources, platformFeeAmount, note } = record;
  if (typeof id !== 'string' || !id || typeof taxYear !== 'number' || !Number.isInteger(taxYear)) return null;
  if (!RECONCILIATION_DECISION_TYPES.includes(decision as ReconciliationDecisionType)) return null;
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const refs: IncomeSourceRef[] = [];
  for (const source of sources) {
    if (!source || typeof source !== 'object') return null;
    const { kind, id: sourceId, amount } = source as Record<string, unknown>;
    if (!INCOME_SOURCE_KINDS.includes(kind as IncomeSourceKind) || typeof sourceId !== 'string' || !sourceId || !isFiniteAmount(amount)) return null;
    refs.push({ kind: kind as IncomeSourceKind, id: sourceId, amount });
  }
  if (platformFeeAmount !== undefined && platformFeeAmount !== null && !isFiniteAmount(platformFeeAmount)) return null;
  return {
    id, taxYear, decision: decision as ReconciliationDecisionType, sources: refs,
    platformFeeAmount: isFiniteAmount(platformFeeAmount) ? platformFeeAmount : 0,
    ...(typeof note === 'string' && note ? { note } : {}),
  };
}

export type DecisionCheck =
  | { ok: true; countedCents: number; feeCents: number; kinds: Set<IncomeSourceKind>; sources: IncomeSourceCandidate[] }
  | { ok: false; reason: string };

/**
 * Validate one decision against the current records. `claimedBy` lets a caller
 * reject a source that another saved decision already explains.
 */
export function validateReconciliationDecision(
  decision: IncomeReconciliationDecision,
  candidates: ReadonlyMap<string, IncomeSourceCandidate>,
  claimedBy: ReadonlyMap<string, string> = new Map(),
): DecisionCheck {
  const resolved: IncomeSourceCandidate[] = [];
  const seen = new Set<string>();
  for (const ref of decision.sources) {
    const key = sourceKey(ref);
    if (seen.has(key)) return { ok: false, reason: 'The same record is listed twice in this decision.' };
    seen.add(key);
    const candidate = candidates.get(key);
    if (!candidate) return { ok: false, reason: `A ${SOURCE_KIND_LABELS[ref.kind]} record in this decision no longer exists for this tax year or is no longer classified as business income.` };
    if (candidate.linkedImport) return { ok: false, reason: `${candidate.label} is already linked to its imported receipt and counted once; it cannot be reconciled again.` };
    if (toCents(candidate.amount) !== toCents(ref.amount)) return { ok: false, reason: `${candidate.label} is ${dollars(toCents(candidate.amount))} in your records, not the ${dollars(toCents(ref.amount))} this decision names. Review the amounts and record the decision again.` };
    const owner = claimedBy.get(key);
    if (owner !== undefined && owner !== decision.id) return { ok: false, reason: `${candidate.label} is already reconciled in another saved decision.` };
    resolved.push(candidate);
  }
  const feeCents = toCents(decision.platformFeeAmount);
  const kinds = new Set(resolved.map(source => source.kind));
  const byKind = (kind: IncomeSourceKind) => resolved.filter(source => source.kind === kind);
  const sum = (sources: IncomeSourceCandidate[]) => sources.reduce((total, source) => total + toCents(source.amount), 0);
  const forms = byKind('form_1099'), receipts = byKind('gross_receipt'), transactions = byKind('transaction');

  if (decision.decision === 'separate_income') {
    if (resolved.length !== 1) return { ok: false, reason: 'Mark one record at a time as separate income.' };
    if (feeCents) return { ok: false, reason: 'Separate income does not record a platform fee.' };
    return { ok: true, countedCents: toCents(resolved[0].amount), feeCents: 0, kinds, sources: resolved };
  }

  if (decision.decision === 'same_payments') {
    if (resolved.length < 2) return { ok: false, reason: 'Select at least two records that describe the same payments.' };
    // Two 1099s can report one payment stream. Duplicate receipts or deposits of one kind are
    // summed by the base rule, so they cannot be declared duplicates here.
    if (kinds.size < 2 && forms.length !== resolved.length) return { ok: false, reason: 'Select records of at least two kinds (a 1099, direct income or bank income) that describe the same payments.' };
    if (feeCents) return { ok: false, reason: 'Record platform fees with the “1099-K includes fees” decision.' };
    // An information return reports the whole payment stream; receipts and deposits may be split.
    const totals = [...forms.map(form => toCents(form.amount)), ...(receipts.length ? [sum(receipts)] : []), ...(transactions.length ? [sum(transactions)] : [])];
    const target = totals[0];
    if (totals.some(total => total !== target)) {
      const parts = [
        ...forms.map(form => `${form.label} ${dollars(toCents(form.amount))}`),
        ...(receipts.length ? [`direct income ${dollars(sum(receipts))}`] : []),
        ...(transactions.length ? [`bank income ${dollars(sum(transactions))}`] : []),
      ];
      const kForm = forms.find(form => form.formType === '1099-K');
      const hint = kForm && [receipts, transactions].some(group => group.length && sum(group) < toCents(kForm.amount))
        ? ' If the platform deducted fees before depositing, choose “1099-K includes fees” and enter the fee amount.'
        : '';
      return { ok: false, reason: `Amounts do not match (${parts.join('; ')}). Each kind of record must total the same amount before it can count once.${hint}` };
    }
    return { ok: true, countedCents: target, feeCents: 0, kinds, sources: resolved };
  }

  if (forms.length !== 1 || forms[0].formType !== '1099-K') return { ok: false, reason: 'Select exactly one 1099-K together with the deposits or direct income it reports.' };
  if (!receipts.length && !transactions.length) return { ok: false, reason: 'Select the direct income or bank deposits that the 1099-K reports.' };
  const gross = toCents(forms[0].amount);
  if (feeCents <= 0 || feeCents >= gross) return { ok: false, reason: 'Enter the platform fee amount: more than $0 and less than the 1099-K gross amount.' };
  const net = gross - feeCents;
  let netEvidence = false;
  for (const [label, group] of [['direct income', receipts], ['bank income', transactions]] as const) {
    if (!group.length) continue;
    const total = sum(group);
    if (total === net) netEvidence = true;
    else if (total !== gross) return { ok: false, reason: `${label} totals ${dollars(total)}, which is neither the 1099-K gross ${dollars(gross)} nor gross less the ${dollars(feeCents)} fee (${dollars(net)}).` };
  }
  if (!netEvidence) return { ok: false, reason: `No selected deposit or direct income equals the 1099-K gross less the ${dollars(feeCents)} fee. If nothing is net of fees, choose “same payments” instead.` };
  return { ok: true, countedCents: gross, feeCents, kinds, sources: resolved };
}

export interface IncomeReconciliationResolution {
  /** Cents counted once per applied decision. */
  reconciledCents: number;
  /** Cents of records no decision covers, by kind. */
  unclaimedCents: Record<IncomeSourceKind, number>;
  claimedBy: Map<string, string>;
  appliedDecisionIds: string[];
  feeExpenseCandidates: FeeExpenseCandidate[];
  conflicts: IncomeReconciliationConflict[];
}

/**
 * Apply saved decisions to the current candidate records and report every
 * remaining ambiguity. Callers must refuse to total income while conflicts exist.
 */
export function resolveIncomeSources(taxYear: number, candidates: ReadonlyArray<IncomeSourceCandidate>, decisions: ReadonlyArray<Record<string, unknown>>): IncomeReconciliationResolution {
  const byKey = new Map(candidates.map(candidate => [sourceKey(candidate), candidate] as const));
  const claimedBy = new Map<string, string>();
  const conflicts: IncomeReconciliationConflict[] = [];
  const feeExpenseCandidates: FeeExpenseCandidate[] = [];
  const groups: Array<{ decisionId: string; kinds: Set<IncomeSourceKind> }> = [];
  const appliedDecisionIds: string[] = [];
  let reconciledCents = 0;
  for (const record of decisions) {
    const decision = normalizeReconciliationDecision(record);
    const decisionId = typeof record.id === 'string' ? record.id : 'unknown';
    if (!decision || decision.taxYear !== taxYear) {
      conflicts.push({ reason: 'stale_decision', decisionId, message: 'A saved reconciliation decision is malformed or belongs to another tax year. Remove it and record the decision again.', sources: [] });
      continue;
    }
    const check = validateReconciliationDecision(decision, byKey, claimedBy);
    if (!check.ok) {
      conflicts.push({ reason: 'stale_decision', decisionId, message: `A saved reconciliation decision no longer matches your records: ${check.reason}`,
        sources: decision.sources.map(ref => ({ ...ref, label: byKey.get(sourceKey(ref))?.label ?? `${SOURCE_KIND_LABELS[ref.kind]} (record removed)` })) });
      continue;
    }
    check.sources.forEach(source => claimedBy.set(sourceKey(source), decision.id));
    reconciledCents += check.countedCents;
    appliedDecisionIds.push(decision.id);
    if (decision.decision !== 'separate_income') groups.push({ decisionId: decision.id, kinds: check.kinds });
    if (check.feeCents) {
      const form = check.sources.find(source => source.kind === 'form_1099')!;
      feeExpenseCandidates.push({ decisionId: decision.id, formId: form.id, label: form.label, amount: check.feeCents / 100 });
    }
  }

  const unclaimed = candidates.filter(candidate => !candidate.linkedImport && !claimedBy.has(sourceKey(candidate)));
  const unclaimedCents: Record<IncomeSourceKind, number> = { form_1099: 0, gross_receipt: 0, transaction: 0 };
  for (const candidate of unclaimed) unclaimedCents[candidate.kind] += toCents(candidate.amount);
  const activeKinds = INCOME_SOURCE_KINDS.filter(kind => unclaimedCents[kind] > 0);
  const unclaimedForms = unclaimed.filter(candidate => candidate.kind === 'form_1099');
  if (activeKinds.length > 1) {
    conflicts.push({ reason: 'overlapping_sources', message: 'Transactions, gross receipts or 1099 forms may describe the same payments. They have no verified matching link and cannot be added safely.',
      sources: unclaimed.filter(candidate => activeKinds.includes(candidate.kind)).map(publicRef) });
  }
  // A K and NEC (even from different named payers) can describe the same receipts,
  // so once a year has several 1099s each one needs its own decision.
  const reconcilableForms = candidates.filter(candidate => candidate.kind === 'form_1099' && !candidate.linkedImport);
  if (unclaimedForms.length && reconcilableForms.length > 1) {
    conflicts.push({ reason: 'multiple_forms', message: 'This tax year has more than one 1099 and at least one has no reconciliation decision. A 1099-K and a 1099-NEC can report the same earnings; mark each 1099 as separate income or reconcile it with the payments it reports.',
      sources: unclaimedForms.map(publicRef) });
  }
  for (const group of groups) {
    const uncovered = activeKinds.filter(kind => !group.kinds.has(kind));
    if (!uncovered.length) continue;
    conflicts.push({ reason: 'unreconciled_against_decision', decisionId: group.decisionId,
      message: `Unreconciled ${uncovered.map(kind => SOURCE_KIND_LABELS[kind]).join(' and ')} may belong to payments already reconciled in a saved decision that has no ${uncovered.map(kind => SOURCE_KIND_LABELS[kind]).join(' or ')} record. Add those records to that decision or mark them as separate income.`,
      sources: unclaimed.filter(candidate => uncovered.includes(candidate.kind)).map(publicRef) });
  }
  return { reconciledCents, unclaimedCents, claimedBy, appliedDecisionIds, feeExpenseCandidates, conflicts };
}
