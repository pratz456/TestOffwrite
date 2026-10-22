import { encryptSensitive, isEncrypted } from '@/lib/security/utils';
import {
  normalizeOrganizerIdentifier, organizerIdentifierKind,
  readOrganizerIdentifiers, type OrganizerIdentifierRead,
} from './identifiers';

interface OrganizerDocumentRef { set(data: Record<string, unknown>, options: { merge: boolean }): Promise<unknown> }
interface OrganizerDocument { data(): Record<string, unknown>; ref?: OrganizerDocumentRef }

/** Every identifier field, including ones the screen no longer asks for. Notes and other answers stay as stored. */
export function identifierFormatPatch(read: OrganizerIdentifierRead): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const field of read.legacyPlaintextFields) {
    const kind = organizerIdentifierKind(field);
    const value = read.organizer[field];
    if (!kind || typeof value !== 'string') continue;
    const trimmed = value.trim();
    // The current-format envelope decides. A shape mismatch still stores the trimmed value.
    if (!trimmed || isEncrypted(trimmed)) continue;
    const normalized = normalizeOrganizerIdentifier(kind, trimmed);
    patch[field] = encryptSensitive('error' in normalized ? trimmed : normalized.digits);
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
