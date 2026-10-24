/** Client-safe consent vocabulary. Server reads and the model factory live elsewhere. */

export const MODEL_CONSENT_UNAVAILABLE = '[PLACEHOLDER] Not available';

/** Placeholder copy only. Final sentences are not written here. */
export const MODEL_DISCLOSURE_TITLE = '[PLACEHOLDER] Disclosure screen';
export const MODEL_DISCLOSURE_RECIPIENT = '[PLACEHOLDER] Recipient: OpenAI';
export const MODEL_DISCLOSURE_PURPOSE = '[PLACEHOLDER] One purpose';
export const MODEL_DISCLOSURE_CHECKBOX = '[PLACEHOLDER] Disclosure checkbox';
export const MODEL_DISCLOSURE_NAME_LABEL = '[PLACEHOLDER] Typed name';
export const MODEL_DISCLOSURE_DATE_LABEL = '[PLACEHOLDER] Date';
export const MODEL_DISCLOSURE_LENGTH = '[PLACEHOLDER] This consent is valid for one year from the date you sign.';
export const MODEL_DISCLOSURE_TIGTA = '[PLACEHOLDER] TIGTA line';
export const MODEL_DISCLOSURE_SUBMIT = '[PLACEHOLDER] Submit disclosure';
export const MODEL_DISCLOSURE_DECLINE = '[PLACEHOLDER] Decline';
export const MODEL_DISCLOSURE_REVPROC_5041A = [
  '[PLACEHOLDER] Rev. Proc. 2013-14 5.04(1)(a) sentence 1',
  '[PLACEHOLDER] Rev. Proc. 2013-14 5.04(1)(a) sentence 2',
] as const;

/** Fields this disclosure may name. Social Security numbers are not on this list. */
export const MODEL_DISCLOSURE_DATA_LIST = [
  { id: 'profession', label: '[PLACEHOLDER] Profession' },
  { id: 'business_type', label: '[PLACEHOLDER] Business type' },
  { id: 'filing_state', label: '[PLACEHOLDER] Filing state' },
  { id: 'income_range', label: '[PLACEHOLDER] Income range' },
  { id: 'transaction_merchant', label: '[PLACEHOLDER] Transaction merchant' },
  { id: 'transaction_amount', label: '[PLACEHOLDER] Transaction amount' },
  { id: 'transaction_date', label: '[PLACEHOLDER] Transaction date' },
  { id: 'transaction_category', label: '[PLACEHOLDER] Transaction category' },
  { id: 'notes', label: '[PLACEHOLDER] Notes' },
  { id: 'document_text', label: '[PLACEHOLDER] Uploaded document text' },
] as const;

export const MODEL_REUSE_TITLE = '[PLACEHOLDER] Reuse screen';
export const MODEL_REUSE_CHECKBOX = '[PLACEHOLDER] Reuse checkbox';
export const MODEL_REUSE_SUBMIT = '[PLACEHOLDER] Submit reuse';
export const MODEL_REUSE_REVPROC_5041C = '[PLACEHOLDER] Rev. Proc. 2013-14 5.04(1)(c) text';
export const MODEL_REUSE_PURPOSE = '[PLACEHOLDER] Reuse purpose sentence';

export function formatConsentDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

/** Disclosure can be stored only when its own box is checked and a name was typed. */
export function disclosureAcceptBody(acknowledged: boolean, signedName: string): { action: 'accept'; acknowledged: true; signedName: string } | null {
  const name = signedName.trim();
  if (acknowledged !== true || name.length === 0) return null;
  return { action: 'accept', acknowledged: true, signedName: name };
}

/** Decline is one action and carries no typed name. */
export function disclosureDeclineBody(): { action: 'decline' } {
  return { action: 'decline' };
}

/** Reuse stays off until its own box is checked. It never shares the disclosure body. */
export function reuseAcceptBody(acknowledged: boolean): { action: 'accept_reuse'; acknowledged: true } | null {
  if (acknowledged !== true) return null;
  return { action: 'accept_reuse', acknowledged: true };
}

export const MODEL_PURPOSES = [
  'transaction_analysis',
  'document_text',
  'document_image',
  'statement_autodetect',
  'statement_extract',
  'statement_receipt',
  'tax_assistant',
  'account_assistant',
  'voice_command',
] as const;

export type ModelPurpose = (typeof MODEL_PURPOSES)[number];

export const IMAGE_MODEL_PURPOSES = [
  'document_image',
  'statement_autodetect',
  'statement_extract',
  'statement_receipt',
] as const satisfies readonly ModelPurpose[];

export type ConsentStatus = 'granted' | 'declined' | 'withdrawn';
export type ConsentRecordType = 'disclosure' | 'reuse';
export type ConsentRefusalReason = 'missing' | 'not_granted' | 'purpose' | 'expired' | 'before_signed_at';

export const MODEL_CONSENT_DOCUMENT_VERSION = 'pending-legal-review';

export function isModelPurpose(value: unknown): value is ModelPurpose {
  return typeof value === 'string' && (MODEL_PURPOSES as readonly string[]).includes(value);
}

export function isImageModelPurpose(purpose: ModelPurpose): boolean {
  return (IMAGE_MODEL_PURPOSES as readonly string[]).includes(purpose);
}

export function modelConsentPath(uid: string, recordType: ConsentRecordType): string {
  return `user_profiles/${uid}/model_consents/${recordType}`;
}

/**
 * One UTC year after signing.
 * A grant that stores no length uses this default under 301.7216-3(b)(5).
 * The disclosure placeholder states this same length, and a new grant stores expiresAt from it.
 */
export function defaultConsentExpiry(signedAt: Date): Date {
  const expires = new Date(signedAt.getTime());
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  return expires;
}
