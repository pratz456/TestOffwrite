import { IncomeReconciliationRequiredError, listIncomeSourceCandidates, type IncomeRecord } from './business-income';
import {
  normalizeReconciliationDecision, resolveIncomeSources, sourceKey, validateReconciliationDecision,
  type FeeExpenseCandidate, type IncomeReconciliationConflict, type IncomeSourceCandidate, type IncomeSourceRef, type ReconciliationDecisionType,
} from './income-reconciliation';

/** Deep link into the reconciliation panel for one tax year. */
export const incomeReconciliationPath = (taxYear: number) => `/protected?screen=income-tracking&tab=reconcile&year=${taxYear}`;

export const INCOME_RECONCILIATION_POLICY = 'WriteOff never merges, edits or deletes income records automatically. A reconciliation decision only records how existing records relate so each payment counts once; every record stays exactly as you saved it.';

/**
 * Shared HTTP 422 body for every route that withholds a total behind the income
 * gate. Conflicts name records only by kind, id, label and amount the owner
 * already sees in the app; the JSON and PDF routes must return identical bodies.
 */
export function incomeReconciliationReviewBody(error: IncomeReconciliationRequiredError, taxYear: number) {
  return {
    error: error.message,
    code: error.code,
    taxYear,
    conflicts: error.conflicts,
    reviewPath: incomeReconciliationPath(taxYear),
    explainerPath: `/api/income/reconciliation?year=${taxYear}`,
  };
}

export interface IncomeSourceRecords {
  transactions: ReadonlyArray<IncomeRecord>;
  receipts: ReadonlyArray<IncomeRecord>;
  forms: ReadonlyArray<IncomeRecord>;
  decisions: ReadonlyArray<IncomeRecord>;
}

export interface SavedDecisionView {
  id: string;
  decision: ReconciliationDecisionType | 'unknown';
  sources: Array<IncomeSourceRef & { label: string }>;
  platformFeeAmount: number;
  note: string;
  /** Gross receipts this decision counted when it was saved. */
  countedAmount: number | null;
  decidedAt: string | null;
  /** False when the decision no longer matches the current records and is reported as a conflict. */
  applied: boolean;
}

export interface IncomeReconciliationSummary {
  taxYear: number;
  candidates: Array<IncomeSourceCandidate & { decisionId?: string }>;
  decisions: SavedDecisionView[];
  conflicts: IncomeReconciliationConflict[];
  /** Schedule C line 1 for the year once nothing is ambiguous; null while conflicts remain. */
  grossReceipts: number | null;
  /** Dollars counted once by applied decisions, and dollars of records no decision covers. */
  reconciledAmount: number;
  unclaimedAmount: number;
  feeExpenseCandidates: FeeExpenseCandidate[];
  /** Set when a saved record needs review outside this workflow (e.g. a 1099-MISC or rental receipt). */
  unsupported: string | null;
  policy: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';
const str = (value: unknown) => typeof value === 'string' ? value : '';

function decisionView(record: IncomeRecord, appliedIds: ReadonlySet<string>): SavedDecisionView {
  const normalized = normalizeReconciliationDecision(record);
  const id = str(record.id);
  const rawSources = Array.isArray(record.sources) ? record.sources.filter(isRecord) : [];
  return {
    id,
    decision: normalized?.decision ?? 'unknown',
    sources: rawSources.map(source => ({
      kind: source.kind as IncomeSourceRef['kind'], id: str(source.id),
      amount: typeof source.amount === 'number' ? source.amount : 0, label: str(source.label),
    })),
    platformFeeAmount: normalized?.platformFeeAmount ?? 0,
    note: str(record.note),
    countedAmount: typeof record.countedAmount === 'number' && Number.isFinite(record.countedAmount) ? record.countedAmount : null,
    decidedAt: str(record.decidedAt) || null,
    applied: appliedIds.has(id),
  };
}

/** The owner-facing state of one tax year: what can be reconciled, what was decided, what still blocks a total. */
export function summarizeIncomeReconciliation(taxYear: number, records: IncomeSourceRecords): IncomeReconciliationSummary {
  const base = { taxYear, feeExpenseCandidates: [] as FeeExpenseCandidate[], policy: INCOME_RECONCILIATION_POLICY };
  let candidates: IncomeSourceCandidate[];
  try {
    candidates = listIncomeSourceCandidates(taxYear, records.transactions, records.receipts, records.forms).candidates;
  } catch (error) {
    if (!(error instanceof IncomeReconciliationRequiredError)) throw error;
    return { ...base, candidates: [], decisions: records.decisions.map(record => decisionView(record, new Set())), conflicts: [], grossReceipts: null, reconciledAmount: 0, unclaimedAmount: 0, unsupported: error.message };
  }
  const resolution = resolveIncomeSources(taxYear, candidates, records.decisions);
  const appliedIds = new Set(resolution.appliedDecisionIds);
  const unclaimed = resolution.unclaimedCents.form_1099 + resolution.unclaimedCents.gross_receipt + resolution.unclaimedCents.transaction;
  return {
    ...base,
    candidates: candidates.map(candidate => {
      const decisionId = resolution.claimedBy.get(sourceKey(candidate));
      return decisionId ? { ...candidate, decisionId } : candidate;
    }),
    decisions: records.decisions.map(record => decisionView(record, appliedIds)),
    conflicts: resolution.conflicts,
    grossReceipts: resolution.conflicts.length ? null : (resolution.reconciledCents + unclaimed) / 100,
    reconciledAmount: resolution.reconciledCents / 100,
    unclaimedAmount: unclaimed / 100,
    feeExpenseCandidates: resolution.feeExpenseCandidates,
    unsupported: null,
  };
}

export interface DecisionRequest {
  /** The saved decision being replaced, or a placeholder for a new one. */
  id: string;
  decision: ReconciliationDecisionType;
  sources: IncomeSourceRef[];
  platformFeeAmount: number;
  note: string;
}

export interface PreparedDecision {
  taxYear: number;
  decision: ReconciliationDecisionType;
  sources: Array<IncomeSourceRef & { label: string }>;
  platformFeeAmount: number;
  note: string;
  countedAmount: number;
}

export type DecisionPreparation =
  | { ok: true; stored: PreparedDecision }
  | { ok: false; status: 400 | 422; reason: string };

/**
 * Check a requested decision against the owner's current records and the other
 * saved decisions before it is stored. Labels and amounts are captured from the
 * records as they are now, so a later edit to a record surfaces as a stale decision.
 */
export function prepareReconciliationDecision(taxYear: number, records: IncomeSourceRecords, request: DecisionRequest): DecisionPreparation {
  let candidates: IncomeSourceCandidate[];
  try {
    candidates = listIncomeSourceCandidates(taxYear, records.transactions, records.receipts, records.forms).candidates;
  } catch (error) {
    if (!(error instanceof IncomeReconciliationRequiredError)) throw error;
    return { ok: false, status: 422, reason: error.message };
  }
  const others = records.decisions.filter(record => record.id !== request.id);
  const { claimedBy } = resolveIncomeSources(taxYear, candidates, others);
  const byKey = new Map(candidates.map(candidate => [sourceKey(candidate), candidate] as const));
  const check = validateReconciliationDecision({ ...request, taxYear }, byKey, claimedBy);
  if (!check.ok) return { ok: false, status: 400, reason: check.reason };
  return {
    ok: true,
    stored: {
      taxYear, decision: request.decision, note: request.note,
      sources: check.sources.map(source => ({ kind: source.kind, id: source.id, amount: source.amount, label: source.label })),
      platformFeeAmount: check.feeCents / 100,
      countedAmount: check.countedCents / 100,
    },
  };
}
