export {
  CURRENT_CONSENT_TEXT_VERSION,
  DISCLOSING_PREPARER_LEGAL_NAME,
  DRAFT_DISCLOSURE_CONSENT_TEXT,
  FILING_CONSENT_TEXT_COLLECTION,
  FILING_DISCLOSURE_CONSENT_COLLECTION,
  PARTNER_RECIPIENT_LEGAL_NAMES,
} from './config';
export { DEFAULT_CONSENT_DURATION, expiresAtFor, isPastExpiry, type DurationStated } from './duration';
export {
  createPartnerSendStub,
  evaluateFilingHandOff,
  runQueuedFilingHandOff,
  sendFilingHandOff,
  type HandOffRequest,
  type HandOffReturn,
  type PartnerSendStub,
  type SendResult,
} from './gate';
export { type CoveredReturn, type DisclosureConsentRecord, type DisclosureScope } from './record';
export {
  ACCEPTED_SIGNATURE_METHODS,
  hashSignatureValue,
  MIN_ASSIGNED_PIN_OR_IDENTIFIER_LENGTH,
  signatureValueMeetsLength,
  SIGNATURE_METHODS,
  uniqueIdentifierIsComplete,
  type SignatureMethod,
} from './signature';
export { saveDisclosureConsent, withdrawDisclosureConsent, type SaveDisclosureConsentInput } from './store';
export { noteInFirmPreparerReassignment } from './store';
export { consentTextSha256, draftDisclosureConsentText } from './text';
