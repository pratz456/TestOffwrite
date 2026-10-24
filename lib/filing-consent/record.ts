import { DISCLOSING_PREPARER_LEGAL_NAME, partnerRecipientLegalNames } from './config';
import { isDurationStated, type DurationStated } from './duration';
import { isSignatureMethod, type SignatureMethod } from './signature';

export interface CoveredReturn {
  code: string;
  taxYear: number;
}

export type DisclosureScope =
  | { kind: 'whole_return' }
  | { kind: 'fields'; fields: string[] };

/**
 * Stored disclosure consent. `kind` is only `disclosure`. A record that also
 * covers a use is rejected and is never a valid value here.
 * `withdrawnAt` is null until the person withdraws. `expiresAt` is required.
 */
export interface DisclosureConsentRecord {
  uid: string;
  taxYear: number;
  disclosingPreparerLegalName: string;
  taxpayerName: string;
  purpose: string;
  returnsCovered: CoveredReturn[];
  recipients: string[];
  /**
   * The partner this consent names. A record without it does not match a hand off.
   * Saving writes it once. An existing consent is never rewritten to add or change it.
   */
  recipientPartnerId: string;
  scope: DisclosureScope;
  signatureMethod: SignatureMethod;
  signatureValue: string;
  userTypedNotPrefilled: boolean;
  signedAt: string;
  expiresAt: string;
  durationStated: DurationStated;
  consentTextVersion: string;
  consentTextSha256: string;
  kind: 'disclosure';
  withdrawnAt: string | null;
}

export interface ConsentRefusal {
  ok: false;
  code: string;
  message: string;
  field?: string;
}

export function refusal(code: string, message: string, field?: string): ConsentRefusal {
  return field === undefined ? { ok: false, code, message } : { ok: false, code, message, field };
}

export function isReturnCode(code: string): boolean {
  return code === 'federal' || /^[A-Z]{2}$/.test(code);
}

export function returnKey(code: string, taxYear: number): string {
  return `${code}:${taxYear}`;
}

function blankString(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

function scopeIsPresent(value: unknown): value is DisclosureScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const scope = value as { kind?: unknown; fields?: unknown };
  if (scope.kind === 'whole_return') return true;
  if (scope.kind !== 'fields' || !Array.isArray(scope.fields) || scope.fields.length === 0) return false;
  return scope.fields.every(field => typeof field === 'string' && field.trim().length > 0);
}

function returnsArePresent(value: unknown): value is CoveredReturn[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const code = (entry as { code?: unknown }).code;
    const taxYear = (entry as { taxYear?: unknown }).taxYear;
    return typeof code === 'string' && isReturnCode(code) && typeof taxYear === 'number' && Number.isInteger(taxYear);
  });
}

function recipientsArePresent(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(name => typeof name === 'string' && name.trim().length > 0);
}

/**
 * First required field that is missing or empty, in a fixed order.
 * `expiresAt` null is a missing field. It is never treated as "no expiry".
 * `withdrawnAt` must be present; null means not withdrawn, and a blank string is empty.
 * `userTypedNotPrefilled: false` is present. A later check refuses it.
 */
export function missingRequiredField(data: Record<string, unknown>): string | null {
  if (blankString(data.uid)) return 'uid';
  if (typeof data.taxYear !== 'number' || !Number.isInteger(data.taxYear)) return 'taxYear';
  if (blankString(data.disclosingPreparerLegalName)) return 'disclosingPreparerLegalName';
  if (blankString(data.taxpayerName)) return 'taxpayerName';
  if (blankString(data.purpose)) return 'purpose';
  if (!returnsArePresent(data.returnsCovered)) return 'returnsCovered';
  if (!recipientsArePresent(data.recipients)) return 'recipients';
  if (!scopeIsPresent(data.scope)) return 'scope';
  if (blankString(data.signatureMethod)) return 'signatureMethod';
  if (blankString(data.signatureValue)) return 'signatureValue';
  if (typeof data.userTypedNotPrefilled !== 'boolean') return 'userTypedNotPrefilled';
  if (blankString(data.signedAt) || Number.isNaN(Date.parse(String(data.signedAt)))) return 'signedAt';
  if (!Object.prototype.hasOwnProperty.call(data, 'expiresAt')) return 'expiresAt';
  if (data.expiresAt == null || blankString(data.expiresAt) || Number.isNaN(Date.parse(String(data.expiresAt)))) return 'expiresAt';
  if (!isDurationStated(data.durationStated)) return 'durationStated';
  if (blankString(data.consentTextVersion)) return 'consentTextVersion';
  if (blankString(data.consentTextSha256)) return 'consentTextSha256';
  if (blankString(data.kind)) return 'kind';
  if (!Object.prototype.hasOwnProperty.call(data, 'withdrawnAt')) return 'withdrawnAt';
  if (data.withdrawnAt != null && blankString(data.withdrawnAt)) return 'withdrawnAt';
  return null;
}

/** A disclosure record that also authorizes a use. Separate documents are required. */
export function coversUseAsWell(data: { coversUse?: unknown; useConsent?: unknown; kind?: unknown }): boolean {
  if (data.coversUse === true) return true;
  if (data.useConsent != null) return true;
  if (typeof data.kind !== 'string') return false;
  return data.kind !== 'disclosure' && data.kind.includes('use');
}

export function recipientNotOnLegalNameList(recipients: string[]): string | null {
  for (const name of recipients) {
    if (!partnerRecipientLegalNames().includes(name)) return name;
  }
  return null;
}

export function disclosingPreparerMatchesConfig(name: string): boolean {
  return name === DISCLOSING_PREPARER_LEGAL_NAME;
}

/** A consent record is one of these two kinds. One stored document never holds both. */
export type ConsentKind = 'use' | 'disclosure';

/**
 * Stored use consent. `kind` is only `use`. Recipients belong on the disclosure
 * document, so this record does not carry them.
 */
export interface UseConsentRecord {
  uid: string;
  taxYear: number;
  disclosingPreparerLegalName: string;
  taxpayerName: string;
  purpose: string;
  returnsCovered: CoveredReturn[];
  scope: DisclosureScope;
  signatureMethod: SignatureMethod;
  signatureValue: string;
  userTypedNotPrefilled: boolean;
  signedAt: string;
  expiresAt: string;
  durationStated: DurationStated;
  consentTextVersion: string;
  consentTextSha256: string;
  kind: 'use';
  withdrawnAt: string | null;
}

/** A use record that also authorizes a disclosure. Separate documents are required. */
export function coversDisclosureAsWell(data: {
  coversDisclosure?: unknown;
  disclosureConsent?: unknown;
  kind?: unknown;
  recipients?: unknown;
}): boolean {
  if (data.coversDisclosure === true) return true;
  if (data.disclosureConsent != null) return true;
  if (Array.isArray(data.recipients) && data.recipients.length > 0) return true;
  if (typeof data.kind !== 'string' || data.kind === 'use') return false;
  return data.kind.includes('disclosure');
}

export function signatureMethodValue(value: unknown): SignatureMethod | null {
  return isSignatureMethod(value) ? value : null;
}
