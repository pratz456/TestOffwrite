import { adminDb } from '@/lib/firebase/admin';
import {
  CURRENT_USE_CONSENT_TEXT_VERSION,
  DISCLOSING_PREPARER_LEGAL_NAME,
  DRAFT_USE_CONSENT_TEXT,
  FILING_CONSENT_TEXT_COLLECTION,
  FILING_USE_CONSENT_COLLECTION,
} from './config';
import { DEFAULT_CONSENT_DURATION, expiresAtFor, isDurationStated, type DurationStated } from './duration';
import {
  coversDisclosureAsWell,
  disclosingPreparerMatchesConfig,
  isReturnCode,
  refusal,
  type ConsentRefusal,
  type CoveredReturn,
  type DisclosureScope,
  type UseConsentRecord,
} from './record';
import { isAcceptedSignatureMethod, isSignatureMethod } from './signature';
import { filingConsentNow } from './clock';
import { consentTextSha256 } from './text';

export interface SaveUseConsentInput {
  uid: string;
  taxYear: number;
  taxpayerName: string;
  purpose: string;
  returnsCovered: CoveredReturn[];
  scope: DisclosureScope;
  signatureMethod: string;
  signatureValue: string;
  userTypedNotPrefilled: boolean;
  /** Omitted when the person does not choose a period. Save then uses one year. */
  duration?: DurationStated;
  kind: string;
  coversDisclosure?: boolean;
  disclosureConsent?: unknown;
  recipients?: unknown;
}

export type SaveUseConsentResult =
  | { ok: true; id: string; record: UseConsentRecord }
  | ConsentRefusal;

function blank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

/**
 * Writes one use consent into the use collection. A record that also covers a
 * disclosure is rejected and nothing is written. The disclosing preparer name,
 * the signing time, and the consent text hash come from the server.
 */
export async function saveUseConsent(input: SaveUseConsentInput): Promise<SaveUseConsentResult> {
  if (input.kind !== 'use' || coversDisclosureAsWell(input)) {
    return refusal('combined_use_and_disclosure', 'A use consent and a disclosure consent must be separate records.');
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
  if (blank(input.uid) || blank(input.taxpayerName) || blank(input.purpose) || blank(input.signatureValue)) {
    return refusal('missing_field', 'A required use consent field is missing or empty.');
  }
  if (typeof input.taxYear !== 'number' || !Number.isInteger(input.taxYear)) {
    return refusal('missing_field', 'Required field taxYear is missing or empty.', 'taxYear');
  }
  if (!Array.isArray(input.returnsCovered) || input.returnsCovered.length === 0) {
    return refusal('missing_field', 'Required field returnsCovered is missing or empty.', 'returnsCovered');
  }

  const duration = input.duration === undefined ? DEFAULT_CONSENT_DURATION : input.duration;
  if (!isDurationStated(duration)) {
    return refusal('missing_field', 'The stated duration is missing or empty.', 'durationStated');
  }
  const signedAt = filingConsentNow().toISOString();
  const expiresAt = expiresAtFor(signedAt, duration);
  if (!expiresAt) return refusal('missing_field', 'The expiry time could not be set from the stated duration.', 'expiresAt');

  const record: UseConsentRecord = {
    uid: input.uid,
    taxYear: input.taxYear,
    disclosingPreparerLegalName: DISCLOSING_PREPARER_LEGAL_NAME,
    taxpayerName: input.taxpayerName,
    purpose: input.purpose,
    returnsCovered: input.returnsCovered,
    scope: input.scope,
    signatureMethod: input.signatureMethod,
    signatureValue: input.signatureValue,
    userTypedNotPrefilled: true,
    signedAt,
    expiresAt,
    durationStated: { unit: duration.unit, count: duration.count },
    consentTextVersion: CURRENT_USE_CONSENT_TEXT_VERSION,
    consentTextSha256: consentTextSha256(DRAFT_USE_CONSENT_TEXT),
    kind: 'use',
    withdrawnAt: null,
  };

  if (!disclosingPreparerMatchesConfig(record.disclosingPreparerLegalName)) {
    return refusal('disclosing_preparer_mismatch', 'The disclosing preparer name does not match the configured legal entity.');
  }
  if (record.returnsCovered.some(item => item.taxYear !== record.taxYear || !isReturnCode(item.code))) {
    return refusal('missing_field', 'Each covered return needs the consent tax year and an explicit federal or state code.', 'returnsCovered');
  }

  const textRef = adminDb.collection(FILING_CONSENT_TEXT_COLLECTION).doc(CURRENT_USE_CONSENT_TEXT_VERSION);
  const existingText = await textRef.get();
  if (!existingText.exists) {
    await textRef.create({ version: CURRENT_USE_CONSENT_TEXT_VERSION, text: DRAFT_USE_CONSENT_TEXT });
  } else {
    const stored = existingText.data();
    const storedText = stored && typeof stored.text === 'string' ? stored.text : '';
    if (storedText !== DRAFT_USE_CONSENT_TEXT) {
      return refusal('consent_text_mismatch', 'The stored use consent text for this version no longer matches the text that was signed.');
    }
  }

  const ref = adminDb.collection(FILING_USE_CONSENT_COLLECTION).doc();
  await ref.create(record);
  return { ok: true, id: ref.id, record };
}
