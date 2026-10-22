import { FieldValue } from 'firebase-admin/firestore';
import { encryptSensitive, isEncrypted } from '@/lib/security/utils';
import {
  dependentIdKind, dependentIdReview, isDependentIdentifierField, normalizeOrganizerIdentifier, organizerIdentifierKind,
  readOrganizerIdentifiers, storedDependentIdKinds, storedIdKindNeedsReview, type DependentIdKind, type OrganizerIdentifierRead,
} from './identifiers';

interface OrganizerDocumentRef { set(data: Record<string, unknown>, options: { merge: boolean }): Promise<unknown> }
interface OrganizerDocument { data(): Record<string, unknown>; ref?: OrganizerDocumentRef }

/**
 * Merge keeps nested keys that this patch omits. An empty review map clears them.
 * A map that still has other fields deletes only the removed ones.
 */
export function withClearedReviewFlags(previous: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = patch.idKindNeedsReview;
  if (!next || typeof next !== 'object' || Array.isArray(next)) return patch;
  const prior = previous.idKindNeedsReview;
  if (!prior || typeof prior !== 'object' || Array.isArray(prior)) return patch;
  const review: Record<string, unknown> = { ...(next as Record<string, unknown>) };
  const removed = Object.keys(prior as Record<string, unknown>).filter(field => !(field in review));
  if (removed.length === 0 || Object.keys(review).length === 0) return patch;
  for (const field of removed) review[field] = FieldValue.delete();
  return { ...patch, idKindNeedsReview: review };
}

/** Every identifier field, including ones the screen no longer asks for. Notes and other answers stay as stored. */
export function identifierFormatPatch(read: OrganizerIdentifierRead): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const idKind: Record<string, DependentIdKind> = { ...storedDependentIdKinds(read.organizer) };
  const review: Record<string, true> = { ...storedIdKindNeedsReview(read.organizer) };
  let kindChanged = false;
  let reviewChanged = false;
  for (const [field, value] of Object.entries(read.organizer)) {
    if (!isDependentIdentifierField(field) || typeof value !== 'string' || !value.trim() || isEncrypted(value)) continue;
    const kind = dependentIdKind(field, value, read.organizer);
    if (kind && idKind[field] !== kind) {
      idKind[field] = kind;
      kindChanged = true;
    }
    const mark = dependentIdReview(field, value, read.organizer);
    if (mark === 'set' && review[field] !== true) {
      review[field] = true;
      reviewChanged = true;
    } else if (mark === 'clear' && field in review) {
      delete review[field];
      reviewChanged = true;
    }
  }
  if (kindChanged) patch.idKind = idKind;
  if (reviewChanged) patch.idKindNeedsReview = review;
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
    await ref.set(withClearedReviewFlags(read.organizer, { ...patch, identifiersEncryptedAt: new Date() }), { merge: true });
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
