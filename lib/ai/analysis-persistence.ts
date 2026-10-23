import { createHash, randomUUID } from 'node:crypto';
import type { DocumentReference } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { mileageVehicleCopyEnabled } from '@/lib/mileage/vehicle-copy';
import { vehicleFromDocument, vehicleMethodForTaxYear, type LegacyVehicleProfile, type VehicleRecord } from '@/lib/mileage/vehicles';
import { hiredFareOvernightConfirmed, hiredFarePurpose, hiredVehicleFare, HIRED_FARE_OVERNIGHT, HIRED_FARE_PERSONAL, HIRED_FARE_PURPOSE, SEPARATE_VEHICLE_COST_SHARE, standardMileageSeparateCost } from '@/lib/ai/vehicle-separate-costs';
import { ACTUAL_EXPENSE_BUSINESS_SHARE, finiteUsePercent } from '@/lib/ai/actual-expense-share';
import type { OutputType } from './analyzeTransaction';
import { composeExplanation, type ExplainableResult, type ExplanationProfile } from './explanation';
import { getOpenAIModel } from '@/lib/openai/client';
import { reviewCategory, type AiReviewSuggestion, type TransactionKind } from '@/lib/transactions/ai-review-contract';
import { analysisProfileHash } from './profile-context';
import { isCountableRecord } from '@/lib/transactions/record-scope';

export const ANALYSIS_LEASE_MS = 240_000;
export interface AnalysisLease { token: string; inputHash: string; expiresAt: number }
const INPUT_FIELDS = [
  'trans_id', 'merchant_name', 'name', 'amount', 'date', 'datetime', 'category', 'bank_category', 'description', 'notes', 'note',
  'account_id', 'pending', 'business_purpose', 'attendees', 'travel_destination', 'equipment_details',
  'client_project', 'documentation_status', 'meeting_notes', 'mileage_details', 'location', 'city', 'state',
  'receipt_url', 'receipt_filename', 'ocr_data',
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
  // Removal and supersession do not change model inputs, but either invalidates
  // a suggestion from an in-flight manual or background run.
  return isCountableRecord(data) && data.analysisLeaseToken === lease.token && data.analysisInputHash === lease.inputHash &&
    lease.expiresAt > now && analysisInputHash(data) === lease.inputHash;
}

/** Base vehicle-expense question. Actual expenses, an unknown method, no vehicle data, and the copy switch off all keep this text. */
export const VEHICLE_METHOD_GATE = {
  question: 'Do you use the standard mileage rate or actual expenses for this vehicle?',
  reason: 'Vehicle costs depend on the method chosen for the vehicle. Fuel, repairs and insurance are included in the standard mileage rate; with actual expenses they are allocated by business-use share. Record the method and your mileage log in Settings before this charge can count.',
} as const;

/** Standard mileage already covers running costs. Parking, tolls, car loan interest, and vehicle personal property tax stay deductible on their own. */
export const STANDARD_MILEAGE_RUNNING_COST_GATE = {
  question: 'Fuel, repairs, insurance and depreciation are included in the standard mileage rate. Parking, tolls, and the business share of car loan interest and personal property tax on the car are added on their own.',
  reason: 'This car uses the standard mileage rate, so fuel, repairs, insurance and depreciation are already included and are not deducted again. Parking, tolls, and the business share of car loan interest and personal property tax on the car are added on their own.',
} as const;

function approvalText(data: Record<string, unknown> | undefined): string {
  if (!data) return '';
  return ['merchant_name', 'name', 'description', 'notes', 'note', 'business_purpose']
    .map(key => typeof data[key] === 'string' ? data[key] as string : '')
    .filter(Boolean)
    .join(' ');
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

/**
 * Why an engine approval is withheld from the saved suggestion, in the user's terms. The review and
 * Schedule C paths cannot consume a deduction in a method-review category or at a partial share, so
 * the stored suggestion must ask for the fact that unblocks it rather than restate the approval.
 */
export interface VehicleMethodGateFacts {
  vehicles?: readonly VehicleRecord[] | null;
  profile?: LegacyVehicleProfile | null;
  taxYear?: number;
  vehicleId?: string | null;
}

export function withheldApprovalGate(input: { category: string | null; deductiblePercent: number | null; transactionKind: TransactionKind; amount?: unknown; text?: string; merchantText?: string; businessUsePercent?: number | null },
  expectedPercent: number, facts?: VehicleMethodGateFacts): { question: string; reason: string } | { share: number; reason?: string } | null {
  const category = reviewCategory(input.category);
  if (input.transactionKind === 'unknown') {
    return { question: 'Was this a purchase, customer payment, refund, loan, owner contribution or movement between your own accounts?',
      reason: 'The bank record and saved context do not establish the type of money movement. Confirm its purpose before any tax treatment is assigned.' };
  }
  if (!category || category.value === 'other') {
    return { question: 'Which expense category fits this charge?',
      reason: 'This charge does not fit a category WriteOff can place on Schedule C automatically. Choose a specific category, or keep it with its saved purpose for your preparer.' };
  }
  const separateCost = standardMileageSeparateCost(input.text ?? '');
  const vehiclePropertyTax = category.value === 'taxes_licenses' && separateCost === 'property_tax';
  if (category.value === 'vehicle_expense' || vehiclePropertyTax) {
    if (mileageVehicleCopyEnabled()) {
      const dated = facts?.taxYear;
      const fact = vehicleMethodForTaxYear({
        vehicles: facts?.vehicles,
        profile: facts?.profile,
        taxYear: typeof dated === 'number' ? dated : new Date().getFullYear(),
        vehicleId: facts?.vehicleId,
      });
      // Interest and vehicle property tax stay out of the mileage hold and count only at the recorded share, under either method.
      if (separateCost) {
        const recorded = finiteUsePercent(input.businessUsePercent) ?? finiteUsePercent(fact.businessUsePercent);
        if (recorded === null) return { ...SEPARATE_VEHICLE_COST_SHARE };
        return { share: recorded, reason: SEPARATE_VEHICLE_COST_SHARE.reason };
      }
      if (category.value === 'vehicle_expense' && hiredVehicleFare(input.merchantText ?? '')) {
        return { ...HIRED_FARE_PURPOSE };
      }
      if (fact.status === 'known' && fact.method === 'standard_mileage') {
        return { ...STANDARD_MILEAGE_RUNNING_COST_GATE };
      }
      if (fact.status === 'known' && fact.method === 'actual_expense') {
        const recorded = finiteUsePercent(input.businessUsePercent) ?? finiteUsePercent(fact.businessUsePercent);
        if (recorded === null) return { ...ACTUAL_EXPENSE_BUSINESS_SHARE };
        return { share: recorded };
      }
    }
    if (category.value === 'vehicle_expense') return { ...VEHICLE_METHOD_GATE };
  }
  if (category.value === 'equipment') {
    return { question: 'What was purchased, when was it first used for business, and which depreciation or de minimis election applies?',
      reason: 'Equipment is recovered through depreciation, Section 179 or the de minimis safe harbor election rather than expensed automatically. Record the asset facts before it counts.' };
  }
  if (category.value === 'home_office') {
    return { question: 'Is the space used regularly and exclusively for business, and which method (simplified or actual) applies?',
      reason: 'Home office costs are claimed through the home office deduction (Form 8829 or the simplified method), not as a direct expense. Answer the home office questions in Settings.' };
  }
  if (category.recordedCategory.endsWith('_REVIEW_REQUIRED')) {
    return { question: 'Which tax treatment applies to this charge?',
      reason: 'This category needs a separate tax method review before a deduction can be recorded. Save the category and review the treatment with your preparer.' };
  }
  const percent = input.deductiblePercent;
  const amount = Number(input.amount);
  const share = typeof percent === 'number' && Number.isFinite(amount) && amount > 0
    ? ` ($${(Math.abs(amount) * percent / 100).toFixed(2)} of $${Math.abs(amount).toFixed(2)})` : '';
  return { question: `Is this charge 100% business, or a shared item? WriteOff's Schedule C estimate includes charges only at ${expectedPercent}%; a partial share is kept with the record for your preparer.`,
    reason: typeof percent === 'number'
      ? `Only the recorded ${percent}% business share${share} would be deductible. WriteOff's Schedule C estimate does not include partial allocations automatically, so this charge is kept with its ${percent}% share for your preparer.`
      : `WriteOff's Schedule C estimate includes this category only at ${expectedPercent}%. Confirm the business share before it can count.` };
}

/** The fact the review chips should collect for a withheld approval (see `firstOpenQuestion`). */
export function withheldMissingField(category: string | null, transactionKind: TransactionKind): string {
  if (transactionKind === 'unknown') return 'transaction_kind';
  switch (reviewCategory(category)?.value) {
    case 'vehicle_expense': return 'vehicle_method';
    case 'equipment': return 'asset_treatment';
    case 'home_office': return 'home_office_eligibility';
    case undefined: case 'other': return 'expense_category';
    // Not `business_use_percentage`: the share is already saved; no chip can change what the estimate includes.
    default: return 'business_use_allocation';
  }
}

/** Only suggestions and workflow state; no user classification, category, amount, or reason fields. */
export function analysisSuggestionUpdate(result: OutputType, now = Date.now(), canonicalData?: Record<string, unknown>, profileHash?: string,
  profile?: ExplanationProfile | Record<string, unknown> | null, vehicleFacts?: VehicleMethodGateFacts) {
  const evidence = result as OutputType & { transaction_kind?: TransactionKind; tax_year?: number | null;
    policy_version?: string; sources?: AiReviewSuggestion['sources'] };
  const model = result.provenance?.model?.trim() || getOpenAIModel('transaction');
  const transactionKind = evidence.transaction_kind ?? (canonicalData && Number(canonicalData.amount) > 0 ?
    result.expense_type === 'personal' ? 'personal' : 'expense' : 'unknown');
  // A proposed purpose is a question for the user, so it only travels with the unresolved business_purpose field.
  const proposedPurpose = result.status === 'needs_more_info' && result.missing_fields?.includes('business_purpose') && typeof result.proposed_purpose === 'string'
    ? result.proposed_purpose.trim() || undefined : undefined;
  const scheduleCLine = transactionKind === 'expense' && typeof result.schedule_c_line === 'string' ? result.schedule_c_line.trim() || undefined : undefined;
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
    // Firestore rejects undefined, so the optional display fields are only written when the server set them.
    ...(proposedPurpose ? { proposedPurpose } : {}),
    ...(scheduleCLine ? { scheduleCLine } : {}),
  };
  // A saved suggestion never approves a credit/zero amount as a new expense or approves an unsupported method.
  if (canonicalData && (transactionKind === 'expense' && !(Number(canonicalData.amount) > 0) ||
      transactionKind === 'income' && !(Number(canonicalData.amount) < 0) ||
      transactionKind === 'refund' && !(Number(canonicalData.amount) < 0) ||
      ['income', 'transfer', 'personal', 'refund'].includes(transactionKind) && suggestion.isDeductible === true)) {
    suggestion.status = 'needs_more_info'; suggestion.isDeductible = null; suggestion.deductiblePercent = null;
    suggestion.questions = [...suggestion.questions, 'Confirm whether this entry is a purchase, income, a transfer, or a refund before assigning tax treatment.'].slice(0, 3);
  }
  const merchantText = canonicalData ? ['merchant_name', 'name', 'description'].map(key => typeof canonicalData[key] === 'string' ? canonicalData[key] as string : '').filter(Boolean).join(' ') : '';
  if (mileageVehicleCopyEnabled() && canonicalData && suggestion.status === 'ok' && suggestion.isDeductible === true &&
      suggestion.category === 'vehicle_expense' && /\buber\s*eats\b/i.test(merchantText)) {
    suggestion.category = 'meals_50';
    suggestion.deductiblePercent = 50;
    suggestion.scheduleCLine = '24b';
  }
  const purposeText = canonicalData ? ['business_purpose', 'notes', 'note'].map(key => typeof canonicalData[key] === 'string' ? canonicalData[key] as string : '').filter(Boolean).join(' ') : '';
  // A hired fare is transportation decided by the trip. It never takes the method or the share of the user's own car.
  // undefined keeps the incoming line. null clears it so a local fare is not filed on 24a or 27b.
  let scheduleLine: string | null | undefined;
  if (mileageVehicleCopyEnabled() && canonicalData && suggestion.status === 'ok' && suggestion.isDeductible === true &&
      hiredVehicleFare(merchantText) && suggestion.category !== 'meals_50' &&
      (suggestion.category === 'vehicle_expense' || suggestion.category === 'travel' || suggestion.category === 'other')) {
    const farePurpose = hiredFarePurpose(purposeText);
    if (farePurpose === 'business' && hiredFareOvernightConfirmed(purposeText)) {
      suggestion.category = 'travel';
      suggestion.scheduleCLine = '24a';
      suggestion.deductiblePercent = 100;
      suggestion.isDeductible = true;
      suggestion.status = 'ok';
      scheduleLine = '24a';
    } else if (farePurpose === 'business') {
      suggestion.category = null;
      delete suggestion.scheduleCLine;
      suggestion.status = 'needs_more_info';
      suggestion.isDeductible = null;
      suggestion.deductiblePercent = null;
      suggestion.questions = [HIRED_FARE_OVERNIGHT.question];
      suggestion.reasoning = HIRED_FARE_OVERNIGHT.reason;
      scheduleLine = null;
    } else if (farePurpose === 'personal') {
      suggestion.category = 'travel';
      suggestion.scheduleCLine = '24a';
      suggestion.isDeductible = false;
      suggestion.deductiblePercent = 0;
      suggestion.status = 'ok';
      suggestion.questions = [];
      suggestion.reasoning = HIRED_FARE_PERSONAL.reason;
    } else {
      suggestion.category = 'travel';
      suggestion.scheduleCLine = '24a';
      suggestion.status = 'needs_more_info';
      suggestion.isDeductible = null;
      suggestion.deductiblePercent = null;
      suggestion.questions = [HIRED_FARE_PURPOSE.question];
      suggestion.reasoning = HIRED_FARE_PURPOSE.reason;
    }
  }
  const supportedCategory = reviewCategory(suggestion.category);
  const expectedPercent = supportedCategory?.value === 'meals_50' ? 50 : 100;
  const separateOnThisCharge = mileageVehicleCopyEnabled() && canonicalData &&
    (suggestion.category === 'vehicle_expense' || suggestion.category === 'taxes_licenses') &&
    standardMileageSeparateCost(approvalText(canonicalData));
  // The reasoning the user reads must describe the saved suggestion; an approval the review path cannot
  // consume is stored with the question that unblocks it, never beside "deductible on line N" prose.
  let withheld: { question: string; reason: string } | null = null;
  let appliedShareReason: string | null = null;
  if (suggestion.status === 'ok' && canonicalData && (transactionKind === 'unknown' ||
      suggestion.isDeductible === true && (!supportedCategory || supportedCategory.recordedCategory.endsWith('_REVIEW_REQUIRED') ||
        suggestion.deductiblePercent !== expectedPercent || Boolean(separateOnThisCharge)))) {
    const savedDate = typeof canonicalData.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(canonicalData.date) ? Number(canonicalData.date.slice(0, 4)) : null;
    const vehicleId = typeof canonicalData.vehicleId === 'string' ? canonicalData.vehicleId : typeof canonicalData.vehicle_id === 'string' ? canonicalData.vehicle_id : vehicleFacts?.vehicleId;
    const gate = withheldApprovalGate({
      category: suggestion.category, deductiblePercent: suggestion.deductiblePercent, transactionKind, amount: canonicalData.amount, text: approvalText(canonicalData),
      merchantText, businessUsePercent: finiteUsePercent(canonicalData.business_use_percentage),
    }, expectedPercent, {
      ...vehicleFacts,
      taxYear: vehicleFacts?.taxYear ?? evidence.tax_year ?? savedDate ?? undefined,
      vehicleId,
    });
    if (gate && 'share' in gate) {
      suggestion.deductiblePercent = gate.share;
      suggestion.isDeductible = true;
      suggestion.status = 'ok';
      if (result.deductible_percent !== gate.share) {
        appliedShareReason = gate.reason ?? ACTUAL_EXPENSE_BUSINESS_SHARE.reason;
        suggestion.reasoning = appliedShareReason;
      }
    } else if (gate) {
      withheld = gate;
      suggestion.status = 'needs_more_info'; suggestion.isDeductible = null; suggestion.deductiblePercent = null;
      suggestion.questions = [gate.question, ...suggestion.questions.filter(question => question !== gate.question)].slice(0, 3);
      suggestion.reasoning = gate.reason;
    }
  }
  const fareReason = suggestion.reasoning === HIRED_FARE_PERSONAL.reason || suggestion.reasoning === HIRED_FARE_PURPOSE.reason || suggestion.reasoning === HIRED_FARE_OVERNIGHT.reason ? suggestion.reasoning : null;
  const displayedReason = withheld?.reason ?? appliedShareReason ?? fareReason ?? result.customized_reason ?? null;
  const hiredPurposeField = mileageVehicleCopyEnabled() && suggestion.questions[0] === HIRED_FARE_PURPOSE.question;
  const missingFields = withheld
    ? [withheld.question === ACTUAL_EXPENSE_BUSINESS_SHARE.question ? 'business_use_percentage'
      : mileageVehicleCopyEnabled() && withheld.question === HIRED_FARE_PURPOSE.question ? 'business_purpose'
        : withheldMissingField(suggestion.category, transactionKind)]
    : hiredPurposeField && suggestion.status === 'needs_more_info'
      ? ['business_purpose']
      : mileageVehicleCopyEnabled() && suggestion.status === 'needs_more_info' && suggestion.questions[0] === HIRED_FARE_OVERNIGHT.question
        ? ['travel_eligibility']
        : result.missing_fields ?? [];
  const label = suggestion.status === 'needs_more_info' ? 'Needs more information' : suggestion.status === 'blocked' ? 'Needs manual review' :
    suggestion.isDeductible === true ? 'Likely Deductible' : suggestion.isDeductible === false ? 'Unlikely Deductible' : 'Needs manual review';
  // The explanation describes the gated suggestion the user sees, never the raw model output.
  const savedLine = scheduleLine !== undefined ? scheduleLine : (suggestion.scheduleCLine ?? scheduleCLine ?? null);
  const gated: ExplainableResult = { ...(result as ExplainableResult), status: suggestion.status, transaction_kind: transactionKind,
    category: scheduleLine === null ? undefined : (suggestion.category ?? result.category), questions: suggestion.questions, is_deductible: suggestion.isDeductible ?? undefined, deductible_percent: suggestion.deductiblePercent ?? undefined,
    ...(scheduleLine === null ? { schedule_c_line: undefined } : scheduleLine ? { schedule_c_line: scheduleLine } : {}),
    ...(withheld ? { customized_reason: withheld.reason, reasoning_summary: withheld.reason, key_analysis_factor: withheld.reason.slice(0, 400),
      missing_fields: missingFields } : {}),
    ...(fareReason ? { customized_reason: fareReason, reasoning_summary: fareReason, key_analysis_factor: fareReason.slice(0, 400), missing_fields: missingFields } : {}),
    ...(appliedShareReason ? { customized_reason: appliedShareReason, reasoning_summary: appliedShareReason, key_analysis_factor: appliedShareReason.slice(0, 400), deductible_percent: suggestion.deductiblePercent ?? undefined } : {}) };
  const savedDate = typeof canonicalData?.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(canonicalData.date) ? Number(canonicalData.date.slice(0, 4)) : null;
  const explanation = composeExplanation({ result: gated, transaction: canonicalData, profile, taxYear: evidence.tax_year ?? savedDate });
  return {
    ai_suggestion: suggestion, ai_explanation: explanation, ai_transaction_kind: transactionKind,
    ai_tax_year: evidence.tax_year ?? null, ai_sources: evidence.sources ?? [],
    ai_policy_version: evidence.policy_version ?? null, ai_provenance: evidence.provenance ?? null,
    ai_status: suggestion.status, ai_category: suggestion.category ?? null,
    ai_deductible_percent: suggestion.deductiblePercent,
    ai_key_analysis_factor: withheld ? withheld.reason.slice(0, 400) : fareReason ? fareReason.slice(0, 400) : result.key_analysis_factor ?? null,
    ai_customized_reason: displayedReason,
    ai_reasoning_summary: withheld ? withheld.reason : fareReason ?? result.reasoning_summary ?? null,
    ai_irs_refs: result.irs_refs ?? [], ai_audit_risk: result.audit_risk ?? null,
    ai_audit_risk_rationale: result.audit_risk_rationale ?? null, ai_confidence: result.confidence ?? null,
    ai_missing_fields: missingFields, ai_questions: suggestion.questions,
    ai_documentation_required: result.documentation_required ?? [], ai_reason_hash: result.reason_hash ?? null,
    ai_proposed_purpose: proposedPurpose ?? null, ai_schedule_c_line: savedLine,
    ai_model: model, ai_last_analyzed_at: now,
    deductionStatus: label, confidence: result.confidence ?? null,
    reasoning: displayedReason ?? result.reasoning_summary ?? null,
    irsPublication: result.irs_refs?.[0] ?? null, irsSection: null,
    ai: {
      transaction_kind: transactionKind, tax_year: evidence.tax_year ?? null, sources: evidence.sources ?? [],
      policy_version: evidence.policy_version ?? null, provenance: evidence.provenance ?? null,
      status: suggestion.status, status_label: label, score_pct: result.confidence == null ? null : Math.round(result.confidence * 100),
      reasoning: displayedReason ?? result.reasoning_summary ?? null, category: suggestion.category ?? null,
      irs_refs: result.irs_refs ?? [], audit_risk: result.audit_risk ?? null,
      deductible_percent: suggestion.deductiblePercent, questions: suggestion.questions,
      missing_fields: missingFields, documentation_required: result.documentation_required ?? [],
      proposed_purpose: proposedPurpose ?? null, schedule_c_line: savedLine,
      model, last_analyzed_at: now,
    },
    analyzed: true, analysis_status: 'completed', analysisStatus: 'completed', analysisErrorCode: null, analysisRefreshReason: null,
    analysisCompletedAt: new Date(now), analysisUpdatedAt: new Date(now).toISOString(),
    analysisLeaseToken: null, analysisLeaseExpiresAt: null,
  };
}

export async function persistAnalysisSuggestion(ref: DocumentReference, result: OutputType, lease: AnalysisLease, profileHash?: string,
  profile?: ExplanationProfile | Record<string, unknown> | null) {
  const parts = ref.path.split('/');
  if (!profileHash || parts.length !== 6 || parts[0] !== 'user_profiles' || parts[2] !== 'accounts' || parts[4] !== 'transactions') {
    return { status: 'stale' as const };
  }
  const profileRef = adminDb.doc(`user_profiles/${parts[1]}`);
  return adminDb.runTransaction(async tx => {
    const vehicleRead = mileageVehicleCopyEnabled() ? tx.get(profileRef.collection('vehicles')).then(vehicleSnap => {
      const docs = (vehicleSnap as { docs?: Array<{ id: string; data: () => Record<string, unknown> }> }).docs;
      return Array.isArray(docs) ? docs.map(doc => vehicleFromDocument(doc.id, doc.data())) : undefined;
    }).catch(() => undefined) : Promise.resolve(undefined);
    const [snap, currentProfile, vehicles] = await Promise.all([
      tx.get(ref), tx.get(profileRef), vehicleRead,
    ]);
    if (!snap.exists || !isAnalysisLeaseCurrent(snap.data()!, lease)) return { status: 'stale' as const };
    // Profile edits can change both the decision and displayed tax effect while the model runs.
    // Reading profile and transaction inside one commit transaction prevents publishing old facts.
    if (!currentProfile.exists || analysisProfileHash(currentProfile.data()!, snap.data()!.date) !== profileHash) return { status: 'stale' as const };
    const profileData = currentProfile.data() as Record<string, unknown>;
    const nested = profileData.business_vehicle;
    const vehicleId = typeof snap.data()!.vehicleId === 'string' ? snap.data()!.vehicleId : typeof snap.data()!.vehicle_id === 'string' ? snap.data()!.vehicle_id : null;
    const update = analysisSuggestionUpdate(result, Date.now(), snap.data()!, profileHash, profile, {
      vehicles,
      vehicleId,
      profile: {
        vehicle_deduction_method: typeof profileData.vehicle_deduction_method === 'string' ? profileData.vehicle_deduction_method : null,
        vehicle_business_use_percentage: typeof profileData.vehicle_business_use_percentage === 'number' ? profileData.vehicle_business_use_percentage : null,
        business_vehicle: nested && typeof nested === 'object' ? nested as LegacyVehicleProfile['business_vehicle'] : null,
      },
    });
    tx.update(ref, update);
    return {
      status: 'saved' as const,
      suggestion: update.ai_suggestion,
      explanation: update.ai_explanation,
      display: {
        status: update.ai.status,
        statusLabel: update.ai.status_label,
        confidence: update.confidence,
        reasoning: update.reasoning,
        irsPublication: update.irsPublication,
        irsSection: update.irsSection,
        updatedAt: update.analysisUpdatedAt,
        ai: update.ai,
      },
    };
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
