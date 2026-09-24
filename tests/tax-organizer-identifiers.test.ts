import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eligibilityOrganizer, hsaFacts } from './fixtures/eligibility';

// In-memory tax_organizers collection: the real route handlers run against it.
const state = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>(), sets: [] as Record<string, unknown>[], failSet: false }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'owner' }, error: null }) }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => {
  if (name !== 'tax_organizers') throw new Error(`unexpected collection ${name}`);
  const filters: [string, unknown][] = [];
  const doc = (id: string) => ({ id, data: () => ({ ...state.docs.get(id)! }), ref: { set: async (patch: Record<string, unknown>, options: { merge: boolean }) => {
    if (state.failSet) throw new Error('private write failure');
    state.sets.push(patch);
    state.docs.set(id, options.merge ? { ...state.docs.get(id), ...patch } : patch);
  } } });
  const query = {
    where(field: string, _op: string, value: unknown) { filters.push([field, value]); return query; },
    limit() { return query; },
    async get() {
      const ids = [...state.docs].filter(([, data]) => filters.every(([field, value]) => data[field] === value)).map(([id]) => id);
      return { empty: !ids.length, docs: ids.map(doc) };
    },
    async add(data: Record<string, unknown>) { const id = `org-${state.docs.size + 1}`; state.docs.set(id, data); return { id }; },
  };
  return query;
} } }));

import { GET, POST } from '../app/api/tax/organizer/route';
import { decryptSensitive, encryptSensitive, isEncrypted } from '../lib/security/utils';
import {
  DEPENDENT_IDENTIFIERS_REMOVED_WARNING, encryptOrganizerIdentifiers, legacyIdentifierPatch, maskOrganizerIdentifier,
  organizerIdentifierKind, readOrganizerIdentifiers,
} from '../lib/tax-organizer/identifiers';
import { REDACTED_ID, redactIdentifierText } from '../lib/security/identifier-redaction';
import { sanitizeExportValue } from '../lib/reports/data-export';

const IDENTIFIERS = { taxpayerSSN: '900000001', spouseSSN: '900000002', bankAccount: '000123456789', bankRouting: '071000013', ipPin: '123456', ein: '123456789' };
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/tax/organizer', { method: 'POST', body: JSON.stringify(body) }));
const get = (year = 2026) => GET(new NextRequest(`http://localhost/api/tax/organizer?year=${year}`));
const stored = () => [...state.docs.values()].find(doc => doc.taxYear === 2026 && doc.userId === 'owner')!;

beforeEach(() => { state.docs.clear(); state.sets.length = 0; state.failSet = false; });

describe('organizer identifier set', () => {
  it('covers every identifier answer and explicit dependent identifiers, but not yes/no eligibility answers', () => {
    for (const field of Object.keys(IDENTIFIERS)) expect(organizerIdentifierKind(field), field).not.toBeNull();
    expect(organizerIdentifierKind('dependentSSN')).toBe('ssn');
    expect(organizerIdentifierKind('dependent2ITIN')).toBe('ssn');
    for (const field of ['taxpayerSeniorSSN', 'spouseSeniorSSN', 'workEligibleSSN', 'dependents', 'dateOfBirth', 'spouseDoB']) expect(organizerIdentifierKind(field), field).toBeNull();
  });
  it('masks display values to their last digits and never prints an IP PIN', () => {
    expect(maskOrganizerIdentifier('ssn', '900000001')).toBe('***-**-0001');
    expect(maskOrganizerIdentifier('bankAccount', '000123456789')).toBe('****6789');
    expect(maskOrganizerIdentifier('bankRouting', '071000013')).toBe('*****0013');
    expect(maskOrganizerIdentifier('ein', '123456789')).toBe('**-***6789');
    expect(maskOrganizerIdentifier('ipPin', '123456')).toBe('Provided to preparer separately');
    expect(maskOrganizerIdentifier('ssn', '')).toBe(''); expect(maskOrganizerIdentifier('ssn', undefined)).toBe('');
  });
  it('rejects malformed identifiers with a field-specific message', () => {
    expect(encryptOrganizerIdentifiers({ ipPin: '12345' }, {})).toEqual({ error: 'Invalid IRS Identity Protection PIN' });
    expect(encryptOrganizerIdentifiers({ bankRouting: '12345678' }, {})).toEqual({ error: 'Invalid bank routing number' });
    expect(encryptOrganizerIdentifiers({ ein: '12-345678' }, {})).toEqual({ error: 'Invalid employer identification number' });
    expect(encryptOrganizerIdentifiers({ dependentSSN: 'yes' }, {})).toEqual({ error: 'Invalid Social Security number' });
    const normalized = encryptOrganizerIdentifiers({ ein: '12-3456789' }, {});
    expect('answers' in normalized && decryptSensitive(normalized.answers.ein)).toBe('123456789');
  });
});

describe('organizer route stores ciphertext and returns plaintext only to the owner', () => {
  it('round-trips structured eligibility only under the matching tax year', async () => {
    const answers = eligibilityOrganizer({ hsa: hsaFacts() });
    expect((await post({ taxYear: 2026, ...answers })).status).toBe(201);
    expect((await (await get()).json()).organizer.adjustmentEligibilityFacts).toBe(answers.adjustmentEligibilityFacts);
    const previous = stored();
    expect((await post({ taxYear: 2026, ...eligibilityOrganizer({ taxYear: 2025, hsa: hsaFacts() }) })).status).toBe(400);
    expect(stored()).toEqual(previous);
  });
  it.each(['not json', JSON.stringify({ version: 1, taxYear: 2026, hsa: { approved: true } }), JSON.stringify({ version: 1, taxYear: 2026, hsa: { months: [] } })])('rejects malformed eligibility before saving: %s', async adjustmentEligibilityFacts => {
    expect((await post({ taxYear: 2026, adjustmentEligibilityFacts })).status).toBe(400);
    expect(state.docs.size).toBe(0);
  });
  it.each(Object.entries(IDENTIFIERS))('round-trips %s through encryption', async (field, value) => {
    const saved = await post({ taxYear: 2026, [field]: value, filingStatus: 'single' });
    expect(saved.status).toBe(201);
    const record = stored();
    expect(record[field]).not.toBe(value);
    expect(isEncrypted(String(record[field]))).toBe(true);
    expect(decryptSensitive(String(record[field]))).toBe(value);
    expect(JSON.stringify(record)).not.toContain(value);
    const body = await (await get()).json();
    expect(body.organizer[field]).toBe(value);
    expect(body.organizer.filingStatus).toBe('single');
  });
  it('re-encrypts every legacy plaintext identifier when the owner reads the organizer, and keeps the read working if that write fails', async () => {
    state.docs.set('legacy', { userId: 'owner', taxYear: 2026, ...IDENTIFIERS, dependentDetails: 'Emma Shah, 123-45-6789, 2018-03-15, Daughter' });
    state.failSet = true;
    let body = await (await get()).json();
    expect(body.organizer).toMatchObject(IDENTIFIERS);
    expect(body.organizer.dependentDetails).toBe(`Emma Shah, ${REDACTED_ID}, 2018-03-15, Daughter`);
    expect(state.docs.get('legacy')!.taxpayerSSN).toBe(IDENTIFIERS.taxpayerSSN);
    state.failSet = false;
    body = await (await get()).json();
    expect(body.organizer).toMatchObject(IDENTIFIERS);
    const record = state.docs.get('legacy')!;
    for (const [field, value] of Object.entries(IDENTIFIERS)) {
      expect(isEncrypted(String(record[field])), field).toBe(true);
      expect(decryptSensitive(String(record[field]))).toBe(value);
    }
    expect(record.dependentDetails).toBe(`Emma Shah, ${REDACTED_ID}, 2018-03-15, Daughter`);
    expect(record.identifiersEncryptedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(record)).not.toMatch(/900000001|000123456789|071000013|123456|123-45-6789/);
    // A fully migrated document is not rewritten on later reads.
    state.sets.length = 0;
    await get();
    expect(state.sets).toHaveLength(0);
  });
  it('re-encrypts legacy plaintext on the next write, even when the client resends the same value', async () => {
    state.docs.set('legacy', { userId: 'owner', taxYear: 2026, ipPin: '123456', bankRouting: '071000013' });
    expect((await post({ taxYear: 2026, ipPin: '123456', bankRouting: '071000013' })).status).toBe(200);
    const record = state.docs.get('legacy')!;
    expect(isEncrypted(String(record.ipPin)) && isEncrypted(String(record.bankRouting))).toBe(true);
    expect(decryptSensitive(String(record.ipPin))).toBe('123456');
  });
  it('keeps an unchanged ciphertext from a stale tab instead of encrypting it twice', async () => {
    const ciphertext = encryptSensitive('900000001');
    state.docs.set('current', { userId: 'owner', taxYear: 2026, taxpayerSSN: ciphertext });
    expect((await post({ taxYear: 2026, taxpayerSSN: ciphertext })).status).toBe(200);
    expect(state.docs.get('current')!.taxpayerSSN).toBe(ciphertext);
  });
  it('removes identifier digits from dependent details before storing and tells the client what was saved', async () => {
    const response = await post({ taxYear: 2026, dependents: '2', dependentDetails: 'Emma Shah, 123-45-6789, 2018-03-15, Daughter\nLeo Shah, 987 65 4321, 2020-01-02, Son\nITIN 912-70-1234' });
    expect(response.status).toBe(201);
    const body = await response.json();
    const expected = `Emma Shah, ${REDACTED_ID}, 2018-03-15, Daughter\nLeo Shah, ${REDACTED_ID}, 2020-01-02, Son\nITIN ${REDACTED_ID}`;
    expect(body).toMatchObject({ success: true, warning: DEPENDENT_IDENTIFIERS_REMOVED_WARNING, redacted: { dependentDetails: expected } });
    expect(stored().dependentDetails).toBe(expected);
    expect(JSON.stringify(stored())).not.toMatch(/123-45-6789|987 65 4321|912-70-1234/);
    const clean = await post({ taxYear: 2026, dependentDetails: 'Emma Shah, 2018-03-15, Daughter' });
    expect(await clean.json()).toEqual({ success: true, id: expect.any(String) });
  });
  it('rejects an invalid identifier before writing anything', async () => {
    const response = await post({ taxYear: 2026, ipPin: '12', taxpayerSSN: '900000001' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Invalid IRS Identity Protection PIN');
    expect(state.docs.size).toBe(0);
  });
});

describe('identifier read/patch helpers', () => {
  it('reports legacy fields and builds a patch of ciphertext plus redacted text only', () => {
    const read = readOrganizerIdentifiers({ taxpayerSSN: encryptSensitive('900000001'), ipPin: '123456', dependentDetails: 'SSN 900-00-0003', filingStatus: 'single' });
    expect(read.organizer).toMatchObject({ taxpayerSSN: '900000001', ipPin: '123456', dependentDetails: `SSN ${REDACTED_ID}`, filingStatus: 'single' });
    expect(read.legacyPlaintextFields).toEqual(['ipPin']); expect(read.redactedTextFields).toEqual(['dependentDetails']);
    const patch = legacyIdentifierPatch(read);
    expect(Object.keys(patch).sort()).toEqual(['dependentDetails', 'ipPin']);
    expect(decryptSensitive(patch.ipPin)).toBe('123456'); expect(patch.dependentDetails).toBe(`SSN ${REDACTED_ID}`);
  });
  it('leaves amounts alone while redacting identifiers in dependent text', () => {
    const result = redactIdentifierText('Support paid $123,456,789 and 1,234.50; child SSN 123-45-6789; EIN 12-3456789; run 123456789; amount 123456789.00');
    expect(result.text).toBe(`Support paid $123,456,789 and 1,234.50; child SSN ${REDACTED_ID}; EIN ${REDACTED_ID}; run ${REDACTED_ID}; amount 123456789.00`);
    expect(result.count).toBe(3);
  });
});

describe('owner export archive never carries organizer identifiers', () => {
  it('drops identifier keys (ciphertext or legacy plaintext) and redacts dependent notes', () => {
    const exported = sanitizeExportValue({ id: 'org', taxYear: 2026, ...IDENTIFIERS, taxpayerSSN: encryptSensitive('900000001'), identifiersEncryptedAt: new Date(),
      dependentDetails: 'Emma Shah, 123-45-6789, 2018-03-15, Daughter', employerEIN: '12-3456789', filingStatus: 'single' }) as Record<string, unknown>;
    expect(Object.keys(exported).sort()).toEqual(['dependentDetails', 'employerEIN', 'filingStatus', 'id', 'taxYear']);
    expect(exported.dependentDetails).toBe(`Emma Shah, ${REDACTED_ID}, 2018-03-15, Daughter`);
    expect(JSON.stringify(exported)).not.toMatch(/900000001|000123456789|071000013|123456\b|123-45-6789/);
  });
});
