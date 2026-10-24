import { adminDb } from '@/lib/firebase/admin';
import {
  MODEL_CONSENT_DOCUMENT_VERSION, MODEL_CONSENT_UNAVAILABLE, MODEL_DISCLOSURE_LENGTH,
  defaultConsentExpiry, isImageModelPurpose, isModelPurpose, isValidTimeZone, modelConsentPath,
  type ConsentRecordType, type ConsentRefusalReason, type ConsentStatus, type ModelPurpose,
} from './consent-contract';

export {
  MODEL_CONSENT_DOCUMENT_VERSION, MODEL_CONSENT_UNAVAILABLE, MODEL_PURPOSES, IMAGE_MODEL_PURPOSES,
  defaultConsentExpiry, isImageModelPurpose, isModelPurpose, modelConsentPath,
} from './consent-contract';
export type { ConsentRecordType, ConsentRefusalReason, ConsentStatus, ModelPurpose } from './consent-contract';

export interface PurposeConsent {
  signedAt: Date;
  expiresAt: Date;
  timeZone: string | null;
}

export interface DisclosureConsent {
  status: ConsentStatus;
  purposes: ModelPurpose[];
  terms: Partial<Record<ModelPurpose, PurposeConsent>>;
  invalidPurposes: ModelPurpose[];
  consentDocumentVersion: string;
  signedAt: Date;
  expiresAt: Date;
  timeZone: string | null;
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

function zoneOf(value: unknown): string | null {
  return typeof value === 'string' && isValidTimeZone(value) ? value : null;
}

/**
 * Data-integrity rule. The writer always stores signedAt and expiresAt, so a missing or
 * unreadable instant is incomplete data and does not allow model calls. expiresAt has to
 * fall after signedAt and no later than the one year anniversary of signedAt in the signing
 * zone, with February 29 clamped to February 28. A later instant is incomplete data too.
 */
function storedTerm(signedAtRaw: unknown, expiresAtRaw: unknown, timeZone: string | null): PurposeConsent | null {
  const signedAt = asDate(signedAtRaw);
  const expiresAt = asDate(expiresAtRaw);
  if (!signedAt || !expiresAt) return null;
  if (expiresAt.getTime() <= signedAt.getTime()) return null;
  if (expiresAt.getTime() > defaultConsentExpiry(signedAt, timeZone).getTime()) return null;
  return { signedAt, expiresAt, timeZone };
}

function grantMap(data: Record<string, unknown>): Record<string, unknown> | null {
  const value = data.purposeGrants;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function listedPurposes(data: Record<string, unknown>): ModelPurpose[] {
  return Array.isArray(data.purposes) ? data.purposes.filter(isModelPurpose) : [];
}

interface ParsedConsent {
  recognized: boolean;
  status: ConsentStatus | null;
  version: string;
  timeZone: string | null;
  terms: Partial<Record<ModelPurpose, PurposeConsent>>;
  order: ModelPurpose[];
  invalidPurposes: ModelPurpose[];
  shared: PurposeConsent | null;
  recordInvalid: boolean;
}

function parseConsent(data: Record<string, unknown> | null | undefined, recordType: ConsentRecordType): ParsedConsent {
  const empty: ParsedConsent = {
    recognized: false, status: null, version: '', timeZone: null, terms: {}, order: [],
    invalidPurposes: [], shared: null, recordInvalid: false,
  };
  if (!data || data.recordType !== recordType) return empty;
  if (data.status !== 'granted' && data.status !== 'declined' && data.status !== 'withdrawn') return empty;
  const version = typeof data.consentDocumentVersion === 'string' ? data.consentDocumentVersion.trim() : '';
  if (!version) return empty;
  const timeZone = zoneOf(data.timeZone);
  const listed = listedPurposes(data);
  const map = grantMap(data);
  const terms: Partial<Record<ModelPurpose, PurposeConsent>> = {};
  const invalidPurposes: ModelPurpose[] = [];
  const order: ModelPurpose[] = [];
  if (map) {
    for (const purpose of [...listed, ...Object.keys(map).filter(isModelPurpose)]) {
      if (order.includes(purpose) || !Object.hasOwn(map, purpose)) continue;
      order.push(purpose);
      const entry = map[purpose];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        invalidPurposes.push(purpose);
        continue;
      }
      const raw = entry as Record<string, unknown>;
      const term = storedTerm(raw.signedAt, raw.expiresAt, zoneOf(raw.timeZone) ?? timeZone);
      if (!term) invalidPurposes.push(purpose);
      else terms[purpose] = term;
    }
    const shared = storedTerm(data.signedAt, data.expiresAt, timeZone);
    return {
      recognized: true, status: data.status, version, timeZone, terms, order, invalidPurposes, shared,
      recordInvalid: Object.keys(terms).length === 0 && !shared,
    };
  }
  const shared = storedTerm(data.signedAt, data.expiresAt, timeZone);
  if (!shared) {
    return {
      recognized: true, status: data.status, version, timeZone, terms, order: [...listed],
      invalidPurposes: [...listed], shared: null, recordInvalid: true,
    };
  }
  for (const purpose of listed) {
    terms[purpose] = shared;
    order.push(purpose);
  }
  return {
    recognized: true, status: data.status, version, timeZone, terms, order, invalidPurposes, shared, recordInvalid: false,
  };
}

function anchorOf(parsed: ParsedConsent): PurposeConsent | null {
  for (const purpose of parsed.order) {
    const term = parsed.terms[purpose];
    if (term) return term;
  }
  return parsed.shared;
}

function toDisclosure(parsed: ParsedConsent): DisclosureConsent | null {
  if (!parsed.recognized || !parsed.status || parsed.recordInvalid) return null;
  const anchor = anchorOf(parsed);
  if (!anchor) return null;
  return {
    status: parsed.status,
    purposes: parsed.order.filter(purpose => parsed.terms[purpose]),
    terms: parsed.terms,
    invalidPurposes: parsed.invalidPurposes,
    consentDocumentVersion: parsed.version,
    signedAt: anchor.signedAt,
    expiresAt: anchor.expiresAt,
    timeZone: anchor.timeZone ?? parsed.timeZone,
    recordType: 'disclosure',
  };
}

/** A disclosure grant is trusted only from the disclosure document. Reuse never satisfies it. */
export function readDisclosureConsent(data: Record<string, unknown> | null | undefined): DisclosureConsent | null {
  const parsed = parseConsent(data, 'disclosure');
  if (!parsed.recognized || parsed.recordInvalid) return null;
  return toDisclosure(parsed);
}

export function evaluateDisclosureConsent(
  record: DisclosureConsent | null,
  purpose: ModelPurpose,
  requestedAt: Date,
): { ok: true } | { ok: false; reason: ConsentRefusalReason } {
  if (!record) return { ok: false, reason: 'missing' };
  if (record.invalidPurposes.includes(purpose)) return { ok: false, reason: 'invalid_record' };
  if (record.status !== 'granted') return { ok: false, reason: 'not_granted' };
  const term = record.terms[purpose];
  if (!term) return { ok: false, reason: 'purpose' };
  if (requestedAt.getTime() < term.signedAt.getTime()) return { ok: false, reason: 'before_signed_at' };
  if (requestedAt.getTime() >= term.expiresAt.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true };
}

function disclosureDecision(
  data: Record<string, unknown> | null | undefined,
  purpose: ModelPurpose,
  requestedAt: Date,
): { ok: true; record: DisclosureConsent } | { ok: false; reason: ConsentRefusalReason } {
  const parsed = parseConsent(data, 'disclosure');
  if (!parsed.recognized || !parsed.status) return { ok: false, reason: 'missing' };
  if (parsed.recordInvalid || parsed.invalidPurposes.includes(purpose)) return { ok: false, reason: 'invalid_record' };
  const record = toDisclosure(parsed);
  if (!record) return { ok: false, reason: 'invalid_record' };
  const verdict = evaluateDisclosureConsent(record, purpose, requestedAt);
  if (!verdict.ok) return verdict;
  return { ok: true, record };
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
  const data = snapshot.exists ? snapshot.data() as Record<string, unknown> : null;
  const decision = disclosureDecision(data, purpose, requestedAt);
  if (!decision.ok) throw new ConsentRequiredError(decision.reason);
  return decision.record;
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
  timeZone: string | null;
  recordType: ConsentRecordType | null;
}

export async function readModelConsentView(uid: string, now = new Date()): Promise<ModelConsentView> {
  const snapshot = await adminDb.doc(modelConsentPath(uid, 'disclosure')).get();
  const parsed = snapshot.exists ? parseConsent(snapshot.data() as Record<string, unknown>, 'disclosure') : null;
  const record = parsed ? toDisclosure(parsed) : null;
  if (!parsed?.recognized || !record) {
    return { status: 'declined', purposes: [], consentDocumentVersion: null, signedAt: null, expiresAt: null, timeZone: null, recordType: null };
  }
  if (record.status !== 'granted') {
    return {
      status: record.status,
      purposes: [],
      consentDocumentVersion: record.consentDocumentVersion,
      signedAt: record.signedAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
      timeZone: record.timeZone,
      recordType: 'disclosure',
    };
  }
  const live = record.purposes.filter(purpose => {
    const term = record.terms[purpose];
    return !!term && now.getTime() < term.expiresAt.getTime();
  });
  const anchor = live[0] ? record.terms[live[0]] ?? null : null;
  if (!anchor) {
    return {
      status: 'declined',
      purposes: [],
      consentDocumentVersion: record.consentDocumentVersion,
      signedAt: record.signedAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
      timeZone: record.timeZone,
      recordType: 'disclosure',
    };
  }
  const latest = live.reduce((max, purpose) => {
    const term = record.terms[purpose];
    return term && term.expiresAt.getTime() > max.getTime() ? term.expiresAt : max;
  }, anchor.expiresAt);
  return {
    status: 'granted',
    purposes: live,
    consentDocumentVersion: record.consentDocumentVersion,
    signedAt: anchor.signedAt.toISOString(),
    expiresAt: latest.toISOString(),
    timeZone: anchor.timeZone ?? record.timeZone,
    recordType: 'disclosure',
  };
}

function emptyConsentView(): ModelConsentView {
  return { status: 'declined', purposes: [], consentDocumentVersion: null, signedAt: null, expiresAt: null, timeZone: null, recordType: null };
}

interface DatedConsent {
  status: ConsentStatus;
  purposes: ModelPurpose[];
  terms: Partial<Record<ModelPurpose, PurposeConsent>>;
  consentDocumentVersion: string;
  signedAt: Date;
  expiresAt: Date;
  timeZone: string | null;
}

/** Reuse is a different document. A disclosure record, or no record, is not reuse consent. */
export function readReuseConsent(data: Record<string, unknown> | null | undefined, now = new Date()): DatedConsent | null {
  const parsed = parseConsent(data, 'reuse');
  if (!parsed.recognized || !parsed.status || parsed.recordInvalid) return null;
  const anchor = anchorOf(parsed);
  if (!anchor) return null;
  const purposes = parsed.order.filter(purpose => {
    const term = parsed.terms[purpose];
    return !!term && now.getTime() < term.expiresAt.getTime();
  });
  return {
    status: parsed.status,
    purposes,
    terms: parsed.terms,
    consentDocumentVersion: parsed.version,
    signedAt: anchor.signedAt,
    expiresAt: anchor.expiresAt,
    timeZone: anchor.timeZone ?? parsed.timeZone,
  };
}

function viewFrom(record: DatedConsent | null, recordType: ConsentRecordType): ModelConsentView {
  if (!record) return emptyConsentView();
  return {
    status: record.status,
    purposes: record.purposes,
    consentDocumentVersion: record.consentDocumentVersion,
    signedAt: record.signedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    timeZone: record.timeZone,
    recordType,
  };
}

export async function readReuseConsentView(uid: string, now = new Date()): Promise<ModelConsentView> {
  const snapshot = await adminDb.doc(modelConsentPath(uid, 'reuse')).get();
  const record = snapshot.exists ? readReuseConsent(snapshot.data() as Record<string, unknown>, now) : null;
  return viewFrom(record, 'reuse');
}

export async function readModelConsentBundle(uid: string): Promise<ModelConsentView & { reuse: ModelConsentView }> {
  const [disclosure, reuse] = await Promise.all([readModelConsentView(uid), readReuseConsentView(uid)]);
  return { ...disclosure, reuse };
}

type StoredGrant = { signedAt: unknown; expiresAt: unknown; timeZone?: string };

/** Keep grants already stored. A legacy record contributes its shared dates once, and only when both instants are present. */
function storedGrants(existing: Record<string, unknown> | undefined): Record<string, StoredGrant> {
  const grants: Record<string, StoredGrant> = {};
  if (!existing) return grants;
  const map = grantMap(existing);
  if (map) {
    for (const [key, value] of Object.entries(map)) {
      if (!isModelPurpose(key) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      grants[key] = {
        signedAt: entry.signedAt,
        expiresAt: entry.expiresAt,
        ...(typeof entry.timeZone === 'string' ? { timeZone: entry.timeZone } : {}),
      };
    }
    return grants;
  }
  if (existing.signedAt === undefined || existing.expiresAt === undefined) return grants;
  const timeZone = typeof existing.timeZone === 'string' ? existing.timeZone : undefined;
  for (const item of listedPurposes(existing)) {
    grants[item] = {
      signedAt: existing.signedAt,
      expiresAt: existing.expiresAt,
      ...(timeZone ? { timeZone } : {}),
    };
  }
  return grants;
}

/** Stores a signed disclosure for one purpose and leaves every other purpose's dates as they were stored. Does not write the reuse document. */
export async function acceptDisclosureConsent(uid: string, signedName: string, purpose: ModelPurpose, timeZone: string, requestedAt: Date): Promise<ModelConsentView> {
  const name = signedName.trim();
  const zone = timeZone.trim();
  if (!uid || !name || !isModelPurpose(purpose) || !isValidTimeZone(zone)) throw new ConsentRequiredError('missing');
  const signedAt = requestedAt;
  const expiresAt = defaultConsentExpiry(signedAt, zone);
  const ref = adminDb.doc(modelConsentPath(uid, 'disclosure'));
  await adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const existing = snapshot.exists ? snapshot.data() as Record<string, unknown> : undefined;
    const purposeGrants = storedGrants(existing);
    purposeGrants[purpose] = { signedAt, expiresAt, timeZone: zone };
    const purposes: ModelPurpose[] = [];
    const prior = existing ? listedPurposes(existing) : [];
    for (const item of [...prior, purpose, ...Object.keys(purposeGrants).filter(isModelPurpose)]) {
      if (!purposeGrants[item] || purposes.includes(item)) continue;
      purposes.push(item);
    }
    tx.set(ref, {
      status: 'granted',
      purposes,
      purposeGrants,
      consentDocumentVersion: MODEL_CONSENT_DOCUMENT_VERSION,
      signedAt,
      timeZone: zone,
      consentLength: MODEL_DISCLOSURE_LENGTH,
      expiresAt,
      recordType: 'disclosure',
      signedName: name,
      acknowledged: true,
    });
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
export async function acceptReuseConsent(uid: string, timeZone: string, requestedAt: Date): Promise<ModelConsentView> {
  const zone = timeZone.trim();
  if (!uid || !isValidTimeZone(zone)) throw new ConsentRequiredError('missing');
  await adminDb.doc(modelConsentPath(uid, 'reuse')).set({
    status: 'granted',
    purposes: [],
    consentDocumentVersion: MODEL_CONSENT_DOCUMENT_VERSION,
    signedAt: requestedAt,
    timeZone: zone,
    expiresAt: defaultConsentExpiry(requestedAt, zone),
    recordType: 'reuse',
    acknowledged: true,
  });
  return readReuseConsentView(uid);
}

/** Owner withdrawal. Clears every purpose. A missing disclosure becomes an explicit withdrawn record. */
export async function withdrawModelConsent(uid: string, requestedAt: Date): Promise<ModelConsentView> {
  const ref = adminDb.doc(modelConsentPath(uid, 'disclosure'));
  const snapshot = await ref.get();
  const existing = snapshot.exists ? snapshot.data() as Record<string, unknown> : {};
  const record = readDisclosureConsent(existing);
  const signedAt = record?.signedAt ?? requestedAt;
  const zone = record?.timeZone ?? null;
  const kept = record?.expiresAt;
  const expiresAt = kept && kept.getTime() > signedAt.getTime() && kept.getTime() <= defaultConsentExpiry(signedAt, zone).getTime()
    ? kept
    : defaultConsentExpiry(signedAt, zone);
  await ref.set({
    status: 'withdrawn',
    purposes: [],
    purposeGrants: {},
    consentDocumentVersion: record?.consentDocumentVersion || (typeof existing.consentDocumentVersion === 'string' ? existing.consentDocumentVersion : MODEL_CONSENT_DOCUMENT_VERSION),
    signedAt,
    expiresAt,
    ...(zone ? { timeZone: zone } : {}),
    recordType: 'disclosure',
    withdrawnAt: requestedAt,
  });
  return readModelConsentView(uid);
}
