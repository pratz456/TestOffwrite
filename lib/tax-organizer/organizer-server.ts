import { encryptSensitive } from '@/lib/security/utils';
import {
  isRetiredOrganizerIdentifier, normalizeOrganizerIdentifier, organizerIdentifierKind,
  readOrganizerIdentifiers, type OrganizerIdentifierRead,
} from './identifiers';

interface OrganizerDocumentRef { set(data: Record<string, unknown>, options: { merge: boolean }): Promise<unknown> }
interface OrganizerDocument { data(): Record<string, unknown>; ref?: OrganizerDocumentRef }

/** Identifier fields still collected, rewritten into the current format. Retired fields, notes and other answers stay as stored. */
export function identifierFormatPatch(read: OrganizerIdentifierRead): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const field of read.legacyPlaintextFields) {
    if (isRetiredOrganizerIdentifier(field)) continue;
    const kind = organizerIdentifierKind(field);
    const value = read.organizer[field];
    if (!kind || typeof value !== 'string' || !value) continue;
    const normalized = normalizeOrganizerIdentifier(kind, value);
    if ('error' in normalized) continue;
    patch[field] = encryptSensitive(normalized.digits);
  }
  return patch;
}

/**
 * Stores identifier fields in the current format when read.
 * The read still returns when the write fails, and values are never logged.
 */
export async function migrateLegacyOrganizerIdentifiers(ref: OrganizerDocumentRef | undefined, read: OrganizerIdentifierRead): Promise<boolean> {
  const patch = identifierFormatPatch(read);
  if (!ref || Object.keys(patch).length === 0) return false;
  try {
    await ref.set({ ...patch, identifiersEncryptedAt: new Date() }, { merge: true });
    return true;
  } catch {
    return false;
  }
}

/** Organizer values for a server route. */
export async function readOrganizerDocument(doc: OrganizerDocument): Promise<Record<string, unknown>> {
  const read = readOrganizerIdentifiers(doc.data());
  await migrateLegacyOrganizerIdentifiers(doc.ref, read);
  return read.organizer;
}
