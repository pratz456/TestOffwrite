import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/admin', async () => {
  const { createFakeFirestore } = await import('./fixtures/fake-firestore');
  return { adminDb: createFakeFirestore() };
});

import { adminDb } from '@/lib/firebase/admin';
import type { FakeFirestore } from './fixtures/fake-firestore';
import {
  ACCEPTED_SIGNATURE_METHODS,
  CURRENT_CONSENT_TEXT_VERSION,
  DISCLOSING_PREPARER_LEGAL_NAME,
  DRAFT_DISCLOSURE_CONSENT_TEXT,
  FILING_CONSENT_TEXT_COLLECTION,
  FILING_DISCLOSURE_CONSENT_COLLECTION,
  PARTNER_RECIPIENT_LEGAL_NAMES,
  SIGNATURE_METHODS,
  consentTextSha256,
  createPartnerSendStub,
  expiresAtFor,
  hashSignatureValue,
  noteInFirmPreparerReassignment,
  runQueuedFilingHandOff,
  saveDisclosureConsent,
  sendFilingHandOff,
  signatureValueMeetsLength,
  uniqueIdentifierIsComplete,
  withdrawDisclosureConsent,
  type HandOffRequest,
  type HandOffReturn,
  type SaveDisclosureConsentInput,
} from '@/lib/filing-consent';

const db = adminDb as unknown as FakeFirestore;
const PARTNER = PARTNER_RECIPIENT_LEGAL_NAMES[0];
const SIGNED_AT = '2026-01-15T20:00:00.000Z';
const NOW = new Date('2026-02-01T18:00:00.000Z');
const ONE_YEAR_EXPIRY = '2027-01-15T20:00:00.000Z';

const fetchSpy = vi.spyOn(globalThis, 'fetch');

function federal(taxYear: number, fields: Record<string, unknown> = { wages: 100, agi: 80, refund: 10 }): HandOffReturn {
  return { code: 'federal', taxYear, fields };
}

function saveInput(overrides: Partial<SaveDisclosureConsentInput> = {}): SaveDisclosureConsentInput {
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
    signedAt: SIGNED_AT,
    kind: 'disclosure',
    ...overrides,
  };
}

function handOff(recordId: string, overrides: Partial<HandOffRequest> = {}): HandOffRequest {
  return {
    signedInUid: 'user-1',
    taxYear: 2026,
    recipientLegalName: PARTNER,
    returns: [federal(2026)],
    consentRecordId: recordId,
    ...overrides,
  };
}

function consentPaths(): string[] {
  return [...db.records.keys()].filter(path => path.startsWith(`${FILING_DISCLOSURE_CONSENT_COLLECTION}/`));
}

async function seedConsentText(): Promise<void> {
  await db.collection(FILING_CONSENT_TEXT_COLLECTION).doc(CURRENT_CONSENT_TEXT_VERSION).set({
    version: CURRENT_CONSENT_TEXT_VERSION,
    text: DRAFT_DISCLOSURE_CONSENT_TEXT,
  });
}

async function saveValid(overrides: Partial<SaveDisclosureConsentInput> = {}) {
  const saved = await saveDisclosureConsent(saveInput(overrides));
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw new Error('expected a stored disclosure consent');
  return saved;
}

function copyStored(id: string): Record<string, unknown> {
  const data = db.records.get(`${FILING_DISCLOSURE_CONSENT_COLLECTION}/${id}`);
  if (data === undefined) throw new Error(`missing consent ${id}`);
  return { ...data };
}

function consentBytes(id: string): Buffer {
  const data = db.records.get(`${FILING_DISCLOSURE_CONSENT_COLLECTION}/${id}`);
  if (data === undefined) throw new Error(`missing consent ${id}`);
  return Buffer.from(JSON.stringify(data), 'utf8');
}

async function plant(record: Record<string, unknown>, id: string): Promise<string> {
  await db.collection(FILING_DISCLOSURE_CONSENT_COLLECTION).doc(id).set(record);
  return id;
}

beforeEach(async () => {
  db.records.clear();
  fetchSpy.mockClear();
  await seedConsentText();
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
});

describe('disclosure consent hand off gate', () => {
  it('refuses a send when no consent record is stored', async () => {
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff('', { consentRecordId: undefined }), stub, NOW);
    expect(result).toMatchObject({ sent: false, code: 'no_record' });
    expect(stub.deliveries).toEqual([]);

    const missing = createPartnerSendStub();
    const missingResult = await sendFilingHandOff(handOff('does-not-exist'), missing, NOW);
    expect(missingResult).toMatchObject({ sent: false, code: 'no_record' });
    expect(missing.deliveries).toEqual([]);
  });

  it('refuses a browser consent checked flag when no record is stored', async () => {
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff('', { consentRecordId: undefined, browserConsentChecked: true }), stub, NOW);
    expect(result).toMatchObject({ sent: false, code: 'no_record' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a consent whose text version is not current', async () => {
    const saved = await saveValid();
    const id = await plant({ ...copyStored(saved.id), consentTextVersion: 'draft-old' }, 'stale-version');
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(id), stub, NOW);
    expect(result).toMatchObject({ sent: false, code: 'text_version_not_current' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a recipient that is not on the signed list, including another firm and a subcontractor', async () => {
    const saved = await saveValid();
    const otherFirm = createPartnerSendStub();
    const otherFirmResult = await sendFilingHandOff(handOff(saved.id, { recipientLegalName: 'Other Draft Firm LLC' }), otherFirm, NOW);
    expect(otherFirmResult).toMatchObject({ sent: false, code: 'recipient_not_on_list' });
    expect(otherFirm.deliveries).toEqual([]);

    const subcontractor = createPartnerSendStub();
    const subcontractorResult = await sendFilingHandOff(handOff(saved.id, { recipientLegalName: 'North Review Subcontractor LLC' }), subcontractor, NOW);
    expect(subcontractorResult).toMatchObject({ sent: false, code: 'recipient_not_on_list' });
    expect(subcontractor.deliveries).toEqual([]);
  });

  it('leaves the consent byte for byte unchanged when a preparer is reassigned inside the named firm, and refuses a different firm, a subcontractor, or a reviewer', async () => {
    const saved = await saveValid();
    expect(saved.record.recipients).toEqual([PARTNER]);
    const before = consentBytes(saved.id);

    const noted = await noteInFirmPreparerReassignment({
      consentRecordId: saved.id,
      uid: 'user-1',
      firmLegalName: PARTNER,
      preparerName: 'Second Draft Preparer',
    });
    expect(noted).toEqual({ ok: true });
    const afterReassignment = consentBytes(saved.id);
    expect(afterReassignment.equals(before)).toBe(true);
    expect(Buffer.compare(afterReassignment, before)).toBe(0);

    const stub = createPartnerSendStub();
    const sent = await sendFilingHandOff(handOff(saved.id), stub, NOW);
    expect(sent).toEqual({ sent: true });
    expect(stub.deliveries).toHaveLength(1);
    expect(stub.deliveries[0].recipientLegalName).toBe(PARTNER);
    expect(consentBytes(saved.id).equals(before)).toBe(true);

    for (const recipientLegalName of ['Other Draft Firm LLC', 'North Review Subcontractor LLC', 'Draft Return Reviewer LLC']) {
      const refusedStub = createPartnerSendStub();
      const refused = await sendFilingHandOff(handOff(saved.id, { recipientLegalName }), refusedStub, NOW);
      expect(refused).toMatchObject({ sent: false, code: 'recipient_not_on_list' });
      expect(refusedStub.deliveries).toEqual([]);
      expect(consentBytes(saved.id).equals(before)).toBe(true);
    }
  });

  it('refuses a recipient description that is not a legal name on the partner list', async () => {
    const before = consentPaths().length;
    const saved = await saveDisclosureConsent(saveInput({ recipients: ['our filing partner'] }));
    expect(saved).toMatchObject({ ok: false, code: 'recipient_not_legal_name' });
    expect(consentPaths()).toHaveLength(before);

    const base = await saveValid();
    const id = await plant({ ...copyStored(base.id), recipients: ['our filing partner'] }, 'description-recipient');
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(id, { recipientLegalName: 'our filing partner' }), stub, NOW);
    expect(result).toMatchObject({ sent: false, code: 'recipient_not_legal_name' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a withdrawn consent', async () => {
    const saved = await saveValid();
    const withdrawn = await withdrawDisclosureConsent(saved.id, 'user-1', new Date('2026-03-01T00:00:00.000Z'));
    expect(withdrawn).toEqual({ ok: true });
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(saved.id, { browserConsentChecked: true }), stub, NOW);
    expect(result).toMatchObject({ sent: false, code: 'withdrawn' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a consent whose account is not the signed in user', async () => {
    const saved = await saveValid();
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(saved.id, { signedInUid: 'user-2' }), stub, NOW);
    expect(result).toMatchObject({ sent: false, code: 'uid_mismatch' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a consent whose tax year is not the year of the return being sent', async () => {
    const saved = await saveValid();
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(saved.id, {
      taxYear: 2025,
      returns: [federal(2025, { wages: 50 })],
    }), stub, NOW);
    expect(result).toMatchObject({ sent: false, code: 'tax_year_mismatch' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a stored record when any required field is missing or empty', async () => {
    const saved = await saveValid();
    const base = copyStored(saved.id);
    const fields = [
      'uid',
      'taxYear',
      'disclosingPreparerLegalName',
      'taxpayerName',
      'purpose',
      'returnsCovered',
      'recipients',
      'scope',
      'signatureMethod',
      'signatureValue',
      'userTypedNotPrefilled',
      'signedAt',
      'expiresAt',
      'durationStated',
      'consentTextVersion',
      'consentTextSha256',
      'kind',
      'withdrawnAt',
    ];
    const emptyValue: Record<string, unknown> = {
      uid: '',
      taxYear: null,
      disclosingPreparerLegalName: ' ',
      taxpayerName: '',
      purpose: '   ',
      returnsCovered: [],
      recipients: [],
      scope: null,
      signatureMethod: '',
      signatureValue: '',
      userTypedNotPrefilled: null,
      signedAt: '',
      expiresAt: null,
      durationStated: null,
      consentTextVersion: '',
      consentTextSha256: '',
      kind: '',
      withdrawnAt: '',
    };

    for (const field of fields) {
      const removed = { ...base };
      delete removed[field];
      const removedId = await plant(removed, `missing-${field}`);
      const removedStub = createPartnerSendStub();
      const removedResult = await sendFilingHandOff(handOff(removedId), removedStub, NOW);
      expect(removedResult).toMatchObject({ sent: false, code: 'missing_field', field });
      expect(removedStub.deliveries).toEqual([]);

      const emptiedId = await plant({ ...base, [field]: emptyValue[field] }, `empty-${field}`);
      const emptiedStub = createPartnerSendStub();
      const emptiedResult = await sendFilingHandOff(handOff(emptiedId), emptiedStub, NOW);
      expect(emptiedResult).toMatchObject({ sent: false, code: 'missing_field', field });
      expect(emptiedStub.deliveries).toEqual([]);
    }
  });

  it('refuses state data and a different federal year when the consent names only federal 2026, and sends federal plus CA when both are named', async () => {
    const federalOnly = await saveValid();
    const stateStub = createPartnerSendStub();
    const stateResult = await sendFilingHandOff(handOff(federalOnly.id, {
      returns: [{ code: 'CA', taxYear: 2026, fields: { wages: 40 } }],
    }), stateStub, NOW);
    expect(stateResult).toMatchObject({ sent: false, code: 'return_not_covered' });
    expect(stateStub.deliveries).toEqual([]);

    const priorYearStub = createPartnerSendStub();
    const priorYearResult = await sendFilingHandOff(handOff(federalOnly.id, {
      returns: [federal(2025, { wages: 40 })],
    }), priorYearStub, NOW);
    expect(priorYearResult).toMatchObject({ sent: false, code: 'return_not_covered' });
    expect(priorYearStub.deliveries).toEqual([]);

    const mixedStub = createPartnerSendStub();
    const mixedResult = await sendFilingHandOff(handOff(federalOnly.id, {
      returns: [federal(2026), { code: 'CA', taxYear: 2026, fields: { wages: 40 } }],
    }), mixedStub, NOW);
    expect(mixedResult).toMatchObject({ sent: false, code: 'return_not_covered' });
    expect(mixedStub.deliveries).toEqual([]);

    const both = await saveValid({
      returnsCovered: [{ code: 'federal', taxYear: 2026 }, { code: 'CA', taxYear: 2026 }],
    });
    const bothStub = createPartnerSendStub();
    const bothResult = await sendFilingHandOff(handOff(both.id, {
      returns: [federal(2026, { wages: 100 }), { code: 'CA', taxYear: 2026, fields: { wages: 40 } }],
    }), bothStub, NOW);
    expect(bothResult).toEqual({ sent: true });
    expect(bothStub.deliveries).toHaveLength(1);
    expect(bothStub.deliveries[0].payload.returns).toEqual([
      { code: 'federal', taxYear: 2026, fields: { wages: 100 } },
      { code: 'CA', taxYear: 2026, fields: { wages: 40 } },
    ]);
  });

  it('sends nothing on a queued retry after the consent is withdrawn', async () => {
    const saved = await saveValid();
    const stub = createPartnerSendStub();
    const request = handOff(saved.id);
    const job = { request };
    const first = await runQueuedFilingHandOff(job, stub, NOW);
    expect(first).toEqual({ sent: true });
    expect(stub.deliveries).toHaveLength(1);

    const withdrawn = await withdrawDisclosureConsent(saved.id, 'user-1', new Date('2026-03-02T00:00:00.000Z'));
    expect(withdrawn).toEqual({ ok: true });
    const retry = await runQueuedFilingHandOff(job, stub, NOW);
    expect(retry).toMatchObject({ sent: false, code: 'withdrawn' });
    expect(stub.deliveries).toHaveLength(1);
    const secondRetry = await runQueuedFilingHandOff(job, stub, NOW);
    expect(secondRetry).toMatchObject({ sent: false, code: 'withdrawn' });
    expect(stub.deliveries).toHaveLength(1);
    expect(stub.deliveries[0].recipientLegalName).toBe(PARTNER);
  });

  it('sends the covered return when a typed name consent is valid', async () => {
    const saved = await saveValid();
    expect(saved.record.signatureMethod).toBe('typed_name');
    expect(ACCEPTED_SIGNATURE_METHODS).toEqual(['typed_name']);
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(saved.id), stub, NOW);
    expect(result).toEqual({ sent: true });
    expect(stub.deliveries).toHaveLength(1);
    expect(stub.deliveries[0].payload.returns).toEqual([
      { code: 'federal', taxYear: 2026, fields: { wages: 100, agi: 80, refund: 10 } },
    ]);
  });

  it('sends only the named fields when the signed scope is narrower than the whole return', async () => {
    const saved = await saveValid({ scope: { kind: 'fields', fields: ['wages', 'agi'] } });
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(saved.id), stub, NOW);
    expect(result).toEqual({ sent: true });
    expect(stub.deliveries).toHaveLength(1);
    expect(stub.deliveries[0].payload.returns[0].fields).toEqual({ wages: 100, agi: 80 });
    expect(Object.prototype.hasOwnProperty.call(stub.deliveries[0].payload.returns[0].fields, 'refund')).toBe(false);
  });

  it('rejects a record that covers both a use and a disclosure and writes nothing', async () => {
    const before = consentPaths().length;
    const combinedKind = await saveDisclosureConsent(saveInput({ kind: 'disclosure_and_use' }));
    expect(combinedKind).toMatchObject({ ok: false, code: 'combined_use_and_disclosure' });
    const combinedFlag = await saveDisclosureConsent(saveInput({ coversUse: true }));
    expect(combinedFlag).toMatchObject({ ok: false, code: 'combined_use_and_disclosure' });
    expect(consentPaths()).toHaveLength(before);

    const base = await saveValid();
    const id = await plant({ ...copyStored(base.id), kind: 'disclosure_and_use' }, 'combined-record');
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(id), stub, NOW);
    expect(result).toMatchObject({ sent: false, code: 'combined_use_and_disclosure' });
    expect(stub.deliveries).toEqual([]);
  });

  it('stores a one year expiry when no duration is chosen', async () => {
    const saved = await saveValid();
    expect(saved.record.signedAt).toBe(SIGNED_AT);
    expect(saved.record.durationStated).toEqual({ unit: 'years', count: 1 });
    expect(saved.record.expiresAt).toBe(ONE_YEAR_EXPIRY);
    expect(expiresAtFor('2024-02-29T00:00:00.000Z', { unit: 'years', count: 1 })).toBe('2025-02-28T00:00:00.000Z');
  });

  it('stores the chosen period as the expiry', async () => {
    const saved = await saveValid({ duration: { unit: 'days', count: 30 } });
    expect(saved.record.durationStated).toEqual({ unit: 'days', count: 30 });
    expect(saved.record.expiresAt).toBe('2026-02-14T20:00:00.000Z');
  });

  it('refuses a missing or null expiry as a missing field', async () => {
    const saved = await saveValid();
    const base = copyStored(saved.id);
    const removed = { ...base };
    delete removed.expiresAt;
    const removedId = await plant(removed, 'expiry-removed');
    const removedStub = createPartnerSendStub();
    const removedResult = await sendFilingHandOff(handOff(removedId), removedStub, NOW);
    expect(removedResult).toMatchObject({ sent: false, code: 'missing_field', field: 'expiresAt' });
    expect(removedStub.deliveries).toEqual([]);

    const nullId = await plant({ ...base, expiresAt: null }, 'expiry-null');
    const nullStub = createPartnerSendStub();
    const nullResult = await sendFilingHandOff(handOff(nullId), nullStub, NOW);
    expect(nullResult).toMatchObject({ sent: false, code: 'missing_field', field: 'expiresAt' });
    expect(nullStub.deliveries).toEqual([]);
  });

  it('refuses a record whose expiry does not equal the signing time plus the stated duration', async () => {
    const saved = await saveValid();
    const id = await plant({ ...copyStored(saved.id), expiresAt: '2028-01-15T20:00:00.000Z' }, 'expiry-mismatch');
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(id), stub, NOW);
    expect(result).toMatchObject({ sent: false, code: 'expiry_mismatch' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a send on the day after expiry', async () => {
    const saved = await saveValid();
    const onExpiry = createPartnerSendStub();
    const onExpiryResult = await sendFilingHandOff(handOff(saved.id), onExpiry, new Date(ONE_YEAR_EXPIRY));
    expect(onExpiryResult).toEqual({ sent: true });
    expect(onExpiry.deliveries).toHaveLength(1);

    const dayAfter = new Date('2027-01-16T20:00:00.000Z');
    const late = createPartnerSendStub();
    const lateResult = await sendFilingHandOff(handOff(saved.id), late, dayAfter);
    expect(lateResult).toMatchObject({ sent: false, code: 'expired' });
    expect(late.deliveries).toEqual([]);
  });

  it('refuses a send after the stored consent text for the version is altered', async () => {
    const saved = await saveValid();
    expect(saved.record.consentTextSha256).toBe(consentTextSha256(DRAFT_DISCLOSURE_CONSENT_TEXT));
    await db.collection(FILING_CONSENT_TEXT_COLLECTION).doc(CURRENT_CONSENT_TEXT_VERSION).update({
      text: `${DRAFT_DISCLOSURE_CONSENT_TEXT}\nALTERED AFTER SIGNING`,
    });
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(saved.id), stub, NOW);
    expect(result).toMatchObject({ sent: false, code: 'consent_text_mismatch' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses an assigned pin record', async () => {
    const before = consentPaths().length;
    const saved = await saveDisclosureConsent(saveInput({ signatureMethod: 'assigned_pin', signatureValue: hashSignatureValue('sample-pin', 'record-salt') }));
    expect(saved).toMatchObject({ ok: false, code: 'signature_method_not_accepted' });
    expect(consentPaths()).toHaveLength(before);

    const base = await saveValid();
    const id = await plant({
      ...copyStored(base.id),
      signatureMethod: 'assigned_pin',
      signatureValue: hashSignatureValue('sample-pin', 'record-salt'),
    }, 'assigned-pin');
    const stored = db.records.get(`${FILING_DISCLOSURE_CONSENT_COLLECTION}/${id}`);
    if (stored === undefined) throw new Error('missing assigned pin record');
    expect(stored.signatureValue).toBe(hashSignatureValue('sample-pin', 'record-salt'));
    expect(String(stored.signatureValue)).not.toContain('sample-pin');
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(id), stub, NOW);
    expect(result).toMatchObject({ sent: false, code: 'signature_method_not_accepted' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a unique identifier record', async () => {
    const before = consentPaths().length;
    const saved = await saveDisclosureConsent(saveInput({ signatureMethod: 'unique_identifier', signatureValue: hashSignatureValue('sample-id', 'record-salt') }));
    expect(saved).toMatchObject({ ok: false, code: 'signature_method_not_accepted' });
    expect(consentPaths()).toHaveLength(before);

    const base = await saveValid();
    const id = await plant({
      ...copyStored(base.id),
      signatureMethod: 'unique_identifier',
      signatureValue: hashSignatureValue('sample-id', 'record-salt'),
      identityVerified: true,
    }, 'unique-identifier');
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(id), stub, NOW);
    expect(result).toMatchObject({ sent: false, code: 'signature_method_not_accepted' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a signature method outside the three value enum', async () => {
    const saved = await saveValid();
    const id = await plant({ ...copyStored(saved.id), signatureMethod: 'click' }, 'click-method');
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(id), stub, NOW);
    expect(result).toMatchObject({ sent: false, code: 'invalid_signature_method' });
    expect(stub.deliveries).toEqual([]);
    expect(SIGNATURE_METHODS).toEqual(['assigned_pin', 'typed_name', 'unique_identifier']);
  });

  it('refuses a signature that was not typed into an unprefilled field', async () => {
    const saved = await saveValid();
    const id = await plant({ ...copyStored(saved.id), userTypedNotPrefilled: false }, 'prefilled-signature');
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(id), stub, NOW);
    expect(result).toMatchObject({ sent: false, code: 'signature_not_user_typed' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a disclosing preparer name that is not the configured legal entity', async () => {
    const saved = await saveValid();
    expect(saved.record.disclosingPreparerLegalName).toBe(DISCLOSING_PREPARER_LEGAL_NAME);
    expect(DISCLOSING_PREPARER_LEGAL_NAME.startsWith('DRAFT:')).toBe(true);
    const id = await plant({ ...copyStored(saved.id), disclosingPreparerLegalName: 'Some Other Entity LLC' }, 'wrong-preparer');
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(id), stub, NOW);
    expect(result).toMatchObject({ sent: false, code: 'disclosing_preparer_mismatch' });
    expect(stub.deliveries).toEqual([]);
  });

  it('checks pin and identifier length and a caller supplied salt without storing a secret', () => {
    expect(signatureValueMeetsLength('assigned_pin', '1234')).toBe(false);
    expect(signatureValueMeetsLength('assigned_pin', '12345')).toBe(true);
    expect(signatureValueMeetsLength('unique_identifier', 'abcd')).toBe(false);
    expect(signatureValueMeetsLength('unique_identifier', 'abcde')).toBe(true);
    expect(signatureValueMeetsLength('typed_name', '   ')).toBe(false);
    expect(signatureValueMeetsLength('typed_name', 'Test Taxpayer')).toBe(true);
    expect(uniqueIdentifierIsComplete('abcde', false)).toBe(false);
    expect(uniqueIdentifierIsComplete('abcd', true)).toBe(false);
    expect(uniqueIdentifierIsComplete('abcde', true)).toBe(true);
    const hash = hashSignatureValue('12345', 'salt-a');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain('12345');
    expect(hash).toBe(hashSignatureValue('12345', 'salt-a'));
    expect(hash).not.toBe(hashSignatureValue('12345', 'salt-b'));
    expect(() => hashSignatureValue('12345', '')).toThrow(/salt/);
  });

  it('leaves the new collections out of the client rules file', () => {
    const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
    expect(rules.includes(FILING_DISCLOSURE_CONSENT_COLLECTION)).toBe(false);
    expect(rules.includes(FILING_CONSENT_TEXT_COLLECTION)).toBe(false);
  });
});
