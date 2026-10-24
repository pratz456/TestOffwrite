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
  evaluateFilingHandOff,
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
import { resetFilingConsentClock, setFilingConsentClock } from '@/lib/filing-consent/clock';

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
    residentState: 'NY',
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

function at(iso: string): void {
  setFilingConsentClock(() => new Date(iso));
}

async function saveValid(overrides: Partial<SaveDisclosureConsentInput> = {}) {
  at(SIGNED_AT);
  const saved = await saveDisclosureConsent(saveInput(overrides));
  at(NOW.toISOString());
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw new Error('expected a stored disclosure consent');
  return saved;
}

function watchWrites(collectionName: string): { methods: string[]; restore: () => void } {
  const originalCollection = db.collection.bind(db);
  const methods: string[] = [];
  const wrapped = (name: string) => {
    const collection = originalCollection(name);
    if (name !== collectionName) return collection;
    const originalDoc = collection.doc.bind(collection);
    collection.doc = (id?: string) => {
      const document = originalDoc(id);
      const originalCreate = document.create.bind(document);
      const originalSet = document.set.bind(document);
      document.create = async (data: Record<string, unknown>) => {
        methods.push('create');
        return originalCreate(data);
      };
      document.set = async (data: Record<string, unknown>, setOptions?: { merge?: boolean }) => {
        methods.push('set');
        return originalSet(data, setOptions);
      };
      return document;
    };
    return collection;
  };
  db.collection = wrapped as typeof db.collection;
  return {
    methods,
    restore() {
      db.collection = originalCollection as typeof db.collection;
    },
  };
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
  resetFilingConsentClock();
  at(SIGNED_AT);
  db.records.clear();
  fetchSpy.mockClear();
  await seedConsentText();
});

afterEach(() => {
  resetFilingConsentClock();
  expect(fetchSpy).not.toHaveBeenCalled();
});

describe('disclosure consent hand off gate', () => {
  it('refuses a send when no consent record is stored', async () => {
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff('', { consentRecordId: undefined }), stub);
    expect(result).toMatchObject({ sent: false, code: 'no_record' });
    expect(stub.deliveries).toEqual([]);

    const missing = createPartnerSendStub();
    const missingResult = await sendFilingHandOff(handOff('does-not-exist'), missing);
    expect(missingResult).toMatchObject({ sent: false, code: 'no_record' });
    expect(missing.deliveries).toEqual([]);
  });

  it('refuses a browser consent checked flag when no record is stored', async () => {
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff('', { consentRecordId: undefined, browserConsentChecked: true }), stub);
    expect(result).toMatchObject({ sent: false, code: 'no_record' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a consent whose text version is not current', async () => {
    const saved = await saveValid();
    const id = await plant({ ...copyStored(saved.id), consentTextVersion: 'draft-old' }, 'stale-version');
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(id), stub);
    expect(result).toMatchObject({ sent: false, code: 'text_version_not_current' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a recipient that is not on the signed list, including another firm and a subcontractor', async () => {
    const saved = await saveValid();
    const otherFirm = createPartnerSendStub();
    const otherFirmResult = await sendFilingHandOff(handOff(saved.id, { recipientLegalName: 'Other Draft Firm LLC' }), otherFirm);
    expect(otherFirmResult).toMatchObject({ sent: false, code: 'recipient_not_on_list' });
    expect(otherFirm.deliveries).toEqual([]);

    const subcontractor = createPartnerSendStub();
    const subcontractorResult = await sendFilingHandOff(handOff(saved.id, { recipientLegalName: 'North Review Subcontractor LLC' }), subcontractor);
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
    const sent = await sendFilingHandOff(handOff(saved.id), stub);
    expect(sent).toEqual({ sent: true });
    expect(stub.deliveries).toHaveLength(1);
    expect(stub.deliveries[0].recipientLegalName).toBe(PARTNER);
    expect(consentBytes(saved.id).equals(before)).toBe(true);

    for (const recipientLegalName of ['Other Draft Firm LLC', 'North Review Subcontractor LLC', 'Draft Return Reviewer LLC']) {
      const refusedStub = createPartnerSendStub();
      const refused = await sendFilingHandOff(handOff(saved.id, { recipientLegalName }), refusedStub);
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
    const result = await sendFilingHandOff(handOff(id, { recipientLegalName: 'our filing partner' }), stub);
    expect(result).toMatchObject({ sent: false, code: 'recipient_not_legal_name' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a withdrawn consent', async () => {
    const saved = await saveValid();
    at('2026-03-01T00:00:00.000Z');
    const withdrawn = await withdrawDisclosureConsent(saved.id, 'user-1');
    expect(withdrawn).toEqual({ ok: true });
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(saved.id, { browserConsentChecked: true }), stub);
    expect(result).toMatchObject({ sent: false, code: 'withdrawn' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a consent whose account is not the signed in user', async () => {
    const saved = await saveValid();
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(saved.id, { signedInUid: 'user-2' }), stub);
    expect(result).toMatchObject({ sent: false, code: 'uid_mismatch' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a consent whose tax year is not the year of the return being sent', async () => {
    const saved = await saveValid();
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(saved.id, {
      taxYear: 2025,
      returns: [federal(2025, { wages: 50 })],
    }), stub);
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
      const removedResult = await sendFilingHandOff(handOff(removedId), removedStub);
      expect(removedResult).toMatchObject({ sent: false, code: 'missing_field', field });
      expect(removedStub.deliveries).toEqual([]);

      const emptiedId = await plant({ ...base, [field]: emptyValue[field] }, `empty-${field}`);
      const emptiedStub = createPartnerSendStub();
      const emptiedResult = await sendFilingHandOff(handOff(emptiedId), emptiedStub);
      expect(emptiedResult).toMatchObject({ sent: false, code: 'missing_field', field });
      expect(emptiedStub.deliveries).toEqual([]);
    }
  });

  it('refuses state data and a different federal year when the consent names only federal 2026, and sends federal plus CA when both are named', async () => {
    const federalOnly = await saveValid();
    const stateStub = createPartnerSendStub();
    const stateResult = await sendFilingHandOff(handOff(federalOnly.id, {
      returns: [{ code: 'CA', taxYear: 2026, fields: { wages: 40 } }],
    }), stateStub);
    expect(stateResult).toMatchObject({ sent: false, code: 'return_not_covered' });
    expect(stateStub.deliveries).toEqual([]);

    const priorYearStub = createPartnerSendStub();
    const priorYearResult = await sendFilingHandOff(handOff(federalOnly.id, {
      returns: [federal(2025, { wages: 40 })],
    }), priorYearStub);
    expect(priorYearResult).toMatchObject({ sent: false, code: 'return_not_covered' });
    expect(priorYearStub.deliveries).toEqual([]);

    const mixedStub = createPartnerSendStub();
    const mixedResult = await sendFilingHandOff(handOff(federalOnly.id, {
      returns: [federal(2026), { code: 'CA', taxYear: 2026, fields: { wages: 40 } }],
    }), mixedStub);
    expect(mixedResult).toMatchObject({ sent: false, code: 'return_not_covered' });
    expect(mixedStub.deliveries).toEqual([]);

    const both = await saveValid({
      returnsCovered: [{ code: 'federal', taxYear: 2026 }, { code: 'CA', taxYear: 2026 }],
    });
    const bothStub = createPartnerSendStub();
    const bothResult = await sendFilingHandOff(handOff(both.id, {
      returns: [federal(2026, { wages: 100 }), { code: 'CA', taxYear: 2026, fields: { wages: 40 } }],
    }), bothStub);
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
    const first = await runQueuedFilingHandOff(job, stub);
    expect(first).toEqual({ sent: true });
    expect(stub.deliveries).toHaveLength(1);

    at('2026-03-02T00:00:00.000Z');
    const withdrawn = await withdrawDisclosureConsent(saved.id, 'user-1');
    expect(withdrawn).toEqual({ ok: true });
    const retry = await runQueuedFilingHandOff(job, stub);
    expect(retry).toMatchObject({ sent: false, code: 'withdrawn' });
    expect(stub.deliveries).toHaveLength(1);
    const secondRetry = await runQueuedFilingHandOff(job, stub);
    expect(secondRetry).toMatchObject({ sent: false, code: 'withdrawn' });
    expect(stub.deliveries).toHaveLength(1);
    expect(stub.deliveries[0].recipientLegalName).toBe(PARTNER);
  });

  it('sends the covered return when a typed name consent is valid', async () => {
    const saved = await saveValid();
    expect(saved.record.signatureMethod).toBe('typed_name');
    expect(ACCEPTED_SIGNATURE_METHODS).toEqual(['typed_name']);
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(saved.id), stub);
    expect(result).toEqual({ sent: true });
    expect(stub.deliveries).toHaveLength(1);
    expect(stub.deliveries[0].payload.returns).toEqual([
      { code: 'federal', taxYear: 2026, fields: { wages: 100, agi: 80, refund: 10 } },
    ]);
  });

  it('refuses a send that includes a field the consent does not name', async () => {
    const saved = await saveValid({ scope: { kind: 'fields', fields: ['wages', 'agi'] } });
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(saved.id), stub);
    expect(result).toMatchObject({ sent: false, code: 'field_not_named' });
    expect(stub.deliveries).toEqual([]);
  });

  it('delivers nothing to the recipient when the send includes an unnamed field', async () => {
    const saved = await saveValid({ scope: { kind: 'fields', fields: ['wages', 'agi'] } });
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(saved.id, {
      returns: [federal(2026, { wages: 100, agi: 80, accountNumber: '0000' })],
    }), stub);
    expect(result).toMatchObject({ sent: false, code: 'field_not_named' });
    expect(stub.deliveries).toEqual([]);
    expect(stub.deliveries.some(delivery => delivery.recipientLegalName === PARTNER)).toBe(false);
  });

  it('sends the return when every field in the payload is named on the consent', async () => {
    const saved = await saveValid({ scope: { kind: 'fields', fields: ['wages', 'agi'] } });
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(saved.id, {
      returns: [federal(2026, { wages: 100, agi: 80 })],
    }), stub);
    expect(result).toEqual({ sent: true });
    expect(stub.deliveries).toEqual([{
      recipientLegalName: PARTNER,
      payload: { returns: [{ code: 'federal', taxYear: 2026, fields: { wages: 100, agi: 80 } }] },
    }]);
  });

  it('the exported API has no way to set signedAt or now', async () => {
    const api = await import('@/lib/filing-consent');
    expect(api).not.toHaveProperty('setFilingConsentClock');
    expect(api).not.toHaveProperty('resetFilingConsentClock');
    expect(api).not.toHaveProperty('replaceDraftDisclosureConsentText');
    expect(api).not.toHaveProperty('resetDraftDisclosureConsentText');
    for (const fn of [
      saveDisclosureConsent,
      withdrawDisclosureConsent,
      noteInFirmPreparerReassignment,
      evaluateFilingHandOff,
      sendFilingHandOff,
      runQueuedFilingHandOff,
    ]) {
      const source = Function.prototype.toString.call(fn);
      const params = source.match(/^(?:async\s+)?function[^(]*\(([^)]*)\)/)?.[1] ?? '';
      expect(params).not.toMatch(/\bnow\b/);
      expect(params).not.toMatch(/\bsignedAt\b/);
    }
    at('2026-06-01T15:00:00.000Z');
    const save = saveDisclosureConsent as (
      input: SaveDisclosureConsentInput,
      supplied?: Date,
    ) => ReturnType<typeof saveDisclosureConsent>;
    const saved = await save(
      { ...saveInput(), signedAt: '2020-01-01T00:00:00.000Z' } as SaveDisclosureConsentInput,
      new Date('1999-01-01T00:00:00.000Z'),
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error('expected a stored disclosure consent');
    expect(saved.record.signedAt).toBe('2026-06-01T15:00:00.000Z');
    expect(saved.record.expiresAt).toBe('2027-06-01T15:00:00.000Z');
  });

  it('creates the consent document once and refuses a second create', async () => {
    const watched = watchWrites(FILING_DISCLOSURE_CONSENT_COLLECTION);
    try {
      const saved = await saveValid();
      expect(watched.methods).toEqual(['create']);
      const before = consentBytes(saved.id);
      watched.restore();
      await expect(db.collection(FILING_DISCLOSURE_CONSENT_COLLECTION).doc(saved.id).create({ overwritten: true })).rejects.toThrow(/Document exists/);
      expect(consentBytes(saved.id).equals(before)).toBe(true);
    } finally {
      watched.restore();
    }
  });

  it('creates the consent text document once and leaves it unchanged on a later save', async () => {
    await db.collection(FILING_CONSENT_TEXT_COLLECTION).doc(CURRENT_CONSENT_TEXT_VERSION).delete();
    const watched = watchWrites(FILING_CONSENT_TEXT_COLLECTION);
    try {
      const saved = await saveValid();
      expect(saved.record.consentTextVersion).toBe(CURRENT_CONSENT_TEXT_VERSION);
      expect(watched.methods).toEqual(['create']);
      const textPath = `${FILING_CONSENT_TEXT_COLLECTION}/${CURRENT_CONSENT_TEXT_VERSION}`;
      const stored = db.records.get(textPath);
      if (stored === undefined) throw new Error('missing consent text');
      const before = Buffer.from(JSON.stringify(stored), 'utf8');
      at(SIGNED_AT);
      const again = await saveDisclosureConsent(saveInput());
      expect(again.ok).toBe(true);
      expect(watched.methods).toEqual(['create']);
      const after = db.records.get(textPath);
      if (after === undefined) throw new Error('missing consent text');
      expect(Buffer.from(JSON.stringify(after), 'utf8').equals(before)).toBe(true);
      watched.restore();
      await expect(db.collection(FILING_CONSENT_TEXT_COLLECTION).doc(CURRENT_CONSENT_TEXT_VERSION).create({ text: 'other' })).rejects.toThrow(/Document exists/);
      const still = db.records.get(textPath);
      if (still === undefined) throw new Error('missing consent text');
      expect(Buffer.from(JSON.stringify(still), 'utf8').equals(before)).toBe(true);
    } finally {
      watched.restore();
    }
  });

  it('refuses a second withdrawal and keeps the first withdrawal time', async () => {
    const saved = await saveValid();
    at('2026-03-01T00:00:00.000Z');
    const first = await withdrawDisclosureConsent(saved.id, 'user-1');
    expect(first).toEqual({ ok: true });
    at('2026-04-01T00:00:00.000Z');
    const second = await withdrawDisclosureConsent(saved.id, 'user-1');
    expect(second).toMatchObject({ ok: false, code: 'withdrawn' });
    expect(copyStored(saved.id).withdrawnAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('lets exactly one of two concurrent withdrawals succeed', async () => {
    const saved = await saveValid();
    at('2026-03-01T00:00:00.000Z');
    const results = await Promise.all([
      withdrawDisclosureConsent(saved.id, 'user-1'),
      withdrawDisclosureConsent(saved.id, 'user-1'),
    ]);
    const succeeded = results.filter(result => result.ok);
    const refused = results.filter(result => !result.ok);
    expect(succeeded).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ ok: false, code: 'withdrawn' });
    expect(copyStored(saved.id).withdrawnAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('refuses an in firm reassignment to a different firm, a subcontractor, or a reviewer', async () => {
    const saved = await saveValid();
    const before = consentBytes(saved.id);
    for (const firmLegalName of ['Other Draft Firm LLC', 'North Review Subcontractor LLC', 'Draft Return Reviewer LLC']) {
      const noted = await noteInFirmPreparerReassignment({
        consentRecordId: saved.id,
        uid: 'user-1',
        firmLegalName,
        preparerName: 'Second Draft Preparer',
      });
      expect(noted).toMatchObject({ ok: false, code: 'recipient_not_on_list' });
      expect(consentBytes(saved.id).equals(before)).toBe(true);
    }
  });

  it('refuses an in firm reassignment when the named firm is not a configured legal name', async () => {
    const saved = await saveValid();
    const id = await plant({ ...copyStored(saved.id), recipients: ['North Review Subcontractor LLC'] }, 'planted-subcontractor-firm');
    const before = consentBytes(id);
    const noted = await noteInFirmPreparerReassignment({
      consentRecordId: id,
      uid: 'user-1',
      firmLegalName: 'North Review Subcontractor LLC',
      preparerName: 'Second Draft Preparer',
    });
    expect(noted).toMatchObject({ ok: false, code: 'recipient_not_legal_name' });
    expect(consentBytes(id).equals(before)).toBe(true);
  });

  it('refuses an in firm reassignment when the consent is withdrawn', async () => {
    const saved = await saveValid();
    at('2026-03-01T00:00:00.000Z');
    const withdrawn = await withdrawDisclosureConsent(saved.id, 'user-1');
    expect(withdrawn).toEqual({ ok: true });
    const before = consentBytes(saved.id);
    const noted = await noteInFirmPreparerReassignment({
      consentRecordId: saved.id,
      uid: 'user-1',
      firmLegalName: PARTNER,
      preparerName: 'Second Draft Preparer',
    });
    expect(noted).toMatchObject({ ok: false, code: 'withdrawn' });
    expect(consentBytes(saved.id).equals(before)).toBe(true);
  });

  it('refuses an in firm reassignment when the consent is expired', async () => {
    const saved = await saveValid();
    const before = consentBytes(saved.id);
    at('2027-01-16T20:00:00.000Z');
    const noted = await noteInFirmPreparerReassignment({
      consentRecordId: saved.id,
      uid: 'user-1',
      firmLegalName: PARTNER,
      preparerName: 'Second Draft Preparer',
    });
    expect(noted).toMatchObject({ ok: false, code: 'expired' });
    expect(consentBytes(saved.id).equals(before)).toBe(true);
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
    const result = await sendFilingHandOff(handOff(id), stub);
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
    const removedResult = await sendFilingHandOff(handOff(removedId), removedStub);
    expect(removedResult).toMatchObject({ sent: false, code: 'missing_field', field: 'expiresAt' });
    expect(removedStub.deliveries).toEqual([]);

    const nullId = await plant({ ...base, expiresAt: null }, 'expiry-null');
    const nullStub = createPartnerSendStub();
    const nullResult = await sendFilingHandOff(handOff(nullId), nullStub);
    expect(nullResult).toMatchObject({ sent: false, code: 'missing_field', field: 'expiresAt' });
    expect(nullStub.deliveries).toEqual([]);
  });

  it('refuses a record whose expiry does not equal the signing time plus the stated duration', async () => {
    const saved = await saveValid();
    const id = await plant({ ...copyStored(saved.id), expiresAt: '2028-01-15T20:00:00.000Z' }, 'expiry-mismatch');
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(id), stub);
    expect(result).toMatchObject({ sent: false, code: 'expiry_mismatch' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a send on the day after expiry', async () => {
    const saved = await saveValid();
    at(ONE_YEAR_EXPIRY);
    const onExpiry = createPartnerSendStub();
    const onExpiryResult = await sendFilingHandOff(handOff(saved.id), onExpiry);
    expect(onExpiryResult).toEqual({ sent: true });
    expect(onExpiry.deliveries).toHaveLength(1);

    at('2027-01-16T20:00:00.000Z');
    const late = createPartnerSendStub();
    const lateResult = await sendFilingHandOff(handOff(saved.id), late);
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
    const result = await sendFilingHandOff(handOff(saved.id), stub);
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
    const result = await sendFilingHandOff(handOff(id), stub);
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
    const result = await sendFilingHandOff(handOff(id), stub);
    expect(result).toMatchObject({ sent: false, code: 'signature_method_not_accepted' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a signature method outside the three value enum', async () => {
    const saved = await saveValid();
    const id = await plant({ ...copyStored(saved.id), signatureMethod: 'click' }, 'click-method');
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(id), stub);
    expect(result).toMatchObject({ sent: false, code: 'invalid_signature_method' });
    expect(stub.deliveries).toEqual([]);
    expect(SIGNATURE_METHODS).toEqual(['assigned_pin', 'typed_name', 'unique_identifier']);
  });

  it('refuses a signature that was not typed into an unprefilled field', async () => {
    const saved = await saveValid();
    const id = await plant({ ...copyStored(saved.id), userTypedNotPrefilled: false }, 'prefilled-signature');
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(id), stub);
    expect(result).toMatchObject({ sent: false, code: 'signature_not_user_typed' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a disclosing preparer name that is not the configured legal entity', async () => {
    const saved = await saveValid();
    expect(saved.record.disclosingPreparerLegalName).toBe(DISCLOSING_PREPARER_LEGAL_NAME);
    expect(DISCLOSING_PREPARER_LEGAL_NAME.startsWith('DRAFT:')).toBe(true);
    const id = await plant({ ...copyStored(saved.id), disclosingPreparerLegalName: 'Some Other Entity LLC' }, 'wrong-preparer');
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(id), stub);
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
