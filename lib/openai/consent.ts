import { adminDb } from '@/lib/firebase/admin';
import {
  MODEL_CONSENT_DOCUMENT_VERSION, MODEL_CONSENT_UNAVAILABLE, MODEL_PURPOSES,
  defaultConsentExpiry, isImageModelPurpose, isModelPurpose, modelConsentPath,
  type ConsentRecordType, type ConsentRefusalReason, type ConsentStatus, type ModelPurpose,
} from './consent-contract';

export {
  MODEL_CONSENT_DOCUMENT_VERSION, MODEL_CONSENT_UNAVAILABLE, MODEL_PURPOSES, IMAGE_MODEL_PURPOSES,
  defaultConsentExpiry, isImageModelPurpose, isModelPurpose, modelConsentPath,
} from './consent-contract';
export type { ConsentRecordType, ConsentRefusalReason, ConsentStatus, ModelPurpose } from './consent-contract';

export interface DisclosureConsent {
  status: ConsentStatus;
  purposes: ModelPurpose[];
  consentDocumentVersion: string;
  signedAt: Date;
  expiresAt: Date;
  recordType: 'disclosure';
}

export class ConsentRequiredError extends Error {
  readonly status = 403;
  readonly code = 'CONSENT_REQUIRED' as const;
  constructor(readonly reason: ConsentRefusalReason) {
    super(MODEL_CONSENT_UNAVAILABLE);
    this.name = 'ConsentRequiredError';
  }
}

export class ImageProcessingNotApprovedError extends Error {
  readonly status = 403;
  readonly code = 'IMAGE_PROCESSING_NOT_APPROVED' as const;
  constructor() {
    super(MODEL_CONSENT_UNAVAILABLE);
    this.name = 'ImageProcessingNotApprovedError';
  }
}

export class OpenAINotConfiguredError extends Error {
  readonly code = 'AI_UNAVAILABLE' as const;
  constructor() {
    super('OpenAI is not configured (missing OPENAI_API_KEY)');
    this.name = 'OpenAINotConfiguredError';
  }
}

export function isConsentRequired(error: unknown): error is ConsentRequiredError {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 'CONSENT_REQUIRED';
}

export function isImageProcessingNotApproved(error: unknown): error is ImageProcessingNotApprovedError {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 'IMAGE_PROCESSING_NOT_APPROVED';
}

export function isOpenAINotConfigured(error: unknown): boolean {
  return error instanceof OpenAINotConfiguredError
    || (error instanceof Error && error.message === 'OpenAI is not configured (missing OPENAI_API_KEY)');
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    if (date instanceof Date && Number.isFinite(date.getTime())) return date;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  return null;
}

/** A disclosure grant is trusted only from the disclosure document. Reuse never satisfies it. */
export function readDisclosureConsent(data: Record<string, unknown> | null | undefined): DisclosureConsent | null {
  if (!data || data.recordType !== 'disclosure') return null;
  if (data.status !== 'granted' && data.status !== 'declined' && data.status !== 'withdrawn') return null;
  const signedAt = asDate(data.signedAt);
  const expiresAt = asDate(data.expiresAt);
  const version = typeof data.consentDocumentVersion === 'string' ? data.consentDocumentVersion.trim() : '';
  if (!signedAt || !expiresAt || !version) return null;
  const purposes = Array.isArray(data.purposes) ? data.purposes.filter(isModelPurpose) : [];
  return { status: data.status, purposes, consentDocumentVersion: version, signedAt, expiresAt, recordType: 'disclosure' };
}

export function evaluateDisclosureConsent(
  record: DisclosureConsent | null,
  purpose: ModelPurpose,
  requestedAt: Date,
): { ok: true } | { ok: false; reason: ConsentRefusalReason } {
  if (!record) return { ok: false, reason: 'missing' };
  if (record.status !== 'granted') return { ok: false, reason: 'not_granted' };
  if (requestedAt.getTime() < record.signedAt.getTime()) return { ok: false, reason: 'before_signed_at' };
  if (requestedAt.getTime() >= record.expiresAt.getTime()) return { ok: false, reason: 'expired' };
  if (!record.purposes.includes(purpose)) return { ok: false, reason: 'purpose' };
  return { ok: true };
}

export function imageProcessingApproved(): boolean {
  return process.env.MODEL_IMAGE_PROCESSING_APPROVED === 'true';
}

/** Reads the disclosure document on every call. Nothing is cached past this request. */
export async function requireModelConsent(uid: string, purpose: ModelPurpose, requestedAt: Date): Promise<DisclosureConsent> {
  if (!uid || !isModelPurpose(purpose) || !(requestedAt instanceof Date) || !Number.isFinite(requestedAt.getTime())) {
    throw new ConsentRequiredError('missing');
  }
  const snapshot = await adminDb.doc(modelConsentPath(uid, 'disclosure')).get();
  const record = snapshot.exists ? readDisclosureConsent(snapshot.data() as Record<string, unknown>) : null;
  const decision = evaluateDisclosureConsent(record, purpose, requestedAt);
  if (!decision.ok) throw new ConsentRequiredError(decision.reason);
  return record!;
}

/**
 * Consent first, then the image-processing flag. Both live here so removing this
 * function from the client factory is the only way a model call can proceed.
 */
export async function enforceModelGate(uid: string, purpose: ModelPurpose, requestedAt: Date): Promise<void> {
  await requireModelConsent(uid, purpose, requestedAt);
  if (isImageModelPurpose(purpose) && !imageProcessingApproved()) throw new ImageProcessingNotApprovedError();
}

export interface ModelConsentView {
  status: ConsentStatus;
  purposes: ModelPurpose[];
  consentDocumentVersion: string | null;
  signedAt: string | null;
  expiresAt: string | null;
  recordType: ConsentRecordType | null;
}

export async function readModelConsentView(uid: string): Promise<ModelConsentView> {
  const snapshot = await adminDb.doc(modelConsentPath(uid, 'disclosure')).get();
  const record = snapshot.exists ? readDisclosureConsent(snapshot.data() as Record<string, unknown>) : null;
  if (!record) {
    return { status: 'declined', purposes: [], consentDocumentVersion: null, signedAt: null, expiresAt: null, recordType: null };
  }
  return {
    status: record.status,
    purposes: record.purposes,
    consentDocumentVersion: record.consentDocumentVersion,
    signedAt: record.signedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    recordType: 'disclosure',
  };
}

function emptyConsentView(): ModelConsentView {
  return { status: 'declined', purposes: [], consentDocumentVersion: null, signedAt: null, expiresAt: null, recordType: null };
}

interface DatedConsent {
  status: ConsentStatus;
  purposes: ModelPurpose[];
  consentDocumentVersion: string;
  signedAt: Date;
  expiresAt: Date;
}

/** Reuse is a different document. A disclosure record, or no record, is not reuse consent. */
export function readReuseConsent(data: Record<string, unknown> | null | undefined): DatedConsent | null {
  if (!data || data.recordType !== 'reuse') return null;
  if (data.status !== 'granted' && data.status !== 'declined' && data.status !== 'withdrawn') return null;
  const signedAt = asDate(data.signedAt);
  const expiresAt = asDate(data.expiresAt);
  const version = typeof data.consentDocumentVersion === 'string' ? data.consentDocumentVersion.trim() : '';
  if (!signedAt || !expiresAt || !version) return null;
  const purposes = Array.isArray(data.purposes) ? data.purposes.filter(isModelPurpose) : [];
  return { status: data.status, purposes, consentDocumentVersion: version, signedAt, expiresAt };
}

function viewFrom(record: DatedConsent | null, recordType: ConsentRecordType): ModelConsentView {
  if (!record) return emptyConsentView();
  return {
    status: record.status,
    purposes: record.purposes,
    consentDocumentVersion: record.consentDocumentVersion,
    signedAt: record.signedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    recordType,
  };
}

export async function readReuseConsentView(uid: string): Promise<ModelConsentView> {
  const snapshot = await adminDb.doc(modelConsentPath(uid, 'reuse')).get();
  const record = snapshot.exists ? readReuseConsent(snapshot.data() as Record<string, unknown>) : null;
  return viewFrom(record, 'reuse');
}

export async function readModelConsentBundle(uid: string): Promise<ModelConsentView & { reuse: ModelConsentView }> {
  const [disclosure, reuse] = await Promise.all([readModelConsentView(uid), readReuseConsentView(uid)]);
  return { ...disclosure, reuse };
}

/** Stores a signed disclosure. Does not create or update the reuse document. */
export async function acceptDisclosureConsent(uid: string, signedName: string, requestedAt: Date): Promise<ModelConsentView> {
  const name = signedName.trim();
  if (!uid || !name) throw new ConsentRequiredError('missing');
  const signedAt = requestedAt;
  await adminDb.doc(modelConsentPath(uid, 'disclosure')).set({
    status: 'granted',
    purposes: [...MODEL_PURPOSES],
    consentDocumentVersion: MODEL_CONSENT_DOCUMENT_VERSION,
    signedAt,
    expiresAt: defaultConsentExpiry(signedAt),
    recordType: 'disclosure',
    signedName: name,
    acknowledged: true,
  });
  return readModelConsentView(uid);
}

/** One tap, no typed name. Does not write the reuse document. */
export async function declineModelConsent(uid: string, requestedAt: Date): Promise<ModelConsentView> {
  if (!uid) throw new ConsentRequiredError('missing');
  await adminDb.doc(modelConsentPath(uid, 'disclosure')).set({
    status: 'declined',
    purposes: [],
    consentDocumentVersion: MODEL_CONSENT_DOCUMENT_VERSION,
    signedAt: requestedAt,
    expiresAt: defaultConsentExpiry(requestedAt),
    recordType: 'disclosure',
    acknowledged: false,
  });
  return readModelConsentView(uid);
}

/** Opt-in reuse record. Off unless this is called. Never writes the disclosure document. */
export async function acceptReuseConsent(uid: string, requestedAt: Date): Promise<ModelConsentView> {
  if (!uid) throw new ConsentRequiredError('missing');
  await adminDb.doc(modelConsentPath(uid, 'reuse')).set({
    status: 'granted',
    purposes: [],
    consentDocumentVersion: MODEL_CONSENT_DOCUMENT_VERSION,
    signedAt: requestedAt,
    expiresAt: defaultConsentExpiry(requestedAt),
    recordType: 'reuse',
    acknowledged: true,
  });
  return readReuseConsentView(uid);
}

/** Owner withdrawal. A missing disclosure becomes an explicit withdrawn record. */
export async function withdrawModelConsent(uid: string, requestedAt: Date): Promise<ModelConsentView> {
  const ref = adminDb.doc(modelConsentPath(uid, 'disclosure'));
  const snapshot = await ref.get();
  const existing = snapshot.exists ? snapshot.data() as Record<string, unknown> : {};
  const record = readDisclosureConsent(existing);
  const signedAt = record?.signedAt ?? requestedAt;
  const expiresAt = record?.expiresAt ?? defaultConsentExpiry(signedAt);
  await ref.set({
    status: 'withdrawn',
    purposes: record?.purposes ?? [],
    consentDocumentVersion: record?.consentDocumentVersion || (typeof existing.consentDocumentVersion === 'string' ? existing.consentDocumentVersion : MODEL_CONSENT_DOCUMENT_VERSION),
    signedAt,
    expiresAt,
    recordType: 'disclosure',
    withdrawnAt: requestedAt,
  });
  return readModelConsentView(uid);
}
