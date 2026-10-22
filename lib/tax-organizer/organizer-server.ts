import { encryptSensitive, isEncrypted } from '@/lib/security/utils';
import {
  dependentIdKind, isDependentIdentifierField, normalizeOrganizerIdentifier, organizerIdentifierKind,
  readOrganizerIdentifiers, storedDependentIdKinds, type DependentIdKind, type OrganizerIdentifierRead,
} from './identifiers';

interface OrganizerDocumentRef { set(data: Record<string, unknown>, options: { merge: boolean }): Promise<unknown> }
interface OrganizerDocument { data(): Record<string, unknown>; ref?: OrganizerDocumentRef }

/** Every identifier field, including ones the screen no longer asks for. Notes and other answers stay as stored. */
export function identifierFormatPatch(read: OrganizerIdentifierRead): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const idKind: Record<string, DependentIdKind> = { ...storedDependentIdKinds(read.organizer) };
  let kindChanged = false;
  for (const [field, value] of Object.entries(read.organizer)) {
    if (!isDependentIdentifierField(field) || typeof value !== 'string' || !value.trim() || isEncrypted(value)) continue;
    const kind = dependentIdKind(field, value, read.organizer);
    if (!kind || idKind[field] === kind) continue;
    idKind[field] = kind;
    kindChanged = true;
  }
  if (kindChanged) patch.idKind = idKind;
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
