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
 * 2025 and later a third-party settlement organization files one only when
 * payments are over $20,000 and over 200 transactions (Gig Economy Tax Center;
 * Form 1099-K FAQs). Payment-card 1099-Ks have no threshold.
 */
import {
  DECISION_LABEL_CORRECTED, DECISION_LABEL_NOT_BUSINESS, ERR_CORRECTED_NEEDS_TWO_NEC, ERR_CORRECTED_PICK,
  ERR_CORRECTED_SAME_PAYER, ERR_CORRECTED_SUM, ERR_NOT_BUSINESS_NEEDS_ONE_K, ERR_PARTS_EXCEED_GROSS, ERR_REASON_REQUIRED,
  ERR_SAME_NEEDS_K, ERR_SELECT_BUSINESS_RECORDS, ERR_SUM_MISMATCH, fillIncomeCopy,
  LEGACY_NEC_PRIOR_YEAR_NOTE, LEGACY_NEC_REOPEN_REASON, LEGACY_NEC_WARNING,
} from './income-reconciliation-copy';
import { r10_5LegacyNecReopen, reconciliationYearMayAlreadyBeFiled } from './reconciliation-feature';

export const INCOME_SOURCE_KINDS = ['form_1099', 'gross_receipt', 'transaction'] as const;
export type IncomeSourceKind = (typeof INCOME_SOURCE_KINDS)[number];

export const RECONCILIATION_DECISION_TYPES = ['same_payments', 'separate_income', 'k_includes_fees', 'k_not_business_income', 'corrected_form_replaces'] as const;
export type ReconciliationDecisionType = (typeof RECONCILIATION_DECISION_TYPES)[number];

export const NOT_BUSINESS_REASONS = ['refunds_credits', 'personal'] as const;
export type NotBusinessReason = (typeof NOT_BUSINESS_REASONS)[number];
/** Amount in dollars, over 0. */
export interface NotBusinessPart { reason: NotBusinessReason; amount: number }

export const PAYMENT_METHOD_HINTS = ['app_or_card', 'check_ach_wire', 'not_sure'] as const;
export type PaymentMethodHint = (typeof PAYMENT_METHOD_HINTS)[number];

export const SOURCE_KIND_LABELS: Record<IncomeSourceKind, string> = {
  form_1099: '1099 form', gross_receipt: 'direct income', transaction: 'bank income',
};
export const DECISION_LABELS: Record<ReconciliationDecisionType, string> = {
  same_payments: 'Same payments', separate_income: 'Separate income', k_includes_fees: '1099-K includes fees',
  k_not_business_income: DECISION_LABEL_NOT_BUSINESS,
  corrected_form_replaces: DECISION_LABEL_CORRECTED,
};

export interface IncomeSourceRef { kind: IncomeSourceKind; id: string; amount: number }
export interface IncomeSourceCandidate extends IncomeSourceRef {
  label: string;
  date?: string;
  formType?: string;
  /** Payer on a 1099, kept apart from the form type so the row can show both in full. */
  payerName?: string;
  /** A server-created import link already counts this form with its receipt. */
  linkedImport?: boolean;
}
export interface IncomeReconciliationDecision {
  id: string;
  taxYear: number;
  decision: ReconciliationDecisionType;
  sources: IncomeSourceRef[];
  platformFeeAmount: number;
  /** Empty for every decision type other than k_not_business_income. */
  notBusinessParts: NotBusinessPart[];
  /** Guide-question answer. Never used in any total. */
  paymentMethodHint?: PaymentMethodHint;
  /** The 1099-NEC the owner marked as the corrected form. Only on corrected_form_replaces. */
  correctedFormId?: string;
  note?: string;
}
export interface FeeExpenseCandidate { decisionId: string; formId: string; label: string; amount: number }
export interface OutsideScheduleCItem {
  decisionId: string;
  formId: string;
  label: string;
  amount: number;
  status: 'needs_review';
}
export interface ReplacedForm {
  decisionId: string;
  formId: string;
  label: string;
  amount: number;
}
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

/**
 * Same payments may join a 1099-K to other records, or one 1099-NEC to the deposits
 * or direct income that report it. Two or more 1099-NEC forms are separate income.
 * A corrected 1099-NEC uses corrected_form_replaces. It is not a same-payments match.
 */
export function samePaymentsAllowed(sources: ReadonlyArray<{ kind: IncomeSourceKind; formType?: string }>): boolean {
  const forms = sources.filter(source => source.kind === 'form_1099');
  if (forms.some(form => form.formType === '1099-K')) return true;
  if (forms.length === 0) return true;
  const nonFormCount = sources.length - forms.length;
  return forms.length === 1 && nonFormCount > 0 && forms.every(form => form.formType === '1099-NEC');
}

function readNotBusinessParts(value: unknown): NotBusinessPart[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 2) return null;
  const seen = new Set<string>();
  const parts: NotBusinessPart[] = [];
  for (const part of value) {
    if (!part || typeof part !== 'object') return null;
    const { reason, amount } = part as Record<string, unknown>;
    if (!NOT_BUSINESS_REASONS.includes(reason as NotBusinessReason)) return null;
    if (typeof reason !== 'string' || seen.has(reason)) return null;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
    seen.add(reason);
    parts.push({ reason: reason as NotBusinessReason, amount });
  }
  return parts;
}

/** Shape-check a saved decision; malformed records are reported as stale, never applied. */
export function normalizeReconciliationDecision(record: Record<string, unknown>): IncomeReconciliationDecision | null {
  const { id, taxYear, decision, sources, platformFeeAmount, note, paymentMethodHint, correctedFormId } = record;
  if (typeof id !== 'string' || !id || typeof taxYear !== 'number' || !Number.isInteger(taxYear)) return null;
  if (!RECONCILIATION_DECISION_TYPES.includes(decision as ReconciliationDecisionType)) return null;
  if (correctedFormId !== undefined && correctedFormId !== null && (typeof correctedFormId !== 'string' || !correctedFormId.trim())) return null;
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const refs: IncomeSourceRef[] = [];
  for (const source of sources) {
    if (!source || typeof source !== 'object') return null;
    const { kind, id: sourceId, amount } = source as Record<string, unknown>;
    if (!INCOME_SOURCE_KINDS.includes(kind as IncomeSourceKind) || typeof sourceId !== 'string' || !sourceId || !isFiniteAmount(amount)) return null;
    refs.push({ kind: kind as IncomeSourceKind, id: sourceId, amount });
  }
  if (platformFeeAmount !== undefined && platformFeeAmount !== null && !isFiniteAmount(platformFeeAmount)) return null;
  const notBusinessParts = readNotBusinessParts(record.notBusinessParts);
  if (!notBusinessParts) return null;
  if (paymentMethodHint !== undefined && paymentMethodHint !== null && !PAYMENT_METHOD_HINTS.includes(paymentMethodHint as PaymentMethodHint)) return null;
  return {
    id, taxYear, decision: decision as ReconciliationDecisionType, sources: refs,
    platformFeeAmount: isFiniteAmount(platformFeeAmount) ? platformFeeAmount : 0,
    notBusinessParts,
    ...(typeof paymentMethodHint === 'string' ? { paymentMethodHint: paymentMethodHint as PaymentMethodHint } : {}),
    ...(typeof correctedFormId === 'string' && correctedFormId.trim() ? { correctedFormId: correctedFormId.trim() } : {}),
    ...(typeof note === 'string' && note ? { note } : {}),
  };
}

export type DecisionCheck =
  | { ok: true; countedCents: number; feeCents: number; returnsCents: number; personalCents: number; kinds: Set<IncomeSourceKind>; sources: IncomeSourceCandidate[] }
  | { ok: false; reason: string };

const okCheck = (
  countedCents: number, feeCents: number, kinds: Set<IncomeSourceKind>, sources: IncomeSourceCandidate[],
  returnsCents = 0, personalCents = 0,
): DecisionCheck => ({ ok: true, countedCents, feeCents, returnsCents, personalCents, kinds, sources });

/**
 * Validate one decision against the current records. `claimedBy` lets a caller
 * reject a source that another saved decision already explains.
 */
export interface ReconciliationValidateOptions {
  /**
   * New saves always reject a same-payments decision made of only 1099-NECs.
   * A stored decision for the current year is rejected only when the R10.5 flag
   * is on. Pass false to keep counting a decision that was saved before that rule,
   * including a prior year that may already be filed.
   */
  rejectNecOnlySamePayments?: boolean;
}

export function validateReconciliationDecision(
  decision: IncomeReconciliationDecision,
  candidates: ReadonlyMap<string, IncomeSourceCandidate>,
  claimedBy: ReadonlyMap<string, string> = new Map(),
  options: ReconciliationValidateOptions = {},
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
  const parts = decision.notBusinessParts ?? [];
  if (decision.decision !== 'k_not_business_income' && parts.length) {
    return { ok: false, reason: 'Refund and personal amounts can only be recorded on the 1099-K decision for amounts that are not business income.' };
  }
  const feeCents = toCents(decision.platformFeeAmount);
  const kinds = new Set(resolved.map(source => source.kind));
  const byKind = (kind: IncomeSourceKind) => resolved.filter(source => source.kind === kind);
  const sum = (sources: IncomeSourceCandidate[]) => sources.reduce((total, source) => total + toCents(source.amount), 0);
  const forms = byKind('form_1099'), receipts = byKind('gross_receipt'), transactions = byKind('transaction');

  if (decision.decision === 'separate_income') {
    if (feeCents) return { ok: false, reason: 'Separate income does not record a platform fee.' };
    return okCheck(sum(resolved), 0, kinds, resolved);
  }

  if (decision.decision === 'corrected_form_replaces') {
    if (forms.length !== 2 || forms.some(form => form.formType !== '1099-NEC')) return { ok: false, reason: ERR_CORRECTED_NEEDS_TWO_NEC };
    if (feeCents) return { ok: false, reason: 'A corrected 1099-NEC does not record a platform fee.' };
    const [first, second] = forms;
    const payerA = (first.payerName ?? '').trim();
    const payerB = (second.payerName ?? '').trim();
    if (payerA.toLowerCase() !== payerB.toLowerCase()) {
      return { ok: false, reason: fillIncomeCopy(ERR_CORRECTED_SAME_PAYER, { payerA: payerA || 'Unknown payer', payerB: payerB || 'Unknown payer' }) };
    }
    if (!decision.correctedFormId || !forms.some(form => form.id === decision.correctedFormId)) return { ok: false, reason: ERR_CORRECTED_PICK };
    const corrected = forms.find(form => form.id === decision.correctedFormId)!;
    const correctedCents = toCents(corrected.amount);
    for (const [label, group] of [['direct income', receipts], ['bank income', transactions]] as const) {
      if (!group.length) continue;
      const selected = sum(group);
      if (selected !== correctedCents) {
        return { ok: false, reason: fillIncomeCopy(ERR_CORRECTED_SUM, { kind: label, selected: dollars(selected), corrected: dollars(correctedCents) }) };
      }
    }
    return okCheck(correctedCents, 0, kinds, resolved);
  }

  if (decision.decision === 'same_payments') {
    if (resolved.length < 2) return { ok: false, reason: 'Select at least two records that describe the same payments.' };
    // Two 1099s can report one payment stream. Duplicate receipts or deposits of one kind are
    // summed by the base rule, so they cannot be declared duplicates here.
    if (kinds.size < 2 && forms.length !== resolved.length) return { ok: false, reason: 'Select records of at least two kinds (a 1099, direct income or bank income) that describe the same payments.' };
    if (!samePaymentsAllowed(resolved) && options.rejectNecOnlySamePayments !== false) return { ok: false, reason: ERR_SAME_NEEDS_K };
    if (feeCents) return { ok: false, reason: 'Record platform fees with the “1099-K includes fees” decision.' };
    // An information return reports the whole payment stream; receipts and deposits may be split.
    const totals = [...forms.map(form => toCents(form.amount)), ...(receipts.length ? [sum(receipts)] : []), ...(transactions.length ? [sum(transactions)] : [])];
    const target = totals[0];
    if (totals.some(total => total !== target)) {
      const partLabels = [
        ...forms.map(form => `${form.label} ${dollars(toCents(form.amount))}`),
        ...(receipts.length ? [`direct income ${dollars(sum(receipts))}`] : []),
        ...(transactions.length ? [`bank income ${dollars(sum(transactions))}`] : []),
      ];
      const kForm = forms.find(form => form.formType === '1099-K');
      const hint = kForm && [receipts, transactions].some(group => group.length && sum(group) < toCents(kForm.amount))
        ? ' If the platform deducted fees before depositing, choose “1099-K includes fees” and enter the fee amount.'
        : '';
      return { ok: false, reason: `Amounts do not match (${partLabels.join('; ')}). Each kind of record must total the same amount before it can count once.${hint}` };
    }
    return okCheck(target, 0, kinds, resolved);
  }

  if (decision.decision === 'k_not_business_income') {
    if (forms.length !== 1 || forms[0].formType !== '1099-K') return { ok: false, reason: ERR_NOT_BUSINESS_NEEDS_ONE_K };
    if (!parts.length) return { ok: false, reason: ERR_REASON_REQUIRED };
    const partCents = (reason: NotBusinessReason) => {
      const part = parts.find(item => item.reason === reason);
      return part ? toCents(part.amount) : 0;
    };
    const refunds = partCents('refunds_credits');
    const personal = partCents('personal');
    const gross = toCents(forms[0].amount);
    if (refunds + personal + feeCents > gross) {
      return { ok: false, reason: fillIncomeCopy(ERR_PARTS_EXCEED_GROSS, { parts: dollars(refunds + personal + feeCents), gross: dollars(gross) }) };
    }
    const business = gross - refunds - personal - feeCents;
    const groups = [['direct income', receipts], ['bank income', transactions]] as const;
    if (business > 0) {
      if (!receipts.length && !transactions.length) {
        return { ok: false, reason: fillIncomeCopy(ERR_SELECT_BUSINESS_RECORDS, { business: dollars(business) }) };
      }
      const mismatches = groups.flatMap(([label, group]) => group.length && sum(group) !== business ? [mismatchReason(label, sum(group), gross, refunds, personal, feeCents)] : []);
      if (mismatches.length) return { ok: false, reason: mismatches.join(' ') };
    } else if (receipts.length || transactions.length) {
      const selected = groups.filter(([, group]) => group.length);
      const reason = selected.map(([label, group]) => mismatchReason(label, sum(group), gross, refunds, personal, feeCents)).join(' ');
      return { ok: false, reason };
    }
    return okCheck(gross - personal, feeCents, kinds, resolved, refunds, personal);
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
  return okCheck(gross, feeCents, kinds, resolved);
}

/** Two or more 1099-NEC forms and no other records. One NEC plus its deposits is not this case. */
function necOnlySamePayments(decision: IncomeReconciliationDecision, candidates: ReadonlyMap<string, IncomeSourceCandidate>): boolean {
  if (decision.decision !== 'same_payments' || decision.sources.length < 2) return false;
  const forms: IncomeSourceCandidate[] = [];
  for (const ref of decision.sources) {
    const candidate = candidates.get(sourceKey(ref));
    if (!candidate || candidate.kind !== 'form_1099') return false;
    forms.push(candidate);
  }
  return forms.every(form => form.formType === '1099-NEC');
}

function mismatchReason(kind: string, selected: number, gross: number, refunds: number, personal: number, fee: number): string {
  return fillIncomeCopy(ERR_SUM_MISMATCH, {
    gross: dollars(gross), kind, selected: dollars(selected), refunds: dollars(refunds), personal: dollars(personal), fee: dollars(fee),
    total: dollars(selected + refunds + personal + fee),
  });
}

export interface IncomeReconciliationResolution {
  /** Cents counted once per applied decision. For a not-business decision this is line 1 (gross minus personal). */
  reconciledCents: number;
  /** Schedule C line 2 cents from owner-recorded 1099-K refunds and credits. */
  returnsCents: number;
  /** Cents of records no decision covers, by kind. */
  unclaimedCents: Record<IncomeSourceKind, number>;
  claimedBy: Map<string, string>;
  appliedDecisionIds: string[];
  feeExpenseCandidates: FeeExpenseCandidate[];
  outsideScheduleC: OutsideScheduleCItem[];
  /** Original 1099-NEC forms kept on file and counted at $0 because a corrected form was chosen. */
  replacedForms: ReplacedForm[];
  conflicts: IncomeReconciliationConflict[];
  /** Non-blocking notes. A prior-year NEC-only same-payments flag lives here and does not change the total. */
  notices: string[];
  /** Saved NEC-only same-payments decisions that keep counting while the R10.5 switch is off. */
  legacyNecWarningIds: string[];
  /** Current-year NEC-only same-payments decisions reopened while the R10.5 switch is on. */
  reopenedNecDecisionIds: string[];
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
  const outsideScheduleC: OutsideScheduleCItem[] = [];
  const replacedForms: ReplacedForm[] = [];
  const notices: string[] = [];
  const legacyNecWarningIds: string[] = [];
  const reopenedNecDecisionIds: string[] = [];
  const groups: Array<{ decisionId: string; kinds: Set<IncomeSourceKind> }> = [];
  const appliedDecisionIds: string[] = [];
  let reconciledCents = 0;
  let returnsCents = 0;
  const reopenNecOnly = r10_5LegacyNecReopen();
  for (const record of decisions) {
    const decision = normalizeReconciliationDecision(record);
    const decisionId = typeof record.id === 'string' ? record.id : 'unknown';
    if (!decision || decision.taxYear !== taxYear) {
      conflicts.push({ reason: 'stale_decision', decisionId, message: 'A saved reconciliation decision is malformed or belongs to another tax year. Remove it and record the decision again.', sources: [] });
      continue;
    }
    const necOnly = necOnlySamePayments(decision, byKey);
    const filedYear = reconciliationYearMayAlreadyBeFiled(decision.taxYear);
    const check = validateReconciliationDecision(decision, byKey, claimedBy, {
      rejectNecOnlySamePayments: reopenNecOnly && !(necOnly && filedYear),
    });
    if (!check.ok) {
      const reopenedNow = reopenNecOnly && necOnly && !filedYear && check.reason === ERR_SAME_NEEDS_K;
      const sources = decision.sources.map(ref => ({ ...ref, label: byKey.get(sourceKey(ref))?.label ?? `${SOURCE_KIND_LABELS[ref.kind]} (record removed)` }));
      if (reopenedNow) {
        const counted = validateReconciliationDecision(decision, byKey, claimedBy, { rejectNecOnlySamePayments: false });
        if (counted.ok) {
          counted.sources.forEach(source => claimedBy.set(sourceKey(source), decision.id));
          reconciledCents += counted.sources.reduce((total, source) => total + toCents(source.amount), 0);
          reopenedNecDecisionIds.push(decision.id);
          conflicts.push({ reason: 'stale_decision', decisionId, message: `${LEGACY_NEC_REOPEN_REASON} ${ERR_SAME_NEEDS_K}`, sources });
          continue;
        }
      }
      conflicts.push({
        reason: 'stale_decision', decisionId,
        message: `A saved reconciliation decision no longer matches your records: ${check.reason}`,
        sources,
      });
      continue;
    }
    if (reopenNecOnly && necOnly && filedYear) notices.push(LEGACY_NEC_PRIOR_YEAR_NOTE);
    const necForms = check.sources.filter(source => source.kind === 'form_1099' && source.formType === '1099-NEC').length;
    if (!reopenNecOnly && decision.decision === 'same_payments' && necForms >= 2) {
      notices.push(LEGACY_NEC_WARNING);
      legacyNecWarningIds.push(decision.id);
    }
    check.sources.forEach(source => claimedBy.set(sourceKey(source), decision.id));
    reconciledCents += check.countedCents;
    returnsCents += check.returnsCents;
    appliedDecisionIds.push(decision.id);
    if (decision.decision !== 'separate_income') groups.push({ decisionId: decision.id, kinds: check.kinds });
    if (check.feeCents) {
      const form = check.sources.find(source => source.kind === 'form_1099')!;
      feeExpenseCandidates.push({ decisionId: decision.id, formId: form.id, label: form.label, amount: check.feeCents / 100 });
    }
    if (check.personalCents) {
      const form = check.sources.find(source => source.kind === 'form_1099')!;
      outsideScheduleC.push({ decisionId: decision.id, formId: form.id, label: form.label, amount: check.personalCents / 100, status: 'needs_review' });
    }
    if (decision.decision === 'corrected_form_replaces') {
      const original = check.sources.find(source => source.kind === 'form_1099' && source.id !== decision.correctedFormId);
      if (original) replacedForms.push({ decisionId: decision.id, formId: original.id, label: original.label, amount: original.amount });
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
  return { reconciledCents, returnsCents, unclaimedCents, claimedBy, appliedDecisionIds, feeExpenseCandidates, outsideScheduleC, replacedForms, conflicts, notices, legacyNecWarningIds, reopenedNecDecisionIds };
}
