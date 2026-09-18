/**
 * Sign-up acknowledgments. Every account records them before profile setup,
 * including Google sign-ins that never see the sign-up form. The record is
 * stored on the profile document and written only through
 * POST /api/database/profiles, which validates it with parseConsentRecord.
 */
import { DOCUMENT_IMPORT_CONSENT_VERSION } from './document-import-consent';

export const CONSENT_TERMS_VERSION = '2026-09-18';

export const REQUIRED_CONSENTS = ['terms', 'bank_data', 'ai_review'] as const;
/**
 * `communications` is a marketing preference. `document_import` is the §7216
 * consent to disclose a whole tax-document image to OpenAI; it is never offered
 * at sign-up, is true only together with a typed signature of the current
 * consent text, and can be withdrawn in Settings.
 */
export const OPTIONAL_CONSENTS = ['communications', 'document_import'] as const;
export type RequiredConsent = (typeof REQUIRED_CONSENTS)[number];
export type OptionalConsent = (typeof OPTIONAL_CONSENTS)[number];
export type ConsentKey = RequiredConsent | OptionalConsent;

/** `reacknowledgment` covers accounts created before the current terms version, gated in the protected layout. */
export const CONSENT_SOURCES = ['sign-up', 'profile-setup', 'reacknowledgment'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export type ConsentChoices = Record<ConsentKey, boolean>;

/** Electronic signature of DOCUMENT_IMPORT_CONSENT_TEXT (Rev. Proc. 2013-14 §6): typed full name and date. */
export interface DocumentImportConsentSignature {
  version: string;
  signed_name: string;
  signed_at: string;
}

export interface ConsentRecord extends ConsentChoices {
  version: string;
  source: ConsentSource;
  /** When the person checked the boxes; the server adds consents_recorded_at. */
  accepted_at: string;
  /** Present exactly when document_import is true. */
  document_import_signature?: DocumentImportConsentSignature;
}

export const NO_CONSENTS: ConsentChoices = { terms: false, bank_data: false, ai_review: false, communications: false, document_import: false };

export function requiredConsentsAccepted(choices: Partial<ConsentChoices> | null | undefined): boolean {
  return REQUIRED_CONSENTS.every(key => choices?.[key] === true);
}

/** Sign-up, profile-setup and re-acknowledgment records; the §7216 consent is added later by signDocumentImportConsent. */
export function buildConsentRecord(choices: ConsentChoices, source: ConsentSource, now = new Date()): ConsentRecord | null {
  if (!requiredConsentsAccepted(choices)) return null;
  return {
    version: CONSENT_TERMS_VERSION,
    source,
    accepted_at: now.toISOString(),
    terms: true,
    bank_data: true,
    ai_review: true,
    communications: choices.communications === true,
    document_import: false,
  };
}

const RECORD_KEYS = new Set<string>(['version', 'source', 'accepted_at', 'document_import_signature', ...REQUIRED_CONSENTS, ...OPTIONAL_CONSENTS]);
const MAX_SIGNED_NAME_LENGTH = 200;

/** Well-formed signature or null; `stale` marks a signature of an earlier consent text, which no longer authorizes anything. */
function parseDocumentImportSignature(input: unknown): { signature: DocumentImportConsentSignature | null; stale: boolean } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { signature: null, stale: false };
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['version', 'signed_name', 'signed_at'].includes(key))) return { signature: null, stale: false };
  const name = typeof value.signed_name === 'string' ? value.signed_name.trim() : '';
  if (!name || name.length > MAX_SIGNED_NAME_LENGTH || typeof value.version !== 'string') return { signature: null, stale: false };
  if (typeof value.signed_at !== 'string' || value.signed_at.length > 40 || Number.isNaN(Date.parse(value.signed_at))) return { signature: null, stale: false };
  if (value.version !== DOCUMENT_IMPORT_CONSENT_VERSION) return { signature: null, stale: true };
  return { signature: { version: value.version, signed_name: name, signed_at: new Date(value.signed_at).toISOString() }, stale: false };
}

/**
 * Strict allowlist shared by the API route and the client: only the known keys,
 * only the current terms, and the required acknowledgments must be true.
 * `document_import: true` needs a well-formed signature; a signature of an
 * earlier consent version is read as no consent rather than as a bad record.
 */
export function parseConsentRecord(input: unknown): ConsentRecord | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some(key => !RECORD_KEYS.has(key))) return null;
  if (record.version !== CONSENT_TERMS_VERSION) return null;
  if (!CONSENT_SOURCES.includes(record.source as ConsentSource)) return null;
  if (typeof record.accepted_at !== 'string' || record.accepted_at.length > 40 || Number.isNaN(Date.parse(record.accepted_at))) return null;
  if (!REQUIRED_CONSENTS.every(key => record[key] === true)) return null;
  if (OPTIONAL_CONSENTS.some(key => key in record && typeof record[key] !== 'boolean')) return null;
  let signature: DocumentImportConsentSignature | null = null;
  if (record.document_import === true) {
    const parsed = parseDocumentImportSignature(record.document_import_signature);
    if (!parsed.signature && !parsed.stale) return null;
    signature = parsed.signature;
  }
  return {
    version: CONSENT_TERMS_VERSION,
    source: record.source as ConsentSource,
    accepted_at: new Date(record.accepted_at).toISOString(),
    terms: true,
    bank_data: true,
    ai_review: true,
    communications: record.communications === true,
    document_import: signature !== null,
    ...(signature ? { document_import_signature: signature } : {}),
  };
}

export function hasAcknowledgedRequiredConsents(record: unknown): record is ConsentRecord {
  return parseConsentRecord(record) !== null;
}

/** True only for a current-version signed §7216 consent; the import route sends a document image on nothing less. */
export function hasDocumentImportConsent(record: unknown): boolean {
  return parseConsentRecord(record)?.document_import === true;
}

/** Adds the typed signature to the account's existing acknowledgments; null when the name is blank or there is no current record. */
export function signDocumentImportConsent(record: unknown, signedName: string, now = new Date()): ConsentRecord | null {
  const current = parseConsentRecord(record);
  const name = signedName.trim();
  if (!current || !name || name.length > MAX_SIGNED_NAME_LENGTH) return null;
  return {
    ...current,
    document_import: true,
    document_import_signature: { version: DOCUMENT_IMPORT_CONSENT_VERSION, signed_name: name, signed_at: now.toISOString() },
  };
}

/** Withdrawal keeps every other acknowledgment; the server re-stamps consents_recorded_at. */
export function withdrawDocumentImportConsent(record: unknown): ConsentRecord | null {
  const current = parseConsentRecord(record);
  if (!current) return null;
  const withdrawn: ConsentRecord = { ...current, document_import: false };
  delete withdrawn.document_import_signature;
  return withdrawn;
}

/**
 * The sign-up form collects acknowledgments before the account can call the
 * API (email accounts verify first). They wait here, bound to the sign-up
 * email, until profile setup records them for that same account.
 */
export const PENDING_CONSENTS_KEY = 'writeoff.pending-consents';
export const PENDING_CONSENTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface PendingConsents {
  email: string;
  record: ConsentRecord;
  stashed_at: number;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? '';
}

export function stashPendingConsents(record: ConsentRecord, email: string | null | undefined, storage = browserStorage(), now = Date.now()): void {
  const address = normalizeEmail(email);
  if (!storage || !address) return;
  const pending: PendingConsents = { email: address, record, stashed_at: now };
  try {
    storage.setItem(PENDING_CONSENTS_KEY, JSON.stringify(pending));
  } catch {
    // Storage may be full or disabled; setup asks for the acknowledgments again.
  }
}

export function clearPendingConsents(storage = browserStorage()): void {
  try {
    storage?.removeItem(PENDING_CONSENTS_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Returns the stashed record only for the same account and current terms; anything else is discarded. */
export function readPendingConsents(email: string | null | undefined, storage = browserStorage(), now = Date.now()): ConsentRecord | null {
  const address = normalizeEmail(email);
  if (!storage || !address) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(PENDING_CONSENTS_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let pending: Partial<PendingConsents> | null = null;
  try {
    pending = JSON.parse(raw) as Partial<PendingConsents>;
  } catch {
    pending = null;
  }
  const fresh = typeof pending?.stashed_at === 'number' && now - pending.stashed_at <= PENDING_CONSENTS_TTL_MS && pending.stashed_at <= now + 60_000;
  const record = pending && pending.email === address && fresh ? parseConsentRecord(pending.record) : null;
  if (!record) clearPendingConsents(storage);
  return record;
}
