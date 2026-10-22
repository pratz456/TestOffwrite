import { readOrganizerIdentifiers, type OrganizerIdentifierRead } from './identifiers';

interface OrganizerDocumentRef { set(data: Record<string, unknown>, options: { merge: boolean }): Promise<unknown> }
interface OrganizerDocument { data(): Record<string, unknown>; ref?: OrganizerDocumentRef }

/**
 * Write-on-read is paused pending a records count and the owner's decision.
 * Do not rewrite stored records on read.
 */
export async function migrateLegacyOrganizerIdentifiers(ref: OrganizerDocumentRef | undefined, read: OrganizerIdentifierRead): Promise<boolean> {
  void ref;
  void read;
  return false;
}

/** Decrypted organizer for a server route. This read does not write. */
export async function readOrganizerDocument(doc: OrganizerDocument): Promise<Record<string, unknown>> {
  const read = readOrganizerIdentifiers(doc.data());
  await migrateLegacyOrganizerIdentifiers(doc.ref, read);
  return read.organizer;
}
