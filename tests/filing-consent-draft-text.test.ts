import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/admin', async () => {
  const { createFakeFirestore } = await import('./fixtures/fake-firestore');
  return { adminDb: createFakeFirestore() };
});

import { adminDb } from '@/lib/firebase/admin';
import type { FakeFirestore } from './fixtures/fake-firestore';
import {
  CURRENT_CONSENT_TEXT_VERSION,
  DRAFT_DISCLOSURE_CONSENT_TEXT,
  FILING_CONSENT_TEXT_COLLECTION,
  PARTNER_RECIPIENT_LEGAL_NAMES,
  createPartnerSendStub,
  replaceDraftDisclosureConsentText,
  resetDraftDisclosureConsentText,
  saveDisclosureConsent,
  sendFilingHandOff,
  type HandOffRequest,
  type SaveDisclosureConsentInput,
} from '@/lib/filing-consent';
import { resetFilingConsentClock, setFilingConsentClock } from '@/lib/filing-consent/clock';

const db = adminDb as unknown as FakeFirestore;
const PARTNER = PARTNER_RECIPIENT_LEGAL_NAMES[0];
const SIGNED_AT = '2026-01-15T20:00:00.000Z';
const NOW = new Date('2026-02-01T18:00:00.000Z');

const fetchSpy = vi.spyOn(globalThis, 'fetch');

function saveInput(): SaveDisclosureConsentInput {
  return {
    uid: 'user-1',
    taxYear: 2026,
    taxpayerName: 'Test Taxpayer',
    purpose: 'DRAFT: to prepare and e-file your 2026 federal return and your home state return',
    returnsCovered: [{ code: 'federal', taxYear: 2026 }],
    recipients: [PARTNER],
    scope: { kind: 'whole_return' },
    signatureMethod: 'typed_name',
    signatureValue: 'Test Taxpayer',
    userTypedNotPrefilled: true,
    kind: 'disclosure',
  };
}

function handOff(recordId: string): HandOffRequest {
  return {
    signedInUid: 'user-1',
    taxYear: 2026,
    recipientLegalName: PARTNER,
    returns: [{ code: 'federal', taxYear: 2026, fields: { wages: 100 } }],
    consentRecordId: recordId,
  };
}

beforeEach(async () => {
  resetDraftDisclosureConsentText();
  resetFilingConsentClock();
  setFilingConsentClock(() => new Date(SIGNED_AT));
  db.records.clear();
  fetchSpy.mockClear();
  await db.collection(FILING_CONSENT_TEXT_COLLECTION).doc(CURRENT_CONSENT_TEXT_VERSION).set({
    version: CURRENT_CONSENT_TEXT_VERSION,
    text: DRAFT_DISCLOSURE_CONSENT_TEXT,
  });
});

afterEach(() => {
  resetDraftDisclosureConsentText();
  resetFilingConsentClock();
  expect(fetchSpy).not.toHaveBeenCalled();
});

describe('draft disclosure consent text', () => {
  it('refuses an old consent when the draft text changes without a version bump', async () => {
    const saved = await saveDisclosureConsent(saveInput());
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error('expected a stored disclosure consent');
    expect(saved.record.consentTextVersion).toBe(CURRENT_CONSENT_TEXT_VERSION);

    replaceDraftDisclosureConsentText(CURRENT_CONSENT_TEXT_VERSION, `${DRAFT_DISCLOSURE_CONSENT_TEXT}\nAn extra line with no version bump.`);
    expect(CURRENT_CONSENT_TEXT_VERSION).toBe('draft-2026-10-23');

    const stub = createPartnerSendStub();
    setFilingConsentClock(() => NOW);
    const result = await sendFilingHandOff(handOff(saved.id), stub);
    expect(result).toMatchObject({ sent: false, code: 'consent_text_mismatch' });
    expect(stub.deliveries).toEqual([]);
  });
});
