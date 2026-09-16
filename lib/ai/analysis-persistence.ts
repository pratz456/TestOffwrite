import { createHash, randomUUID } from 'node:crypto';
import type { DocumentReference } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import type { OutputType } from './analyzeTransaction';

export const ANALYSIS_LEASE_MS = 240_000;
export interface AnalysisLease { token: string; inputHash: string; expiresAt: number }
const INPUT_FIELDS = [
  'trans_id', 'merchant_name', 'name', 'amount', 'date', 'datetime', 'category', 'description', 'notes', 'note',
  'account_id', 'pending', 'business_purpose', 'attendees', 'travel_destination', 'equipment_details',
  'client_project', 'documentation_status', 'meeting_notes', 'mileage_details', 'location', 'city', 'state',
  'merchant_category_code', 'mcc', 'payment_channel', 'authorized_date', 'iso_currency_code',
  'unofficial_currency_code', 'personal_finance_category', 'counterparties', 'merchant_entity_id',
] as const;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value ?? null;
}

/** Classification fields are excluded: AI never owns or writes the user's tax decision. */
export function analysisInputHash(data: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(canonical(Object.fromEntries(INPUT_FIELDS.map(key => [key, data[key]]))))).digest('hex');
}

export function createAnalysisLease(data: Record<string, unknown>, now = Date.now()): AnalysisLease {
  return { token: randomUUID(), inputHash: analysisInputHash(data), expiresAt: now + ANALYSIS_LEASE_MS };
}

export function hasActiveAnalysisLease(data: Record<string, unknown>, now = Date.now()): boolean {
  return typeof data.analysisLeaseToken === 'string' && typeof data.analysisLeaseExpiresAt === 'number' && data.analysisLeaseExpiresAt > now;
}

export function analysisLeaseUpdate(lease: AnalysisLease) {
  return { analysisLeaseToken: lease.token, analysisInputHash: lease.inputHash, analysisLeaseExpiresAt: lease.expiresAt,
    analysis_status: 'running', analysisStatus: 'running', analysisStartedAt: new Date() };
}

export function isAnalysisLeaseCurrent(data: Record<string, unknown>, lease: AnalysisLease, now = Date.now()): boolean {
  return data.analysisLeaseToken === lease.token && data.analysisInputHash === lease.inputHash &&
    lease.expiresAt > now && analysisInputHash(data) === lease.inputHash;
}

/** Call only after resolving and authorizing the transaction's actual document reference. */
export async function claimAnalysisLease(ref: DocumentReference) {
  return adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { status: 'missing' as const };
    const data = snap.data()!;
    if (hasActiveAnalysisLease(data)) return { status: 'busy' as const };
    const lease = createAnalysisLease(data);
    tx.update(ref, analysisLeaseUpdate(lease));
    return { status: 'claimed' as const, lease, data };
  });
}

/** Only suggestions and workflow state; no user classification, category, amount, or reason fields. */
export function analysisSuggestionUpdate(result: OutputType, now = Date.now()) {
  const label = result.status === 'needs_more_info' ? 'Needs more information' : result.status === 'blocked' ? 'Needs manual review' :
    result.is_deductible === true ? 'Likely Deductible' : result.is_deductible === false ? 'Unlikely Deductible' : 'Needs manual review';
  return {
    ai_status: result.status, ai_category: result.category ?? null,
    ai_deductible_percent: result.deductible_percent ?? null,
    ai_key_analysis_factor: result.key_analysis_factor ?? null,
    ai_customized_reason: result.customized_reason ?? null,
    ai_reasoning_summary: result.reasoning_summary ?? null,
    ai_irs_refs: result.irs_refs ?? [], ai_audit_risk: result.audit_risk ?? null,
    ai_audit_risk_rationale: result.audit_risk_rationale ?? null, ai_confidence: result.confidence ?? null,
    ai_missing_fields: result.missing_fields ?? [], ai_questions: result.questions ?? [],
    ai_documentation_required: result.documentation_required ?? [], ai_reason_hash: result.reason_hash ?? null,
    ai_model: process.env.OPENAI_MODEL || 'gpt-4o-mini', ai_last_analyzed_at: now,
    deductionStatus: label, confidence: result.confidence ?? null,
    reasoning: result.customized_reason ?? result.reasoning_summary ?? null,
    irsPublication: result.irs_refs?.[0] ?? null, irsSection: null,
    ai: {
      status: result.status, status_label: label, score_pct: result.confidence == null ? null : Math.round(result.confidence * 100),
      reasoning: result.customized_reason ?? result.reasoning_summary ?? null, category: result.category ?? null,
      irs_refs: result.irs_refs ?? [], audit_risk: result.audit_risk ?? null,
      deductible_percent: result.deductible_percent ?? null, questions: result.questions ?? [],
      missing_fields: result.missing_fields ?? [], documentation_required: result.documentation_required ?? [],
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini', last_analyzed_at: now,
    },
    analyzed: true, analysis_status: 'completed', analysisStatus: 'completed', analysisErrorCode: null,
    analysisCompletedAt: new Date(now), analysisUpdatedAt: new Date(now).toISOString(),
    analysisLeaseToken: null, analysisLeaseExpiresAt: null,
  };
}

export async function persistAnalysisSuggestion(ref: DocumentReference, result: OutputType, lease: AnalysisLease) {
  return adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || !isAnalysisLeaseCurrent(snap.data()!, lease)) return { status: 'stale' as const };
    tx.update(ref, analysisSuggestionUpdate(result));
    return { status: 'saved' as const };
  });
}

export async function releaseAnalysisLease(ref: DocumentReference, lease: AnalysisLease, code = 'AI_FAILED') {
  await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data()?.analysisLeaseToken === lease.token) {
      tx.update(ref, { analysisLeaseToken: null, analysisLeaseExpiresAt: null,
        analysis_status: 'failed', analysisStatus: 'failed', analysisErrorCode: code });
    }
  });
}
