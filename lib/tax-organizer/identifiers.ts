/**
 * Tax organizer identifier handling (server only).
 *
 * Every identifier answer is stored as AES-256-GCM ciphertext (`SSN_ENCRYPTION_KEY`)
 * and decrypted only inside server routes. Legacy plaintext values are read as-is
 * and reported so the caller can re-encrypt them on that read; free-text dependent
 * details have SSN/ITIN-shaped digits removed before storage. PDFs and archives
 * print masked values only.
 */
import { decryptSensitive, encryptSensitive, isEncrypted, maskSSN, sanitizeString } from '@/lib/security/utils';
import { redactIdentifierText } from '@/lib/security/identifier-redaction';

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
      continue;
    }
    if ((ORGANIZER_REDACTED_TEXT_FIELDS as readonly string[]).includes(field)) {
      const redaction = redactIdentifierText(value);
      if (redaction.count > 0) { organizer[field] = redaction.text; redactedTextFields.push(field); }
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
 * Encrypts every identifier answer and redacts identifier digits from free text.
 * Ciphertext that matches the stored value is kept (a tab opened before an update
 * may still hold it); every other identifier is validated and re-encrypted.
 */
export function encryptOrganizerIdentifiers(
  answers: Record<string, string>, previous: Record<string, unknown>,
): OrganizerIdentifierWrite | { error: string } {
  const encrypted: Record<string, string> = { ...answers };
  const redactedTextFields: string[] = [];
  for (const [field, value] of Object.entries(answers)) {
    if (!value) continue;
    const kind = organizerIdentifierKind(field);
    if (kind) {
      if (isEncrypted(value) && value === previous[field]) continue;
      const normalized = normalizeOrganizerIdentifier(kind, value);
      if ('error' in normalized) return normalized;
      encrypted[field] = encryptSensitive(normalized.digits);
      continue;
    }
    if ((ORGANIZER_REDACTED_TEXT_FIELDS as readonly string[]).includes(field)) {
      const redaction = redactIdentifierText(value);
      if (redaction.count > 0) redactedTextFields.push(field);
      encrypted[field] = sanitizeString(redaction.text, 2000);
    }
  }
  return { answers: encrypted, redactedTextFields };
}

export const IDENTIFIER_PROVIDED_SEPARATELY = 'Provided to preparer separately';
export const DEPENDENT_IDENTIFIERS_REMOVED_WARNING = 'Social Security or taxpayer identification numbers were removed from the dependent details before saving. Give dependent SSNs to your tax preparer directly; WriteOff does not store them.';

/** Display form for PDFs and archives: last digits only; an IP PIN is never printed. */
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
