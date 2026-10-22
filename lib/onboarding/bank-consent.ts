import { createHash } from 'node:crypto';
import { adminDb, FieldValue } from '@/lib/firebase/admin';
import { legacyBankDataConsent } from './consents';
import { BANK_CONSENT_SOURCE, BANK_CONSENT_TEXT, BANK_CONSENT_VERSION } from './bank-consent-copy';

/**
 * Pending owner decision: people who already linked a bank keep syncing until a
 * one-time prompt exists. An older sign-up record with `bank_data: true` counts
 * only when that account already has a saved Plaid item or stored access record.
 * Set this to false to stop accepting those records. Removal is this one assignment.
 */
export const ACCEPT_LEGACY_BANK_DATA_CONSENT = true;

/** True only while the owner decision above still accepts an older `bank_data: true` record for an account that already has a saved bank link. */
export function legacyBankDataConsentStillCounts(
  record: unknown,
  accept = ACCEPT_LEGACY_BANK_DATA_CONSENT,
  savedBankLink = false,
): boolean {
  return accept && savedBankLink && legacyBankDataConsent(record);
}

function storedSecret(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

/** A Plaid item or access token already stored for this account. A disconnected item does not count. */
function profileHasSavedBankLink(profile: Record<string, unknown> | undefined): boolean {
  if (!profile) return false;
  return storedSecret(profile.plaid_item_id) || storedSecret(profile.plaid_token) || storedSecret(profile.access_token);
}

function connectionHasSavedBankLink(data: Record<string, unknown> | undefined): boolean {
  if (!data || data.status === 'disconnected') return false;
  return storedSecret(data.encryptedAccessToken) || storedSecret(data.accessToken) || storedSecret(data.itemId);
}

async function accountHasSavedBankLink(uid: string, profile: Record<string, unknown> | undefined): Promise<boolean> {
  if (profileHasSavedBankLink(profile)) return true;
  const saved = await adminDb.collection('plaid_connections').where('uid', '==', uid).get();
  return saved.docs.some(doc => connectionHasSavedBankLink(doc.data()));
}

export function bankConsentWordingHash(text = BANK_CONSENT_TEXT): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** A saved bank-connect record for the current wording. Older sign-up records are checked separately. */
export function isCurrentBankConsentRecord(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  return record.version === BANK_CONSENT_VERSION
    && record.source === BANK_CONSENT_SOURCE
    && record.wording_hash === bankConsentWordingHash()
    && typeof record.accepted_at === 'string'
    && record.accepted_at.length <= 40
    && !Number.isNaN(Date.parse(record.accepted_at));
}

/**
 * True when this account already has a bank acknowledgment: a new bank-connect record,
 * or, while `ACCEPT_LEGACY_BANK_DATA_CONSENT` is set, an older `bank_data: true` record
 * on an account that already has a saved bank link.
 */
export async function hasCurrentBankConsent(uid: string): Promise<boolean> {
  const profileSnap = await adminDb.doc(`user_profiles/${uid}`).get();
  const profile = profileSnap.data() as Record<string, unknown> | undefined;
  if (legacyBankDataConsentStillCounts(profile?.consents, ACCEPT_LEGACY_BANK_DATA_CONSENT, await accountHasSavedBankLink(uid, profile))) return true;
  const saved = await adminDb.collection(`user_profiles/${uid}/bank_consents`).get();
  return saved.docs.some(doc => isCurrentBankConsentRecord(doc.data()));
}

/** Adds one bank-connect record. Earlier records are left as they were. */
export async function appendBankConsent(uid: string, acceptedAt: string): Promise<void> {
  await adminDb.collection(`user_profiles/${uid}/bank_consents`).doc().create({
    version: BANK_CONSENT_VERSION,
    wording_hash: bankConsentWordingHash(),
    accepted_at: acceptedAt,
    recorded_at: FieldValue.serverTimestamp(),
    source: BANK_CONSENT_SOURCE,
  });
}
