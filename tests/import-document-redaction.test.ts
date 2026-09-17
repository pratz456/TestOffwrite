import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Real import route; auth, Firestore transport, local OCR and the model are
// synthetic. Every identifier below is synthetic.
const state = vi.hoisted(() => ({
  records: {} as Record<string, Record<string, unknown>[]>,
  profile: null as Record<string, unknown> | null,
}));
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  recognize: vi.fn(),
}));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'import-owner' }, error: null }) }));
vi.mock('@/lib/openai/client', () => ({ getOpenAIModel: () => 'gpt-4o', getOpenAIClientOrThrow: () => ({ chat: { completions: { create: mocks.create } } }) }));
vi.mock('@/lib/ocr/document-text', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/ocr/document-text')>(), recognizeDocumentText: mocks.recognize }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => {
  const filters: [string, unknown][] = [];
  return {
    where(field: string, _operator: string, value: unknown) { filters.push([field, value]); return this; },
    limit() { return this; },
    doc: (id: string) => ({ get: async () => ({ exists: state.profile !== null && name === 'user_profiles' && id === 'import-owner', data: () => state.profile ?? undefined }) }),
    add: async (data: Record<string, unknown>) => { (state.records[name] ??= []).push(data); return { id: `synthetic-${state.records[name].length}` }; },
    get: async () => {
      const records = (state.records[name] || []).filter(record => filters.every(([field, value]) => record[field] === value));
      return { empty: !records.length, docs: records.map((record, i) => ({ id: `synthetic-${i + 1}`, data: () => ({ ...record }), ref: { set: async (data: Record<string, unknown>) => { Object.assign(record, data); } } })) };
    },
  };
} } }));

import { POST as importDocument } from '../app/api/tax/import-document/route';
import { encryptSensitive } from '../lib/security/utils';
import { DOCUMENT_IMAGE_CONSENT_REQUIRED, DOCUMENT_IMPORT_CONSENT_VERSION } from '../lib/onboarding/document-import-consent';

const W2_TEXT = [
  'a Employee\'s social security number 123-45-6789', 'b Employer identification number (EIN) 98-7654321',
  'c Employer\'s name Synthetic Employer LLC 100 Main St Austin TX 78701-1234', 'd Control number 555444333',
  '1 Wages, tips, other compensation 65,000.00', '2 Federal income tax withheld 7,250.10',
  '3 Social security wages 65,000.00', '4 Social security tax withheld 4,030.00', '5 Medicare wages 65,000.00', '6 Medicare tax withheld 942.50',
  '15 State TX 16 State wages 65000.00', 'Form W-2 Wage and Tax Statement 2025',
].join('\n');
const W2_JSON = { docType: 'w2', employerName: 'Synthetic Employer LLC', employerEIN: null, box1Wages: 65000, box2FederalWithheld: 7250.1, box3SocialSecurityWages: 65000,
  box4SocialSecurityWithheld: 4030, box5MedicareWages: 65000, box6MedicareWithheld: 942.5, box12Codes: [], box16StateWages: 65000, box17StateWithheld: null, state: 'TX', taxYear: 2025,
  confidence: 0.96, fieldConfidence: { box1Wages: 0.97, box2FederalWithheld: 0.95, box3SocialSecurityWages: 0.96, box5MedicareWages: 0.96 }, imageQualityIssues: [], verificationWarnings: [] };
// A real PNG signature: the route verifies magic bytes before OCR.
const IMAGE_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...Array.from({ length: 64 }, () => 1)]);
const consents = (documentImport: boolean, version = DOCUMENT_IMPORT_CONSENT_VERSION) => ({
  version: '2026-09-17', source: 'sign-up', accepted_at: '2026-09-17T12:00:00.000Z', bank_data: true, ai_review: true, communications: false,
  document_import: documentImport, ...(documentImport ? { document_import_signature: { version, signed_name: 'Synthetic Signer', signed_at: '2026-09-18T09:00:00.000Z' } } : {}),
});

const modelReplies = (...bodies: unknown[]) => { for (const body of bodies) mocks.create.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(body) } }] }); };
const request = (fields: Record<string, string> = {}, type = 'image/png') => {
  const form = new FormData();
  form.set('file', new Blob([IMAGE_BYTES], { type }), 'synthetic.png');
  form.set('docType', 'w2'); form.set('taxYear', '2025'); form.set('commit', 'true');
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new NextRequest('http://localhost/api/tax/import-document', { method: 'POST', body: form });
};
const sentText = (call: number) => JSON.stringify(mocks.create.mock.calls[call][0].messages);
const contentParts = (call: number) => mocks.create.mock.calls[call][0].messages[0].content as { type: string; image_url?: { url: string } }[];

beforeEach(() => {
  mocks.create.mockReset(); mocks.recognize.mockReset();
  state.records = { tax_organizers: [{ userId: 'import-owner', taxYear: 2025, taxpayerSSN: encryptSensitive('123456789') }] };
  state.profile = { name: 'Owner', consents: consents(false) };
  mocks.recognize.mockResolvedValue({ text: W2_TEXT, confidence: 0.9 });
});

describe('redact-first W-2/1099 import: text path', () => {
  it('sends redacted OCR text, never the image or any identifier, and reads the EIN locally', async () => {
    modelReplies(W2_JSON);
    const response = await importDocument(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const call = mocks.create.mock.calls[0][0];
    expect(call.store).toBe(false);
    expect(contentParts(0).map(part => part.type)).toEqual(['text']);
    const sent = sentText(0);
    for (const identifier of ['123-45-6789', '123456789', '98-7654321', '987654321', '555444333']) expect(sent).not.toContain(identifier);
    expect(sent).toContain('***-**-6789'); expect(sent).toContain('[redacted-id]');
    expect(sent).toContain('65,000.00'); expect(sent).toContain('7,250.10'); expect(sent).toContain('78701-1234');
    expect(sent).toContain('needs_image');
    expect(body).toMatchObject({ success: true, disclosure: 'text', identifiersRedacted: 3, documentOwner: 'taxpayer', committed: true });
    expect(body.extracted.employerEIN).toBe('98-7654321');
    expect(body.verificationRequired).toEqual([]);
    expect(state.records.w2_income).toHaveLength(1);
    expect(state.records.w2_income[0]).toMatchObject({ employerEIN: '98-7654321', wages: 65000, source: 'document_import' });
    expect(JSON.stringify(state.records.w2_income)).not.toMatch(/123-45-6789|123456789|6789/);
  });

  it('flags a document whose SSN does not match the organizer instead of storing the number', async () => {
    state.records.tax_organizers = [{ userId: 'import-owner', taxYear: 2025, taxpayerSSN: encryptSensitive('111223333'), spouseSSN: '444556666' }];
    modelReplies(W2_JSON);
    const body = await (await importDocument(request({ commit: 'false' }))).json();
    expect(body.documentOwner).toBe('unmatched');
    expect(body.verificationRequired).toEqual([expect.stringContaining('(***-**-6789) does not match')]);
    expect(JSON.stringify(body)).not.toMatch(/123-45-6789|123456789|111223333|444556666/);
    expect(state.records.w2_income).toBeUndefined();
  });

  it('attributes a spouse W-2 through the legacy plaintext spouse SSN and leaves the organizer intact for the owner read path', async () => {
    state.records.tax_organizers = [{ userId: 'import-owner', taxYear: 2025, taxpayerSSN: encryptSensitive('111223333'), spouseSSN: '123456789' }];
    modelReplies(W2_JSON);
    expect((await (await importDocument(request({ commit: 'false' }))).json()).documentOwner).toBe('spouse');
  });
});

describe('redact-first W-2/1099 import: image fallback needs the signed §7216 consent', () => {
  it.each([
    ['OCR confidence is low', () => mocks.recognize.mockResolvedValue({ text: W2_TEXT, confidence: 0.2 }), 'ocr_low_confidence', 0],
    ['OCR produced almost no text', () => mocks.recognize.mockResolvedValue({ text: 'W-2', confidence: 0.95 }), 'ocr_low_confidence', 0],
    ['the file has no local OCR path', () => mocks.recognize.mockResolvedValue(null), 'ocr_unavailable', 0],
    ['the model asks for the image', () => modelReplies({ needs_image: true, reason: 'columns interleaved' }), 'model_requested_image', 1],
  ])('refuses the image with 403 %s when %s and no consent was given', async (_label, arrange, reason, textCalls) => {
    arrange();
    const response = await importDocument(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: DOCUMENT_IMAGE_CONSENT_REQUIRED, reason, consentOnFile: false, error: expect.stringContaining('consent') });
    expect(mocks.create).toHaveBeenCalledTimes(textCalls);
    if (textCalls) { expect(contentParts(0).map(part => part.type)).toEqual(['text']); expect(sentText(0)).not.toContain('base64'); }
    expect(state.records.w2_income).toBeUndefined();
  });

  it('refuses the request flag alone: the consent must be signed on the profile', async () => {
    mocks.recognize.mockResolvedValue(null);
    const response = await importDocument(request({ documentImageConsent: 'true' }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: DOCUMENT_IMAGE_CONSENT_REQUIRED, consentOnFile: false });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refuses a signed consent alone: the person authorizes each document from the upload screen', async () => {
    state.profile = { consents: consents(true) };
    mocks.recognize.mockResolvedValue(null);
    const response = await importDocument(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: DOCUMENT_IMAGE_CONSENT_REQUIRED, consentOnFile: true });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    ['a signature of an earlier consent text', consents(true, '2026-01-01')],
    ['a withdrawn consent', consents(false)],
    ['a profile without acknowledgments', undefined],
  ])('treats %s as no consent', async (_label, record) => {
    state.profile = record ? { consents: record } : {};
    mocks.recognize.mockResolvedValue(null);
    expect((await importDocument(request({ documentImageConsent: 'true' }))).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('sends the whole image with store disabled once the flag and the signed consent are both present', async () => {
    state.profile = { consents: consents(true) };
    mocks.recognize.mockResolvedValue({ text: W2_TEXT, confidence: 0.2 });
    modelReplies(W2_JSON);
    const response = await importDocument(request({ documentImageConsent: 'true' }));
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const call = mocks.create.mock.calls[0][0];
    expect(call.store).toBe(false);
    const parts = contentParts(0);
    expect(parts.map(part => part.type)).toEqual(['text', 'image_url']);
    expect(parts[1].image_url!.url).toBe(`data:image/png;base64,${Buffer.from(IMAGE_BYTES).toString('base64')}`);
    expect(sentText(0)).not.toContain('needs_image');
    expect(await response.json()).toMatchObject({ success: true, disclosure: 'image', identifiersRedacted: 0, documentOwner: 'unknown' });
  });

  it('falls through to the consented image only after the model declined the redacted text', async () => {
    state.profile = { consents: consents(true) };
    modelReplies({ needs_image: true, reason: 'garbled' }, W2_JSON);
    const response = await importDocument(request({ documentImageConsent: 'true' }));
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(contentParts(0).map(part => part.type)).toEqual(['text']);
    expect(contentParts(1).map(part => part.type)).toEqual(['text', 'image_url']);
    expect(await response.json()).toMatchObject({ disclosure: 'image' });
  });
});
