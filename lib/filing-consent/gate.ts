import { adminDb } from '@/lib/firebase/admin';
import {
  CURRENT_CONSENT_TEXT_VERSION,
  FILING_CONSENT_TEXT_COLLECTION,
  FILING_DISCLOSURE_CONSENT_COLLECTION,
  RESIDENT_STATE_CODES,
  currentDisclosurePurpose,
  partnerRecipientLegalNames,
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
  residentState: string;
}

/** Missing home state. The caller asks the state question before the hand off. */
export interface AskResidentStateDecision {
  ok: false;
  code: 'ask_resident_state';
  ask: 'resident_state';
  message: string;
}

export type HandOffDecision =
  | { ok: true; payload: HandOffPayload }
  | AskResidentStateDecision
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

const residentStateCodeSet = new Set(RESIDENT_STATE_CODES);

/** Trim, uppercase, and accept only the shared 51-entry resident-state list. */
export function residentStateForHandOff(value: unknown): string | AskResidentStateDecision | ConsentRefusal {
  // The caller must set residentState from server-side profile data, never from the request body.
  const state = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!state) {
    return {
      ok: false,
      code: 'ask_resident_state',
      ask: 'resident_state',
      message: 'Ask the resident state question before this hand off.',
    };
  }
  if (!residentStateCodeSet.has(state)) {
    return refusal('invalid_resident_state', 'The resident state is not one of the fifty states or the District of Columbia.');
  }
  return state;
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
  | { sent: false; code: 'ask_resident_state'; ask: 'resident_state'; message: string }
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
  if (data.purpose !== currentDisclosurePurpose()) {
    return refusal(
      'consent_purpose_mismatch',
      'The consent purpose does not match the current stated purpose. A new consent is required.',
    );
  }

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
  if (recipientNotOnLegalNameList(recipients) || !partnerRecipientLegalNames().includes(request.recipientLegalName)) {
    return refusal('recipient_not_legal_name', 'Each recipient must be a legal name from the partner list. A description is refused.');
  }
  const consentPartner = typeof data.recipientPartnerId === 'string' ? data.recipientPartnerId.trim() : '';
  if (consentPartner !== request.recipientLegalName) {
    return refusal(
      'recipient_partner_mismatch',
      'The disclosure consent, the before work screen, and the hand off recipient must name the same partner.',
    );
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

  const residentState = residentStateForHandOff(request.residentState);
  if (typeof residentState !== 'string') return residentState;

  const vtRefusal = await vtHandOffRefusal({
    residentState,
    uid: request.signedInUid,
    partnerLegalName: request.recipientLegalName,
    returns: request.returns.map(item => ({ code: item.code, taxYear: item.taxYear })),
  });
  if (vtRefusal) return vtRefusal;

  const screenRefusal = await beforeWorkHandOffRefusal({
    residentState,
    uid: request.signedInUid,
    taxYear: request.taxYear,
    partnerId: request.recipientLegalName,
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
    if (decision.code === 'ask_resident_state') {
      return {
        sent: false,
        code: 'ask_resident_state',
        ask: 'resident_state',
        message: decision.message,
      };
    }
    const refusalDecision = decision as ConsentRefusal;
    return refusalDecision.field === undefined
      ? { sent: false, code: refusalDecision.code, message: refusalDecision.message }
      : { sent: false, code: refusalDecision.code, message: refusalDecision.message, field: refusalDecision.field };
  }
  stub.deliver({ recipientLegalName: request.recipientLegalName, payload: decision.payload });
  return { sent: true };
}

/** Queued jobs and retries must use this, which calls the gate again immediately before delivery. */
export async function runQueuedFilingHandOff(job: { request: HandOffRequest }, stub: PartnerSendStub): Promise<SendResult> {
  return sendFilingHandOff(job.request, stub);
}
