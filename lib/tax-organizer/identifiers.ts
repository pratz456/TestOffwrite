/**
 * Tax organizer identifier handling (server only).
 *
 * Every identifier answer is stored as AES-256-GCM ciphertext (`SSN_ENCRYPTION_KEY`)
 * and decrypted only inside server routes. Legacy plaintext values are read as-is.
 * Reads do not rewrite them. Free text is stored as typed and masked only on the
 * owner response.
 */
import { decryptSensitive, encryptSensitive, isEncrypted, maskSSN } from '@/lib/security/utils';

export type OrganizerIdentifierKind = 'ssn' | 'bankAccount' | 'bankRouting' | 'ipPin' | 'ein';

/** Organizer answers that hold a taxpayer, spouse, dependent or refund-account identifier. */
export const ORGANIZER_IDENTIFIER_FIELDS: Readonly<Record<string, OrganizerIdentifierKind>> = {
  taxpayerSSN: 'ssn', spouseSSN: 'ssn', bankAccount: 'bankAccount', bankRouting: 'bankRouting', ipPin: 'ipPin', ein: 'ein',
};

/** Free-text organizer answers that must never carry identifier digits. */
export const ORGANIZER_REDACTED_TEXT_FIELDS = ['dependentDetails'] as const;

const IDENTIFIER_RULES: Record<OrganizerIdentifierKind, { pattern: RegExp; label: string }> = {
  ssn: { pattern: /^\d{9}$/, label: 'Social Security number' },
  bankAccount: { pattern: /^\d{4,17}$/, label: 'bank account number' },
  bankRouting: { pattern: /^\d{9}$/, label: 'bank routing number' },
  ipPin: { pattern: /^\d{6}$/, label: 'IRS Identity Protection PIN' },
  ein: { pattern: /^\d{9}$/, label: 'employer identification number' },
};

/**
 * Named identifier answers plus explicit dependent identifier answers (dependentSSN,
 * dependent2ITIN, ...). Yes/no eligibility answers such as taxpayerSeniorSSN or
 * workEligibleSSN are not identifiers, so no broader suffix match is used.
 */
export function organizerIdentifierKind(field: string): OrganizerIdentifierKind | null {
  if (field in ORGANIZER_IDENTIFIER_FIELDS) return ORGANIZER_IDENTIFIER_FIELDS[field];
  if (/^dependent\d*(SSN|ITIN)$/.test(field)) return 'ssn';
  return null;
}

/** Taxpayer, spouse, dependent, PIN and bank answers are no longer accepted. EIN stays. */
export function isRetiredOrganizerIdentifier(field: string): boolean {
  const kind = organizerIdentifierKind(field);
  return kind !== null && kind !== 'ein';
}

export function withoutRetiredOrganizerIdentifiers(answers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(answers).filter(([field]) => !isRetiredOrganizerIdentifier(field)));
}

export function isOrganizerIdentifierField(field: string): boolean {
  return organizerIdentifierKind(field) !== null;
}

/** Normalizes a typed identifier (dashes and spaces removed) and validates its shape. */
export function normalizeOrganizerIdentifier(kind: OrganizerIdentifierKind, value: string): { digits: string } | { error: string } {
  const digits = value.replace(/[-\s]/g, '');
  return IDENTIFIER_RULES[kind].pattern.test(digits) ? { digits } : { error: `Invalid ${IDENTIFIER_RULES[kind].label}` };
}

export interface OrganizerIdentifierRead {
  /** Decrypted (or legacy plaintext) identifier values merged over the record; server use only. */
  organizer: Record<string, unknown>;
  /** Identifier answers found unencrypted; the caller re-encrypts them on this read. */
  legacyPlaintextFields: string[];
  /** Free-text answers that still contained identifier digits; the caller stores the redacted text. */
  redactedTextFields: string[];
}

/** Decrypts identifier answers for a server route; legacy plaintext is passed through and reported. */
export function readOrganizerIdentifiers(data: Record<string, unknown>): OrganizerIdentifierRead {
  const organizer: Record<string, unknown> = { ...data };
  const legacyPlaintextFields: string[] = [];
  const redactedTextFields: string[] = [];
  for (const [field, value] of Object.entries(data)) {
    if (typeof value !== 'string' || !value) continue;
    if (organizerIdentifierKind(field)) {
      if (isEncrypted(value)) organizer[field] = decryptSensitive(value);
      else legacyPlaintextFields.push(field);
    }
  }
  return { organizer, legacyPlaintextFields, redactedTextFields };
}

/** Firestore patch that encrypts legacy plaintext identifiers and stores redacted text (write-on-read migration). */
export function legacyIdentifierPatch(read: OrganizerIdentifierRead): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const field of read.legacyPlaintextFields) {
    const value = read.organizer[field];
    if (typeof value === 'string' && value) patch[field] = encryptSensitive(value);
  }
  for (const field of read.redactedTextFields) {
    const value = read.organizer[field];
    if (typeof value === 'string') patch[field] = value;
  }
  return patch;
}

export interface OrganizerIdentifierWrite {
  answers: Record<string, string>;
  /** Free-text answers whose identifier digits were removed before saving. */
  redactedTextFields: string[];
}

/**
 * Encrypts identifier answers. Free text is copied through unchanged.
 * Ciphertext that matches the stored value is kept (a tab opened before an update
 * may still hold it); every other identifier is validated and re-encrypted.
 */
export function encryptOrganizerIdentifiers(
  answers: Record<string, string>, previous: Record<string, unknown>,
): OrganizerIdentifierWrite | { error: string } {
  const encrypted: Record<string, string> = { ...answers };
  for (const [field, value] of Object.entries(answers)) {
    if (!value) continue;
    const kind = organizerIdentifierKind(field);
    if (!kind) continue;
    let plain = typeof previous[field] === 'string' ? previous[field] : '';
    if (plain && isEncrypted(plain)) {
      try { plain = decryptSensitive(plain); } catch { plain = ''; }
    }
    // A masked read or the same number must not replace the stored value.
    if (plain && echoesStoredIdentifier(kind, value, plain)) { delete encrypted[field]; continue; }
    if (isEncrypted(value) && value === previous[field]) continue;
    const normalized = normalizeOrganizerIdentifier(kind, value);
    if ('error' in normalized) return normalized;
    encrypted[field] = encryptSensitive(normalized.digits);
  }
  return { answers: encrypted, redactedTextFields: [] };
}

/**
 * Read path only. A standalone 9-digit number, such as an order number, is masked
 * on read. The stored characters stay intact, and saving that masked read puts
 * the original digits back. A phone, a ZIP+4 and a longer digit run are not masked.
 */
export function organizerTextForClient(field: string, value: string): string {
  const kind = organizerIdentifierKind(field);
  if (kind) return maskOrganizerIdentifier(kind, value);
  return maskSsnShapedFreeText(value);
}

/** 3-2-4 groups with a dash or space, or a standalone 9-digit run, bounded on both sides. */
export function ssnShapedExpression(): RegExp {
  return /(?<!\w)(?:\d{3}[- ]\d{2}[- ]\d{4}|\d{9})(?!\w)/g;
}

const MASKED_FREE_TEXT_TOKEN = /\*\*\*-\*\*-(\d{4})/g;
export const MASKED_NUMBER_EDIT_ERROR = "Please don't edit the hidden number in this field";

/** Puts stored originals back into masked free-text tokens. Text with no tokens is returned as typed. */
export function restoreMaskedFreeText(incoming: string, stored: string): { text: string } | { error: string } {
  const tokens = [...incoming.matchAll(MASKED_FREE_TEXT_TOKEN)];
  if (tokens.length === 0) return { text: incoming };
  const storedValues = [...stored.matchAll(ssnShapedExpression())].map(match => match[0]);
  if (tokens.length > storedValues.length) return { error: MASKED_NUMBER_EDIT_ERROR };
  const byLast4 = new Map<string, string[]>();
  for (const value of storedValues) {
    const last4 = value.replace(/\D/g, '').slice(-4);
    byLast4.set(last4, [...(byLast4.get(last4) ?? []), value]);
  }
  for (const token of tokens) {
    if ((byLast4.get(token[1]) ?? []).length !== 1) return { error: MASKED_NUMBER_EDIT_ERROR };
  }
  return { text: incoming.replace(MASKED_FREE_TEXT_TOKEN, (_match, last4: string) => byLast4.get(last4)![0]) };
}

export function restoreOrganizerFreeText(
  answers: Record<string, string>, previous: Record<string, unknown>,
): { answers: Record<string, string> } | { error: string } {
  const next: Record<string, string> = {};
  for (const [field, value] of Object.entries(answers)) {
    if (organizerIdentifierKind(field)) { next[field] = value; continue; }
    const restored = restoreMaskedFreeText(value, typeof previous[field] === 'string' ? previous[field] : '');
    if ('error' in restored) return restored;
    next[field] = restored.text;
  }
  return { answers: next };
}

/**
 * Drops an answer the client sent back unchanged from a masked read, including
 * free text whose masked tokens were just restored to the stored original.
 * A merge that omits the field leaves the stored text byte-for-byte.
 */
export function withoutUneditedMaskedText(answers: Record<string, string>, previous: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(answers).filter(([field, value]) => {
    const stored = previous[field];
    if (typeof stored !== 'string' || !stored) return true;
    let plain = stored;
    if (organizerIdentifierKind(field) && isEncrypted(stored)) {
      try { plain = decryptSensitive(stored); } catch { return true; }
    }
    if (value === plain) return false;
    const kind = organizerIdentifierKind(field);
    return !(kind && echoesStoredIdentifier(kind, value, plain));
  }));
}

export const IDENTIFIER_PROVIDED_SEPARATELY = 'Provided to preparer separately';
export const DEPENDENT_IDENTIFIERS_REMOVED_WARNING = 'Social Security or taxpayer identification numbers were removed from the dependent details before saving. Give dependent SSNs to your tax preparer directly; WriteOff does not store them.';

/** True when a save is echoing a masked read, the last four digits, or the same full number. */
export function echoesStoredIdentifier(kind: OrganizerIdentifierKind, incoming: string, storedPlain: string): boolean {
  const storedDigits = storedPlain.replace(/\D/g, '');
  if (!storedDigits) return false;
  if (incoming === maskOrganizerIdentifier(kind, storedPlain)) return true;
  const incomingDigits = incoming.replace(/\D/g, '');
  if (incomingDigits.length === 4 && incomingDigits === storedDigits.slice(-4)) return true;
  const normalized = normalizeOrganizerIdentifier(kind, incoming);
  return !('error' in normalized) && normalized.digits === storedDigits;
}

/** Display form for a read response: last digits only; an IP PIN is never printed. */
export function maskOrganizerIdentifier(kind: OrganizerIdentifierKind, value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  switch (kind) {
    case 'ssn': return maskSSN(digits);
    case 'ipPin': return IDENTIFIER_PROVIDED_SEPARATELY;
    case 'ein': return `**-***${digits.slice(-4).padStart(4, '*')}`;
    case 'bankRouting': return `*****${digits.slice(-4).padStart(4, '*')}`;
    case 'bankAccount': return `****${digits.slice(-4).padStart(4, '*')}`;
  }
}

/** Masks separated 3-2-4 groups and standalone 9-digit runs. Save does not call this. */
export function maskSsnShapedFreeText(value: string): string {
  return value.replace(ssnShapedExpression(), (match) => `***-**-${match.replace(/\D/g, '').slice(-4)}`);
}

/** Owner response: identifier answers are masked, and free text cannot echo a 3-2-4 digit group. */
export function toOrganizerClientView(organizer: Record<string, unknown>): Record<string, unknown> {
  const view: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(organizer)) {
    if (typeof value === 'string') {
      if (organizerIdentifierKind(field)) {
        if (!value) continue;
        const masked = organizerTextForClient(field, value);
        if (masked) view[field] = masked;
        continue;
      }
      view[field] = organizerTextForClient(field, value);
      continue;
    }
    view[field] = value;
  }
  return view;
}
