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
} from '@/lib/filing-consent';
import {
  resetFilingConsentClock,
  saveDisclosureConsent,
  setFilingConsentClock,
  type SaveDisclosureConsentInput,
} from '@/lib/filing-consent/store';

const db = adminDb as unknown as FakeFirestore;
const PARTNER = PARTNER_RECIPIENT_LEGAL_NAMES[0];

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

beforeEach(async () => {
  resetFilingConsentClock();
  db.records.clear();
  fetchSpy.mockClear();
  await db.collection(FILING_CONSENT_TEXT_COLLECTION).doc(CURRENT_CONSENT_TEXT_VERSION).set({
    version: CURRENT_CONSENT_TEXT_VERSION,
    text: DRAFT_DISCLOSURE_CONSENT_TEXT,
  });
});

afterEach(() => {
  resetFilingConsentClock();
  expect(fetchSpy).not.toHaveBeenCalled();
});

describe('filing consent clock seam', () => {
  it('stores the signing time from the store clock seam', async () => {
    setFilingConsentClock(() => new Date('2026-06-01T15:00:00.000Z'));
    const saved = await saveDisclosureConsent(saveInput());
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error('expected a stored disclosure consent');
    expect(saved.record.signedAt).toBe('2026-06-01T15:00:00.000Z');
    expect(saved.record.expiresAt).toBe('2027-06-01T15:00:00.000Z');
  });
});
