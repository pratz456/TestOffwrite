/**
 * Tax organizer identifier handling (server only).
 *
 * Every identifier answer is stored as AES-256-GCM ciphertext (`SSN_ENCRYPTION_KEY`)
 * and decrypted only inside server routes. Older identifier values are read as-is
 * until a read or the next save stores collected fields in the current format.
 * A separated 3-2-4 number whose digits are
 * not already in that free-text field is rejected on save, and the message names
 * the field. A standalone 9-digit run is kept. Masking happens only on the owner response.
 */
import { decryptSensitive, encryptSensitive, isEncrypted, maskSSN } from '@/lib/security/utils';

export type OrganizerIdentifierKind = 'ssn' | 'bankAccount' | 'bankRouting' | 'ipPin' | 'ein';

/** Organizer answers that hold a taxpayer, spouse, dependent or refund-account identifier. */
export const ORGANIZER_IDENTIFIER_FIELDS: Readonly<Record<string, OrganizerIdentifierKind>> = {
  taxpayerSSN: 'ssn', spouseSSN: 'ssn', bankAccount: 'bankAccount', bankRouting: 'bankRouting', ipPin: 'ipPin', ein: 'ein',
};

const IDENTIFIER_RULES: Record<OrganizerIdentifierKind, { pattern: RegExp; label: string }> = {
  ssn: { pattern: /^\d{9}$/, label: 'Social Security number' },
  bankAccount: { pattern: /^\d{4,17}$/, label: 'bank account number' },
  bankRouting: { pattern: /^\d{9}$/, label: 'bank routing number' },
  ipPin: { pattern: /^\d{6}$/, label: 'IRS Identity Protection PIN' },
  ein: { pattern: /^\d{9}$/, label: 'employer identification number' },
};

export type DependentIdKind = 'ssn' | 'itin' | 'atin' | 'none';

const DEPENDENT_KIND_SUFFIX = /^(?:dependent\d*)?(SSN|ITIN|ATIN)$/i;
const UNNAMED_DEPENDENT_NUMBER = /^dependent\d*(?:Number|Identifier)$/;

/**
 * Named identifier answers plus explicit dependent identifier answers (dependentSSN,
 * dependent2ITIN, dependentATIN, ...). Yes/no eligibility answers such as taxpayerSeniorSSN or
 * workEligibleSSN are not identifiers, so no broader suffix match is used.
 */
export function isDependentIdentifierField(field: string): boolean {
  return DEPENDENT_KIND_SUFFIX.test(field) || UNNAMED_DEPENDENT_NUMBER.test(field);
}

export function organizerIdentifierKind(field: string): OrganizerIdentifierKind | null {
  if (field in ORGANIZER_IDENTIFIER_FIELDS) return ORGANIZER_IDENTIFIER_FIELDS[field];
  if (isDependentIdentifierField(field)) return 'ssn';
  return null;
}

function explicitDependentKind(value: unknown): DependentIdKind | null {
  if (typeof value !== 'string') return null;
  const kind = value.trim().toLowerCase();
  if (kind === 'ssn' || kind === 'itin' || kind === 'atin' || kind === 'none') return kind;
  return null;
}

/** Kind chosen on the form, keyed by field when more than one number is stored. */
export function storedDependentIdKinds(data: Record<string, unknown>): Record<string, DependentIdKind> {
  const idKind = data.idKind;
  if (!idKind || typeof idKind !== 'object' || Array.isArray(idKind)) return {};
  const kinds: Record<string, DependentIdKind> = {};
  for (const [field, value] of Object.entries(idKind as Record<string, unknown>)) {
    const kind = explicitDependentKind(value);
    if (kind && isDependentIdentifierField(field)) kinds[field] = kind;
  }
  return kinds;
}

/** A choice sent with this save. A stored label is not a new choice. */
function freshDependentKind(field: string, data: Record<string, unknown>): DependentIdKind | null {
  const stem = field.replace(/(?:SSN|ITIN|ATIN|Number|Identifier)$/i, '');
  const sibling = explicitDependentKind(data[`${stem}IdKind`]) ?? explicitDependentKind(data[`${field}IdKind`]);
  if (sibling) return sibling;
  return typeof data.idKind === 'string' ? explicitDependentKind(data.idKind) : null;
}

/** Review flags keyed by field. Only a boolean true is kept, so the map never holds digits. */
export function storedIdKindNeedsReview(data: Record<string, unknown>): Record<string, true> {
  const raw = data.idKindNeedsReview;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const flags: Record<string, true> = {};
  for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === true && isDependentIdentifierField(field)) flags[field] = true;
  }
  return flags;
}

function dependentKindFromFieldName(field: string): DependentIdKind | null {
  const match = DEPENDENT_KIND_SUFFIX.exec(field);
  return match ? match[1].toLowerCase() as DependentIdKind : null;
}

/** A leading 9 uses the 4th and 5th digits: 93 is atin, and the itin ranges are itin. Anything else is ssn. */
export function dependentKindFromDigits(value: string): DependentIdKind {
  const digits = value.replace(/\D/g, '');
  if (digits.length >= 5 && digits[0] === '9') {
    const group = Number(digits.slice(3, 5));
    if (group === 93) return 'atin';
    if ((group >= 50 && group <= 65) || (group >= 70 && group <= 88) || (group >= 90 && group <= 92) || (group >= 94 && group <= 99)) return 'itin';
  }
  return 'ssn';
}

/** Choice, stored label, field name, then the digit pattern. A leading 9 can still come back as ssn from this step. */
function dependentIdKindUnguarded(field: string, value: string, data: Record<string, unknown>): DependentIdKind | null {
  if (!isDependentIdentifierField(field)) return null;
  const digits = value.replace(/\D/g, '');
  const leadingNine = digits[0] === '9';
  const fresh = freshDependentKind(field, data);
  if (fresh === 'ssn' && leadingNine) {
    const fromDigits = dependentKindFromDigits(value);
    return fromDigits === 'ssn' ? 'none' : fromDigits;
  }
  if (fresh) return fresh;
  const stored = storedDependentIdKinds(data)[field];
  if (stored) return stored;
  const named = dependentKindFromFieldName(field);
  if (named === 'itin' || named === 'atin') return named;
  if (named === 'ssn' && leadingNine) return dependentKindFromDigits(value);
  return named ?? dependentKindFromDigits(value);
}

function reclassifiedLeadingNine(value: string, kind: DependentIdKind | null): DependentIdKind | null {
  if (kind !== 'ssn' || value.replace(/\D/g, '')[0] !== '9') return kind;
  const fromDigits = dependentKindFromDigits(value);
  return fromDigits === 'ssn' ? 'none' : fromDigits;
}

/**
 * A fresh ssn choice on a leading 9 follows the digit pattern and is stored as itin, atin, or none.
 * Otherwise an entered choice, then a stored label, then the field name, then the digit pattern.
 * A leading 9 is never stored as ssn: the digit pattern wins, or the label is none.
 * The kind is a label only, and no digits are ever copied into it.
 */
export function dependentIdKind(field: string, value: string, data: Record<string, unknown>): DependentIdKind | null {
  return reclassifiedLeadingNine(value, dependentIdKindUnguarded(field, value, data));
}

/** Set when a leading 9 would have been labeled ssn. A fresh itin or atin choice clears it. */
export function dependentIdReview(field: string, value: string, data: Record<string, unknown>): 'set' | 'clear' | null {
  if (!isDependentIdentifierField(field)) return null;
  const fresh = freshDependentKind(field, data);
  if (fresh === 'itin' || fresh === 'atin') return 'clear';
  const digits = value.replace(/\D/g, '');
  if (fresh === 'ssn' && digits[0] === '9') return 'set';
  if (dependentIdKindUnguarded(field, value, data) === 'ssn' && digits[0] === '9') return 'set';
  return null;
}

export function dependentKindHints(answers: Record<string, unknown>): Record<string, unknown> {
  const hints: Record<string, unknown> = {};
  if ('idKind' in answers) hints.idKind = answers.idKind;
  for (const [field, value] of Object.entries(answers)) {
    if (field !== 'idKind' && /IdKind$/.test(field)) hints[field] = value;
  }
  return hints;
}

export function withoutDependentKindHints<T>(answers: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(answers).filter(([field]) => field !== 'idKind' && field !== 'idKindNeedsReview' && !/IdKind$/.test(field)));
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
  /** Identifier values for server routes only. Older values are included as stored. */
  organizer: Record<string, unknown>;
  /** Identifier answers still stored in an older format. */
  legacyPlaintextFields: string[];
}

/** Decrypts identifier answers for a server route. Older values are passed through and reported. */
export function readOrganizerIdentifiers(data: Record<string, unknown>): OrganizerIdentifierRead {
  const organizer: Record<string, unknown> = { ...data };
  const legacyPlaintextFields: string[] = [];
  for (const [field, value] of Object.entries(data)) {
    if (typeof value !== 'string' || !value) continue;
    if (organizerIdentifierKind(field)) {
      if (isEncrypted(value)) organizer[field] = decryptSensitive(value);
      else legacyPlaintextFields.push(field);
    }
  }
  return { organizer, legacyPlaintextFields };
}

export interface OrganizerIdentifierWrite {
  answers: Record<string, string>;
}

/**
 * Encrypts identifier answers. Free text is copied through.
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
  return { answers: encrypted };
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

/** Separated 3-2-4 groups only, with the same boundaries as `ssnShapedExpression`. Bare 9-digit runs are excluded. */
export function separatedSsnExpression(): RegExp {
  return /(?<!\w)\d{3}[- ]\d{2}[- ]\d{4}(?!\w)/g;
}

const MASKED_FREE_TEXT_TOKEN = /\*\*\*-\*\*-(\d{4})/g;
export const MASKED_NUMBER_EDIT_ERROR = "Please don't edit the hidden number in this field";
export const SSN_NOT_ACCEPTED_ERROR = "Please don't enter Social Security numbers here. We don't need them.";

/** Short names for free-text answers. Any other field uses the generic note label. */
const ORGANIZER_FIELD_LABELS: Readonly<Record<string, string>> = {
  dependentDetails: 'Dependent details',
  spouseName: 'Spouse name',
  streetAddress: 'Street address',
  city: 'City',
  stateAddr: 'State',
  zipCode: 'ZIP',
};

export function organizerFieldLabel(field: string): string {
  return ORGANIZER_FIELD_LABELS[field] ?? 'This note';
}

const numberDigits = (value: string) => value.replace(/\D/g, '');

/**
 * Puts each masked token back to the stored text at that position.
 * The same digits in different punctuation count as one number, so each token
 * keeps the original characters at its own position. An extra copy of that
 * token repeats the stored number. Two different digit strings that share a
 * last 4 are rejected. Moving a different number to an earlier spot is rejected.
 */
export function restoreMaskedFreeText(incoming: string, stored: string): { text: string } | { error: string } {
  const tokens = [...incoming.matchAll(new RegExp(MASKED_FREE_TEXT_TOKEN.source, 'g'))];
  if (tokens.length === 0) return { text: incoming };
  const storedMatches = [...stored.matchAll(ssnShapedExpression())];
  const digitsByLast4 = new Map<string, Set<string>>();
  const storedCountByLast4 = new Map<string, number>();
  for (const match of storedMatches) {
    const digits = numberDigits(match[0]);
    const last4 = digits.slice(-4);
    const seen = digitsByLast4.get(last4) ?? new Set<string>();
    seen.add(digits);
    digitsByLast4.set(last4, seen);
    storedCountByLast4.set(last4, (storedCountByLast4.get(last4) ?? 0) + 1);
  }
  const tokenCountByLast4 = new Map<string, number>();
  for (const token of tokens) {
    tokenCountByLast4.set(token[1], (tokenCountByLast4.get(token[1]) ?? 0) + 1);
    const seen = digitsByLast4.get(token[1]);
    if (!seen || seen.size !== 1) return { error: MASKED_NUMBER_EDIT_ERROR };
  }
  let cursor = 0;
  const usedByLast4 = new Map<string, number>();
  let missing = false;
  const text = incoming.replace(new RegExp(MASKED_FREE_TEXT_TOKEN.source, 'g'), (_match, last4: string) => {
    while (cursor < storedMatches.length && numberDigits(storedMatches[cursor][0]).slice(-4) !== last4) cursor += 1;
    if (cursor < storedMatches.length) {
      usedByLast4.set(last4, (usedByLast4.get(last4) ?? 0) + 1);
      return storedMatches[cursor++][0];
    }
    // A copied token repeats the one stored number. Moving a different number earlier still fails below.
    const storedCount = storedCountByLast4.get(last4) ?? 0;
    const tokenCount = tokenCountByLast4.get(last4) ?? 0;
    const used = usedByLast4.get(last4) ?? 0;
    if (tokenCount > storedCount && used >= storedCount) {
      const original = storedMatches.find(match => numberDigits(match[0]).slice(-4) === last4);
      if (original) return original[0];
    }
    missing = true;
    return _match;
  });
  return missing ? { error: MASKED_NUMBER_EDIT_ERROR } : { text };
}

/** A separated 3-2-4 number is new when its digits are not already in an SSN-shaped value in the stored field. */
export function newSeparatedNumberError(field: string, text: string, stored: string): { error: string } | null {
  const storedDigits = new Set([...stored.matchAll(ssnShapedExpression())].map(match => numberDigits(match[0])));
  for (const match of text.matchAll(separatedSsnExpression())) {
    if (!storedDigits.has(numberDigits(match[0]))) return { error: `${organizerFieldLabel(field)}: ${SSN_NOT_ACCEPTED_ERROR}` };
  }
  return null;
}

export function restoreOrganizerFreeText(
  answers: Record<string, string>, previous: Record<string, unknown>,
): { answers: Record<string, string> } | { error: string } {
  const next: Record<string, string> = {};
  for (const [field, value] of Object.entries(answers)) {
    if (organizerIdentifierKind(field)) { next[field] = value; continue; }
    const stored = typeof previous[field] === 'string' ? previous[field] : '';
    const restored = restoreMaskedFreeText(value, stored);
    if ('error' in restored) return restored;
    const rejected = newSeparatedNumberError(field, restored.text, stored);
    if (rejected) return rejected;
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
    if (field === 'idKind' || field === 'idKindNeedsReview') continue;
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
