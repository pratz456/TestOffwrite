import { adminDb } from '@/lib/firebase/admin';
import {
  CURRENT_CONSENT_TEXT_VERSION,
  FILING_CONSENT_TEXT_COLLECTION,
  FILING_DISCLOSURE_CONSENT_COLLECTION,
  PARTNER_RECIPIENT_LEGAL_NAMES,
} from './config';
import { expiresAtFor, isDurationStated, isPastExpiry } from './duration';
import {
  coversUseAsWell,
  disclosingPreparerMatchesConfig,
  missingRequiredField,
  recipientNotOnLegalNameList,
  refusal,
  returnKey,
  type ConsentRefusal,
  type CoveredReturn,
  type DisclosureScope,
} from './record';
import { isAcceptedSignatureMethod, isSignatureMethod } from './signature';
import { filingConsentNow } from './clock';
import { beforeWorkHandOffRefusal } from './before-work';
import { consentTextSha256, draftDisclosureConsentText } from './text';
import { vtHandOffRefusal } from './vt-declaration';

export interface HandOffReturn {
  code: string;
  taxYear: number;
  fields: Record<string, unknown>;
}

export interface HandOffPayload {
  returns: HandOffReturn[];
}

/**
 * The browser flag is accepted so a caller can pass it through, and it never
 * authorizes a send. Only a stored record can do that.
 */
export interface HandOffRequest {
  signedInUid: string;
  taxYear: number;
  recipientLegalName: string;
  returns: HandOffReturn[];
  consentRecordId?: string;
  browserConsentChecked?: boolean;
  /** Home state. Omitted for a hand off that is not a state specific check. */
  residentState?: string;
}

export type HandOffDecision =
  | { ok: true; payload: HandOffPayload }
  | ConsentRefusal;

export interface PartnerDelivery {
  recipientLegalName: string;
  payload: HandOffPayload;
}

/** Records what would have been sent. It does not open a network connection. */
export interface PartnerSendStub {
  deliveries: PartnerDelivery[];
  deliver(delivery: PartnerDelivery): void;
}

export function createPartnerSendStub(): PartnerSendStub {
  const deliveries: PartnerDelivery[] = [];
  return {
    deliveries,
    deliver(delivery) {
      deliveries.push({
        recipientLegalName: delivery.recipientLegalName,
        payload: {
          returns: delivery.payload.returns.map(item => ({
            code: item.code,
            taxYear: item.taxYear,
            fields: { ...item.fields },
          })),
        },
      });
    },
  };
}

export type SendResult =
  | { sent: true }
  | { sent: false; code: string; message: string; field?: string };

/**
 * Re reads the stored consent and decides whether this send may leave.
 * Call this immediately before every send, including a retry or a queued job.
 * On any refusal the caller sends nothing.
 */
export async function evaluateFilingHandOff(request: HandOffRequest): Promise<HandOffDecision> {
  const recordId = typeof request.consentRecordId === 'string' ? request.consentRecordId.trim() : '';
  if (!recordId) {
    return refusal('no_record', 'No disclosure consent record is stored. A browser consent flag is not a record.');
  }

  const snap = await adminDb.collection(FILING_DISCLOSURE_CONSENT_COLLECTION).doc(recordId).get();
  if (!snap.exists) {
    return refusal('no_record', 'No disclosure consent record is stored. A browser consent flag is not a record.');
  }
  const raw = snap.data();
  if (!raw) {
    return refusal('no_record', 'No disclosure consent record is stored. A browser consent flag is not a record.');
  }
  const data = raw as Record<string, unknown>;

  if (coversUseAsWell(data)) {
    return refusal('combined_use_and_disclosure', 'A record that covers both a disclosure and a use is refused.');
  }

  const missing = missingRequiredField(data);
  if (missing) return refusal('missing_field', `Required field ${missing} is missing or empty.`, missing);

  const signatureMethod = data.signatureMethod;
  if (!isSignatureMethod(signatureMethod)) {
    return refusal('invalid_signature_method', 'The signature method is not one of the three allowed values.');
  }
  if (!isAcceptedSignatureMethod(signatureMethod)) {
    return refusal('signature_method_not_accepted', 'Version 1 accepts only a typed name. This is a draft product choice pending approval.');
  }
  if (data.userTypedNotPrefilled !== true) {
    return refusal('signature_not_user_typed', 'The signature must be typed into a field that was not prefilled.');
  }

  if (!disclosingPreparerMatchesConfig(String(data.disclosingPreparerLegalName))) {
    return refusal('disclosing_preparer_mismatch', 'The disclosing preparer name does not match the configured legal entity.');
  }

  if (data.consentTextVersion !== CURRENT_CONSENT_TEXT_VERSION) {
    return refusal('text_version_not_current', 'The consent text version is not the current version. The person has to sign again.');
  }

  const codeText = draftDisclosureConsentText(String(data.consentTextVersion));
  if (codeText === null || consentTextSha256(codeText) !== data.consentTextSha256) {
    return refusal('consent_text_mismatch', 'The consent text for this version no longer matches the text that was signed.');
  }

  const textSnap = await adminDb.collection(FILING_CONSENT_TEXT_COLLECTION).doc(String(data.consentTextVersion)).get();
  const storedTextData = textSnap.exists ? textSnap.data() : undefined;
  const storedText = storedTextData && typeof storedTextData.text === 'string' ? storedTextData.text : '';
  if (!storedText || consentTextSha256(storedText) !== data.consentTextSha256) {
    return refusal('consent_text_mismatch', 'The stored consent text no longer matches the text that was signed.');
  }

  if (data.uid !== request.signedInUid) {
    return refusal('uid_mismatch', 'The consent record belongs to a different account.');
  }
  if (data.taxYear !== request.taxYear) {
    return refusal('tax_year_mismatch', 'The consent record is for a different tax year than the return being sent.');
  }

  const recipients = data.recipients as string[];
  if (!recipients.includes(request.recipientLegalName)) {
    return refusal('recipient_not_on_list', 'The hand off recipient is not on the signed recipient list.');
  }
  if (recipientNotOnLegalNameList(recipients) || !PARTNER_RECIPIENT_LEGAL_NAMES.includes(request.recipientLegalName)) {
    return refusal('recipient_not_legal_name', 'Each recipient must be a legal name from the partner list. A description is refused.');
  }

  if (data.withdrawnAt != null) {
    return refusal('withdrawn', 'The consent was withdrawn. Nothing more is sent.');
  }

  if (!isDurationStated(data.durationStated)) {
    return refusal('missing_field', 'Required field durationStated is missing or empty.', 'durationStated');
  }
  const expectedExpiry = expiresAtFor(String(data.signedAt), data.durationStated);
  if (!expectedExpiry || data.expiresAt !== expectedExpiry) {
    return refusal('expiry_mismatch', 'The expiry does not equal the signing time plus the duration stated in the consent.');
  }
  if (isPastExpiry(String(data.expiresAt), filingConsentNow())) {
    return refusal('expired', 'The consent is past its expiry. Nothing is sent.');
  }

  const covered = new Set((data.returnsCovered as CoveredReturn[]).map(item => returnKey(item.code, item.taxYear)));
  if (request.returns.length === 0 || request.returns.some(item => !covered.has(returnKey(item.code, item.taxYear)))) {
    return refusal('return_not_covered', 'The send includes a return that is not named in the consent.');
  }

  const scope = data.scope as DisclosureScope;
  if (scope.kind === 'fields') {
    const named = new Set(scope.fields);
    for (const item of request.returns) {
      for (const field of Object.keys(item.fields)) {
        if (!named.has(field)) return refusal('field_not_named', 'The send includes a field the consent does not name.');
      }
    }
  }

  const vtRefusal = await vtHandOffRefusal({
    residentState: request.residentState,
    uid: request.signedInUid,
    partnerLegalName: request.recipientLegalName,
    returns: request.returns.map(item => ({ code: item.code, taxYear: item.taxYear })),
  });
  if (vtRefusal) return vtRefusal;

  const screenRefusal = await beforeWorkHandOffRefusal({
    residentState: request.residentState,
    uid: request.signedInUid,
    taxYear: request.taxYear,
  });
  if (screenRefusal) return screenRefusal;

  return {
    ok: true,
    payload: { returns: request.returns.map(item => ({ code: item.code, taxYear: item.taxYear, fields: { ...item.fields } })) },
  };
}

/**
 * Partner send entry. A future route, retry, or queued job calls this
 * immediately before delivery. The gate re reads the record inside this call.
 * A refusal returns an error and does not call the stub.
 */
export async function sendFilingHandOff(request: HandOffRequest, stub: PartnerSendStub): Promise<SendResult> {
  const decision = await evaluateFilingHandOff(request);
  if (!decision.ok) {
    return decision.field === undefined
      ? { sent: false, code: decision.code, message: decision.message }
      : { sent: false, code: decision.code, message: decision.message, field: decision.field };
  }
  stub.deliver({ recipientLegalName: request.recipientLegalName, payload: decision.payload });
  return { sent: true };
}

/** Queued jobs and retries must use this, which calls the gate again immediately before delivery. */
export async function runQueuedFilingHandOff(job: { request: HandOffRequest }, stub: PartnerSendStub): Promise<SendResult> {
  return sendFilingHandOff(job.request, stub);
}
