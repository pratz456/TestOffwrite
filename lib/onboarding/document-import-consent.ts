/**
 * IRC §7216 consent to disclose tax return information to OpenAI, wired to the
 * document-import image fallback (app/api/tax/import-document). The wording is the
 * Rev. Proc. 2013-14 draft in docs/compliance/SECTION_7216_CONSENT_REVIEW_2026-09-17.md §4,
 * reproduced verbatim; change DOCUMENT_IMPORT_CONSENT_VERSION whenever it changes so
 * that earlier signatures no longer authorize the disclosure.
 *
 * The two bracketed blanks are completed by the taxpayer on the consent screen:
 * the typed full name is the electronic signature (Rev. Proc. 2013-14 §6) and the
 * date is displayed, never pre-filled or completed later.
 */
export const DOCUMENT_IMPORT_CONSENT_VERSION = '2026-09-17';

export const DOCUMENT_IMPORT_CONSENT_NAME_BLANK = '[type your full name]';
export const DOCUMENT_IMPORT_CONSENT_DATE_BLANK = "[today's date]";

export const DOCUMENT_IMPORT_CONSENT_TEXT = `CONSENT TO DISCLOSURE OF TAX RETURN INFORMATION

Federal law requires this consent form be provided to you. Unless authorized
by law, we cannot disclose your tax return information to third parties for
purposes other than those related to the preparation and filing of your tax
return without your consent. If you consent to the disclosure of your tax
return information, Federal law may not protect your tax return information
from further use or distribution.

You are not required to complete this form. Because our ability to disclose
your tax return information to another tax return preparer affects the tax
return preparation service(s) that we provide to you and its (their) cost, we
may decline to provide you with tax return preparation services or change the
terms (including the cost) of the tax return preparation services that we
provide to you if you do not sign this form. If you agree to the disclosure of
your tax return information, your consent is valid for the amount of time that
you specify. If you do not specify the duration of your consent, your consent
is valid for one year from the date of signature.

WriteOff uses OpenAI, L.L.C. (San Francisco, California) as a service provider
to help categorize your business transactions and suggest possible tax
treatments for your review, and to read tax documents and bank statements you
choose to upload. To do this, WriteOff discloses to OpenAI: your profession,
business type, state, income ranges, home-office and vehicle-use facts, and
travel pattern; the merchant, amount, date, location, category, payment
channel and your notes for each transaction analyzed; your past confirmed
categorizations for the same merchant; and the full content of any W-2, 1099,
platform summary, bank or credit card statement, or receipt image you upload
for extraction, which may include your Social Security number, taxpayer
identification number, address, account numbers and employer identification
number if they appear on the document. OpenAI processes this information only
to return results to WriteOff and does not use it to train its models.
WriteOff does not disclose your name, email address, or bank login credentials
to OpenAI.

Duration: this consent is valid until you delete your WriteOff account or
withdraw it in Settings, whichever is earlier.

I, [type your full name], authorize WriteOff to disclose the tax return
information described above to OpenAI, L.L.C. for the purpose of assisting in
the preparation of my records and tax return.

Signature (type your full name): ____________________   Date: [today's date]

If you believe your tax return information has been disclosed or used
improperly in a manner unauthorized by law or without your permission, you may
contact the Treasury Inspector General for Tax Administration (TIGTA) by
telephone at 1-800-366-4484, or by email at complaints@tigta.treas.gov.`;

/** Error code returned by the import route when the image fallback is needed but not authorized. */
export const DOCUMENT_IMAGE_CONSENT_REQUIRED = 'DOCUMENT_IMAGE_CONSENT_REQUIRED';
