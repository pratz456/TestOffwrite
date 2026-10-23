import { adminDb } from '@/lib/firebase/admin';
import {
  CURRENT_CONSENT_TEXT_VERSION,
  DISCLOSING_PREPARER_LEGAL_NAME,
  FILING_CONSENT_TEXT_COLLECTION,
  FILING_DISCLOSURE_CONSENT_COLLECTION,
} from './config';
import { DEFAULT_CONSENT_DURATION, expiresAtFor, isDurationStated, isPastExpiry, type DurationStated } from './duration';
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
import { filingConsentNow } from './clock';
import { consentTextSha256, draftDisclosureConsentText } from './text';

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
  /** Omitted when the person does not choose a period. Save then uses one year. */
  duration?: DurationStated;
  kind: string;
  coversUse?: boolean;
  useConsent?: unknown;
}

export type SaveDisclosureConsentResult =
  | { ok: true; id: string; record: DisclosureConsentRecord }
  | ConsentRefusal;

/**
 * Writes one disclosure consent. A record that also covers a use is rejected
 * and nothing is written. The disclosing preparer name, the signing time, and
 * the consent text hash come from the server, not from the caller.
 * The signing time is filingConsentNow. Tests replace that clock. Callers cannot pass it.
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
  const signedAt = filingConsentNow().toISOString();
  const codeText = draftDisclosureConsentText(CURRENT_CONSENT_TEXT_VERSION);
  if (!codeText) return refusal('consent_text_mismatch', 'The current consent text for this version is missing.');
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
    consentTextSha256: consentTextSha256(codeText),
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
    await textRef.create({ version: CURRENT_CONSENT_TEXT_VERSION, text: codeText });
  } else {
    const stored = existingText.data();
    const storedText = stored && typeof stored.text === 'string' ? stored.text : '';
    if (storedText !== codeText) {
      return refusal('consent_text_mismatch', 'The stored consent text for this version no longer matches the text that was signed.');
    }
  }

  const ref = adminDb.collection(FILING_DISCLOSURE_CONSENT_COLLECTION).doc();
  await ref.create(record);
  return { ok: true, id: ref.id, record };
}

export interface InFirmPreparerReassignment {
  consentRecordId: string;
  uid: string;
  firmLegalName: string;
  preparerName: string;
}

/**
 * Preparer change inside the ERO firm already named on the consent.
 * The consent names that firm, not the individual, so this reads the record
 * and does not write it. A different firm is not an in firm reassignment.
 */
export async function noteInFirmPreparerReassignment(input: InFirmPreparerReassignment): Promise<{ ok: true } | ConsentRefusal> {
  const preparerName = input.preparerName.trim();
  if (!preparerName) return refusal('missing_field', 'The preparer name is missing or empty.', 'preparerName');
  const snap = await adminDb.collection(FILING_DISCLOSURE_CONSENT_COLLECTION).doc(input.consentRecordId).get();
  if (!snap.exists) return refusal('no_record', 'No disclosure consent record is stored.');
  const data = snap.data();
  if (!data || data.uid !== input.uid) return refusal('uid_mismatch', 'The consent record belongs to a different account.');
  const recipients = Array.isArray(data.recipients) ? data.recipients : [];
  if (!recipients.includes(input.firmLegalName)) {
    return refusal('recipient_not_on_list', 'The firm is not the recipient named on the consent.');
  }
  if (recipientNotOnLegalNameList([input.firmLegalName])) {
    return refusal('recipient_not_legal_name', 'The firm must be a legal name from the partner list.');
  }
  if (data.withdrawnAt != null) {
    return refusal('withdrawn', 'The consent is withdrawn. An in firm preparer change is refused.');
  }
  if (typeof data.expiresAt !== 'string' || isPastExpiry(data.expiresAt, filingConsentNow())) {
    return refusal('expired', 'The consent is past its expiry. An in firm preparer change is refused.');
  }
  return { ok: true };
}

export async function withdrawDisclosureConsent(recordId: string, uid: string): Promise<{ ok: true } | ConsentRefusal> {
  const ref = adminDb.collection(FILING_DISCLOSURE_CONSENT_COLLECTION).doc(recordId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return refusal('no_record', 'No disclosure consent record is stored.');
    const data = snap.data();
    if (!data || data.uid !== uid) return refusal('uid_mismatch', 'The consent record belongs to a different account.');
    if (data.withdrawnAt != null) return refusal('withdrawn', 'The consent is already withdrawn.');
    tx.update(ref, { withdrawnAt: filingConsentNow().toISOString() });
    return { ok: true as const };
  });
}
