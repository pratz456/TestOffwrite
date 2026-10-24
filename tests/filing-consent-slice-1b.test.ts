import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/admin', async () => {
  const { createFakeFirestore } = await import('./fixtures/fake-firestore');
  return { adminDb: createFakeFirestore() };
});

import { adminDb } from '@/lib/firebase/admin';
import type { FakeFirestore } from './fixtures/fake-firestore';
import {
  CURRENT_CONSENT_TEXT_VERSION,
  CURRENT_USE_CONSENT_TEXT_VERSION,
  DRAFT_CA_STAFFING,
  DRAFT_DISCLOSURE_CONSENT_TEXT,
  DRAFT_PARTNER_FEE_ESTIMATE,
  DRAFT_PARTNER_PRIMARY_BUSINESS_PHONE,
  DRAFT_PARTNER_PRINCIPAL_BUSINESS_ADDRESS,
  DRAFT_PARTNER_SECURITY_WARRANTY,
  DRAFT_PARTNER_SIGNING_EA_NAME,
  DRAFT_PARTNER_SIGNING_EA_PTIN,
  DRAFT_USE_CONSENT_TEXT,
  FEE_ESTIMATE_PHRASE,
  FILING_BEFORE_WORK_DISCLOSURE_COLLECTION,
  FILING_CONSENT_TEXT_COLLECTION,
  FILING_DISCLOSURE_CONSENT_COLLECTION,
  FILING_HANDOFF_REFUSAL_LOG_COLLECTION,
  FILING_USE_CONSENT_COLLECTION,
  FILING_VT_DECLARATION_COLLECTION,
  PARTNER_RECIPIENT_LEGAL_NAMES,
  assembleBeforeWorkDisclosureScreen,
  buildBeforeWorkDisclosureScreen,
  consentTextSha256,
  createPartnerSendStub,
  recordBeforeWorkDisclosureShown,
  recordPartnerVtDeclaration,
  runQueuedFilingHandOff,
  saveDisclosureConsent,
  saveUseConsent,
  sendFilingHandOff,
  type HandOffRequest,
  type HandOffReturn,
  type PartnerBeforeWorkCopy,
  type SaveDisclosureConsentInput,
  type SaveUseConsentInput,
} from '@/lib/filing-consent';
import { resetFilingConsentClock, setFilingConsentClock } from '@/lib/filing-consent/clock';

const db = adminDb as unknown as FakeFirestore;
const PARTNER = PARTNER_RECIPIENT_LEGAL_NAMES[0];
const SIGNED_AT = '2026-01-15T20:00:00.000Z';
const NOW = '2026-02-01T18:00:00.000Z';
const SHOWN_AT = '2026-03-04T16:30:00.000Z';
const DECLARED_AT = '2026-03-05T17:45:00.000Z';
const WAGES = 'WAGES-MARKER-5901';
const WARRANTY_MARKER = 'secure storage and transmission';

const fetchSpy = vi.spyOn(globalThis, 'fetch');

function at(iso: string): void {
  setFilingConsentClock(() => new Date(iso));
}

function federal(fields: Record<string, unknown> = { wages: 100 }): HandOffReturn {
  return { code: 'federal', taxYear: 2026, fields };
}

function vtReturn(fields: Record<string, unknown> = { wages: WAGES }): HandOffReturn {
  return { code: 'VT', taxYear: 2026, fields };
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

function makeUseInput(overrides: Partial<SaveUseConsentInput> = {}): SaveUseConsentInput {
  return {
    uid: 'user-1',
    taxYear: 2026,
    taxpayerName: 'Test Taxpayer',
    purpose: 'DRAFT: to use tax return information for the stated preparation purpose',
    returnsCovered: [{ code: 'federal', taxYear: 2026 }],
    scope: { kind: 'whole_return' },
    signatureMethod: 'typed_name',
    signatureValue: 'Test Taxpayer',
    userTypedNotPrefilled: true,
    kind: 'use',
    ...overrides,
  };
}

function handOff(recordId: string, overrides: Partial<HandOffRequest> = {}): HandOffRequest {
  return {
    signedInUid: 'user-1',
    taxYear: 2026,
    recipientLegalName: PARTNER,
    returns: [federal()],
    consentRecordId: recordId,
    ...overrides,
  };
}

function paths(collectionName: string): string[] {
  return [...db.records.keys()].filter(key => key.startsWith(`${collectionName}/`));
}

function logs(): Record<string, unknown>[] {
  return paths(FILING_HANDOFF_REFUSAL_LOG_COLLECTION).map(key => db.records.get(key) as Record<string, unknown>);
}

function readyToTransmitFlags(): unknown[] {
  return [...db.records.values()].filter(doc => doc.readyToTransmit === true);
}

async function saveValid(overrides: Partial<SaveDisclosureConsentInput> = {}) {
  at(SIGNED_AT);
  const saved = await saveDisclosureConsent(saveInput(overrides));
  at(NOW);
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw new Error('expected a stored disclosure consent');
  return saved;
}

function configuredCopy(): PartnerBeforeWorkCopy {
  return {
    partnerFirmLegalName: PARTNER,
    signingEaName: DRAFT_PARTNER_SIGNING_EA_NAME,
    signingEaPtin: DRAFT_PARTNER_SIGNING_EA_PTIN,
    principalBusinessAddress: DRAFT_PARTNER_PRINCIPAL_BUSINESS_ADDRESS,
    primaryBusinessPhone: DRAFT_PARTNER_PRIMARY_BUSINESS_PHONE,
    feeEstimateOfTotalCharge: DRAFT_PARTNER_FEE_ESTIMATE,
    securityWarranty: DRAFT_PARTNER_SECURITY_WARRANTY,
  };
}

async function plantScreen(state: 'CT' | 'CA', overrides: Record<string, unknown>) {
  const screen = buildBeforeWorkDisclosureScreen(state);
  if (!screen) throw new Error('expected a before work screen');
  const id = `${encodeURIComponent('user-1')}__2026__${state}`;
  await db.collection(FILING_BEFORE_WORK_DISCLOSURE_COLLECTION).doc(id).set({
    uid: 'user-1',
    taxYear: 2026,
    residentState: state,
    shownAt: SHOWN_AT,
    ...screen,
    ...overrides,
  });
}

beforeEach(async () => {
  resetFilingConsentClock();
  at(SIGNED_AT);
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

describe('separate use and disclosure records', () => {
  it('stores one use record and one disclosure record for each listed state, and rejects a record that holds both', async () => {
    const states = ['MA', 'VT', 'ID', 'HI', 'CT', 'CA'];
    for (const state of states) {
      const uid = `user-${state}`;
      const disclosure = await saveDisclosureConsent(saveInput({ uid }));
      const use = await saveUseConsent(makeUseInput({ uid }));
      expect(disclosure.ok).toBe(true);
      expect(use.ok).toBe(true);
      if (!disclosure.ok || !use.ok) throw new Error(`expected both records for ${state}`);
      expect(disclosure.record.kind).toBe('disclosure');
      expect(use.record.kind).toBe('use');
      expect(disclosure.record.signedAt).toBe(SIGNED_AT);
      expect(use.record.signedAt).toBe(SIGNED_AT);
      expect(use.record.consentTextVersion).toBe(CURRENT_USE_CONSENT_TEXT_VERSION);
      expect(use.record.consentTextSha256).toBe(consentTextSha256(DRAFT_USE_CONSENT_TEXT));
      expect(use.record.consentTextSha256).not.toBe(disclosure.record.consentTextSha256);
    }

    const disclosureDocs = paths(FILING_DISCLOSURE_CONSENT_COLLECTION);
    const useDocs = paths(FILING_USE_CONSENT_COLLECTION);
    expect(disclosureDocs).toHaveLength(states.length);
    expect(useDocs).toHaveLength(states.length);
    expect(disclosureDocs.some(key => useDocs.includes(key))).toBe(false);
    for (const key of disclosureDocs) expect(db.records.get(key)?.kind).toBe('disclosure');
    for (const key of useDocs) {
      const stored = db.records.get(key);
      expect(stored?.kind).toBe('use');
      expect(stored).not.toHaveProperty('recipients');
    }
    expect(paths(FILING_CONSENT_TEXT_COLLECTION)).toEqual([
      `${FILING_CONSENT_TEXT_COLLECTION}/${CURRENT_CONSENT_TEXT_VERSION}`,
      `${FILING_CONSENT_TEXT_COLLECTION}/${CURRENT_USE_CONSENT_TEXT_VERSION}`,
    ]);

    const before = db.records.size;
    const mixedUse = await saveUseConsent(makeUseInput({ coversDisclosure: true }));
    const mixedRecipients = await saveUseConsent({ ...makeUseInput(), recipients: [PARTNER] } as SaveUseConsentInput);
    const mixedKind = await saveUseConsent(makeUseInput({ kind: 'disclosure_and_use' }));
    const disclosureOnUseSaver = await saveUseConsent(makeUseInput({ kind: 'disclosure' }));
    const useOnDisclosureSaver = await saveDisclosureConsent(saveInput({ kind: 'use' }));
    const combinedDisclosure = await saveDisclosureConsent(saveInput({ coversUse: true }));
    for (const refused of [mixedUse, mixedRecipients, mixedKind, disclosureOnUseSaver, useOnDisclosureSaver, combinedDisclosure]) {
      expect(refused).toMatchObject({ ok: false, code: 'combined_use_and_disclosure' });
    }
    expect(db.records.size).toBe(before);
    expect(paths(FILING_DISCLOSURE_CONSENT_COLLECTION)).toHaveLength(states.length);
    expect(paths(FILING_USE_CONSENT_COLLECTION)).toHaveLength(states.length);
  });

  it('takes the use signing time from the clock and ignores a caller supplied time', async () => {
    at('2026-06-01T15:00:00.000Z');
    const save = saveUseConsent as (
      input: SaveUseConsentInput,
      supplied?: Date,
    ) => ReturnType<typeof saveUseConsent>;
    const saved = await save(
      { ...makeUseInput(), signedAt: '2020-01-01T00:00:00.000Z' } as SaveUseConsentInput,
      new Date('1999-01-01T00:00:00.000Z'),
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error('expected a stored use consent');
    expect(saved.record.signedAt).toBe('2026-06-01T15:00:00.000Z');
    const params = Function.prototype.toString.call(saveUseConsent).match(/^(?:async\s+)?function[^(]*\(([^)]*)\)/)?.[1] ?? '';
    expect(params).not.toMatch(/\bnow\b/);
    expect(params).not.toMatch(/\bsignedAt\b/);
  });
});

describe('before work disclosure screen', () => {
  it('builds a Connecticut and California screen from partner placeholders, including print and save', () => {
    expect(DRAFT_PARTNER_PRINCIPAL_BUSINESS_ADDRESS.startsWith('DRAFT placeholder:')).toBe(true);
    expect(DRAFT_PARTNER_PRIMARY_BUSINESS_PHONE.startsWith('DRAFT placeholder:')).toBe(true);
    expect(DRAFT_PARTNER_PRIMARY_BUSINESS_PHONE).not.toMatch(/\d/);
    expect(DRAFT_PARTNER_FEE_ESTIMATE.startsWith('DRAFT placeholder:')).toBe(true);
    expect(DRAFT_PARTNER_FEE_ESTIMATE).toContain(FEE_ESTIMATE_PHRASE);
    expect(DRAFT_PARTNER_SECURITY_WARRANTY.startsWith('DRAFT placeholder pending partner wording:')).toBe(true);
    expect(DRAFT_PARTNER_SIGNING_EA_NAME.startsWith('DRAFT placeholder:')).toBe(true);
    expect(DRAFT_PARTNER_SIGNING_EA_PTIN.startsWith('DRAFT placeholder:')).toBe(true);
    expect(PARTNER.startsWith('DRAFT:')).toBe(true);

    for (const state of ['CT', 'CA'] as const) {
      const screen = buildBeforeWorkDisclosureScreen(state);
      expect(screen).toEqual({
        residentState: state,
        partnerFirmLegalName: PARTNER,
        signingEaName: DRAFT_PARTNER_SIGNING_EA_NAME,
        signingEaPtin: DRAFT_PARTNER_SIGNING_EA_PTIN,
        principalBusinessAddress: DRAFT_PARTNER_PRINCIPAL_BUSINESS_ADDRESS,
        primaryBusinessPhone: DRAFT_PARTNER_PRIMARY_BUSINESS_PHONE,
        feeEstimateOfTotalCharge: DRAFT_PARTNER_FEE_ESTIMATE,
        securityWarranty: DRAFT_PARTNER_SECURITY_WARRANTY,
        printOffered: true,
        saveOffered: true,
      });
    }
    expect(buildBeforeWorkDisclosureScreen('NY')).toBeNull();
    expect(buildBeforeWorkDisclosureScreen('VT')).toBeNull();
  });

  it('returns no screen when address, phone, the fee estimate wording, the warranty, the name, or the PTIN is missing, and copies a partner warranty unchanged', () => {
    const complete = configuredCopy();
    expect(assembleBeforeWorkDisclosureScreen('CT', complete)?.securityWarranty).toBe(complete.securityWarranty);
    const blanks: Array<[keyof PartnerBeforeWorkCopy, string]> = [
      ['principalBusinessAddress', ''],
      ['primaryBusinessPhone', ''],
      ['feeEstimateOfTotalCharge', 'DRAFT placeholder: flat amount pending approval'],
      ['feeEstimateOfTotalCharge', ''],
      ['securityWarranty', ''],
      ['securityWarranty', 'DRAFT placeholder: a warranty rewritten outside the partner record'],
      ['signingEaName', ''],
      ['signingEaPtin', ''],
      ['partnerFirmLegalName', ''],
    ];
    for (const [field, value] of blanks) {
      const copy = { ...complete, [field]: value };
      if (field === 'securityWarranty' && value !== '') {
        expect(value).not.toBe(DRAFT_PARTNER_SECURITY_WARRANTY);
        expect(assembleBeforeWorkDisclosureScreen('CT', copy)?.securityWarranty).toBe(value);
        expect(assembleBeforeWorkDisclosureScreen('CA', copy)?.securityWarranty).toBe(value);
        continue;
      }
      expect(assembleBeforeWorkDisclosureScreen('CT', copy)).toBeNull();
      expect(assembleBeforeWorkDisclosureScreen('CA', copy)).toBeNull();
    }
    const rewrittenFee = 'DRAFT placeholder: an estimate of the total charge, rewritten outside partner config';
    expect(rewrittenFee).toContain(FEE_ESTIMATE_PHRASE);
    expect(assembleBeforeWorkDisclosureScreen('CT', { ...complete, feeEstimateOfTotalCharge: rewrittenFee })?.feeEstimateOfTotalCharge).toBe(rewrittenFee);
  });

  it('records the shown screen from the clock and keeps the first shown time', async () => {
    at(SHOWN_AT);
    const record = recordBeforeWorkDisclosureShown as (
      input: { uid: string; taxYear: number; residentState: string; shownAt?: string },
      supplied?: Date,
    ) => ReturnType<typeof recordBeforeWorkDisclosureShown>;
    const recorded = await record({ uid: 'user-1', taxYear: 2026, residentState: 'CT', shownAt: '1999-01-01T00:00:00.000Z' }, new Date('1999-01-01T00:00:00.000Z'));
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) throw new Error('expected a recorded screen');
    expect(recorded.shownAt).toBe(SHOWN_AT);
    expect(recorded.screen.securityWarranty).toBe(DRAFT_PARTNER_SECURITY_WARRANTY);
    expect(recorded.screen.printOffered).toBe(true);
    expect(recorded.screen.saveOffered).toBe(true);
    const stored = db.records.get(`${FILING_BEFORE_WORK_DISCLOSURE_COLLECTION}/${recorded.id}`);
    expect(stored).toMatchObject({
      shownAt: SHOWN_AT,
      principalBusinessAddress: DRAFT_PARTNER_PRINCIPAL_BUSINESS_ADDRESS,
      primaryBusinessPhone: DRAFT_PARTNER_PRIMARY_BUSINESS_PHONE,
      feeEstimateOfTotalCharge: DRAFT_PARTNER_FEE_ESTIMATE,
      securityWarranty: DRAFT_PARTNER_SECURITY_WARRANTY,
      printOffered: true,
      saveOffered: true,
    });
    at('2026-04-01T00:00:00.000Z');
    const again = await recordBeforeWorkDisclosureShown({ uid: 'user-1', taxYear: 2026, residentState: 'CT' });
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error('expected the original screen');
    expect(again.shownAt).toBe(SHOWN_AT);
    const params = Function.prototype.toString.call(recordBeforeWorkDisclosureShown).match(/^(?:async\s+)?function[^(]*\(([^)]*)\)/)?.[1] ?? '';
    expect(params).not.toMatch(/\bnow\b/);
    expect(params).not.toMatch(/\bsignedAt\b/);
  });

  it.each(['CT', 'CA'] as const)('refuses a %s hand off until the screen is recorded, then sends', async (state) => {
    const saved = await saveValid();
    const early = createPartnerSendStub();
    const blocked = await sendFilingHandOff(handOff(saved.id, { residentState: state }), early);
    expect(blocked).toMatchObject({ sent: false, code: 'before_work_disclosure_missing' });
    expect(early.deliveries).toEqual([]);

    at(SHOWN_AT);
    const recorded = await recordBeforeWorkDisclosureShown({ uid: 'user-1', taxYear: 2026, residentState: state });
    expect(recorded.ok).toBe(true);
    const queued = createPartnerSendStub();
    const sent = await runQueuedFilingHandOff({ request: handOff(saved.id, { residentState: state }) }, queued);
    expect(sent).toEqual({ sent: true });
    expect(queued.deliveries).toHaveLength(1);
  });

  it('does not let a Connecticut screen satisfy California, or a different tax year satisfy this year', async () => {
    const saved = await saveValid();
    at(SHOWN_AT);
    await recordBeforeWorkDisclosureShown({ uid: 'user-1', taxYear: 2026, residentState: 'CT' });
    await recordBeforeWorkDisclosureShown({ uid: 'user-1', taxYear: 2025, residentState: 'CA' });
    const california = createPartnerSendStub();
    const blocked = await sendFilingHandOff(handOff(saved.id, { residentState: 'CA' }), california);
    expect(blocked).toMatchObject({ sent: false, code: 'before_work_disclosure_missing' });
    expect(california.deliveries).toEqual([]);
  });

  it.each([
    ['principal business address', { principalBusinessAddress: '' }, 'principal business address'],
    ['primary business phone', { primaryBusinessPhone: '' }, 'primary business phone'],
    ['fee estimate wording', { feeEstimateOfTotalCharge: 'DRAFT placeholder: flat amount pending approval' }, 'estimate of the total charge'],
    ['rewritten fee', { feeEstimateOfTotalCharge: 'DRAFT placeholder: an estimate of the total charge, rewritten outside partner config' }, 'estimate of the total charge'],
    ['partner warranty', { securityWarranty: `${DRAFT_PARTNER_SECURITY_WARRANTY} extra` }, 'partner warranty'],
    ['signing name', { signingEaName: '' }, 'signing enrolled agent name'],
    ['signing PTIN', { signingEaPtin: '' }, 'PTIN'],
  ] as const)('refuses a Connecticut hand off when the recorded screen is missing the %s', async (_label, overrides, message) => {
    const saved = await saveValid();
    await plantScreen('CT', overrides);
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(saved.id, { residentState: 'CT' }), stub);
    expect(result).toMatchObject({ sent: false, code: 'before_work_disclosure_missing' });
    expect(result).toMatchObject({ message: expect.stringContaining(message) });
    expect(stub.deliveries).toEqual([]);
  });

  it.each([
    ['principal business address', { principalBusinessAddress: 'DRAFT placeholder: a different address' }],
    ['primary business phone', { primaryBusinessPhone: 'DRAFT placeholder: a different telephone number' }],
    ['partner warranty', { securityWarranty: 'DRAFT placeholder: warranty text written for the screen' }],
  ] as const)('refuses a California hand off when the %s is not the partner value', async (_label, overrides) => {
    const saved = await saveValid();
    await plantScreen('CA', overrides);
    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(saved.id, { residentState: 'CA' }), stub);
    expect(result).toMatchObject({ sent: false, code: 'before_work_disclosure_missing' });
    expect(stub.deliveries).toEqual([]);
  });

  it('refuses a recorded screen that does not offer print and save', async () => {
    const saved = await saveValid();
    await plantScreen('CT', { printOffered: false, saveOffered: true });
    const missingPrint = createPartnerSendStub();
    expect(await sendFilingHandOff(handOff(saved.id, { residentState: 'CT' }), missingPrint)).toMatchObject({
      sent: false,
      code: 'before_work_disclosure_missing',
    });
    expect(missingPrint.deliveries).toEqual([]);
    await plantScreen('CA', { printOffered: true, saveOffered: false });
    const missingSave = createPartnerSendStub();
    expect(await sendFilingHandOff(handOff(saved.id, { residentState: 'CA' }), missingSave)).toMatchObject({
      sent: false,
      code: 'before_work_disclosure_missing',
    });
    expect(missingSave.deliveries).toEqual([]);
  });

  it('does not block a resident outside Connecticut and California when no screen is recorded', async () => {
    const saved = await saveValid();
    for (const residentState of [undefined, 'NY', 'MA', 'VT']) {
      const stub = createPartnerSendStub();
      const result = await sendFilingHandOff(handOff(saved.id, { residentState }), stub);
      expect(result).toEqual({ sent: true });
      expect(stub.deliveries).toHaveLength(1);
    }
  });

  it('keeps the partner warranty sentence out of every filing consent file except partner config', () => {
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'lib', 'filing-consent');
    const hits = readdirSync(root)
      .filter(name => name.endsWith('.ts') && name !== 'config.ts')
      .filter(name => readFileSync(path.join(root, name), 'utf8').includes(WARRANTY_MARKER));
    expect(hits).toEqual([]);
    expect(DRAFT_PARTNER_SECURITY_WARRANTY).toContain(WARRANTY_MARKER);
  });

  it('records the California staffing condition separately from the before work screen', () => {
    expect(DRAFT_CA_STAFFING).toEqual({
      placeholder: true,
      everyCaReturnReviewedAndSignedByEnrolledAgent: true,
      nonEnrolledAgentWorkIsPartnerEmployeeOnly: true,
      contractorsOnCaReturns: false,
    });
    const screen = buildBeforeWorkDisclosureScreen('CA');
    expect(screen).not.toHaveProperty('contractorsOnCaReturns');
    expect(screen?.principalBusinessAddress).toBe(DRAFT_PARTNER_PRINCIPAL_BUSINESS_ADDRESS);
    expect(screen?.primaryBusinessPhone).toBe(DRAFT_PARTNER_PRIMARY_BUSINESS_PHONE);
  });
});

describe('Vermont preparer declaration', () => {
  async function saveVt() {
    return saveValid({
      purpose: 'DRAFT: to prepare and e-file your 2026 Vermont return',
      returnsCovered: [{ code: 'VT', taxYear: 2026 }, { code: 'federal', taxYear: 2026 }],
    });
  }

  it('blocks a Vermont user Vermont return until that return has a declaration with a date and a dated copy reference', async () => {
    const saved = await saveVt();
    const blocked = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(saved.id, {
      residentState: 'VT',
      returns: [vtReturn(), federal({ wages: WAGES })],
    }), blocked);
    expect(result).toMatchObject({
      sent: false,
      code: 'vt_declaration_missing',
      message: 'The Vermont return is blocked and is not ready to transmit until the partner declaration for that return is on record.',
    });
    expect(blocked.deliveries).toEqual([]);
    expect(readyToTransmitFlags()).toEqual([]);
    expect(logs()).toEqual([{
      uid: 'user-1',
      taxYear: 2026,
      returnCode: 'VT',
      reason: 'vt_declaration_missing',
    }]);
    expect(JSON.stringify(logs())).not.toContain(WAGES);
    expect(JSON.stringify(result)).not.toContain(WAGES);

    const queued = createPartnerSendStub();
    const queuedResult = await runQueuedFilingHandOff({
      request: handOff(saved.id, { residentState: 'VT', returns: [vtReturn()] }),
    }, queued);
    expect(queuedResult).toMatchObject({ sent: false, code: 'vt_declaration_missing' });
    expect(queued.deliveries).toEqual([]);
  });

  it('does not count a declaration for a different return or tax year', async () => {
    const saved = await saveVt();
    at(DECLARED_AT);
    const otherYear = await recordPartnerVtDeclaration({
      uid: 'user-1',
      taxYear: 2025,
      returnCode: 'VT',
      partnerLegalName: PARTNER,
      datedCopyReference: 'DRAFT-COPY-REF-2025',
    });
    expect(otherYear.ok).toBe(true);
    const yearStub = createPartnerSendStub();
    const yearResult = await sendFilingHandOff(handOff(saved.id, { residentState: 'VT', returns: [vtReturn()] }), yearStub);
    expect(yearResult).toMatchObject({ sent: false, code: 'vt_declaration_missing' });
    expect(yearStub.deliveries).toEqual([]);

    await db.collection(FILING_VT_DECLARATION_COLLECTION).doc(`${encodeURIComponent('user-1')}__2026__VT`).set({
      uid: 'user-1',
      taxYear: 2026,
      returnCode: 'federal',
      partnerLegalName: PARTNER,
      declaredAt: DECLARED_AT,
      datedCopyReference: 'DRAFT-COPY-REF-FEDERAL',
    });
    const returnStub = createPartnerSendStub();
    const returnResult = await sendFilingHandOff(handOff(saved.id, { residentState: 'VT', returns: [vtReturn()] }), returnStub);
    expect(returnResult).toMatchObject({ sent: false, code: 'vt_declaration_missing' });
    expect(returnStub.deliveries).toEqual([]);
    expect(JSON.stringify(logs())).not.toContain(WAGES);
  });

  it('does not count a declaration that lacks the date, the dated copy reference, or the configured partner', async () => {
    const saved = await saveVt();
    const id = `${encodeURIComponent('user-1')}__2026__VT`;
    const base = {
      uid: 'user-1',
      taxYear: 2026,
      returnCode: 'VT',
      partnerLegalName: PARTNER,
      declaredAt: DECLARED_AT,
      datedCopyReference: 'DRAFT-COPY-REF-1',
    };
    for (const overrides of [
      { declaredAt: '' },
      { datedCopyReference: '' },
      { datedCopyReference: '   ' },
      { partnerLegalName: 'DRAFT: some other partner pending approval' },
    ]) {
      await db.collection(FILING_VT_DECLARATION_COLLECTION).doc(id).set({ ...base, ...overrides });
      const stub = createPartnerSendStub();
      const result = await sendFilingHandOff(handOff(saved.id, { residentState: 'VT', returns: [vtReturn()] }), stub);
      expect(result).toMatchObject({ sent: false, code: 'vt_declaration_missing' });
      expect(stub.deliveries).toEqual([]);
    }
  });

  it('sends a Vermont return after the configured partner declaration is recorded from the clock', async () => {
    const saved = await saveVt();
    at(DECLARED_AT);
    const record = recordPartnerVtDeclaration as (
      input: {
        uid: string;
        taxYear: number;
        returnCode: string;
        partnerLegalName: string;
        datedCopyReference: string;
        declaredAt?: string;
      },
      supplied?: Date,
    ) => ReturnType<typeof recordPartnerVtDeclaration>;
    const recorded = await record({
      uid: 'user-1',
      taxYear: 2026,
      returnCode: 'VT',
      partnerLegalName: PARTNER,
      datedCopyReference: 'DRAFT-COPY-REF-1',
      declaredAt: '1999-01-01T00:00:00.000Z',
    }, new Date('1999-01-01T00:00:00.000Z'));
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) throw new Error('expected a declaration');
    expect(recorded.declaredAt).toBe(DECLARED_AT);
    const params = Function.prototype.toString.call(recordPartnerVtDeclaration).match(/^(?:async\s+)?function[^(]*\(([^)]*)\)/)?.[1] ?? '';
    expect(params).not.toMatch(/\bnow\b/);
    expect(params).not.toMatch(/\bsignedAt\b/);

    const stub = createPartnerSendStub();
    const result = await sendFilingHandOff(handOff(saved.id, {
      residentState: 'VT',
      returns: [vtReturn(), federal({ wages: WAGES })],
    }), stub);
    expect(result).toEqual({ sent: true });
    expect(stub.deliveries).toHaveLength(1);
    expect(logs()).toEqual([]);
    expect(readyToTransmitFlags()).toEqual([]);
  });

  it('does not block a non Vermont return for a Vermont user, or a Vermont return for someone who is not a Vermont user', async () => {
    const saved = await saveVt();
    const federalOnly = createPartnerSendStub();
    const federalResult = await sendFilingHandOff(handOff(saved.id, {
      residentState: 'VT',
      returns: [federal({ wages: WAGES })],
    }), federalOnly);
    expect(federalResult).toEqual({ sent: true });
    expect(federalOnly.deliveries).toHaveLength(1);
    expect(logs()).toEqual([]);

    const otherState = createPartnerSendStub();
    const otherResult = await sendFilingHandOff(handOff(saved.id, {
      residentState: 'NY',
      returns: [vtReturn()],
    }), otherState);
    expect(otherResult).toEqual({ sent: true });
    expect(otherState.deliveries).toHaveLength(1);
    expect(logs()).toEqual([]);
  });

  it('refuses to record a declaration for a return that is not Vermont, or without a dated copy reference', async () => {
    const before = paths(FILING_VT_DECLARATION_COLLECTION);
    const wrongReturn = await recordPartnerVtDeclaration({
      uid: 'user-1',
      taxYear: 2026,
      returnCode: 'federal',
      partnerLegalName: PARTNER,
      datedCopyReference: 'DRAFT-COPY-REF-1',
    });
    const missingCopy = await recordPartnerVtDeclaration({
      uid: 'user-1',
      taxYear: 2026,
      returnCode: 'VT',
      partnerLegalName: PARTNER,
      datedCopyReference: ' ',
    });
    expect(wrongReturn).toMatchObject({ ok: false, code: 'vt_declaration_missing' });
    expect(missingCopy).toMatchObject({ ok: false, code: 'vt_declaration_missing' });
    expect(paths(FILING_VT_DECLARATION_COLLECTION)).toEqual(before);
  });
});

describe('server only collections', () => {
  it('leaves the new collections out of the client rules file', () => {
    const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
    for (const name of [
      FILING_USE_CONSENT_COLLECTION,
      FILING_VT_DECLARATION_COLLECTION,
      FILING_BEFORE_WORK_DISCLOSURE_COLLECTION,
      FILING_HANDOFF_REFUSAL_LOG_COLLECTION,
    ]) {
      expect(rules.includes(name)).toBe(false);
    }
  });
});
