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

import { resetRateLimitStore } from './fixtures/rate-limit-store';
import { POST as importDocument } from '../app/api/tax/import-document/route';
import { encryptSensitive } from '../lib/security/utils';
import { DOCUMENT_IMAGE_CONSENT_REQUIRED, DOCUMENT_IMPORT_CONSENT_VERSION } from '../lib/onboarding/document-import-consent';
import { CONSENT_TERMS_VERSION } from '../lib/onboarding/consents';

const W2_TEXT = [
  'a Employee\'s social security number 123-45-6789', 'b Employer identification number (EIN) 98-7654321',
  'c Employer\'s name Synthetic Employer LLC 100 Main St Austin TX 78701-1234', 'd Control number 555444333',
  'e Employee\'s first name and initial Last name Jordan Demo', 'f Employee\'s address and ZIP code 42 Oak Avenue Apt 3 Austin, TX 78702',
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
  version: CONSENT_TERMS_VERSION, source: 'sign-up', accepted_at: '2026-09-17T12:00:00.000Z', terms: true, bank_data: true, ai_review: true, communications: false,
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
  resetRateLimitStore();
  mocks.create.mockReset(); mocks.recognize.mockReset();
  state.records = { tax_organizers: [{ userId: 'import-owner', taxYear: 2025, taxpayerSSN: encryptSensitive('123456789') }] };
  state.profile = { name: 'Jordan Demo', consents: consents(false) };
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
    // The account holder's name and every postal address stay on this server; amounts and the employer name travel.
    for (const personal of ['Jordan', 'Demo', '42 Oak Avenue', '78702', '100 Main St', '78701']) expect(sent).not.toContain(personal);
    expect(sent).toContain('[redacted-name]'); expect(sent).toContain('[redacted-address]'); expect(sent).toContain('Synthetic Employer LLC');
    expect(sent).toContain('65,000.00'); expect(sent).toContain('7,250.10');
    expect(sent).toContain('needs_image');
    expect(body).toMatchObject({ success: true, disclosure: 'text', identifiersRedacted: 8, documentOwner: 'taxpayer', committed: true });
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
    expect(body.verificationRequired).toEqual([expect.stringContaining('does not match')]);
    expect(JSON.stringify(body.verificationRequired)).not.toMatch(/\d{3}-?\d{2}-?\d{4}/);
    expect(JSON.stringify(body)).not.toMatch(/123-45-6789|123456789|111223333|444556666/);
    expect(state.records.w2_income).toBeUndefined();
  });

  it('does not return or store a W-2 employee number from box a', async () => {
    modelReplies({ ...W2_JSON, employeeSSN: '123-45-6789', employeeName: 'Jordan 123-45-6789', modelTranscript: 'raw model text 123-45-6789' });
    const response = await importDocument(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    const ssnShaped = /\d{3}-?\d{2}-?\d{4}/;
    expect(body.rawResponse).toBeUndefined();
    expect(body.extracted.employeeSSN).toBeUndefined();
    expect(body.extracted.employeeName).toBeUndefined();
    expect(body.extracted.modelTranscript).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(ssnShaped);
    expect(JSON.stringify(body)).not.toContain('raw model text');
    expect(JSON.stringify(state.records.w2_income)).not.toMatch(ssnShaped);
    expect(body.extracted.employerEIN).toBe('98-7654321');
    expect(state.records.w2_income[0].employerEIN).toBe('98-7654321');
    expect(state.records.w2_income[0].employeeSSN).toBeUndefined();
  });

  it.each([
    ['NEC', '123-45-6789'],
    ['K', '123456789'],
  ])('does not return or store a 1099-%s recipient number', async (formVariant, recipientTIN) => {
    mocks.recognize.mockResolvedValue({ text: `Form 1099-${formVariant}\nPayer EIN 98-7654321\nRecipient TIN ${recipientTIN}\n1 Nonemployee compensation 1200.00`, confidence: 0.95 });
    modelReplies({ docType: '1099', formVariant, payerName: 'Synthetic Payer', payerEIN: null, recipientTIN, recipientName: 'Jordan Demo', box1Amount: 1200, taxYear: 2025, confidence: 0.95, modelTranscript: `raw model text ${recipientTIN}` });
    const response = await importDocument(request({ docType: '1099' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rawResponse).toBeUndefined();
    expect(body.extracted.recipientTIN).toBeUndefined();
    expect(body.extracted.modelTranscript).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/\d{3}-?\d{2}-?\d{4}/);
    expect(JSON.stringify(body)).not.toContain('raw model text');
    expect(JSON.stringify(state.records.income_1099)).not.toMatch(/\d{3}-?\d{2}-?\d{4}/);
    expect(state.records.income_1099[0].recipientTIN).toBeUndefined();
    expect(body.extracted.payerEIN).toBe('98-7654321');
    expect(state.records.income_1099[0].payerEIN).toBe('98-7654321');
  });

  it.each(['98-7654321', '121212121'])('keeps W-2 employer EIN %s from the text path and drops box a', async (employerEIN) => {
    mocks.recognize.mockResolvedValue({ text: `a Employee's social security number 123-45-6789\nb Employer identification number (EIN) ${employerEIN}\n1 Wages 1000.00`, confidence: 0.95 });
    modelReplies({ ...W2_JSON, employerEIN: null, employeeSSN: '123-45-6789', box1Wages: 1000 });
    const body = await (await importDocument(request())).json();
    expect(body.extracted.employerEIN).toBe(employerEIN);
    expect(body.extracted.employeeSSN).toBeUndefined();
    expect(state.records.w2_income[0].employerEIN).toBe(employerEIN);
    expect(state.records.w2_income[0].employeeSSN).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('123-45-6789');
  });

  it('blanks an undashed payer TIN after a recipient identification number and asks to check the ID', async () => {
    mocks.recognize.mockResolvedValue({ text: "RECIPIENT'S identification number 111111111\nPayer TIN 987654321\n1 Nonemployee compensation 1200.00", confidence: 0.95 });
    modelReplies({ docType: '1099', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN: null, recipientTIN: '111111111', box1Amount: 1200, taxYear: 2025, confidence: 0.95 });
    const body = await (await importDocument(request({ docType: '1099' }))).json();
    expect(body.extracted.payerEIN).toBeNull();
    expect(body.extracted.recipientTIN).toBeUndefined();
    expect(state.records.income_1099[0].payerEIN).toBe('');
    expect(state.records.income_1099[0].recipientTIN).toBeUndefined();
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    expect(JSON.stringify(body)).not.toContain('111111111');
    expect(JSON.stringify(state.records.income_1099)).not.toContain('111111111');
    expect(JSON.stringify(body)).not.toContain('987654321');
    expect(JSON.stringify(state.records.income_1099)).not.toContain('987654321');
  });

  it('keeps the payer TIN when a dashed recipient TIN is listed first', async () => {
    mocks.recognize.mockResolvedValue({ text: "RECIPIENT'S TIN 12-3456789\nPAYER'S TIN 98-7654321\n1 Nonemployee compensation 1200.00", confidence: 0.95 });
    modelReplies({ docType: '1099', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN: '12-3456789', recipientTIN: '12-3456789', box1Amount: 1200, taxYear: 2025, confidence: 0.95 });
    const body = await (await importDocument(request({ docType: '1099' }))).json();
    expect(body.extracted.payerEIN).toBe('98-7654321');
    expect(body.extracted.recipientTIN).toBeUndefined();
    expect(state.records.income_1099[0].payerEIN).toBe('98-7654321');
    expect(JSON.stringify(body)).not.toContain('12-3456789');
    expect(JSON.stringify(state.records.income_1099)).not.toContain('12-3456789');
    expect(body.verificationRequired).not.toContain('Check the employer/payer ID');
  });

  it('blanks a dashed recipient TIN when no payer TIN is present and asks to check the ID', async () => {
    mocks.recognize.mockResolvedValue({ text: "RECIPIENT'S TIN 12-3456789\n1 Nonemployee compensation 1200.00", confidence: 0.95 });
    modelReplies({ docType: '1099', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN: '12-3456789', recipientTIN: '12-3456789', box1Amount: 1200, taxYear: 2025, confidence: 0.95 });
    const body = await (await importDocument(request({ docType: '1099' }))).json();
    expect(body.extracted.payerEIN).toBeNull();
    expect(state.records.income_1099[0].payerEIN).toBe('');
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    expect(JSON.stringify(body)).not.toContain('12-3456789');
    expect(JSON.stringify(state.records.income_1099)).not.toContain('12-3456789');
  });

  it('leaves the payer number blank when the only undashed number is under a recipient identification label', async () => {
    mocks.recognize.mockResolvedValue({ text: "RECIPIENT'S identification number 123456789\n1 Nonemployee compensation 1200.00", confidence: 0.95 });
    modelReplies({ docType: '1099', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN: null, recipientTIN: '123456789', box1Amount: 1200, taxYear: 2025, confidence: 0.95 });
    const body = await (await importDocument(request({ docType: '1099' }))).json();
    expect(body.extracted.payerEIN).toBeNull();
    expect(body.extracted.recipientTIN).toBeUndefined();
    expect(state.records.income_1099[0].payerEIN).toBe('');
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    expect(JSON.stringify(body)).not.toContain('123456789');
    expect(JSON.stringify(state.records.income_1099)).not.toContain('123456789');
  });

  it.each([
    ['w2', 'employerEIN', 'Employer', '123-45-6789', 'w2_income'],
    ['w2', 'employerEIN', 'Employer', '123 45 6789', 'w2_income'],
    ['w2', 'employerEIN', 'Employer EIN', '123-45-6789', 'w2_income'],
    ['w2', 'employerEIN', 'Employer EIN', '123 45 6789', 'w2_income'],
    ['w2', 'employerEIN', 'EIN', '123-45-6789', 'w2_income'],
    ['w2', 'employerEIN', 'EIN', '123 45 6789', 'w2_income'],
    ['1099', 'payerEIN', 'Payer', '123-45-6789', 'income_1099'],
    ['1099', 'payerEIN', 'Payer', '123 45 6789', 'income_1099'],
    ['w2', 'employerEIN', 'b Employer identification number (EIN)', '123-45-6789', 'w2_income'],
    ['w2', 'employerEIN', 'b Employer identification number (EIN)', '123 45 6789', 'w2_income'],
    ['1099', 'payerEIN', "PAYER'S TIN", '123-45-6789', 'income_1099'],
    ['1099', 'payerEIN', 'Payer EIN', '123 45 6789', 'income_1099'],
  ] as const)('leaves %s %s blank when %s is followed by %s', async (docType, field, label, formatted, collection) => {
    mocks.recognize.mockResolvedValue({ text: `${label} ${formatted}\nPaid for services rendered this year`, confidence: 0.95 });
    modelReplies(docType === 'w2'
      ? { ...W2_JSON, employerEIN: formatted, box1Wages: 1000 }
      : { docType: '1099', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN: formatted, box1Amount: 1000, taxYear: 2025, confidence: 0.95, verificationWarnings: [] });
    const body = await (await importDocument(request({ docType }))).json();
    const stored = state.records[collection][0];
    expect(body.extracted[field]).toBeNull();
    expect(stored[field]).toBe('');
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    const visibleDigits = (value: unknown) => JSON.stringify(value).replace(/\D/g, '');
    expect(visibleDigits(body)).not.toContain('123456789');
    expect(visibleDigits(stored)).not.toContain('123456789');
    expect(JSON.stringify(body)).not.toContain(formatted);
    expect(JSON.stringify(stored)).not.toContain(formatted);
  });

  it.each(['12-3456789', '123456789'])('blanks employer number %s when the model returns it and the text has no employer number', async (employerEIN) => {
    mocks.recognize.mockResolvedValue({ text: 'Form W-2 Wage and Tax Statement prepared for the tax year 2025', confidence: 0.95 });
    modelReplies({ ...W2_JSON, employerEIN, box1Wages: 1000 });
    const body = await (await importDocument(request())).json();
    expect(body.extracted.employerEIN).toBeNull();
    expect(state.records.w2_income[0].employerEIN).toBe('');
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    expect(JSON.stringify(body)).not.toContain(employerEIN);
    expect(JSON.stringify(state.records.w2_income)).not.toContain(employerEIN);
  });

  it.each(['12-3456789', '123456789'])('blanks payer number %s when the model returns it and the text has no payer number', async (payerEIN) => {
    mocks.recognize.mockResolvedValue({ text: 'Form 1099-NEC statement prepared for the tax year 2025', confidence: 0.95 });
    modelReplies({ docType: '1099', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN, box1Amount: 1000, taxYear: 2025, confidence: 0.95, verificationWarnings: [] });
    const body = await (await importDocument(request({ docType: '1099' }))).json();
    expect(body.extracted.payerEIN).toBeNull();
    expect(state.records.income_1099[0].payerEIN).toBe('');
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    expect(JSON.stringify(body)).not.toContain(payerEIN);
    expect(JSON.stringify(state.records.income_1099)).not.toContain(payerEIN);
  });

  it.each(['98-7654321', '123456789'])('blanks payer number %s when the request says w2, the model says 1099, and the text has no payer number', async (payerEIN) => {
    mocks.recognize.mockResolvedValue({ text: 'Form 1099-NEC statement prepared for the tax year 2025', confidence: 0.95 });
    modelReplies({ docType: '1099', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN, box1Amount: 1000, taxYear: 2025, confidence: 0.95, verificationWarnings: [] });
    const body = await (await importDocument(request({ docType: 'w2' }))).json();
    expect(body.extracted.payerEIN).toBeNull();
    expect(state.records.income_1099[0].payerEIN).toBe('');
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    expect(JSON.stringify(body)).not.toContain(payerEIN);
    for (const [collection, records] of Object.entries(state.records)) expect(JSON.stringify(records), collection).not.toContain(payerEIN);
  });

  it('blanks a bare payer number when the request says w2, the model says 1099, and the text is a payer TIN', async () => {
    mocks.recognize.mockResolvedValue({ text: "PAYER'S TIN 123456789\nPaid for services rendered this year", confidence: 0.95 });
    modelReplies({ docType: '1099', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN: '123456789', box1Amount: 1000, taxYear: 2025, confidence: 0.95, verificationWarnings: [] });
    const body = await (await importDocument(request({ docType: 'w2' }))).json();
    expect(body.extracted.payerEIN).toBeNull();
    expect(state.records.income_1099[0].payerEIN).toBe('');
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    expect(JSON.stringify(body)).not.toContain('123456789');
    for (const [collection, records] of Object.entries(state.records)) expect(JSON.stringify(records), collection).not.toContain('123456789');
  });

  it('blanks an employer number when the request says 1099 and the model says w2 with no employer number in the text', async () => {
    mocks.recognize.mockResolvedValue({ text: 'Form W-2 Wage and Tax Statement prepared for the tax year 2025', confidence: 0.95 });
    modelReplies({ ...W2_JSON, employerEIN: '12-3456789', box1Wages: 1000 });
    const body = await (await importDocument(request({ docType: '1099' }))).json();
    expect(body.extracted.employerEIN).toBeNull();
    expect(state.records.w2_income[0].employerEIN).toBe('');
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    expect(JSON.stringify(body)).not.toContain('12-3456789');
    for (const [collection, records] of Object.entries(state.records)) expect(JSON.stringify(records), collection).not.toContain('12-3456789');
  });

  it.each([
    ['w2', "PAYER'S TIN 123456789"],
    ['w2', 'Payer EIN 123456789'],
  ] as const)('blanks a bare payer number when the model says %s and the text is %s', async (docType, line) => {
    mocks.recognize.mockResolvedValue({ text: `${line}\nPaid for services rendered this year`, confidence: 0.95 });
    modelReplies({ ...W2_JSON, docType, employerEIN: '123456789', box1Wages: 1000 });
    const body = await (await importDocument(request({ docType: 'w2', confirmedDocType: 'w2' }))).json();
    expect(body.extracted.employerEIN).toBeNull();
    expect(state.records.w2_income[0].employerEIN).toBe('');
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    expect(JSON.stringify(body)).not.toContain('123456789');
    for (const [collection, records] of Object.entries(state.records)) expect(JSON.stringify(records), collection).not.toContain('123456789');
  });

  it('blanks a bare payer number when the model gives no type, the request says w2, and the text is a payer TIN', async () => {
    mocks.recognize.mockResolvedValue({ text: "PAYER'S TIN 123456789\nPaid for services rendered this year", confidence: 0.95 });
    modelReplies({ ...W2_JSON, docType: undefined, employerEIN: '123456789', box1Wages: 1000 });
    const body = await (await importDocument(request({ docType: 'w2', confirmedDocType: 'w2' }))).json();
    expect(body.extracted.employerEIN).toBeNull();
    expect(state.records.w2_income[0].employerEIN).toBe('');
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    expect(JSON.stringify(body)).not.toContain('123456789');
    for (const [collection, records] of Object.entries(state.records)) expect(JSON.stringify(records), collection).not.toContain('123456789');
  });

  it.each([
    ['unknown', '98-7654321', "PAYER'S TIN 98-7654321\nPaid for services rendered this year"],
    ['unknown', null, 'Form 1099-NEC statement prepared for the tax year 2025'],
    [undefined, '98-7654321', "PAYER'S TIN 98-7654321\nPaid for services rendered this year"],
    [undefined, null, 'Form 1099-NEC statement prepared for the tax year 2025'],
  ] as const)('auto request with model type %s resolves payerEIN to %s', async (modelType, payerEIN, text) => {
    mocks.recognize.mockResolvedValue({ text, confidence: 0.95 });
    const reply: Record<string, unknown> = { formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN: null, box1Amount: 1200, taxYear: 2025, confidence: 0.95, verificationWarnings: [] };
    if (modelType) reply.docType = modelType;
    modelReplies(reply);
    const body = await (await importDocument(request({ docType: 'auto' }))).json();
    expect(body.extracted.payerEIN).toBe(payerEIN);
    expect(state.records.income_1099[0].payerEIN).toBe(payerEIN ?? '');
    if (payerEIN === null) expect(body.verificationRequired).toContain('Check the employer/payer ID');
    else expect(body.verificationRequired).not.toContain('Check the employer/payer ID');
  });

  it('keeps a dashed employer number typed after a scan that found none', async () => {
    mocks.recognize.mockResolvedValue({ text: 'Form W-2 Wage and Tax Statement prepared for the tax year 2025', confidence: 0.95 });
    modelReplies({ ...W2_JSON, employerEIN: null, box1Wages: 1000 });
    const body = await (await importDocument(request({ overrideFields: JSON.stringify({ employerEIN: '12-3456789' }) }))).json();
    expect(body.extracted.employerEIN).toBe('12-3456789');
    expect(state.records.w2_income[0].employerEIN).toBe('12-3456789');
    expect(body.verificationRequired).not.toContain('Check the employer/payer ID');
    expect(state.records.w2_income[0]).not.toHaveProperty('verificationWarnings');
  });

  it('keeps a dashed payer number typed after a scan that found none', async () => {
    mocks.recognize.mockResolvedValue({ text: 'Form 1099-NEC statement prepared for the tax year 2025', confidence: 0.95 });
    modelReplies({ docType: '1099', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN: null, box1Amount: 1200, taxYear: 2025, confidence: 0.95, verificationWarnings: [] });
    const body = await (await importDocument(request({ docType: '1099', overrideFields: JSON.stringify({ payerEIN: '98-7654321' }) }))).json();
    expect(body.extracted.payerEIN).toBe('98-7654321');
    expect(state.records.income_1099[0].payerEIN).toBe('98-7654321');
    expect(body.verificationRequired).not.toContain('Check the employer/payer ID');
    expect(state.records.income_1099[0]).not.toHaveProperty('verificationWarnings');
  });

  it('blanks a bare payer number typed on a 1099 and keeps the prompt', async () => {
    mocks.recognize.mockResolvedValue({ text: 'Form 1099-NEC statement prepared for the tax year 2025', confidence: 0.95 });
    modelReplies({ docType: '1099', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN: null, box1Amount: 1200, taxYear: 2025, confidence: 0.95, verificationWarnings: [] });
    const body = await (await importDocument(request({ docType: '1099', overrideFields: JSON.stringify({ payerEIN: '123456789' }) }))).json();
    expect(body.extracted.payerEIN).toBeNull();
    expect(state.records.income_1099[0].payerEIN).toBe('');
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    expect(state.records.income_1099[0]).not.toHaveProperty('verificationWarnings');
    expect(JSON.stringify(body)).not.toContain('123456789');
    for (const [collection, records] of Object.entries(state.records)) expect(JSON.stringify(records), collection).not.toContain('123456789');
  });

  it('saves an untyped reply with a 1099 form variant as a 1099', async () => {
    mocks.recognize.mockResolvedValue({ text: 'Form 1099-NEC statement prepared for the tax year 2025', confidence: 0.95 });
    modelReplies({ docType: 'unknown', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN: null, box1Amount: 1200, taxYear: 2025, confidence: 0.95, verificationWarnings: [] });
    const body = await (await importDocument(request({ docType: 'auto' }))).json();
    expect(body.success).toBe(true);
    expect(state.records.income_1099).toHaveLength(1);
    expect(state.records.w2_income).toBeUndefined();
  });

  it('asks to check the employer number when an auto request saves an untyped W-2 with no employer number', async () => {
    mocks.recognize.mockResolvedValue({ text: 'Form W-2 Wage and Tax Statement prepared for the tax year 2025', confidence: 0.95 });
    modelReplies({ docType: 'unknown', employerName: 'Synthetic Employer LLC', employerEIN: null, box1Wages: 1000, taxYear: 2025, confidence: 0.95, verificationWarnings: [] });
    const body = await (await importDocument(request({ docType: 'auto' }))).json();
    expect(body.extracted.employerEIN).toBeNull();
    expect(state.records.w2_income[0].employerEIN).toBe('');
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
  });

  it("keeps a dashed payer TIN on a W-2 when the model says w2", async () => {
    mocks.recognize.mockResolvedValue({ text: "PAYER'S TIN 98-7654321\nPaid for services rendered this year", confidence: 0.95 });
    modelReplies({ ...W2_JSON, employerEIN: null, box1Wages: 1000 });
    const body = await (await importDocument(request({ docType: 'w2', confirmedDocType: 'w2' }))).json();
    expect(body.extracted.employerEIN).toBe('98-7654321');
    expect(state.records.w2_income[0].employerEIN).toBe('98-7654321');
    expect(body.verificationRequired).not.toContain('Check the employer/payer ID');
  });

  it('does not keep a bare number under a generic identification number label', async () => {
    mocks.recognize.mockResolvedValue({ text: 'Identification number 987654321\n1 Wages 1000.00', confidence: 0.95 });
    modelReplies({ ...W2_JSON, employerEIN: '987654321', box1Wages: 1000 });
    const body = await (await importDocument(request())).json();
    expect(body.extracted.employerEIN).toBeNull();
    expect(state.records.w2_income[0].employerEIN).toBe('');
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    expect(JSON.stringify(body)).not.toContain('987654321');
    expect(JSON.stringify(state.records.w2_income)).not.toContain('987654321');
  });

  it('keeps the employer number when box a is labeled as an identification number', async () => {
    mocks.recognize.mockResolvedValue({ text: "a Employee's identification number 111111111\nb Employer identification number (EIN) 121212121\n1 Wages 1000.00", confidence: 0.95 });
    modelReplies({ ...W2_JSON, employerEIN: null, employeeSSN: '111111111', box1Wages: 1000 });
    const body = await (await importDocument(request())).json();
    expect(body.extracted.employerEIN).toBe('121212121');
    expect(body.extracted.employeeSSN).toBeUndefined();
    expect(state.records.w2_income[0].employerEIN).toBe('121212121');
    expect(state.records.w2_income[0].employeeSSN).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('111111111');
    expect(JSON.stringify(state.records.w2_income)).not.toContain('111111111');
  });

  it.each([
    ['98-7654321', '98-7654321'],
    ['131313131', null],
  ] as const)('text path 1099 payer number %s resolves to %s and drops the recipient TIN', async (payerEIN, expected) => {
    mocks.recognize.mockResolvedValue({ text: `Payer TIN ${payerEIN}\nRecipient TIN 123-45-6789\n1 Nonemployee compensation 1200.00`, confidence: 0.95 });
    modelReplies({ docType: '1099', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN: null, recipientTIN: '123-45-6789', box1Amount: 1200, taxYear: 2025, confidence: 0.95 });
    const body = await (await importDocument(request({ docType: '1099' }))).json();
    expect(body.extracted.payerEIN).toBe(expected);
    expect(body.extracted.recipientTIN).toBeUndefined();
    expect(state.records.income_1099[0].payerEIN).toBe(expected ?? '');
    expect(state.records.income_1099[0].recipientTIN).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('123-45-6789');
    if (expected === null) {
      expect(body.verificationRequired).toContain('Check the employer/payer ID');
      expect(JSON.stringify(body)).not.toContain(payerEIN);
      expect(JSON.stringify(state.records.income_1099)).not.toContain(payerEIN);
    } else {
      expect(body.verificationRequired).not.toContain('Check the employer/payer ID');
    }
  });

  it('blanks a typed employer number that is not NN-NNNNNNN and returns the saved blank', async () => {
    modelReplies(W2_JSON);
    const body = await (await importDocument(request({ overrideFields: JSON.stringify({ employerEIN: '123-45-6789' }) }))).json();
    expect(body.extracted.employerEIN).toBeNull();
    expect(state.records.w2_income[0].employerEIN).toBe('');
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    expect(JSON.stringify(body)).not.toContain('123-45-6789');
    expect(JSON.stringify(body)).not.toContain('98-7654321');
    expect(JSON.stringify(state.records.w2_income)).not.toContain('123-45-6789');
    expect(JSON.stringify(state.records.w2_income)).not.toContain('98-7654321');
  });

  it('blanks a typed payer number that is not NN-NNNNNNN and returns the saved blank', async () => {
    mocks.recognize.mockResolvedValue({ text: "PAYER'S TIN 98-7654321\n1 Nonemployee compensation 1200.00", confidence: 0.95 });
    modelReplies({ docType: '1099', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN: null, box1Amount: 1200, taxYear: 2025, confidence: 0.95, verificationWarnings: [] });
    const body = await (await importDocument(request({ docType: '1099', overrideFields: JSON.stringify({ payerEIN: '123-45-6789' }) }))).json();
    expect(body.extracted.payerEIN).toBeNull();
    expect(state.records.income_1099[0].payerEIN).toBe('');
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    expect(JSON.stringify(body)).not.toContain('123-45-6789');
    expect(JSON.stringify(body)).not.toContain('98-7654321');
    expect(JSON.stringify(state.records.income_1099)).not.toContain('123-45-6789');
    expect(JSON.stringify(state.records.income_1099)).not.toContain('98-7654321');
  });

  it("blanks a bare payer TIN on a 1099 and asks to check the ID", async () => {
    mocks.recognize.mockResolvedValue({ text: "PAYER'S TIN 123456789\nPaid for services rendered this year", confidence: 0.95 });
    modelReplies({ docType: '1099', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN: '123456789', box1Amount: 1000, taxYear: 2025, confidence: 0.95, verificationWarnings: [] });
    const body = await (await importDocument(request({ docType: '1099' }))).json();
    expect(body.extracted.payerEIN).toBeNull();
    expect(state.records.income_1099[0].payerEIN).toBe('');
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    expect(JSON.stringify(body)).not.toContain('123456789');
    expect(JSON.stringify(state.records.income_1099)).not.toContain('123456789');
  });

  it('still renders when the organizer has no identifier fields', async () => {
    state.records.tax_organizers = [{ userId: 'import-owner', taxYear: 2025, filingStatus: 'single' }];
    modelReplies(W2_JSON);
    const body = await (await importDocument(request())).json();
    expect(body).toMatchObject({ success: true, documentOwner: 'unknown', committed: true });
    expect(body.extracted.employerEIN).toBe('98-7654321');
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

  it('does not return or store a W-2 box a value from the image path', async () => {
    state.profile = { consents: consents(true) };
    mocks.recognize.mockResolvedValue({ text: W2_TEXT, confidence: 0.2 });
    modelReplies({ ...W2_JSON, employeeSSN: '123-45-6789', employeeName: 'Jordan 123-45-6789', employerEIN: '98-7654321', modelTranscript: 'raw model text 123-45-6789' });
    const response = await importDocument(request({ documentImageConsent: 'true' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.disclosure).toBe('image');
    expect(body.rawResponse).toBeUndefined();
    expect(body.extracted.employeeSSN).toBeUndefined();
    expect(body.extracted.modelTranscript).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/\d{3}-?\d{2}-?\d{4}/);
    expect(JSON.stringify(body)).not.toContain('raw model text');
    expect(JSON.stringify(state.records.w2_income)).not.toMatch(/\d{3}-?\d{2}-?\d{4}/);
    expect(state.records.w2_income[0].employeeSSN).toBeUndefined();
    expect(state.records.w2_income[0].employerEIN).toBe('98-7654321');
  });

  it.each([
    ['NEC', '123-45-6789'],
    ['K', '123456789'],
  ])('does not return or store a 1099-%s recipient number from the image path', async (formVariant, recipientTIN) => {
    state.profile = { consents: consents(true) };
    mocks.recognize.mockResolvedValue(null);
    modelReplies({ docType: '1099', formVariant, payerName: 'Synthetic Payer', payerEIN: '98-7654321', recipientTIN, recipientName: 'Jordan Demo', box1Amount: 1200, taxYear: 2025, confidence: 0.95, modelTranscript: `raw model text ${recipientTIN}` });
    const response = await importDocument(request({ docType: '1099', documentImageConsent: 'true' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.disclosure).toBe('image');
    expect(body.rawResponse).toBeUndefined();
    expect(body.extracted.recipientTIN).toBeUndefined();
    expect(body.extracted.modelTranscript).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/\d{3}-?\d{2}-?\d{4}/);
    expect(JSON.stringify(body)).not.toContain('raw model text');
    expect(JSON.stringify(state.records.income_1099)).not.toMatch(/\d{3}-?\d{2}-?\d{4}/);
    expect(state.records.income_1099[0].recipientTIN).toBeUndefined();
    expect(body.extracted.payerEIN).toBe('98-7654321');
  });

  it.each([
    ['98-7654321', '98-7654321'],
    ['121212121', null],
  ] as const)('image path W-2 employer number %s resolves to %s and drops box a', async (employerEIN, expected) => {
    state.profile = { consents: consents(true) };
    mocks.recognize.mockResolvedValue(null);
    modelReplies({ ...W2_JSON, employerEIN, employeeSSN: '123-45-6789' });
    const body = await (await importDocument(request({ documentImageConsent: 'true' }))).json();
    expect(body.disclosure).toBe('image');
    expect(body.extracted.employerEIN).toBe(expected);
    expect(body.extracted.employeeSSN).toBeUndefined();
    expect(state.records.w2_income[0].employerEIN).toBe(expected ?? '');
    expect(state.records.w2_income[0].employeeSSN).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('123-45-6789');
    if (expected === null) {
      expect(body.verificationRequired).toContain('Check the employer/payer ID');
      expect(JSON.stringify(body)).not.toContain(employerEIN);
      expect(JSON.stringify(state.records.w2_income)).not.toContain(employerEIN);
    } else {
      expect(body.verificationRequired).not.toContain('Check the employer/payer ID');
    }
  });

  it.each([
    ['w2', 'employerEIN', '123-45-6789', null],
    ['w2', 'employerEIN', '12-3456789', '12-3456789'],
    ['w2', 'employerEIN', '123456789', null],
    ['w2', 'employerEIN', '123 45 6789', null],
    ['1099', 'payerEIN', '123-45-6789', null],
    ['1099', 'payerEIN', '12-3456789', '12-3456789'],
    ['1099', 'payerEIN', '123456789', null],
    ['1099', 'payerEIN', '123 45 6789', null],
  ] as const)('image path keeps a dashed number and blanks %s %s (%s)', async (docType, field, incoming, expected) => {
    state.profile = { consents: consents(true) };
    mocks.recognize.mockResolvedValue(null);
    const extracted = docType === 'w2'
      ? { ...W2_JSON, employerEIN: incoming, employeeSSN: '123-45-6789' }
      : { docType: '1099', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN: incoming, recipientTIN: '123-45-6789', box1Amount: 1200, taxYear: 2025, confidence: 0.95 };
    modelReplies(extracted);
    const body = await (await importDocument(request({ docType, documentImageConsent: 'true' }))).json();
    expect(body.disclosure).toBe('image');
    expect(body.extracted[field]).toBe(expected);
    expect(body.extracted.employeeSSN).toBeUndefined();
    expect(body.extracted.recipientTIN).toBeUndefined();
    const storedRecord = docType === 'w2' ? state.records.w2_income[0] : state.records.income_1099[0];
    expect(storedRecord[field]).toBe(expected ?? '');
    expect(storedRecord.employeeSSN).toBeUndefined();
    expect(storedRecord.recipientTIN).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('123-45-6789');
    expect(JSON.stringify(storedRecord)).not.toContain('123-45-6789');
    if (expected === null) {
      expect(body.verificationRequired).toContain('Check the employer/payer ID');
      expect(JSON.stringify(body)).not.toContain(incoming);
      expect(JSON.stringify(storedRecord)).not.toContain(incoming);
    } else {
      expect(body.verificationRequired).not.toContain('Check the employer/payer ID');
    }
  });

  it('blanks a bare employer number from a photo when box a is omitted and asks to check the ID', async () => {
    state.profile = { consents: consents(true) };
    mocks.recognize.mockResolvedValue(null);
    modelReplies({ ...W2_JSON, employerEIN: '123456789' });
    const body = await (await importDocument(request({ documentImageConsent: 'true' }))).json();
    expect(body.disclosure).toBe('image');
    expect(body.extracted.employerEIN).toBeNull();
    expect(body.extracted.employeeSSN).toBeUndefined();
    expect(state.records.w2_income[0].employerEIN).toBe('');
    expect(state.records.w2_income[0].employeeSSN).toBeUndefined();
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    expect(JSON.stringify(body)).not.toContain('123456789');
    expect(JSON.stringify(state.records.w2_income)).not.toContain('123456789');
  });

  it('does not store a bare number a photo repeats in box a and the employer number', async () => {
    state.profile = { consents: consents(true) };
    mocks.recognize.mockResolvedValue(null);
    modelReplies({ ...W2_JSON, employerEIN: '123456789', employeeSSN: '123456789' });
    const body = await (await importDocument(request({ documentImageConsent: 'true' }))).json();
    expect(body.disclosure).toBe('image');
    expect(body.extracted.employerEIN).toBeNull();
    expect(body.extracted.employeeSSN).toBeUndefined();
    expect(state.records.w2_income[0].employerEIN).toBe('');
    expect(state.records.w2_income[0].employeeSSN).toBeUndefined();
    expect(body.verificationRequired).toContain('Check the employer/payer ID');
    expect(JSON.stringify(body)).not.toContain('123456789');
    expect(JSON.stringify(state.records.w2_income)).not.toContain('123456789');
  });

  it.each([
    ['98-7654321', '98-7654321'],
    ['131313131', null],
  ] as const)('image path 1099 payer number %s resolves to %s and drops the recipient TIN', async (payerEIN, expected) => {
    state.profile = { consents: consents(true) };
    mocks.recognize.mockResolvedValue(null);
    modelReplies({ docType: '1099', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN, recipientTIN: '123-45-6789', recipientName: 'Jordan Demo', box1Amount: 1200, taxYear: 2025, confidence: 0.95 });
    const body = await (await importDocument(request({ docType: '1099', documentImageConsent: 'true' }))).json();
    expect(body.disclosure).toBe('image');
    expect(body.extracted.payerEIN).toBe(expected);
    expect(body.extracted.recipientTIN).toBeUndefined();
    expect(state.records.income_1099[0].payerEIN).toBe(expected ?? '');
    expect(state.records.income_1099[0].recipientTIN).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('123-45-6789');
    if (expected === null) {
      expect(body.verificationRequired).toContain('Check the employer/payer ID');
      expect(JSON.stringify(body)).not.toContain(payerEIN);
      expect(JSON.stringify(state.records.income_1099)).not.toContain(payerEIN);
    } else {
      expect(body.verificationRequired).not.toContain('Check the employer/payer ID');
    }
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

describe('W-2 save that looks like a 1099 asks which form it is', () => {
  const captureLogs = () => {
    const logs: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method => vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(arg => { try { return typeof arg === 'string' ? arg : JSON.stringify(arg); } catch { return String(arg); } }).join(' '));
    }));
    return { logs, restore: () => spies.forEach(spy => spy.mockRestore()) };
  };
  const stable = (record: Record<string, unknown>) => {
    const { importedAt, updatedAt, createdAt, ...rest } = record;
    return rest;
  };
  const freshRecords = () => { state.records = { tax_organizers: state.records.tax_organizers }; };

  it('asks when a W-2 save has a payer label', async () => {
    const seen = captureLogs();
    try {
      for (const line of ["PAYER'S", 'Payer TIN', 'Payer EIN']) {
        mocks.create.mockReset();
        mocks.recognize.mockResolvedValue({ text: `${line} 98-7654321\n1 Wages, tips, other compensation 1000.00`, confidence: 0.95 });
        modelReplies(W2_JSON, W2_JSON);
        const preview = await importDocument(request({ docType: 'w2', commit: 'false' }));
        expect(preview.status, line).toBe(200);
        const body = await preview.json();
        expect(body.needsTypeConfirmation, line).toBe(true);
        expect(JSON.stringify(body.needsTypeConfirmation), line).not.toContain('98-7654321');
        freshRecords();
        const saved = await importDocument(request({ docType: 'w2', commit: 'true' }));
        expect(saved.status, line).toBe(400);
        expect(state.records.w2_income, line).toBeUndefined();
        expect(state.records.income_1099, line).toBeUndefined();
      }
      expect(seen.logs.join('\n')).not.toContain('98-7654321');
    } finally { seen.restore(); }
  });

  it('asks when a W-2 save has a recipient label', async () => {
    for (const line of ["RECIPIENT'S", 'Recipient TIN']) {
      mocks.create.mockReset();
      mocks.recognize.mockResolvedValue({ text: `${line}\n1 Wages, tips, other compensation 1000.00\nb Employer identification number (EIN) 98-7654321`, confidence: 0.95 });
      modelReplies(W2_JSON);
      const body = await (await importDocument(request({ docType: 'w2', commit: 'false' }))).json();
      expect(body.needsTypeConfirmation, line).toBe(true);
    }
  });

  it('asks when a W-2 save contains 1099 box text', async () => {
    for (const phrase of ['Nonemployee compensation', 'Form 1099', '1099-NEC', '1099-MISC', '1099-K', 'Payment card and third party network transactions']) {
      mocks.create.mockReset();
      mocks.recognize.mockResolvedValue({ text: `${phrase}\n1 Wages, tips, other compensation 1000.00\nb Employer identification number (EIN) 98-7654321`, confidence: 0.95 });
      modelReplies(W2_JSON);
      const body = await (await importDocument(request({ docType: 'w2', commit: 'false' }))).json();
      expect(body.needsTypeConfirmation, phrase).toBe(true);
    }
  });

  it('asks when a photo of a W-2 includes a 1099-only field', async () => {
    state.profile = { consents: consents(true) };
    mocks.recognize.mockResolvedValue(null);
    modelReplies({ ...W2_JSON, formVariant: 'NEC' }, { ...W2_JSON, formVariant: 'NEC' });
    const preview = await importDocument(request({ docType: 'w2', commit: 'false', documentImageConsent: 'true' }));
    expect(preview.status).toBe(200);
    const body = await preview.json();
    expect(body.disclosure).toBe('image');
    expect(body.needsTypeConfirmation).toBe(true);
    expect(body.extracted.formVariant).toBeUndefined();
    expect(JSON.stringify(body.needsTypeConfirmation)).not.toContain('98-7654321');
    freshRecords();
    const saved = await importDocument(request({ docType: 'w2', commit: 'true', documentImageConsent: 'true' }));
    expect(saved.status).toBe(400);
    expect(state.records.w2_income).toBeUndefined();
    expect(state.records.income_1099).toBeUndefined();
  });

  it('returns 400 and writes nothing when a triggered W-2 is saved without a choice', async () => {
    const seen = captureLogs();
    try {
      mocks.recognize.mockResolvedValue({ text: "PAYER'S TIN 98-7654321\n1 Wages, tips, other compensation 1000.00", confidence: 0.95 });
      modelReplies(W2_JSON);
      const response = await importDocument(request({ docType: 'w2', commit: 'true' }));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual({ error: 'Choose W-2 or 1099 before saving this document.' });
      expect(JSON.stringify(body)).not.toContain('98-7654321');
      expect(state.records.w2_income).toBeUndefined();
      expect(state.records.income_1099).toBeUndefined();
      expect(Object.keys(state.records)).toEqual(['tax_organizers']);
      expect(seen.logs.join('\n')).not.toContain('98-7654321');
    } finally { seen.restore(); }
  });

  it('saves a confirmed 1099 through the same path as a native 1099 import', async () => {
    const run = async (docType: string, confirmed: string | null, model: Record<string, unknown>, text: string, overrides?: Record<string, unknown>) => {
      freshRecords();
      mocks.create.mockReset();
      mocks.recognize.mockResolvedValue({ text, confidence: 0.95 });
      modelReplies(model);
      const fields: Record<string, string> = { docType, commit: 'true' };
      if (confirmed) fields.confirmedDocType = confirmed;
      if (overrides) fields.overrideFields = JSON.stringify(overrides);
      const response = await importDocument(request(fields));
      expect(response.status).toBe(200);
      const body = await response.json();
      return { body, record: state.records.income_1099[0] as Record<string, unknown> };
    };
    const dashed = "PAYER'S TIN 98-7654321\n1 Nonemployee compensation 1200.00";
    const nativeModel = { docType: '1099', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN: null, box1Amount: 1200, taxYear: 2025, confidence: 0.95, verificationWarnings: [] };
    const w2Model = { docType: 'w2', employerName: 'Synthetic Payer', employerEIN: null, box1Wages: 1200, taxYear: 2025, confidence: 0.95, verificationWarnings: [] };
    const native = await run('1099', null, nativeModel, dashed);
    const confirmed = await run('w2', '1099', w2Model, dashed);
    expect(stable(confirmed.record)).toEqual(stable(native.record));
    expect(confirmed.body.verificationRequired).toEqual(native.body.verificationRequired);
    expect(confirmed.record.payerEIN).toBe('98-7654321');
    expect(confirmed.record.formType).toBe('1099-NEC');
    expect(state.records.w2_income).toBeUndefined();

    const bare = "PAYER'S TIN 123456789\n1 Nonemployee compensation 800.00";
    const nativeBare = await run('1099', null, { ...nativeModel, box1Amount: 800 }, bare);
    const confirmedBare = await run('w2', '1099', { ...w2Model, box1Wages: 800 }, bare);
    expect(stable(confirmedBare.record)).toEqual(stable(nativeBare.record));
    expect(confirmedBare.record.payerEIN).toBe('');
    expect(confirmedBare.body.verificationRequired).toContain('Check the employer/payer ID');
    expect(JSON.stringify(confirmedBare.body)).not.toContain('123456789');
    expect(JSON.stringify(confirmedBare.record)).not.toContain('123456789');

    const edited = await run('w2', '1099', w2Model, dashed, { docType: 'w2', employerName: 'Synthetic Payer', employerEIN: '12-3456789', box1Wages: 900 });
    const nativeEdited = await run('1099', null, nativeModel, dashed, { payerName: 'Synthetic Payer', payerEIN: '12-3456789', box1Amount: 900 });
    expect(stable(edited.record)).toEqual(stable(nativeEdited.record));
    expect(edited.record.payerEIN).toBe('12-3456789');
    expect(edited.record.amount).toBe(900);
  });

  it('saves a confirmed W-2 with typeConfirmedByUser set', async () => {
    mocks.recognize.mockResolvedValue({ text: "PAYER'S TIN 98-7654321\n1 Wages, tips, other compensation 1000.00", confidence: 0.95 });
    modelReplies({ ...W2_JSON, employerEIN: null, box1Wages: 1000 });
    const response = await importDocument(request({ docType: 'w2', commit: 'true', confirmedDocType: 'w2' }));
    expect(response.status).toBe(200);
    expect(state.records.w2_income).toHaveLength(1);
    expect(state.records.w2_income[0].typeConfirmedByUser).toBe(true);
    expect(state.records.w2_income[0].employerEIN).toBe('98-7654321');
    expect(state.records.income_1099).toBeUndefined();
    expect(JSON.stringify(state.records.w2_income)).not.toMatch(/123-45-6789|123456789/);
  });

  it('does not ask for a W-2 Copy B and Copy C that includes the employee notice', async () => {
    // Wording is from the 2026 Form W-2 (https://www.irs.gov/pub/irs-pdf/fw2.pdf): Copy B, Copy C, and the Notice to Employee.
    // That notice names Form W-2, Form 1040, Form W-2c, and Form 843. It does not name a 1099 or a payer.
    const text = [
      "a Employee's social security number 123-45-6789",
      'b Employer identification number (EIN) 98-7654321',
      "c Employer's name, address, and ZIP code Synthetic Employer LLC",
      'd Control number',
      "e Employee's first name and initial Last name Suff.",
      "f Employee's address and ZIP code",
      '1 Wages, tips, other compensation 65000.00',
      '2 Federal income tax withheld 7250.10',
      '3 Social security wages 65000.00',
      '4 Social security tax withheld 4030.00',
      '5 Medicare wages and tips 65000.00',
      '6 Medicare tax withheld 942.50',
      '7 Social security tips',
      '8 Allocated tips',
      '9',
      '10 Dependent care benefits',
      '11 Nonqualified plans',
      '12a See instructions for box 12',
      '13 Statutory employee Retirement plan Third-party sick pay',
      '14a Other',
      '14b Treasury Tipped Occupation Code(s)',
      "15 State Employer's state ID number",
      '16 State wages, tips, etc.',
      '17 State income tax',
      '18 Local wages, tips, etc.',
      '19 Local income tax',
      '20 Locality name',
      'Form W-2 Wage and Tax Statement 2026',
      "Copy B—To Be Filed With Employee's FEDERAL Tax Return.",
      'This information is being furnished to the Internal Revenue Service.',
      "Copy C—For EMPLOYEE'S RECORDS (See Notice to Employee on the back of Copy B.)",
      'This information is being furnished to the Internal Revenue Service. If you are required to file a tax return, a negligence penalty or other sanction may be imposed on you if this income is taxable and you fail to report it.',
      'Future developments. For the latest information about developments related to Form W-2, such as legislation enacted after it was published, go to www.irs.gov/FormW2.',
      'Notice to Employee',
      "Do you have to file? Refer to the Form 1040 instructions to determine if you are required to file a tax return. Even if you don't have to file a tax return, you may be eligible for a refund if box 2 shows an amount or if you are eligible for any credit.",
      "Earned income tax credit (EITC). You may be able to take the EITC for 2026 if your adjusted gross income (AGI) is less than a certain amount. The amount of the credit is based on income and family size. Workers without children could qualify for a smaller credit. You and any qualifying children must have valid social security numbers (SSNs). You can't take the EITC if your investment income is more than the specified amount for 2026 or if income is earned for services provided while you were an inmate at a penal institution. For 2026 income limits and more information, visit www.irs.gov/EITC. See also Pub. 596. Any EITC that is more than your tax liability is refunded to you, but only if you file a tax return.",
      "Employee's social security number (SSN). For your protection, this form may show only the last four digits of your SSN. However, your employer has reported your complete SSN to the IRS and the Social Security Administration (SSA).",
      "Clergy and religious workers. If you aren't subject to social security and Medicare taxes, see Pub. 517.",
      "Corrections. If your name, SSN, or address is incorrect, correct Copies B, C, and 2 and ask your employer to correct your employment record. Be sure to ask the employer to file Form W-2c, Corrected Wage and Tax Statement, with the SSA to correct any name, SSN, or money amount error reported to the SSA on Form W-2. Be sure to get your copies of Form W-2c from your employer for all corrections made so you may file them with your tax return. If your name and SSN are correct but aren't the same as shown on your social security card, you should ask for a new card that displays your correct name at any SSA office or by calling 800-772-1213. You may also visit the SSA website at www.SSA.gov.",
      'Cost of employer-sponsored health coverage (if such cost is provided by the employer). The reporting in box 12, using code DD, of the cost of employer-sponsored health coverage is for your information only. The amount reported with code DD is not taxable.',
      'Credit for excess taxes. If you had more than one employer in 2026 and more than $11,439.00 in social security and/or Tier 1 railroad retirement (RRTA) taxes were withheld, you may be able to claim a credit for the excess against your federal income tax. See the Form 1040 instructions. If you had more than one railroad employer and more than $6,717.90 in Tier 2 RRTA tax was withheld, you may be able to claim a refund on Form 843. See the Instructions for Form 843.',
      '(See also Instructions for Employee on the back of Copy C.)',
    ].join('\n');
    mocks.recognize.mockResolvedValue({ text, confidence: 0.95 });
    modelReplies(W2_JSON);
    const response = await importDocument(request({ docType: 'w2', commit: 'true' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.needsTypeConfirmation).toBeUndefined();
    expect(body.verificationRequired).not.toContain('Check the employer/payer ID');
    expect(state.records.w2_income[0].employerEIN).toBe('98-7654321');
    expect(state.records.w2_income[0].typeConfirmedByUser).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('123-45-6789');
  });

  it('does not treat the word taxpayer as a payer label', async () => {
    const text = [
      'b Employer identification number (EIN) 98-7654321',
      '1 Wages, tips, other compensation 1000.00',
      'Do not accept an IRS individual taxpayer identification number (ITIN) in place of an SSN for employee identification or for Form W-2 reporting.',
    ].join('\n');
    expect(text).toMatch(/\btaxpayer\b/);
    expect(text).not.toMatch(/\bpayer\b/);
    mocks.recognize.mockResolvedValue({ text, confidence: 0.95 });
    modelReplies({ ...W2_JSON, box1Wages: 1000 });
    const body = await (await importDocument(request({ docType: 'w2', commit: 'true' }))).json();
    expect(body.needsTypeConfirmation).toBeUndefined();
    expect(state.records.w2_income).toHaveLength(1);
    expect(state.records.w2_income[0].typeConfirmedByUser).toBeUndefined();
  });
});
