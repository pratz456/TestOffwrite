import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eligibilityOrganizer, hsaFacts } from './fixtures/eligibility';

// In-memory tax_organizers collection: the real route handlers run against it.
const state = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>(), sets: [] as Record<string, unknown>[], merges: [] as boolean[], failSet: false }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'owner' }, error: null }) }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => {
  if (name !== 'tax_organizers') throw new Error(`unexpected collection ${name}`);
  const filters: [string, unknown][] = [];
  const doc = (id: string) => ({ id, data: () => ({ ...state.docs.get(id)! }), ref: { set: async (patch: Record<string, unknown>, options: { merge: boolean }) => {
    if (state.failSet) throw new Error('private write failure');
    state.sets.push(patch);
    state.merges.push(options?.merge === true);
    state.docs.set(id, options?.merge ? { ...state.docs.get(id), ...patch } : patch);
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
  encryptOrganizerIdentifiers, legacyIdentifierPatch, MASKED_NUMBER_EDIT_ERROR, maskOrganizerIdentifier,
  organizerIdentifierKind, readOrganizerIdentifiers,
} from '../lib/tax-organizer/identifiers';
import { REDACTED_ID, redactIdentifierText } from '../lib/security/identifier-redaction';
import { sanitizeExportValue } from '../lib/reports/data-export';

const IDENTIFIERS = { taxpayerSSN: '900000001', spouseSSN: '900000002', bankAccount: '000123456789', bankRouting: '071000013', ipPin: '123456', ein: '123456789' };
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/tax/organizer', { method: 'POST', body: JSON.stringify(body) }));
const get = (year = 2026) => GET(new NextRequest(`http://localhost/api/tax/organizer?year=${year}`));
const stored = () => [...state.docs.values()].find(doc => doc.taxYear === 2026 && doc.userId === 'owner')!;

beforeEach(() => { state.docs.clear(); state.sets.length = 0; state.merges.length = 0; state.failSet = false; });

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

const RETIRED = ['taxpayerSSN', 'spouseSSN', 'dependentSSN', 'ipPin', 'bankRouting', 'bankAccount'] as const;
const SSN_SHAPED = /\d{3}-?\d{2}-?\d{4}/;

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
  it('does not persist retired identifier fields, and returns EIN masked', async () => {
    const saved = await post({ taxYear: 2026, ...IDENTIFIERS, dependentSSN: '900000003', filingStatus: 'single' });
    expect(saved.status).toBe(201);
    const record = stored();
    for (const field of RETIRED) expect(record[field], field).toBeUndefined();
    expect(isEncrypted(String(record.ein))).toBe(true);
    expect(decryptSensitive(String(record.ein))).toBe('123456789');
    expect(JSON.stringify(record)).not.toMatch(/900000001|900000003|000123456789|071000013|123456789/);
    const body = await (await get()).json();
    expect(body.organizer.ein).toBe('**-***6789');
    expect(body.organizer.filingStatus).toBe('single');
    for (const field of RETIRED) expect(body.organizer[field], field).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(SSN_SHAPED);
  });
  it('leaves stored identifier fields byte-for-byte unchanged when the form payload omits them', async () => {
    const seeded = {
      userId: 'owner', taxYear: 2026, filingStatus: 'single',
      taxpayerSSN: encryptSensitive('900000001'),
      spouseSSN: encryptSensitive('900000002'),
      dependentSSN: encryptSensitive('900000003'),
      ipPin: encryptSensitive('123456'),
      bankRouting: encryptSensitive('071000013'),
      bankAccount: encryptSensitive('000123456789'),
    };
    state.docs.set('existing', { ...seeded });
    const before = { ...state.docs.get('existing')! };
    const response = await post({
      taxYear: 2026, filingStatus: 'married_filing_jointly', spouseName: 'Synthetic Spouse', dependents: '1',
      dependentDetails: 'Emma Shah, 2018-03-15, Daughter', streetAddress: '1 Main St', city: 'Austin', stateAddr: 'TX',
      zipCode: '78701', priorYearAGI: '50000', bankAccountType: 'checking',
    });
    expect(response.status).toBe(200);
    expect(state.merges).toEqual([true]);
    const after = state.docs.get('existing')!;
    for (const field of RETIRED) expect(after[field], field).toBe(before[field]);
    expect(state.sets[0]).not.toHaveProperty('taxpayerSSN');
    expect(state.sets[0]).not.toHaveProperty('spouseSSN');
    expect(state.sets[0]).not.toHaveProperty('dependentSSN');
    expect(state.sets[0]).not.toHaveProperty('ipPin');
    expect(state.sets[0]).not.toHaveProperty('bankRouting');
    expect(state.sets[0]).not.toHaveProperty('bankAccount');
    expect(after.filingStatus).toBe('married_filing_jointly');
    expect(after.spouseName).toBe('Synthetic Spouse');
  });
  it('does not overwrite stored identifier fields when a client still sends them', async () => {
    const ciphertext = encryptSensitive('900000001');
    state.docs.set('current', { userId: 'owner', taxYear: 2026, taxpayerSSN: ciphertext, ipPin: '123456', bankRouting: '071000013', filingStatus: 'single' });
    expect((await post({ taxYear: 2026, taxpayerSSN: ciphertext, ipPin: '654321', bankRouting: '021000021', filingStatus: 'head_of_household' })).status).toBe(200);
    const record = state.docs.get('current')!;
    expect(record.taxpayerSSN).toBe(ciphertext);
    expect(record.ipPin).toBe('123456');
    expect(record.bankRouting).toBe('071000013');
    expect(record.filingStatus).toBe('head_of_household');
    expect(state.merges).toEqual([true]);
  });
  it('masks a legacy record on read and does not write', async () => {
    const before = { userId: 'owner', taxYear: 2026, ...IDENTIFIERS, dependentDetails: 'Emma Shah, 123-45-6789, 2018-03-15, Daughter' };
    state.docs.set('legacy', { ...before });
    const body = await (await get()).json();
    expect(body.organizer).toMatchObject({
      taxpayerSSN: '***-**-0001', spouseSSN: '***-**-0002', bankAccount: '****6789', bankRouting: '*****0013',
      ipPin: 'Provided to preparer separately', ein: '**-***6789',
    });
    expect(body.organizer.dependentDetails).toBe('Emma Shah, ***-**-6789, 2018-03-15, Daughter');
    expect(JSON.stringify(body)).not.toMatch(SSN_SHAPED);
    expect(state.sets).toEqual([]);
    expect(state.docs.get('legacy')).toEqual(before);
  });
  it('leaves a phone, a ZIP+4 and a longer reference number unchanged on read', async () => {
    const details = 'Call 555-123-4567 or 5551234567, ZIP 12345-6789, ref 123456789012, note 123-456789';
    state.docs.set('dashed', { userId: 'owner', taxYear: 2026, taxpayerSSN: '900-00-0001', spouseName: 'Pat 900000001', dependentDetails: details });
    const body = await (await get()).json();
    expect(body.organizer.taxpayerSSN).toBe('***-**-0001');
    expect(body.organizer.spouseName).toBe('Pat ***-**-0001');
    expect(body.organizer.dependentDetails).toBe(details);
    expect(state.sets).toEqual([]);
  });
  it('stores free text as typed, masks it on read, and does not overwrite it when the masked text is saved back', async () => {
    const original = 'Emma Shah, 123-45-6789, 2018-03-15, Daughter';
    const saved = await post({ taxYear: 2026, dependentDetails: original });
    expect(saved.status).toBe(201);
    expect(stored().dependentDetails).toBe(original);
    const viewed = await (await get()).json();
    expect(viewed.organizer.dependentDetails).toBe('Emma Shah, ***-**-6789, 2018-03-15, Daughter');
    expect(JSON.stringify(viewed)).not.toMatch(SSN_SHAPED);
    expect(state.sets).toEqual([]);
    expect(stored().dependentDetails).toBe(original);
    const echoed = await post({ taxYear: 2026, dependentDetails: viewed.organizer.dependentDetails });
    expect(echoed.status).toBe(200);
    expect(state.sets).toEqual([]);
    expect(stored().dependentDetails).toBe(original);
    const edited = 'Emma Shah, 2018-03-15, Daughter, lives with taxpayer';
    expect((await post({ taxYear: 2026, dependentDetails: edited })).status).toBe(200);
    expect(stored().dependentDetails).toBe(edited);
  });
  it('masks a standalone 9-digit order number on read and stores it unchanged after the masked text is saved again', async () => {
    // Known limit: the order number is masked on GET. Token restore puts the stored digits back.
    const original = 'Order 123456789';
    expect((await post({ taxYear: 2026, dependentDetails: original })).status).toBe(201);
    expect(stored().dependentDetails).toBe(original);
    const viewed = await (await get()).json();
    expect(viewed.organizer.dependentDetails).toBe('Order ***-**-6789');
    expect(viewed.organizer.dependentDetails).not.toContain('123456789');
    const resaved = await post({ taxYear: 2026, dependentDetails: viewed.organizer.dependentDetails });
    expect(resaved.status).toBe(200);
    expect(state.sets).toEqual([]);
    expect(stored().dependentDetails).toBe(original);
  });
  it('restores the stored digits when text around a masked token is edited', async () => {
    const original = 'Emma, SSN 123-45-6789';
    expect((await post({ taxYear: 2026, dependentDetails: original })).status).toBe(201);
    const viewed = await (await get()).json();
    expect(viewed.organizer.dependentDetails).toBe('Emma, SSN ***-**-6789');
    const edited = String(viewed.organizer.dependentDetails).replace('Emma', 'Maya');
    expect((await post({ taxYear: 2026, dependentDetails: edited })).status).toBe(200);
    expect(stored().dependentDetails).toBe('Maya, SSN 123-45-6789');
  });
  it('restores two masked tokens that have different last 4 digits', async () => {
    const original = 'Child 111-22-3333 and spouse 444-55-6666';
    expect((await post({ taxYear: 2026, dependentDetails: original })).status).toBe(201);
    const viewed = await (await get()).json();
    expect(viewed.organizer.dependentDetails).toBe('Child ***-**-3333 and spouse ***-**-6666');
    const edited = `${viewed.organizer.dependentDetails} are in school`;
    expect((await post({ taxYear: 2026, dependentDetails: edited })).status).toBe(200);
    expect(stored().dependentDetails).toBe('Child 111-22-3333 and spouse 444-55-6666 are in school');
  });
  it('rejects a masked token whose digits changed, or an ambiguous match, and writes nothing', async () => {
    const original = 'Emma, SSN 123-45-6789';
    state.docs.set('notes', { userId: 'owner', taxYear: 2026, dependentDetails: original, filingStatus: 'single' });
    const changed = await post({ taxYear: 2026, dependentDetails: 'Emma, SSN ***-**-9999' });
    expect(changed.status).toBe(400);
    expect(await changed.json()).toEqual({ error: MASKED_NUMBER_EDIT_ERROR });
    expect(state.sets).toEqual([]);
    expect(stored().dependentDetails).toBe(original);
    expect(stored().filingStatus).toBe('single');

    state.docs.set('notes', { userId: 'owner', taxYear: 2026, dependentDetails: '111-22-6789 and 333-44-6789', filingStatus: 'single' });
    const viewed = await (await get()).json();
    expect(viewed.organizer.dependentDetails).toBe('***-**-6789 and ***-**-6789');
    const ambiguous = await post({ taxYear: 2026, dependentDetails: viewed.organizer.dependentDetails, filingStatus: 'single' });
    expect(ambiguous.status).toBe(400);
    expect(await ambiguous.json()).toEqual({ error: MASKED_NUMBER_EDIT_ERROR });
    expect(state.sets).toEqual([]);
    expect(stored().dependentDetails).toBe('111-22-6789 and 333-44-6789');
    expect(stored().filingStatus).toBe('single');
  });
  it('ignores a retired identifier instead of rejecting the rest of the save', async () => {
    const response = await post({ taxYear: 2026, ipPin: '12', taxpayerSSN: '900000001', filingStatus: 'single' });
    expect(response.status).toBe(201);
    expect(stored().ipPin).toBeUndefined();
    expect(stored().taxpayerSSN).toBeUndefined();
    expect(stored().filingStatus).toBe('single');
  });
  it('keeps a stored EIN when the save sends its masked or last-4 form, and stores a new full EIN', async () => {
    const original = encryptSensitive('123456789');
    const taxpayerSSN = encryptSensitive('900000001');
    state.docs.set('ein-row', { userId: 'owner', taxYear: 2026, ein: original, taxpayerSSN, filingStatus: 'single' });
    const masked = await post({ taxYear: 2026, ein: '**-***6789', taxpayerSSN: '***-**-0001', filingStatus: 'single' });
    expect(masked.status).toBe(200);
    expect(state.sets).toEqual([]);
    expect(stored().ein).toBe(original);
    expect(stored().taxpayerSSN).toBe(taxpayerSSN);
    const last4 = await post({ taxYear: 2026, ein: '6789', filingStatus: 'single' });
    expect(last4.status).toBe(200);
    expect(stored().ein).toBe(original);
    const created = await post({ taxYear: 2026, ein: '98-7654321', filingStatus: 'single' });
    expect(created.status).toBe(200);
    expect(decryptSensitive(String(stored().ein))).toBe('987654321');
    expect(stored().ein).not.toBe(original);
  });
  it('still rejects an invalid EIN before writing', async () => {
    const response = await post({ taxYear: 2026, ein: '12-345678', filingStatus: 'single' });
    expect(response.status).toBe(400);
    expect(state.docs.size).toBe(0);
  });
});

describe('identifier read/patch helpers', () => {
  it('reports legacy fields and builds a patch of ciphertext plus redacted text only', () => {
    const read = readOrganizerIdentifiers({ taxpayerSSN: encryptSensitive('900000001'), ipPin: '123456', dependentDetails: 'SSN 900-00-0003', filingStatus: 'single' });
    expect(read.organizer).toMatchObject({ taxpayerSSN: '900000001', ipPin: '123456', dependentDetails: 'SSN 900-00-0003', filingStatus: 'single' });
    expect(read.legacyPlaintextFields).toEqual(['ipPin']); expect(read.redactedTextFields).toEqual([]);
    const patch = legacyIdentifierPatch(read);
    expect(Object.keys(patch)).toEqual(['ipPin']);
    expect(decryptSensitive(patch.ipPin)).toBe('123456');
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
