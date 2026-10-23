import { adminDb } from '@/lib/firebase/admin';
import {
  CURRENT_CONSENT_TEXT_VERSION,
  DISCLOSING_PREPARER_LEGAL_NAME,
  DRAFT_DISCLOSURE_CONSENT_TEXT,
  FILING_CONSENT_TEXT_COLLECTION,
  FILING_DISCLOSURE_CONSENT_COLLECTION,
} from './config';
import { DEFAULT_CONSENT_DURATION, expiresAtFor, isDurationStated, type DurationStated } from './duration';
import {
  coversUseAsWell,
  disclosingPreparerMatchesConfig,
  isReturnCode,
  missingRequiredField,
  recipientNotOnLegalNameList,
  refusal,
  type ConsentRefusal,
  type CoveredReturn,
  type DisclosureConsentRecord,
  type DisclosureScope,
} from './record';
import { isAcceptedSignatureMethod, isSignatureMethod } from './signature';
import { consentTextSha256 } from './text';

export interface SaveDisclosureConsentInput {
  uid: string;
  taxYear: number;
  taxpayerName: string;
  purpose: string;
  returnsCovered: CoveredReturn[];
  recipients: string[];
  scope: DisclosureScope;
  signatureMethod: string;
  signatureValue: string;
  userTypedNotPrefilled: boolean;
  signedAt: string;
  /** Omitted when the person does not choose a period. Save then uses one year. */
  duration?: DurationStated;
  kind: string;
  coversUse?: boolean;
  useConsent?: unknown;
}

export type SaveDisclosureConsentResult =
  | { ok: true; id: string; record: DisclosureConsentRecord }
  | ConsentRefusal;

function canonicalSignedAt(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/**
 * Writes one disclosure consent. A record that also covers a use is rejected
 * and nothing is written. The disclosing preparer name and the consent text
 * hash come from server config, not from the caller.
 */
export async function saveDisclosureConsent(input: SaveDisclosureConsentInput): Promise<SaveDisclosureConsentResult> {
  if (coversUseAsWell(input)) {
    return refusal('combined_use_and_disclosure', 'A disclosure consent and a use consent must be separate records.');
  }
  if (input.kind !== 'disclosure') {
    return refusal('combined_use_and_disclosure', 'This collection stores a disclosure consent only.');
  }
  if (!isSignatureMethod(input.signatureMethod)) {
    return refusal('invalid_signature_method', 'The signature method is not one of the three allowed values.');
  }
  if (!isAcceptedSignatureMethod(input.signatureMethod)) {
    return refusal('signature_method_not_accepted', 'Version 1 accepts only a typed name. This is a draft product choice pending approval.');
  }
  if (input.userTypedNotPrefilled !== true) {
    return refusal('signature_not_user_typed', 'The signature must be typed into a field that was not prefilled.');
  }

  const duration = input.duration === undefined ? DEFAULT_CONSENT_DURATION : input.duration;
  if (!isDurationStated(duration)) {
    return refusal('missing_field', 'The stated duration is missing or empty.', 'durationStated');
  }
  const signedAt = canonicalSignedAt(input.signedAt);
  if (!signedAt) return refusal('missing_field', 'The time signed is missing or empty.', 'signedAt');
  const expiresAt = expiresAtFor(signedAt, duration);
  if (!expiresAt) return refusal('missing_field', 'The expiry time could not be set from the stated duration.', 'expiresAt');

  const record: DisclosureConsentRecord = {
    uid: input.uid,
    taxYear: input.taxYear,
    disclosingPreparerLegalName: DISCLOSING_PREPARER_LEGAL_NAME,
    taxpayerName: input.taxpayerName,
    purpose: input.purpose,
    returnsCovered: input.returnsCovered,
    recipients: input.recipients,
    scope: input.scope,
    signatureMethod: input.signatureMethod,
    signatureValue: input.signatureValue,
    userTypedNotPrefilled: true,
    signedAt,
    expiresAt,
    durationStated: { unit: duration.unit, count: duration.count },
    consentTextVersion: CURRENT_CONSENT_TEXT_VERSION,
    consentTextSha256: consentTextSha256(DRAFT_DISCLOSURE_CONSENT_TEXT),
    kind: 'disclosure',
    withdrawnAt: null,
  };

  const missing = missingRequiredField(record as unknown as Record<string, unknown>);
  if (missing) return refusal('missing_field', `Required field ${missing} is missing or empty.`, missing);
  if (!disclosingPreparerMatchesConfig(record.disclosingPreparerLegalName)) {
    return refusal('disclosing_preparer_mismatch', 'The disclosing preparer name does not match the configured legal entity.');
  }
  if (record.returnsCovered.some(item => item.taxYear !== record.taxYear || !isReturnCode(item.code))) {
    return refusal('missing_field', 'Each covered return needs the consent tax year and an explicit federal or state code.', 'returnsCovered');
  }
  const illegalRecipient = recipientNotOnLegalNameList(record.recipients);
  if (illegalRecipient) {
    return refusal('recipient_not_legal_name', 'Each recipient must be a legal name from the partner list. A description is refused.');
  }

  const textRef = adminDb.collection(FILING_CONSENT_TEXT_COLLECTION).doc(CURRENT_CONSENT_TEXT_VERSION);
  const existingText = await textRef.get();
  if (!existingText.exists) {
    await textRef.set({ version: CURRENT_CONSENT_TEXT_VERSION, text: DRAFT_DISCLOSURE_CONSENT_TEXT });
  } else {
    const stored = existingText.data();
    const storedText = stored && typeof stored.text === 'string' ? stored.text : '';
    if (storedText !== DRAFT_DISCLOSURE_CONSENT_TEXT) {
      return refusal('consent_text_mismatch', 'The stored consent text for this version no longer matches the text that was signed.');
    }
  }

  const ref = adminDb.collection(FILING_DISCLOSURE_CONSENT_COLLECTION).doc();
  await ref.set(record);
  return { ok: true, id: ref.id, record };
}

export async function withdrawDisclosureConsent(recordId: string, uid: string, now: Date = new Date()): Promise<{ ok: true } | ConsentRefusal> {
  const ref = adminDb.collection(FILING_DISCLOSURE_CONSENT_COLLECTION).doc(recordId);
  const snap = await ref.get();
  if (!snap.exists) return refusal('no_record', 'No disclosure consent record is stored.');
  const data = snap.data();
  if (!data || data.uid !== uid) return refusal('uid_mismatch', 'The consent record belongs to a different account.');
  await ref.update({ withdrawnAt: now.toISOString() });
  return { ok: true };
}
