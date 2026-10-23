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
export const FILING_CONSENT_TEXT_COLLECTION = 'filing_consent_texts';

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
