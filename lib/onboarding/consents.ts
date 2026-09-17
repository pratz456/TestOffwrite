/**
 * Sign-up acknowledgments. Every account records them before profile setup,
 * including Google sign-ins that never see the sign-up form. The record is
 * stored on the profile document and written only through
 * POST /api/database/profiles, which validates it with parseConsentRecord.
 */
export const CONSENT_TERMS_VERSION = '2026-09-17';

export const REQUIRED_CONSENTS = ['bank_data', 'ai_review'] as const;
export const OPTIONAL_CONSENTS = ['communications'] as const;
export type RequiredConsent = (typeof REQUIRED_CONSENTS)[number];
export type OptionalConsent = (typeof OPTIONAL_CONSENTS)[number];
export type ConsentKey = RequiredConsent | OptionalConsent;

/** `reacknowledgment` covers accounts created before the current terms version, gated in the protected layout. */
export const CONSENT_SOURCES = ['sign-up', 'profile-setup', 'reacknowledgment'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export type ConsentChoices = Record<ConsentKey, boolean>;

export interface ConsentRecord extends ConsentChoices {
  version: string;
  source: ConsentSource;
  /** When the person checked the boxes; the server adds consents_recorded_at. */
  accepted_at: string;
}

export const NO_CONSENTS: ConsentChoices = { bank_data: false, ai_review: false, communications: false };

export function requiredConsentsAccepted(choices: Partial<ConsentChoices> | null | undefined): boolean {
  return REQUIRED_CONSENTS.every(key => choices?.[key] === true);
}

export function buildConsentRecord(choices: ConsentChoices, source: ConsentSource, now = new Date()): ConsentRecord | null {
  if (!requiredConsentsAccepted(choices)) return null;
  return {
    version: CONSENT_TERMS_VERSION,
    source,
    accepted_at: now.toISOString(),
    bank_data: true,
    ai_review: true,
    communications: choices.communications === true,
  };
}

const RECORD_KEYS = new Set<string>(['version', 'source', 'accepted_at', ...REQUIRED_CONSENTS, ...OPTIONAL_CONSENTS]);

/**
 * Strict allowlist shared by the API route and the client: only the known keys,
 * only the current terms, and the required acknowledgments must be true.
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
  return {
    version: CONSENT_TERMS_VERSION,
    source: record.source as ConsentSource,
    accepted_at: new Date(record.accepted_at).toISOString(),
    bank_data: true,
    ai_review: true,
    communications: record.communications === true,
  };
}

export function hasAcknowledgedRequiredConsents(record: unknown): record is ConsentRecord {
  return parseConsentRecord(record) !== null;
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
