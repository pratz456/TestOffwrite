/**
 * DRAFT configuration for the paid filing disclosure consent (backlog item 90, slice 1).
 * Nothing here is approved legal copy or an approved legal name. The hand off is not
 * wired to a screen or to a live partner.
 *
 * Version 1 is a DRAFT product choice: the schema knows three signature methods, and the
 * accepted set below currently contains only a typed name. Assigned PIN and unique
 * identifier records are refused. This slice does not issue PINs or hold a shared secret.
 *
 * The Firestore collections below are server only. They have no client rule on purpose.
 * Firestore denies a path that no rule matches.
 */

export const FILING_DISCLOSURE_CONSENT_COLLECTION = 'filing_disclosure_consents';
export const FILING_USE_CONSENT_COLLECTION = 'filing_use_consents';
export const FILING_CONSENT_TEXT_COLLECTION = 'filing_consent_texts';
export const FILING_VT_DECLARATION_COLLECTION = 'filing_vt_preparer_declarations';
export const FILING_BEFORE_WORK_DISCLOSURE_COLLECTION = 'filing_before_work_disclosures';
export const FILING_HANDOFF_REFUSAL_LOG_COLLECTION = 'filing_handoff_refusal_logs';

/** Placeholder for the disclosing preparer's legal entity. Not an approved corporate name. */
export const DISCLOSING_PREPARER_LEGAL_NAME = 'DRAFT: WriteOff legal entity name pending approval';

/**
 * Legal names the consent may name as recipients. A description such as
 * "our filing partner" is not on this list and is refused.
 */
export const PARTNER_RECIPIENT_LEGAL_NAMES: readonly string[] = [
  'DRAFT: Partner ERO firm legal name pending approval',
];

export const CURRENT_CONSENT_TEXT_VERSION = 'draft-2026-10-23';
export const CURRENT_USE_CONSENT_TEXT_VERSION = 'draft-use-2026-10-23';

/**
 * DRAFT placeholders for the partner firm. These are not a real company, address,
 * phone, fee, or warranty. The warranty string stands in for words the partner
 * supplies. This product does not author that warranty.
 */
export const DRAFT_PARTNER_SIGNING_EA_NAME = 'DRAFT placeholder: signing enrolled agent name pending approval';
export const DRAFT_PARTNER_SIGNING_EA_PTIN = 'DRAFT placeholder: PTIN pending approval';
export const DRAFT_PARTNER_PRINCIPAL_BUSINESS_ADDRESS = 'DRAFT placeholder: principal business address pending approval';
export const DRAFT_PARTNER_PRIMARY_BUSINESS_PHONE = 'DRAFT placeholder: primary business telephone number pending approval';
export const FEE_ESTIMATE_PHRASE = 'estimate of the total charge';
export const DRAFT_PARTNER_FEE_ESTIMATE = 'DRAFT placeholder: an estimate of the total charge for completion of all requested tax preparation services, amount pending approval';
export const DRAFT_PARTNER_SECURITY_WARRANTY = 'DRAFT placeholder pending partner wording: by encryption or other means, provide for the secure storage and transmission of a taxpayer\'s personal and tax record information';

export interface DraftPartnerDisclosureCopy {
  signingEaName: string;
  signingEaPtin: string;
  principalBusinessAddress: string;
  primaryBusinessPhone: string;
  feeEstimateOfTotalCharge: string;
  securityWarranty: string;
}

function initialDraftPartnerDisclosureCopy(): DraftPartnerDisclosureCopy {
  return {
    signingEaName: DRAFT_PARTNER_SIGNING_EA_NAME,
    signingEaPtin: DRAFT_PARTNER_SIGNING_EA_PTIN,
    principalBusinessAddress: DRAFT_PARTNER_PRINCIPAL_BUSINESS_ADDRESS,
    primaryBusinessPhone: DRAFT_PARTNER_PRIMARY_BUSINESS_PHONE,
    feeEstimateOfTotalCharge: DRAFT_PARTNER_FEE_ESTIMATE,
    securityWarranty: DRAFT_PARTNER_SECURITY_WARRANTY,
  };
}

/** Partner disclosure copy the screen shows. Tests can replace a field. The shipped values stay the placeholders above. */
let draftPartnerDisclosureCopy = initialDraftPartnerDisclosureCopy();

export function currentDraftPartnerDisclosureCopy(): DraftPartnerDisclosureCopy {
  return { ...draftPartnerDisclosureCopy };
}

/** Replaces address, phone, fee, or warranty copy. The next screen hash follows this copy. */
export function replaceDraftPartnerDisclosureCopy(patch: Partial<DraftPartnerDisclosureCopy>): void {
  draftPartnerDisclosureCopy = { ...draftPartnerDisclosureCopy, ...patch };
}

export function resetDraftPartnerDisclosureCopy(): void {
  draftPartnerDisclosureCopy = initialDraftPartnerDisclosureCopy();
}

/**
 * Extra partner names registered by tests. The shipped list above is unchanged.
 * A name has to start with the draft marker.
 */
const draftTestPartnerNames: string[] = [];

export function partnerRecipientLegalNames(): readonly string[] {
  return [...PARTNER_RECIPIENT_LEGAL_NAMES, ...draftTestPartnerNames];
}

export function addDraftTestPartnerName(name: string): void {
  const trimmed = name.trim();
  if (!trimmed.startsWith('DRAFT')) return;
  if (!partnerRecipientLegalNames().includes(trimmed)) draftTestPartnerNames.push(trimmed);
}

export function resetDraftTestPartnerNames(): void {
  draftTestPartnerNames.length = 0;
}

/**
 * DRAFT partner condition for California staffing. This is not the before work
 * screen. Every California resident return is reviewed and signed by an enrolled
 * agent. A person who is not an enrolled agent and who touches the return is the
 * partner's own employee. No contractor works on those returns. No partner has
 * agreed to this.
 */
export const DRAFT_CA_STAFFING = {
  placeholder: true,
  everyCaReturnReviewedAndSignedByEnrolledAgent: true,
  nonEnrolledAgentWorkIsPartnerEmployeeOnly: true,
  contractorsOnCaReturns: false,
} as const;

/**
 * DRAFT consent text for the current version. The mandatory sentences follow Rev. Proc.
 * 2013-14 section 5.04(1)(b) and section 5.04(1)(d), with the preparer name swapped in.
 * This text is not approved and must not be shown to a customer.
 */
export const DRAFT_DISCLOSURE_CONSENT_TEXT = [
  'DRAFT pending approval. Do not show this consent to a customer until the text is approved.',
  'Federal law requires this consent form be provided to you. Unless authorized by law, WriteOff cannot disclose your tax return information to third parties for purposes other than those related to the preparation and filing of your tax return without your consent. If you consent to the disclosure of your tax return information, Federal law may not protect your tax return information from further use or distribution. You are not required to complete this form. Because WriteOff\'s ability to disclose your tax return information to another tax return preparer affects the tax return preparation service(s) that WriteOff provides to you and its (their) cost, WriteOff may decline to provide you with tax return preparation services or change the terms (including the cost) of the tax return preparation services that WriteOff provides to you if you do not sign this form. If you agree to the disclosure of your tax return information, your consent is valid for the amount of time that you specify. If you do not specify the duration of your consent, your consent is valid for one year from the date of signature.',
  'If you believe your tax return information has been disclosed or used improperly in a manner unauthorized by law or without your permission, you may contact the Treasury Inspector General for Tax Administration (TIGTA) by telephone at 1-800-366-4484, or by email at complaints@tigta.treas.gov.',
].join('\n');

/**
 * DRAFT use consent text. A use sits in its own document, separate from the
 * disclosure text above. This text is not approved and must not be shown to a customer.
 */
export const DRAFT_USE_CONSENT_TEXT = [
  'DRAFT pending approval. Do not show this consent to a customer until the text is approved.',
  'This document authorizes a use of tax return information. It does not authorize a disclosure.',
].join('\n');
