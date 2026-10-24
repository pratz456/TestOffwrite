export {
  CURRENT_CONSENT_TEXT_VERSION,
  CURRENT_USE_CONSENT_TEXT_VERSION,
  DISCLOSING_PREPARER_LEGAL_NAME,
  DRAFT_CA_STAFFING,
  DRAFT_DISCLOSURE_CONSENT_TEXT,
  DRAFT_PARTNER_FEE_ESTIMATE,
  DRAFT_PARTNER_PRIMARY_BUSINESS_PHONE,
  DRAFT_PARTNER_PRINCIPAL_BUSINESS_ADDRESS,
  DRAFT_PARTNER_SECURITY_WARRANTY,
  DRAFT_PARTNER_SIGNING_EA_NAME,
  DRAFT_PARTNER_SIGNING_EA_PTIN,
  DRAFT_USE_CONSENT_TEXT,
  FEE_ESTIMATE_PHRASE,
  FILING_BEFORE_WORK_DISCLOSURE_COLLECTION,
  FILING_CONSENT_TEXT_COLLECTION,
  FILING_DISCLOSURE_CONSENT_COLLECTION,
  FILING_HANDOFF_REFUSAL_LOG_COLLECTION,
  FILING_USE_CONSENT_COLLECTION,
  FILING_VT_DECLARATION_COLLECTION,
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
export {
  type ConsentKind,
  type CoveredReturn,
  type DisclosureConsentRecord,
  type DisclosureScope,
  type UseConsentRecord,
} from './record';
export {
  assembleBeforeWorkDisclosureScreen,
  buildBeforeWorkDisclosureScreen,
  recordBeforeWorkDisclosureShown,
  type BeforeWorkDisclosureScreen,
  type PartnerBeforeWorkCopy,
  type RecordBeforeWorkDisclosureInput,
} from './before-work';
export {
  recordPartnerVtDeclaration,
  type RecordVtDeclarationInput,
  type VtDeclarationRecord,
} from './vt-declaration';
export { saveUseConsent, type SaveUseConsentInput, type SaveUseConsentResult } from './use-consent';
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
