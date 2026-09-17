import { createHash, randomUUID } from 'node:crypto';
import type { DocumentReference } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import type { OutputType } from './analyzeTransaction';
import { getOpenAIModel } from '@/lib/openai/client';
import { reviewCategory, type AiReviewSuggestion, type TransactionKind } from '@/lib/transactions/ai-review-contract';

export const ANALYSIS_LEASE_MS = 240_000;
export interface AnalysisLease { token: string; inputHash: string; expiresAt: number }
const INPUT_FIELDS = [
  'trans_id', 'merchant_name', 'name', 'amount', 'date', 'datetime', 'category', 'bank_category', 'description', 'notes', 'note',
  'account_id', 'pending', 'business_purpose', 'attendees', 'travel_destination', 'equipment_details',
  'client_project', 'documentation_status', 'meeting_notes', 'mileage_details', 'location', 'city', 'state',
  'merchant_category_code', 'mcc', 'payment_channel', 'authorized_date', 'iso_currency_code',
  'unofficial_currency_code', 'personal_finance_category', 'counterparties', 'merchant_entity_id',
  'transaction_kind', 'business_use_percentage',
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
export function analysisSuggestionUpdate(result: OutputType, now = Date.now(), canonicalData?: Record<string, unknown>, profileHash?: string) {
  const evidence = result as OutputType & { transaction_kind?: TransactionKind; tax_year?: number | null;
    policy_version?: string; sources?: AiReviewSuggestion['sources'] };
  const model = result.provenance?.model?.trim() || getOpenAIModel('transaction');
  const transactionKind = evidence.transaction_kind ?? (canonicalData && Number(canonicalData.amount) > 0 ?
    result.expense_type === 'personal' ? 'personal' : 'expense' : 'unknown');
  const suggestion: AiReviewSuggestion = {
    id: randomUUID(), status: result.status, transactionKind, category: result.category ?? null,
    isDeductible: result.is_deductible ?? null, deductiblePercent: result.deductible_percent ?? null,
    reasoning: result.customized_reason ?? result.reasoning_summary ?? result.reason ?? '',
    questions: result.questions ?? [], documentationRequired: result.documentation_required ?? [],
    irsReferences: result.irs_refs ?? [], sources: evidence.sources ?? [], taxYear: evidence.tax_year ?? null,
    policyVersion: evidence.policy_version ?? null, model,
    analyzedAt: now, inputHash: canonicalData ? analysisInputHash(canonicalData) : '',
    profileHash: profileHash ?? '',
    categoryReady: result.status !== 'blocked' || result.missing_fields?.some(field => ['supported_tax_year', 'entity_tax_treatment'].includes(field)) === true,
  };
  // A saved suggestion never approves a credit/zero amount as a new expense or approves an unsupported method.
  if (canonicalData && (transactionKind === 'expense' && !(Number(canonicalData.amount) > 0) ||
      transactionKind === 'income' && !(Number(canonicalData.amount) < 0) ||
      transactionKind === 'refund' && !(Number(canonicalData.amount) < 0) ||
      ['income', 'transfer', 'personal', 'refund'].includes(transactionKind) && suggestion.isDeductible === true)) {
    suggestion.status = 'needs_more_info'; suggestion.isDeductible = null; suggestion.deductiblePercent = null;
    suggestion.questions = [...suggestion.questions, 'Confirm whether this entry is a purchase, income, a transfer, or a refund before assigning tax treatment.'].slice(0, 3);
  }
  const supportedCategory = reviewCategory(suggestion.category);
  if (suggestion.status === 'ok' && canonicalData && (transactionKind === 'unknown' ||
      suggestion.isDeductible === true && (!supportedCategory || supportedCategory.recordedCategory.endsWith('_REVIEW_REQUIRED') ||
        suggestion.deductiblePercent !== (supportedCategory.value === 'meals_50' ? 50 : 100)))) {
    suggestion.status = 'needs_more_info'; suggestion.isDeductible = null; suggestion.deductiblePercent = null;
    if (!suggestion.questions.length) suggestion.questions = ['Confirm the business use and applicable tax treatment before claiming a deduction.'];
  }
  const label = suggestion.status === 'needs_more_info' ? 'Needs more information' : suggestion.status === 'blocked' ? 'Needs manual review' :
    suggestion.isDeductible === true ? 'Likely Deductible' : suggestion.isDeductible === false ? 'Unlikely Deductible' : 'Needs manual review';
  return {
    ai_suggestion: suggestion, ai_transaction_kind: transactionKind,
    ai_tax_year: evidence.tax_year ?? null, ai_sources: evidence.sources ?? [],
    ai_policy_version: evidence.policy_version ?? null, ai_provenance: evidence.provenance ?? null,
    ai_status: suggestion.status, ai_category: result.category ?? null,
    ai_deductible_percent: suggestion.deductiblePercent,
    ai_key_analysis_factor: result.key_analysis_factor ?? null,
    ai_customized_reason: result.customized_reason ?? null,
    ai_reasoning_summary: result.reasoning_summary ?? null,
    ai_irs_refs: result.irs_refs ?? [], ai_audit_risk: result.audit_risk ?? null,
    ai_audit_risk_rationale: result.audit_risk_rationale ?? null, ai_confidence: result.confidence ?? null,
    ai_missing_fields: result.missing_fields ?? [], ai_questions: suggestion.questions,
    ai_documentation_required: result.documentation_required ?? [], ai_reason_hash: result.reason_hash ?? null,
    ai_model: model, ai_last_analyzed_at: now,
    deductionStatus: label, confidence: result.confidence ?? null,
    reasoning: result.customized_reason ?? result.reasoning_summary ?? null,
    irsPublication: result.irs_refs?.[0] ?? null, irsSection: null,
    ai: {
      transaction_kind: transactionKind, tax_year: evidence.tax_year ?? null, sources: evidence.sources ?? [],
      policy_version: evidence.policy_version ?? null, provenance: evidence.provenance ?? null,
      status: suggestion.status, status_label: label, score_pct: result.confidence == null ? null : Math.round(result.confidence * 100),
      reasoning: result.customized_reason ?? result.reasoning_summary ?? null, category: result.category ?? null,
      irs_refs: result.irs_refs ?? [], audit_risk: result.audit_risk ?? null,
      deductible_percent: suggestion.deductiblePercent, questions: suggestion.questions,
      missing_fields: result.missing_fields ?? [], documentation_required: result.documentation_required ?? [],
      model, last_analyzed_at: now,
    },
    analyzed: true, analysis_status: 'completed', analysisStatus: 'completed', analysisErrorCode: null,
    analysisCompletedAt: new Date(now), analysisUpdatedAt: new Date(now).toISOString(),
    analysisLeaseToken: null, analysisLeaseExpiresAt: null,
  };
}

export async function persistAnalysisSuggestion(ref: DocumentReference, result: OutputType, lease: AnalysisLease, profileHash?: string) {
  return adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || !isAnalysisLeaseCurrent(snap.data()!, lease)) return { status: 'stale' as const };
    const update = analysisSuggestionUpdate(result, Date.now(), snap.data()!, profileHash);
    tx.update(ref, update);
    return { status: 'saved' as const, suggestion: update.ai_suggestion };
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
