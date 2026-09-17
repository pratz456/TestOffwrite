import { legacyIdentifierPatch, readOrganizerIdentifiers, type OrganizerIdentifierRead } from './identifiers';

interface OrganizerDocumentRef { set(data: Record<string, unknown>, options: { merge: boolean }): Promise<unknown> }
interface OrganizerDocument { data(): Record<string, unknown>; ref?: OrganizerDocumentRef }

/**
 * Write-on-read migration: legacy plaintext identifiers found while reading an
 * organizer are stored encrypted (and free text redacted) before the response is
 * built. The read itself never depends on this write succeeding.
 */
export async function migrateLegacyOrganizerIdentifiers(ref: OrganizerDocumentRef | undefined, read: OrganizerIdentifierRead): Promise<boolean> {
  if (!ref || (!read.legacyPlaintextFields.length && !read.redactedTextFields.length)) return false;
  try {
    await ref.set({ ...legacyIdentifierPatch(read), identifiersEncryptedAt: new Date() }, { merge: true });
    return true;
  } catch {
    // Identifier values are never logged; the next owner read retries the migration.
    return false;
  }
}

/** Decrypted organizer for a server route (PDF, export), migrating legacy plaintext as it is read. */
export async function readOrganizerDocument(doc: OrganizerDocument): Promise<Record<string, unknown>> {
  const read = readOrganizerIdentifiers(doc.data());
  await migrateLegacyOrganizerIdentifiers(doc.ref, read);
  return read.organizer;
}
