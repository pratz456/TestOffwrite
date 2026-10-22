import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eligibilityOrganizer, hsaFacts } from './fixtures/eligibility';

// In-memory tax_organizers collection: the real route handlers run against it.
const state = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>(), sets: [] as Record<string, unknown>[], merges: [] as boolean[], failSet: false, setCalls: 0 }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'owner' }, error: null }) }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => {
  if (name !== 'tax_organizers') throw new Error(`unexpected collection ${name}`);
  const filters: [string, unknown][] = [];
  const doc = (id: string) => ({ id, data: () => ({ ...state.docs.get(id)! }),     ref: { set: async (patch: Record<string, unknown>, options: { merge: boolean }) => {
    state.setCalls += 1;
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
import { organizerTaxInputValues } from '../lib/tax-rules/organizer-tax-inputs';
import { decryptSensitive, encryptSensitive, isEncrypted } from '../lib/security/utils';
import {
  encryptOrganizerIdentifiers, MASKED_NUMBER_EDIT_ERROR, maskOrganizerIdentifier,
  organizerIdentifierKind, readOrganizerIdentifiers, SSN_NOT_ACCEPTED_ERROR,
} from '../lib/tax-organizer/identifiers';

const IDENTIFIERS = { taxpayerSSN: '900000001', spouseSSN: '900000002', bankAccount: '000123456789', bankRouting: '071000013', ipPin: '123456', ein: '123456789' };
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/tax/organizer', { method: 'POST', body: JSON.stringify(body) }));
const get = (year = 2026) => GET(new NextRequest(`http://localhost/api/tax/organizer?year=${year}`));
const stored = () => [...state.docs.values()].find(doc => doc.taxYear === 2026 && doc.userId === 'owner')!;

beforeEach(() => { state.docs.clear(); state.sets.length = 0; state.merges.length = 0; state.failSet = false; state.setCalls = 0; });

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
    expect(isEncrypted(String(record.ipPin))).toBe(true);
    expect(decryptSensitive(String(record.ipPin))).toBe('123456');
    expect(record.ipPin).not.toBe('654321');
    expect(isEncrypted(String(record.bankRouting))).toBe(true);
    expect(decryptSensitive(String(record.bankRouting))).toBe('071000013');
    expect(record.bankRouting).not.toBe('021000021');
    expect(record.filingStatus).toBe('head_of_household');
    expect(state.merges).toEqual([true]);
  });
  it('masks a legacy record on read and leaves notes and retired fields unchanged', async () => {
    const before = { userId: 'owner', taxYear: 2026, ...IDENTIFIERS, dependentDetails: 'Emma Shah, 123-45-6789, 2018-03-15, Daughter' };
    state.docs.set('legacy', { ...before });
    const body = await (await get()).json();
    expect(body.organizer).toMatchObject({
      taxpayerSSN: '***-**-0001', spouseSSN: '***-**-0002', bankAccount: '****6789', bankRouting: '*****0013',
      ipPin: 'Provided to preparer separately', ein: '**-***6789',
    });
    expect(body.organizer.dependentDetails).toBe('Emma Shah, ***-**-6789, 2018-03-15, Daughter');
    expect(JSON.stringify(body)).not.toMatch(SSN_SHAPED);
    expect(Object.keys(state.sets[0]).sort()).toEqual([...Object.keys(IDENTIFIERS), 'identifiersEncryptedAt'].sort());
    const record = state.docs.get('legacy')!;
    for (const field of Object.keys(IDENTIFIERS)) {
      expect(record[field], field).not.toBe(before[field]);
      expect(isEncrypted(String(record[field])), field).toBe(true);
    }
    expect(record.dependentDetails).toBe(before.dependentDetails);
  });
  it('reading stores only the identifier in the current format', async () => {
    const raw = '123456789';
    state.docs.set('legacy', {
      userId: 'owner', taxYear: 2026, ein: raw, filingStatus: 'single', spouseName: 'Pat',
      taxpayerSSN: '900000001', dependentDetails: 'Emma Shah, 123-45-6789, Daughter',
    });
    const body = await (await get()).json();
    expect(body.organizer.ein).toBe('**-***6789');
    expect(state.merges).toEqual([true]);
    expect(Object.keys(state.sets[0]).sort()).toEqual(['ein', 'identifiersEncryptedAt', 'taxpayerSSN']);
    const record = state.docs.get('legacy')!;
    expect(record.ein).not.toBe(raw);
    expect(isEncrypted(String(record.ein))).toBe(true);
    expect(decryptSensitive(String(record.ein))).toBe(raw);
    expect(record.identifiersEncryptedAt).toBeInstanceOf(Date);
  });
  it('a read patch omits other answers and notes', async () => {
    const note = 'Emma Shah, 123-45-6789, Daughter';
    state.docs.set('legacy', {
      userId: 'owner', taxYear: 2026, ein: '123456789', filingStatus: 'single', spouseName: 'Pat',
      taxpayerSSN: '900000001', ipPin: '123456', dependentDetails: note,
    });
    await get();
    const patch = state.sets[0];
    for (const field of ['filingStatus', 'spouseName', 'dependentDetails']) {
      expect(patch, field).not.toHaveProperty(field);
    }
    expect(isEncrypted(String(patch.taxpayerSSN))).toBe(true);
    expect(isEncrypted(String(patch.ipPin))).toBe(true);
    const record = state.docs.get('legacy')!;
    expect(record.filingStatus).toBe('single');
    expect(record.spouseName).toBe('Pat');
    expect(decryptSensitive(String(record.taxpayerSSN))).toBe('900000001');
    expect(decryptSensitive(String(record.ipPin))).toBe('123456');
    expect(record.dependentDetails).toBe(note);
  });
  it('a failed format write still returns the masked read', async () => {
    state.docs.set('legacy', { userId: 'owner', taxYear: 2026, ein: '123456789', filingStatus: 'single', dependentDetails: 'note' });
    state.failSet = true;
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).organizer.ein).toBe('**-***6789');
    expect(state.docs.get('legacy')!.ein).toBe('123456789');
    expect(state.sets).toEqual([]);
    expect(state.setCalls).toBe(1);
  });
  it('a save stores an older identifier in the current format', async () => {
    const note = 'Emma Shah, 123-45-6789, Daughter';
    state.docs.set('legacy', {
      userId: 'owner', taxYear: 2026, ein: '123456789', taxpayerSSN: '900000001', dependentDetails: note, filingStatus: 'single',
    });
    expect((await post({ taxYear: 2026, spouseName: 'Ada' })).status).toBe(200);
    const record = state.docs.get('legacy')!;
    expect(record.ein).not.toBe('123456789');
    expect(isEncrypted(String(record.ein))).toBe(true);
    expect(decryptSensitive(String(record.ein))).toBe('123456789');
    expect(isEncrypted(String(record.taxpayerSSN))).toBe(true);
    expect(decryptSensitive(String(record.taxpayerSSN))).toBe('900000001');
    expect(record.dependentDetails).toBe(note);
    expect(record.spouseName).toBe('Ada');
    expect(state.merges).toEqual([true]);
  });
  it('an identifier already in the current format causes zero writes', async () => {
    const ein = encryptSensitive('123456789');
    const before = {
      userId: 'owner', taxYear: 2026, ein, identifiersEncryptedAt: new Date('2026-01-01T00:00:00.000Z'),
      taxpayerSSN: encryptSensitive('900000001'), dependentDetails: 'note 123-45-6789', filingStatus: 'single',
    };
    state.docs.set('ready', { ...before });
    const body = await (await get()).json();
    expect(body.organizer.ein).toBe('**-***6789');
    expect(state.sets).toEqual([]);
    expect(state.setCalls).toBe(0);
    expect(state.docs.get('ready')).toEqual(before);
  });
  it('a read stores every identifier field in the current format', async () => {
    const fields = {
      taxpayerSSN: '900000001', spouseSSN: '900000002', dependentSSN: '900000003', dependent2ITIN: '900000004',
      bankAccount: '000123456789', bankRouting: '071000013', ipPin: '123456', ein: '123456789',
    };
    state.docs.set('all', { userId: 'owner', taxYear: 2026, filingStatus: 'single', dependentDetails: 'Emma Shah, Daughter', ...fields });
    const body = await (await get()).json();
    expect(body.organizer).toMatchObject({
      taxpayerSSN: '***-**-0001', spouseSSN: '***-**-0002', dependentSSN: '***-**-0003', dependent2ITIN: '***-**-0004',
      bankAccount: '****6789', bankRouting: '*****0013', ipPin: 'Provided to preparer separately', ein: '**-***6789',
    });
    expect(body.organizer.dependentDetails).toBe('Emma Shah, Daughter');
    const patch = state.sets[0];
    expect(Object.keys(patch).sort()).toEqual([...Object.keys(fields), 'identifiersEncryptedAt'].sort());
    for (const [field, value] of Object.entries(fields)) {
      expect(isEncrypted(String(patch[field])), field).toBe(true);
      expect(decryptSensitive(String(patch[field])), field).toBe(value);
    }
    expect(state.merges).toEqual([true]);
    expect(state.docs.get('all')!.dependentDetails).toBe('Emma Shah, Daughter');
    expect(state.docs.get('all')!.filingStatus).toBe('single');
  });
  it('stores an identifier value with the wrong length in the current format', async () => {
    state.docs.set('short', { userId: 'owner', taxYear: 2026, taxpayerSSN: '12345678' });
    const body = await (await get()).json();
    const storedValue = String(state.docs.get('short')!.taxpayerSSN);
    expect(isEncrypted(storedValue)).toBe(true);
    expect(decryptSensitive(storedValue)).toBe('12345678');
    expect(body.organizer.taxpayerSSN).toBe('***-**-5678');
  });
  it('a read writes only identifier fields that are not already in the current format', async () => {
    const taxpayerSSN = encryptSensitive('900000001');
    state.docs.set('mixed', {
      userId: 'owner', taxYear: 2026, taxpayerSSN, spouseSSN: '900000002', ein: '123456789', filingStatus: 'single', dependentDetails: 'note',
    });
    await get();
    const patch = state.sets[0];
    expect(Object.keys(patch).sort()).toEqual(['ein', 'identifiersEncryptedAt', 'spouseSSN']);
    expect(patch).not.toHaveProperty('taxpayerSSN');
    expect(patch).not.toHaveProperty('filingStatus');
    expect(patch).not.toHaveProperty('dependentDetails');
    expect(isEncrypted(String(patch.spouseSSN))).toBe(true);
    expect(decryptSensitive(String(patch.spouseSSN))).toBe('900000002');
    expect(state.docs.get('mixed')!.taxpayerSSN).toBe(taxpayerSSN);
    expect(state.docs.get('mixed')!.dependentDetails).toBe('note');
  });
  it('a save stores a retired identifier the client did not send', async () => {
    state.docs.set('save', { userId: 'owner', taxYear: 2026, taxpayerSSN: '900000001', filingStatus: 'single', dependentDetails: 'note' });
    expect((await post({ taxYear: 2026, spouseName: 'Ada' })).status).toBe(200);
    const record = state.docs.get('save')!;
    expect(isEncrypted(String(record.taxpayerSSN))).toBe(true);
    expect(decryptSensitive(String(record.taxpayerSSN))).toBe('900000001');
    expect(record.spouseName).toBe('Ada');
    expect(record.dependentDetails).toBe('note');
    expect(record.filingStatus).toBe('single');
  });
  it('leaves a phone, a ZIP+4 and a longer reference number unchanged on read', async () => {
    const details = 'Call 555-123-4567 or 5551234567, ZIP 12345-6789, ref 123456789012, note 123-456789';
    state.docs.set('dashed', { userId: 'owner', taxYear: 2026, taxpayerSSN: '900-00-0001', spouseName: 'Pat 900000001', dependentDetails: details });
    const body = await (await get()).json();
    expect(body.organizer.taxpayerSSN).toBe('***-**-0001');
    expect(body.organizer.spouseName).toBe('Pat ***-**-0001');
    expect(body.organizer.dependentDetails).toBe(details);
    expect(Object.keys(state.sets[0]).sort()).toEqual(['identifiersEncryptedAt', 'taxpayerSSN']);
    expect(decryptSensitive(String(state.docs.get('dashed')!.taxpayerSSN))).toBe('900000001');
    expect(state.docs.get('dashed')!.spouseName).toBe('Pat 900000001');
    expect(state.docs.get('dashed')!.dependentDetails).toBe(details);
  });
  it('stores free text as typed, masks it on read, and does not overwrite it when the masked text is saved back', async () => {
    const original = 'Emma Shah, 123-45-6789, 2018-03-15, Daughter';
    state.docs.set('notes', { userId: 'owner', taxYear: 2026, dependentDetails: original });
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
    state.docs.set('word', { userId: 'owner', taxYear: 2026, dependentDetails: original });
    const viewed = await (await get()).json();
    expect(viewed.organizer.dependentDetails).toBe('Emma, SSN ***-**-6789');
    const edited = String(viewed.organizer.dependentDetails).replace('Emma', 'Maya');
    expect((await post({ taxYear: 2026, dependentDetails: edited })).status).toBe(200);
    expect(stored().dependentDetails).toBe('Maya, SSN 123-45-6789');
  });
  it('restores two masked tokens that have different last 4 digits', async () => {
    const original = 'Child 111-22-3333 and spouse 444-55-6666';
    state.docs.set('two', { userId: 'owner', taxYear: 2026, dependentDetails: original });
    const viewed = await (await get()).json();
    expect(viewed.organizer.dependentDetails).toBe('Child ***-**-3333 and spouse ***-**-6666');
    const edited = `${viewed.organizer.dependentDetails} are in school`;
    expect((await post({ taxYear: 2026, dependentDetails: edited })).status).toBe(200);
    expect(stored().dependentDetails).toBe('Child 111-22-3333 and spouse 444-55-6666 are in school');
  });
  it('rejects a new separated number on create and writes nothing', async () => {
    for (const note of ['Child 123-45-6789 lives here', 'Child 123 45 6789 lives here']) {
      state.docs.clear(); state.sets.length = 0;
      const response = await post({ taxYear: 2026, dependentDetails: note, filingStatus: 'single', spouseName: 'Pat' });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: `Dependent details: ${SSN_NOT_ACCEPTED_ERROR}` });
      expect(state.docs.size).toBe(0);
      expect(state.sets).toEqual([]);
    }
  });
  it('rejects an update that adds a separated number and leaves every stored key byte-identical', async () => {
    const original = 'The child lives here. SSN 900-00-1111.';
    state.docs.set('kept', { userId: 'owner', taxYear: 2026, dependentDetails: original, filingStatus: 'single', spouseName: 'Pat' });
    const before = { ...stored() };
    const viewed = await (await get()).json();
    expect(viewed.organizer.dependentDetails).toBe('The child lives here. SSN ***-**-1111.');
    const edited = `${String(viewed.organizer.dependentDetails).replace('child', 'student')} Added 222-33-4444 today.`;
    const saved = await post({ taxYear: 2026, dependentDetails: edited, filingStatus: 'single', spouseName: 'Pat' });
    expect(saved.status).toBe(400);
    expect(await saved.json()).toEqual({ error: `Dependent details: ${SSN_NOT_ACCEPTED_ERROR}` });
    expect(state.sets).toEqual([]);
    expect(Object.keys(stored()).sort()).toEqual(Object.keys(before).sort());
    for (const key of Object.keys(before)) expect(stored()[key], key).toBe(before[key]);
  });
  it('saves a word edit and restores the stored separated number', async () => {
    const original = 'The child lives here. SSN 900-00-1111.';
    state.docs.set('kept', { userId: 'owner', taxYear: 2026, dependentDetails: original, filingStatus: 'single', spouseName: 'Pat' });
    const viewed = await (await get()).json();
    const edited = String(viewed.organizer.dependentDetails).replace('child', 'student');
    expect((await post({ taxYear: 2026, dependentDetails: edited, filingStatus: 'single', spouseName: 'Pat' })).status).toBe(200);
    expect(stored().dependentDetails).toBe('The student lives here. SSN 900-00-1111.');
    expect(stored().filingStatus).toBe('single');
    expect(stored().spouseName).toBe('Pat');
  });
  it.each([
    ['dependentDetails', 'Dependent details'],
    ['spouseName', 'Spouse name'],
    ['streetAddress', 'Street address'],
    ['city', 'City'],
    ['stateAddr', 'State'],
    ['zipCode', 'ZIP'],
  ])('names %s when refusing a new separated number', async (field, label) => {
    state.docs.clear(); state.sets.length = 0;
    const response = await post({ taxYear: 2026, [field]: 'Pat 123-45-6789', filingStatus: 'single' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: `${label}: ${SSN_NOT_ACCEPTED_ERROR}` });
    expect(state.docs.size).toBe(0);
    expect(state.sets).toEqual([]);
  });
  it('names an unlabeled field when refusing a new separated number', async () => {
    const response = await post({ taxYear: 2026, preparerNote: 'Ref 123-45-6789', filingStatus: 'single' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: `This note: ${SSN_NOT_ACCEPTED_ERROR}` });
    expect(state.docs.size).toBe(0);
    expect(state.sets).toEqual([]);
  });
  it('refuses a save that moves a hidden number earlier in the note and writes nothing', async () => {
    const original = 'A 900-00-1111 then B 900-00-2222';
    state.docs.set('order', { userId: 'owner', taxYear: 2026, dependentDetails: original, filingStatus: 'single' });
    const before = { ...stored() };
    const viewed = await (await get()).json();
    const masked = String(viewed.organizer.dependentDetails);
    expect(masked).toBe('A ***-**-1111 then B ***-**-2222');
    const [first, second] = masked.match(/\*\*\*-\*\*-\d{4}/g)!;
    const swapped = masked.replace(first, '___').replace(second, first).replace('___', second);
    expect(swapped).toBe('A ***-**-2222 then B ***-**-1111');
    const saved = await post({ taxYear: 2026, dependentDetails: swapped });
    const body = await saved.json();
    expect(saved.status).toBe(400);
    expect(body).toEqual({ error: MASKED_NUMBER_EDIT_ERROR });
    expect(state.sets).toEqual([]);
    expect(Object.keys(stored()).sort()).toEqual(Object.keys(before).sort());
    for (const key of Object.keys(before)) expect(stored()[key], key).toBe(before[key]);
  });
  it('restores a copied masked token to the stored number and saves', async () => {
    const original = 'Emma, SSN 123-45-6789';
    state.docs.set('copy', { userId: 'owner', taxYear: 2026, dependentDetails: original, filingStatus: 'single' });
    const viewed = await (await get()).json();
    const masked = String(viewed.organizer.dependentDetails);
    expect(masked).toBe('Emma, SSN ***-**-6789');
    const token = masked.match(/\*\*\*-\*\*-\d{4}/)![0];
    const copied = `${masked} and copy ${token}`;
    expect((await post({ taxYear: 2026, dependentDetails: copied, filingStatus: 'single' })).status).toBe(200);
    expect(stored().dependentDetails).toBe('Emma, SSN 123-45-6789 and copy 123-45-6789');
    expect(stored().filingStatus).toBe('single');
  });
  it('stores a newly typed bare 9-digit run unchanged', async () => {
    const created = await post({ taxYear: 2026, dependentDetails: 'Order 555000222', filingStatus: 'single' });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(stored().dependentDetails).toBe('Order 555000222');
    expect(body.warning).toBeUndefined();
    expect(body.redacted).toBeUndefined();
  });
  it('restores a repeated number in each original format and leaves an unchanged save byte-identical', async () => {
    const original = 'First 111-22-3333, again 111-22-3333, also 111 22 3333';
    state.docs.set('dup', { userId: 'owner', taxYear: 2026, dependentDetails: original, filingStatus: 'single', spouseName: 'Pat' });
    const before = { ...stored() };
    const viewed = await (await get()).json();
    expect(viewed.organizer.dependentDetails).toBe('First ***-**-3333, again ***-**-3333, also ***-**-3333');
    const unchanged = await post({ taxYear: 2026, dependentDetails: viewed.organizer.dependentDetails, filingStatus: 'single', spouseName: 'Pat' });
    expect(unchanged.status).toBe(200);
    expect(state.sets).toEqual([]);
    expect(Object.keys(stored()).sort()).toEqual(Object.keys(before).sort());
    for (const key of Object.keys(before)) expect(stored()[key], key).toBe(before[key]);
    const edited = String(viewed.organizer.dependentDetails).replace('First', 'Start');
    expect((await post({ taxYear: 2026, dependentDetails: edited, filingStatus: 'single', spouseName: 'Pat' })).status).toBe(200);
    expect(stored().dependentDetails).toBe('Start 111-22-3333, again 111-22-3333, also 111 22 3333');
    expect(stored().filingStatus).toBe('single');
    expect(stored().spouseName).toBe('Pat');
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
  it('returns the tax-input view without identifier fields and without writing', async () => {
    const before = {
      userId: 'owner', taxYear: 2026, taxpayerSSN: '900000001', ein: '123456789',
      amountOtherIncome: '1500', dependents: '2', notes: 'unrelated',
    };
    state.docs.set('legacy-tax-input', { ...before });
    const input = await (await GET(new NextRequest('http://localhost/api/tax/organizer?year=2026&view=tax-input'))).json();
    expect(input).toEqual(organizerTaxInputValues({ amountOtherIncome: '1500', dependents: '2' }));
    expect(input).not.toHaveProperty('taxpayerSSN');
    expect(input).not.toHaveProperty('ein');
    expect(JSON.stringify(input)).not.toContain('900000001');
    expect(JSON.stringify(input)).not.toContain('123456789');
    expect(state.sets).toEqual([]);
    expect(state.docs.get('legacy-tax-input')).toEqual(before);
  });
  it('returns dependent records whole and drops SSN and ITIN keys', async () => {
    const dependents = [{ name: 'Child', dependentSSN: '900000001', itin: '900000002', dependent2ITIN: '900000003', dateOfBirth: '2018-03-15' }];
    const businessLossFacts = { version: 1, taxYear: 2026, allInvestmentAtRisk: 'yes' };
    state.docs.set('dependent-object', {
      userId: 'owner', taxYear: 2026, dependents, businessLossFacts, notes: 'unrelated', taxpayerSSN: '900000009',
    });
    const input = await (await GET(new NextRequest('http://localhost/api/tax/organizer?year=2026&view=tax-input'))).json();
    expect(input.dependents).toEqual([{ name: 'Child', dateOfBirth: '2018-03-15', identifierKind: 'ssn' }]);
    expect(input.businessLossFacts).toEqual(businessLossFacts);
    expect(JSON.stringify(input)).not.toContain('900000001');
    expect(JSON.stringify(input)).not.toContain('900000002');
    expect(JSON.stringify(input)).not.toContain('900000003');
    expect(input).not.toHaveProperty('taxpayerSSN');
    expect(state.docs.get('dependent-object')).toMatchObject({ dependents, businessLossFacts });
    expect(state.sets).toEqual([]);
  });
  it('returns the organizer fields the federal snapshot reads and leaves the other answers out', async () => {
    state.docs.set('tax-input-row', {
      userId: 'owner', taxYear: 2026, amountOtherIncome: '1500', dependents: '2',
      notes: 'unrelated', hasW2: 'yes', taxpayerSSN: 'ciphertext', updatedAt: 'stamp',
    });
    const body = await (await GET(new NextRequest('http://localhost/api/tax/organizer?year=2026&view=tax-input'))).json();
    expect(body).toEqual(organizerTaxInputValues({ amountOtherIncome: '1500', dependents: '2' }));
    expect(body).not.toHaveProperty('notes');
    expect(body).not.toHaveProperty('taxpayerSSN');
    const missing = await (await GET(new NextRequest('http://localhost/api/tax/organizer?year=2024&view=tax-input'))).json();
    expect(missing).toEqual(organizerTaxInputValues(undefined));
  });
  it('still rejects an invalid EIN before writing', async () => {
    const response = await post({ taxYear: 2026, ein: '12-345678', filingStatus: 'single' });
    expect(response.status).toBe(400);
    expect(state.docs.size).toBe(0);
  });
});

describe('identifier read helpers', () => {
  it('reports legacy plaintext and leaves the stored note unchanged', () => {
    const read = readOrganizerIdentifiers({ taxpayerSSN: encryptSensitive('900000001'), ipPin: '123456', dependentDetails: 'SSN 900-00-0003', filingStatus: 'single' });
    expect(read.organizer).toMatchObject({ taxpayerSSN: '900000001', ipPin: '123456', dependentDetails: 'SSN 900-00-0003', filingStatus: 'single' });
    expect(read.legacyPlaintextFields).toEqual(['ipPin']);
    expect(read).not.toHaveProperty('redactedTextFields');
  });
});
