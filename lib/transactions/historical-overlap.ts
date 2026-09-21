/**
 * Historical-overlap reconciliation model.
 *
 * After a bank is relinked under the replacement Plaid client, the new Item
 * syncs the same historical purchases under new account documents and new
 * transaction ids. The read-only inventory groups exact matches across account
 * scopes for human review; this module owns that key and turns reviewed
 * decisions into the server-only writes the operator command applies.
 *
 * The old record stays canonical because it carries the owner's confirmations.
 * A duplicate new record is stamped `superseded_by` and excluded from every
 * total. Nothing is deleted or merged, and neither record's `is_deductible`
 * or `review_status` is ever changed.
 *
 * The .mjs operator scripts load this file through Node's TypeScript type
 * stripping, so it must stay free of runtime imports and of non-erasable
 * syntax (enums, parameter properties, namespaces).
 */

export type OverlapRecordData = Record<string, unknown>;

export const SUPERSEDED_REASON_HISTORICAL_OVERLAP = 'historical_overlap';

/** Written only by the Admin SDK; firestore.rules keeps every one outside the client allow-lists. */
export const OVERLAP_SERVER_ONLY_FIELDS = Object.freeze([
  'superseded_by',
  'superseded_at',
  'superseded_reason',
  'superseded_decision_id',
  'overlap_reviewed',
  'overlap_reviewed_at',
  'overlap_reviewed_decision_id',
] as const);

/** Any record shape that may carry the server-only marker (hydrated Transaction, export row, raw document). */
export type SupersedableRecord = { superseded_by?: unknown };

export function isSupersededRecord(record: SupersedableRecord | null | undefined): boolean {
  return typeof record?.superseded_by === 'string' && record.superseded_by.length > 0;
}

// ── Overlap key (shared with scripts/production-migration-inventory.mjs) ─────

export function normalizedOverlapDate(value: unknown): string | null {
  const text = typeof value === 'string' ? value.slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function normalizedOverlapCents(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

export function normalizedOverlapMerchant(data: OverlapRecordData): string {
  const value = data.merchant_name || data.name || data.description;
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
    : '';
}

/** Exact key: calendar date, signed cents, normalized merchant text and currency. Null when a record is incomplete. */
export function overlapKey(data: OverlapRecordData): string | null {
  const date = normalizedOverlapDate(data.date);
  const cents = normalizedOverlapCents(data.amount);
  const merchant = normalizedOverlapMerchant(data);
  if (!date || cents === null || !merchant) return null;
  const currency = String(data.iso_currency_code || data.unofficial_currency_code || 'unknown').toUpperCase();
  return JSON.stringify([date, cents, merchant, currency]);
}

/** Records that can still take part in an overlap group: posted, kept by the bank, and not yet reconciled. */
export function isOverlapCandidateRecord(data: OverlapRecordData): boolean {
  return data.pending !== true && data.bank_removed !== true && !isSupersededRecord(data) && data.overlap_reviewed !== true;
}

export function overlapCandidateKey(data: OverlapRecordData): string | null {
  return isOverlapCandidateRecord(data) ? overlapKey(data) : null;
}

// ── Record references ────────────────────────────────────────────────────────

export interface OverlapRecord {
  /** Full Firestore document path, as reported by the inventory. */
  path: string;
  data: OverlapRecordData;
}

export type ParsedTransactionPath =
  | { kind: 'account'; uid: string; accountId: string; transactionId: string }
  | { kind: 'root'; transactionId: string };

const SEGMENT = /^[^/\s]+$/;
const validSegment = (segment: string) => SEGMENT.test(segment) && segment !== '.' && segment !== '..';

/** Accepts the two record shapes the inventory reports; anything else is not a transaction record. */
export function parseTransactionRecordPath(path: unknown): ParsedTransactionPath | null {
  if (typeof path !== 'string') return null;
  const segments = path.split('/');
  if (!segments.every(validSegment)) return null;
  if (segments.length === 6 && segments[0] === 'user_profiles' && segments[2] === 'accounts' && segments[4] === 'transactions') {
    return { kind: 'account', uid: segments[1], accountId: segments[3], transactionId: segments[5] };
  }
  if (segments.length === 2 && segments[0] === 'transactions') return { kind: 'root', transactionId: segments[1] };
  return null;
}

/** Account scope used for grouping; legacy root records are scoped by their recorded account id. */
export function overlapRecordScope(record: OverlapRecord): string | null {
  const parsed = parseTransactionRecordPath(record.path);
  if (!parsed) return null;
  if (parsed.kind === 'account') return parsed.accountId;
  const accountId = record.data.account_id ?? record.data.accountId;
  return `root:${typeof accountId === 'string' && accountId ? accountId : 'unknown'}`;
}

/** Owner of a record; null when the path and the record disagree or no owner is recorded. */
export function overlapRecordOwner(record: OverlapRecord): string | null {
  const parsed = parseTransactionRecordPath(record.path);
  if (!parsed) return null;
  const recorded = [record.data.userId, record.data.user_id].filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (parsed.kind === 'account') {
    return recorded.every(value => value === parsed.uid) ? parsed.uid : null;
  }
  return recorded.length && recorded.every(value => value === recorded[0]) ? recorded[0] : null;
}

// ── Matching ─────────────────────────────────────────────────────────────────

export interface HistoricalOverlapGroup {
  key: string;
  canonical: OverlapRecord[];
  candidates: OverlapRecord[];
}

export interface MatchHistoricalOverlapsInput {
  /** Account scopes whose records carry the owner's history (the old Item's accounts). */
  canonicalScope: readonly string[];
  /** Account scopes created by the relink (the replacement Item's accounts). */
  candidateScope: readonly string[];
  records: readonly OverlapRecord[];
}

/**
 * Exact-match groups with at least one canonical-scope and one candidate-scope
 * record, in first-seen order. Exact matching can miss real duplicates and can
 * include legitimate repeated purchases; every group still needs a human decision.
 */
export function matchHistoricalOverlaps({ canonicalScope, candidateScope, records }: MatchHistoricalOverlapsInput): HistoricalOverlapGroup[] {
  const canonical = new Set(canonicalScope);
  const candidate = new Set(candidateScope);
  const groups = new Map<string, HistoricalOverlapGroup>();
  for (const record of records) {
    const scope = overlapRecordScope(record);
    if (scope === null || (!canonical.has(scope) && !candidate.has(scope))) continue;
    const key = overlapCandidateKey(record.data);
    if (!key) continue;
    const group = groups.get(key) ?? { key, canonical: [], candidates: [] };
    if (canonical.has(scope)) group.canonical.push(record);
    else group.candidates.push(record);
    groups.set(key, group);
  }
  return [...groups.values()].filter(group => group.canonical.length > 0 && group.candidates.length > 0);
}

// ── Decisions ────────────────────────────────────────────────────────────────

export type HistoricalOverlapDecisionKind = 'duplicate' | 'distinct' | 'defer';
export const HISTORICAL_OVERLAP_DECISIONS: readonly HistoricalOverlapDecisionKind[] = ['duplicate', 'distinct', 'defer'];

export interface HistoricalOverlapDecision {
  /** Inventory group label, kept as evidence; labels are salted per inventory run and never re-derived. */
  group?: string;
  canonical: string;
  candidate: string;
  decision: HistoricalOverlapDecisionKind;
  note?: string;
}

export type HistoricalOverlapRefusal =
  | 'invalid_decision'
  | 'invalid_record_path'
  | 'record_missing'
  | 'same_record'
  | 'same_scope'
  | 'owner_mismatch'
  | 'canonical_superseded'
  | 'candidate_superseded_elsewhere'
  | 'record_pending'
  | 'record_removed'
  | 'key_incomplete'
  | 'key_mismatch'
  | 'conflicting_decisions';

export class HistoricalOverlapError extends Error {
  readonly code: HistoricalOverlapRefusal;
  constructor(code: HistoricalOverlapRefusal, message: string) {
    super(message);
    this.name = 'HistoricalOverlapError';
    this.code = code;
  }
}

export type HistoricalOverlapAction = 'supersede' | 'mark_reviewed' | 'none';

export interface HistoricalOverlapWritePlan {
  decisionId: string;
  decision: HistoricalOverlapDecisionKind;
  canonical: string;
  candidate: string;
  action: HistoricalOverlapAction;
  /** The candidate already carries this decision; rerunning writes nothing. */
  alreadyApplied: boolean;
  /** Server-only field update for the candidate record, or null when nothing is written. */
  update: OverlapRecordData | null;
}

export interface PlanHistoricalOverlapOptions {
  decisionId: string;
  now: Date;
}

// A declaration (not an arrow const) so control flow treats each refusal as unreachable afterwards.
function refuse(code: HistoricalOverlapRefusal, message: string): never {
  throw new HistoricalOverlapError(code, message);
}

export function isHistoricalOverlapDecision(value: unknown): value is HistoricalOverlapDecision {
  if (!value || typeof value !== 'object') return false;
  const decision = value as Record<string, unknown>;
  return typeof decision.canonical === 'string' && typeof decision.candidate === 'string'
    && HISTORICAL_OVERLAP_DECISIONS.includes(decision.decision as HistoricalOverlapDecisionKind)
    && (decision.group === undefined || typeof decision.group === 'string')
    && (decision.note === undefined || typeof decision.note === 'string');
}

/**
 * Validate one reviewed decision against the records as they exist now and
 * describe the single write it produces. Refusals throw so nothing partial is
 * ever planned: a canonical must not itself be superseded, a candidate can be
 * superseded by exactly one canonical, both records must still share the exact
 * key, and pending or bank-removed records are never reconciled.
 */
export function planHistoricalOverlapDecision(
  decision: HistoricalOverlapDecision,
  records: { canonical: OverlapRecord | null; candidate: OverlapRecord | null },
  options: PlanHistoricalOverlapOptions,
): HistoricalOverlapWritePlan {
  if (!isHistoricalOverlapDecision(decision)) refuse('invalid_decision', 'Each decision needs canonical and candidate record paths and a decision of duplicate, distinct or defer.');
  const canonicalPath = parseTransactionRecordPath(decision.canonical);
  const candidatePath = parseTransactionRecordPath(decision.candidate);
  if (!canonicalPath || !candidatePath) refuse('invalid_record_path', 'Record references must be transaction document paths from the inventory.');
  if (decision.canonical === decision.candidate) refuse('same_record', 'A record cannot be reconciled against itself.');
  const base = { decisionId: options.decisionId, decision: decision.decision, canonical: decision.canonical, candidate: decision.candidate };
  if (decision.decision === 'defer') return { ...base, action: 'none', alreadyApplied: false, update: null };

  const { canonical, candidate } = records;
  if (!canonical || !candidate || canonical.path !== decision.canonical || candidate.path !== decision.candidate) {
    refuse('record_missing', 'Both records must exist at the referenced paths.');
  }
  const owner = overlapRecordOwner(canonical);
  if (!owner || owner !== overlapRecordOwner(candidate)) refuse('owner_mismatch', 'Both records must belong to the same owner.');
  const canonicalScope = overlapRecordScope(canonical);
  if (canonicalScope === null || canonicalScope === overlapRecordScope(candidate)) refuse('same_scope', 'Overlap decisions pair records from different account scopes.');
  if (isSupersededRecord(canonical.data)) refuse('canonical_superseded', 'A superseded record cannot be canonical.');
  for (const record of [canonical, candidate]) {
    if (record.data.pending === true) refuse('record_pending', 'Pending records are not reconciled; wait until the bank posts them.');
    if (record.data.bank_removed === true) refuse('record_removed', 'Bank-removed records are not reconciled.');
  }
  const canonicalKey = overlapKey(canonical.data);
  const candidateKey = overlapKey(candidate.data);
  if (!canonicalKey || !candidateKey) refuse('key_incomplete', 'Both records need a date, amount and merchant text.');
  if (canonicalKey !== candidateKey) refuse('key_mismatch', 'The records no longer share the same date, amount, merchant and currency; review them again.');

  const supersededBy = typeof candidate.data.superseded_by === 'string' ? candidate.data.superseded_by : null;
  if (decision.decision === 'duplicate') {
    if (supersededBy === decision.canonical) return { ...base, action: 'supersede', alreadyApplied: true, update: null };
    if (supersededBy) refuse('candidate_superseded_elsewhere', 'The candidate is already superseded by a different record.');
    if (candidate.data.overlap_reviewed === true) refuse('conflicting_decisions', 'The candidate was already recorded as distinct; reversing that decision needs a separate review.');
    return {
      ...base, action: 'supersede', alreadyApplied: false,
      update: {
        superseded_by: decision.canonical,
        superseded_at: options.now.toISOString(),
        superseded_reason: SUPERSEDED_REASON_HISTORICAL_OVERLAP,
        superseded_decision_id: options.decisionId,
      },
    };
  }
  if (supersededBy) {
    refuse(supersededBy === decision.canonical ? 'conflicting_decisions' : 'candidate_superseded_elsewhere',
      'The candidate is already superseded and cannot also be recorded as distinct.');
  }
  if (candidate.data.overlap_reviewed === true) return { ...base, action: 'mark_reviewed', alreadyApplied: true, update: null };
  return {
    ...base, action: 'mark_reviewed', alreadyApplied: false,
    update: {
      overlap_reviewed: true,
      overlap_reviewed_at: options.now.toISOString(),
      overlap_reviewed_decision_id: options.decisionId,
    },
  };
}

/**
 * Cross-decision checks for one reviewed plan: a candidate is superseded by at
 * most one canonical and never also recorded as distinct, a canonical of one
 * decision is never a superseded candidate of another, and no decision repeats.
 */
export function assertConsistentHistoricalOverlapDecisions(decisions: readonly HistoricalOverlapDecision[]): void {
  const seen = new Set<string>();
  const byCandidate = new Map<string, HistoricalOverlapDecisionKind[]>();
  const supersededCandidates = new Set<string>();
  for (const decision of decisions) {
    if (!isHistoricalOverlapDecision(decision)) refuse('invalid_decision', 'Each decision needs canonical and candidate record paths and a decision of duplicate, distinct or defer.');
    const identity = JSON.stringify([decision.canonical, decision.candidate, decision.decision]);
    if (seen.has(identity)) refuse('conflicting_decisions', 'The same decision is listed more than once.');
    seen.add(identity);
    if (decision.decision === 'defer') continue;
    const kinds = byCandidate.get(decision.candidate) ?? [];
    kinds.push(decision.decision);
    byCandidate.set(decision.candidate, kinds);
    if (decision.decision === 'duplicate') supersededCandidates.add(decision.candidate);
  }
  for (const kinds of byCandidate.values()) {
    const duplicates = kinds.filter(kind => kind === 'duplicate').length;
    if (duplicates > 1 || (duplicates === 1 && kinds.length > 1)) {
      refuse('conflicting_decisions', 'A candidate can be superseded by exactly one canonical record and cannot also be recorded as distinct.');
    }
  }
  for (const decision of decisions) {
    if (decision.decision !== 'defer' && supersededCandidates.has(decision.canonical)) {
      refuse('conflicting_decisions', 'A record superseded by one decision cannot be the canonical record of another.');
    }
  }
}
