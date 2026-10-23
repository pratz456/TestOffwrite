import { createHash } from 'node:crypto';

/**
 * Rev. Proc. 2013-14 section 6.02 signature methods.
 * Version 1 accepts only `typed_name` (section 6.02(b)). The other two values
 * stay in the schema and are refused by the accepted set in this module's caller.
 * Length and hash helpers cover sections 6.02(a) and 6.02(c) for unit tests.
 * This slice does not issue a PIN and does not embed a shared secret.
 */

export const SIGNATURE_METHODS = ['assigned_pin', 'typed_name', 'unique_identifier'] as const;
export type SignatureMethod = (typeof SIGNATURE_METHODS)[number];

/** DRAFT product choice pending approval. Version 1 signs only with a typed name. */
export const ACCEPTED_SIGNATURE_METHODS: readonly SignatureMethod[] = ['typed_name'];

export const MIN_ASSIGNED_PIN_OR_IDENTIFIER_LENGTH = 5;

export function isSignatureMethod(value: unknown): value is SignatureMethod {
  return typeof value === 'string' && (SIGNATURE_METHODS as readonly string[]).includes(value);
}

export function isAcceptedSignatureMethod(value: unknown): value is SignatureMethod {
  return isSignatureMethod(value) && (ACCEPTED_SIGNATURE_METHODS as readonly string[]).includes(value);
}

/** Typed name: any non blank value. PIN and unique identifier: at least 5 characters. */
export function signatureValueMeetsLength(method: SignatureMethod, value: string): boolean {
  if (method === 'typed_name') return value.trim().length > 0;
  return value.length >= MIN_ASSIGNED_PIN_OR_IDENTIFIER_LENGTH;
}

/**
 * Section 6.02(c) also needs a completed identity check. Not accepted in version 1.
 * Kept so the rule can be tested without issuing an identifier.
 */
export function uniqueIdentifierIsComplete(value: string, identityVerified: boolean): boolean {
  return signatureValueMeetsLength('unique_identifier', value) && identityVerified === true;
}

/**
 * Salted hash for a PIN or identifier. The salt is supplied by the caller.
 * There is no secret in this file. Version 1 does not call this when saving a consent.
 */
export function hashSignatureValue(value: string, salt: string): string {
  if (salt.length === 0) {
    throw new Error('A salt is required. This slice does not use a shared secret.');
  }
  return createHash('sha256').update(salt, 'utf8').update('\0', 'utf8').update(value, 'utf8').digest('hex');
}
