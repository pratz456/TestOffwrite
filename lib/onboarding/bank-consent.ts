import { createHash } from 'node:crypto';
import { adminDb, FieldValue } from '@/lib/firebase/admin';
import { legacyBankDataConsent } from './consents';
import { BANK_CONSENT_SOURCE, BANK_CONSENT_TEXT, BANK_CONSENT_VERSION } from './bank-consent-copy';

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
 * or an older profile record with `bank_data: true` (including profile setup after Google sign-up).
 */
export async function hasCurrentBankConsent(uid: string): Promise<boolean> {
  const profile = await adminDb.doc(`user_profiles/${uid}`).get();
  if (legacyBankDataConsent(profile.data()?.consents)) return true;
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
