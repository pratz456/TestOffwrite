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
export const MODEL_CONSENT_SAVE_ERROR = '[PLACEHOLDER] Consent could not be saved.';
export const MODEL_CONSENT_DATE_LINE = '[PLACEHOLDER] Signing date';
export const MODEL_CONSENT_STATUS_COPY = {
  unknown: '[PLACEHOLDER] Consent status loading',
  granted: '[PLACEHOLDER] Consent status granted',
  declined: '[PLACEHOLDER] Consent status declined',
  withdrawn: '[PLACEHOLDER] Consent status withdrawn',
} as const;

export function isValidTimeZone(value: string): boolean {
  if (!value || value.length > 120) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimeZone(zone) ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Calendar day in the signer zone. The stored instant stays the exact UTC moment. */
export function formatConsentDate(date: Date, timeZone: string): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

export function modelConsentDateLine(date: Date, timeZone: string): string {
  return `${MODEL_CONSENT_DATE_LINE} ${formatConsentDate(date, timeZone)}`;
}

/** Disclosure can be stored only when its own box is checked and a name was typed. */
export function disclosureAcceptBody(
  acknowledged: boolean,
  signedName: string,
  purpose: ModelPurpose,
  timeZone: string,
): { action: 'accept'; acknowledged: true; signedName: string; purpose: ModelPurpose; timeZone: string } | null {
  const name = signedName.trim();
  const zone = timeZone.trim();
  if (acknowledged !== true || name.length === 0 || !isModelPurpose(purpose) || !isValidTimeZone(zone)) return null;
  return { action: 'accept', acknowledged: true, signedName: name, purpose, timeZone: zone };
}

/** Decline is one action and carries no typed name. */
export function disclosureDeclineBody(): { action: 'decline' } {
  return { action: 'decline' };
}

/** Reuse stays off until its own box is checked. It never shares the disclosure body. */
export function reuseAcceptBody(acknowledged: boolean, timeZone: string): { action: 'accept_reuse'; acknowledged: true; timeZone: string } | null {
  const zone = timeZone.trim();
  if (acknowledged !== true || !isValidTimeZone(zone)) return null;
  return { action: 'accept_reuse', acknowledged: true, timeZone: zone };
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

/** The only purpose the disclosure screen names. Saving that screen stores this purpose and no others. */
export const MODEL_DISCLOSURE_SCREEN_PURPOSE: ModelPurpose = 'transaction_analysis';

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

interface CivilTime { year: number; month: number; day: number; hour: number; minute: number; second: number }

function civilTime(date: Date, timeZone: string): CivilTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour') % 24, minute: value('minute'), second: value('second') };
}

function utcFromCivilTime(time: CivilTime, timeZone: string): Date {
  const wall = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  let instant = wall;
  for (let pass = 0; pass < 3; pass += 1) {
    const shown = civilTime(new Date(instant), timeZone);
    const shownWall = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
    const next = wall - (shownWall - wall);
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant);
}

/**
 * One year after the local signing date when a zone is stored.
 * A grant that stores no length uses this default under 301.7216-3(b)(5).
 * With no zone, the default is one UTC year after the exact signing instant.
 */
export function defaultConsentExpiry(signedAt: Date, timeZone?: string | null): Date {
  if (timeZone && isValidTimeZone(timeZone)) {
    const signed = civilTime(signedAt, timeZone);
    return utcFromCivilTime({ ...signed, year: signed.year + 1 }, timeZone);
  }
  const expires = new Date(signedAt.getTime());
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  return expires;
}
