import { createHash } from 'node:crypto';
import { CURRENT_CONSENT_TEXT_VERSION, DRAFT_DISCLOSURE_CONSENT_TEXT } from './config';

/**
 * SHA-256 of the exact consent text shown at signing.
 * The active text for a version starts as the DRAFT constant. Replacing that
 * text without changing the version string makes older signatures mismatch.
 */
const textByVersion = new Map<string, string>([
  [CURRENT_CONSENT_TEXT_VERSION, DRAFT_DISCLOSURE_CONSENT_TEXT],
]);

export function consentTextSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Current draft text for a consent version, or null when that version is unknown. */
export function draftDisclosureConsentText(version: string): string | null {
  const text = textByVersion.get(version);
  return text === undefined ? null : text;
}

/** Edit the draft body in place. The version string stays the same. */
export function replaceDraftDisclosureConsentText(version: string, text: string): void {
  textByVersion.set(version, text);
}

export function resetDraftDisclosureConsentText(): void {
  textByVersion.clear();
  textByVersion.set(CURRENT_CONSENT_TEXT_VERSION, DRAFT_DISCLOSURE_CONSENT_TEXT);
}
