import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeFirestore, type FakeFirestore } from './fixtures/fake-firestore';
import { signDocumentImportConsent } from '@/lib/onboarding/consents';
import { CONSENT_TERMS_VERSION } from '@/lib/onboarding/consents';
import { DOCUMENT_IMPORT_CONSENT_VERSION } from '@/lib/onboarding/document-import-consent';
import { MODEL_DISCLOSURE_LENGTH, MODEL_PURPOSES, defaultConsentExpiry, type ModelPurpose } from '@/lib/openai/consent-contract';
import { analysisTaskId } from '@/lib/ai/analysis-jobs';
import { ruleBasedSuggestion } from '@/lib/transactions/rule-suggestion';
import { bulkConfirmMerchant } from '@/lib/transactions/bulk-confirm';

const state = vi.hoisted(() => ({
  create: vi.fn(),
  construct: vi.fn(),
  uid: 'owner-1',
  ocr: { text: 'Form W-2 Wage and Tax Statement 2026. 1 Wages, tips, other compensation 20,000.00', confidence: 0.95 } as { text: string; confidence: number } | null,
  db: null as FakeFirestore | null,
}));

vi.mock('openai', () => ({
  default: function MockOpenAI(options: unknown) {
    state.construct(options);
    return { chat: { completions: { create: state.create } } };
  },
}));
vi.mock('@/lib/ai/learning-engine', () => ({
  aiLearningEngine: { getLearningContext: async () => null, recordCorrection: async () => undefined },
}));
vi.mock('@/lib/firebase/api-auth', () => ({
  getAuthenticatedUser: async () => ({ user: { uid: state.uid, email: 'owner@example.test', emailVerified: true }, error: null }),
}));
vi.mock('@/lib/firebase/admin', () => {
  const db = createFakeFirestore();
  state.db = db;
  return { adminDb: db, FieldValue: { serverTimestamp: () => new Date(), delete: () => null }, Timestamp: class {} };
});
vi.mock('@/lib/ocr/document-text', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/ocr/document-text')>(),
  recognizeDocumentText: async () => state.ocr,
}));

import { POST as analyze } from '@/app/api/ai/analyze-transaction/route';
import { POST as analyzeAlias } from '@/app/api/openai/analyze-transaction/route';
import { POST as analyzeSingle } from '@/app/api/openai/analyze-single-transaction/route';
import { POST as taxAssistant } from '@/app/api/ai/tax-assistant/route';
import { POST as accountAssistant } from '@/app/api/ai/account-assistant/route';
import { POST as voice } from '@/app/api/ai/parse-voice-command/route';
import { POST as documentImport } from '@/app/api/tax/import-document/route';
import { POST as statementImport } from '@/app/api/tax/import-bank-statement/route';
import { POST as worker } from '@/app/api/internal/analysis-worker/route';
import { GET as readConsent, POST as withdrawConsent } from '@/app/api/settings/model-consent/route';
import { POST as review } from '@/app/api/transactions/[id]/review/route';
import { analyzeTransaction } from '@/lib/ai/analyzeTransaction';
import { enqueueBankTransactionAnalysis, processAnalysisTask } from '@/lib/ai/analysis-jobs';
import * as legacyAnalysis from '@/lib/openai/analysis';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const SECRET = 'synthetic-worker-secret-not-live-32';
const db = () => state.db!;

function disclosure(overrides: Record<string, unknown> = {}) {
  return {
    status: 'granted', recordType: 'disclosure', consentDocumentVersion: 'pending-legal-review',
    purposes: [...MODEL_PURPOSES],
    signedAt: new Date('2020-01-01T00:00:00.000Z'),
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    ...overrides,
  };
}
function profileConsents() {
  return signDocumentImportConsent({
    version: CONSENT_TERMS_VERSION, source: 'sign-up', accepted_at: '2026-01-01T00:00:00.000Z',
    terms: true, bank_data: true, ai_review: true,
  }, 'Synthetic Owner', new Date('2026-01-02T00:00:00.000Z'));
}
function seedOwner(extraProfile: Record<string, unknown> = {}) {
  const uid = state.uid;
  db().records.set(`user_profiles/${uid}`, {
    userId: uid, profession: 'Graphic Designer', state: 'CA', business_entity_type: 'sole_proprietor',
    consents: profileConsents(), ...extraProfile,
  });
  db().records.set(`user_profiles/${uid}/accounts/acct`, { userId: uid, type: 'depository', usageType: 'business', account_id: 'acct' });
  db().records.set(`user_profiles/${uid}/accounts/acct/transactions/tx1`, {
    userId: uid, trans_id: 'tx1', account_id: 'acct', amount: 54.99, date: '2026-03-02',
    merchant_name: 'Adobe Creative Cloud', name: 'Adobe Creative Cloud', category: 'SERVICE_SUBSCRIPTION',
    iso_currency_code: 'USD', pending: false,
  });
}
function grant(purposes?: ModelPurpose[]) {
  db().records.set(`user_profiles/${state.uid}/model_consents/disclosure`, disclosure(purposes ? { purposes } : {}));
}
function json(url: string, body: unknown) {
  return new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
function upload(url: string, fields: Record<string, string>) {
  const form = new FormData();
  form.set('file', new Blob([PNG], { type: 'image/png' }), 'synthetic.png');
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new NextRequest(url, { method: 'POST', body: form });
}
function modelOutput() {
  return {
    status: 'needs_more_info', transaction_kind: 'expense', evidence_ids: ['software-334'],
    is_deductible: null, expense_type: null, category: 'software_subscriptions', deductible_percent: null,
    key_analysis_factor: 'Confirm the subscription is used for client work.',
    customized_reason: 'If this Adobe subscription is used for client design work, it is an ordinary software expense.',
    reasoning_summary: null, irs_refs: null, audit_risk: 'low', audit_risk_rationale: null, confidence: 0.8,
    missing_fields: ['business_purpose'], questions: ['Is this Adobe plan used in your business?'],
    documentation_required: ['Invoice'], reason: null, reason_hash: null,
  };
}
function completion(content: unknown) {
  return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content), refusal: null } }], model: 'gpt-test' };
}
function routedCompletion(request: { messages?: unknown }) {
  const text = JSON.stringify(request);
  if (text.includes('financial document classifier') || text.includes('detectedType')) return completion({ detectedType: 'w2', confidence: 'high' });
  if (text.includes('tax document parser') || text.includes('DOCUMENT TEXT')) return completion({
    docType: 'w2', employerName: 'Synthetic Employer', box1Wages: 20000, box2FederalWithheld: 2000, taxYear: 2026, confidence: 0.95,
  });
  if (text.includes('Extract ALL transactions')) return completion({
    currency: 'USD', bankName: 'Synthetic Bank', accountLast4: '4242', confidence: 'high',
    transactions: [{ date: '2026-03-02', description: 'Adobe', amount: 54.99, category: 'Software', transaction_type: 'debit' }],
  });
  if (text.includes('receipt parser')) return completion({
    currency: 'USD', merchant: 'Adobe', date: '2026-03-02', total: 54.99, category: 'Software', confidence: 'high',
  });
  if (text.includes('voice command parser')) return completion({ type: 'add_expense', data: { amount: 12, merchant: 'Synthetic stationery' }, confidence: 0.9 });
  if (text.includes('Select one read-only account tool')) return completion({ intent: 'prepare_handoff' });
  if (text.includes('missingFactIds')) return completion({ topic: 'vehicles-records', missingFactIds: ['vehicles-records:1'], photoCategories: ['vehicle'] });
  return completion(modelOutput());
}
const assistantBody = () => json('http://localhost/api/ai/tax-assistant', { message: 'Can this synthetic vehicle be deducted?', taxYear: 2026 });
const accountBody = () => json('http://localhost/api/ai/account-assistant', { message: 'Prepare a handoff for my preparer', taxYear: 2026 });
const voiceBody = () => json('http://localhost/api/ai/parse-voice-command', { text: 'Add 12 dollars for synthetic stationery' });
const analyzeBody = () => json('http://localhost/api/ai/analyze-transaction', {
  transactionId: 'tx1',
  transaction: { merchant_name: 'Adobe Creative Cloud', amount: 54.99, category: 'software', date: '2026-03-02' },
});

beforeEach(() => {
  state.create.mockReset();
  state.construct.mockReset();
  state.uid = 'owner-1';
  state.ocr = { text: 'Form W-2 Wage and Tax Statement 2026. 1 Wages, tips, other compensation 20,000.00', confidence: 0.95 };
  db().records.clear();
  seedOwner();
  state.create.mockImplementation(routedCompletion);
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-no-network-key');
  vi.stubEnv('AI_ANALYSIS_ENABLED', 'true');
  vi.stubEnv('MODEL_IMAGE_PROCESSING_APPROVED', '');
  vi.stubEnv('ANALYSIS_WORKER_SECRET', SECRET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function expectNoModel(response: Response) {
  const body = await response.json().catch(() => null) as { code?: string } | null;
  const detail = `status ${response.status} code ${body?.code ?? 'none'} create ${state.create.mock.calls.length}`;
  expect(state.construct.mock.calls.length, detail).toBe(0);
  expect(state.create.mock.calls.length, detail).toBe(0);
  expect(response.status).not.toBe(500);
  expect(response.status).not.toBe(503);
  expect(response.status).toBe(403);
  expect(body).toMatchObject({ code: 'CONSENT_REQUIRED' });
}

describe('entry points make zero model calls without a disclosure grant', () => {
  it('zero calls: document import text', async () => {
    await expectNoModel(await documentImport(upload('http://localhost/api/tax/import-document', { docType: 'w2', commit: 'false' })));
  });
  it('zero calls: document import image fallback', async () => {
    state.ocr = null;
    await expectNoModel(await documentImport(upload('http://localhost/api/tax/import-document', { docType: 'w2', commit: 'false', documentImageConsent: 'true' })));
  });
  it('zero calls: statement import auto-detect', async () => {
    await expectNoModel(await statementImport(upload('http://localhost/api/tax/import-bank-statement', { docType: 'auto', year: '2026' })));
  });
  it('zero calls: statement import statement', async () => {
    await expectNoModel(await statementImport(upload('http://localhost/api/tax/import-bank-statement', { docType: 'bank_statement', year: '2026' })));
  });
  it('zero calls: statement import receipt', async () => {
    await expectNoModel(await statementImport(upload('http://localhost/api/tax/import-bank-statement', { docType: 'receipt', year: '2026' })));
  });
  it('zero calls: analyze transaction route', async () => {
    await expectNoModel(await analyze(analyzeBody()));
  });
  it('zero calls: analyze transaction alias', async () => {
    await expectNoModel(await analyzeAlias(analyzeBody()));
  });
  it('zero calls: analyze single transaction alias', async () => {
    await expectNoModel(await analyzeSingle(analyzeBody()));
  });
  it('zero calls: analyzeTransaction library', async () => {
    await expect(analyzeTransaction({ tx_id: 'tx1', merchant: 'Adobe', amount_usd: 54.99, date_iso: '2026-03-02' }, {
      user_id: state.uid, profession: ['Graphic Designer'], filing_state: 'CA',
    })).resolves.toMatchObject({ success: false, code: 'CONSENT_REQUIRED', retryable: false });
    expect(state.construct).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });
  it('zero calls: legacy analyzeTransaction', async () => {
    await expect(legacyAnalysis.analyzeTransaction({ merchant_name: 'Adobe', amount: 10, userId: state.uid }, { user_id: state.uid })).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    expect(state.construct).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });
  it('zero calls: legacy analyzeTransactionDeductibility', async () => {
    await expect(legacyAnalysis.analyzeTransactionDeductibility({ merchant_name: 'Adobe', amount: 10, userId: state.uid })).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    expect(state.construct).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });
  it('zero calls: analyzeAllTransactions', async () => {
    const result = await legacyAnalysis.analyzeAllTransactions(state.uid);
    expect(state.construct).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, code: 'CONSENT_REQUIRED' });
  });
  it('zero calls: generateTaxSummary', async () => {
    const result = await legacyAnalysis.generateTaxSummary(state.uid);
    expect(state.construct).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, code: 'CONSENT_REQUIRED' });
  });
  it('zero calls: analysis worker', async () => {
    const address = { userId: state.uid, accountId: 'acct', transactionId: 'tx1' };
    expect((await enqueueBankTransactionAnalysis(address)).status).toBe('queued');
    const taskId = analysisTaskId(address);
    const generation = db().records.get(`analysis_tasks/${taskId}`)!.generation as string;
    const response = await worker(json('http://127.0.0.1:3000/api/internal/analysis-worker', { action: 'process', taskId, generation }).clone());
    const request = new NextRequest('http://127.0.0.1:3000/api/internal/analysis-worker', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-analysis-worker-secret': SECRET },
      body: JSON.stringify({ action: 'process', taskId, generation }),
    });
    const result = await worker(request);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ code: 'CONSENT_REQUIRED', retry: false });
    expect(response).toBeTruthy();
    expect(state.construct).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });
  it('zero calls: firestore analysis trigger', async () => {
    const address = { userId: state.uid, accountId: 'acct', transactionId: 'tx1' };
    await enqueueBankTransactionAnalysis(address);
    const taskId = analysisTaskId(address);
    const generation = String(db().records.get(`analysis_tasks/${taskId}`)!.generation);
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    vi.stubEnv('GCLOUD_PROJECT', 'demo-writeoff-security');
    vi.stubEnv('ANALYSIS_WORKER_ORIGIN', 'http://127.0.0.1:3000');
    vi.stubEnv('ANALYSIS_WORKER_SECRET', SECRET);
    vi.stubGlobal('fetch', async (_input: unknown, init?: RequestInit) => {
      const response = await worker(new NextRequest('http://127.0.0.1:3000/api/internal/analysis-worker', {
        method: 'POST', headers: init?.headers, body: init?.body as string,
      }));
      return new Response(await response.text(), { status: response.status, headers: { 'content-type': 'application/json' } });
    });
    const { processBankTransactionAnalysis } = await import('../functions-analysis/src/index');
    await processBankTransactionAnalysis.run({
      specversion: '1.0', id: 'evt', source: 'test', type: 'google.cloud.firestore.document.v1.written',
      time: new Date().toISOString(),
      params: { taskId },
      data: {
        before: { data: () => ({ status: 'paused', generation: 'previous-generation' }) },
        after: { data: () => ({ status: 'queued', generation }) },
      },
    });
    expect(state.construct).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
    expect(db().records.get(`analysis_tasks/${taskId}`)?.lastErrorCode).toBe('CONSENT_REQUIRED');
  });
  it('zero calls: tax assistant', async () => {
    await expectNoModel(await taxAssistant(assistantBody()));
  });
  it('zero calls: account assistant', async () => {
    await expectNoModel(await accountAssistant(accountBody()));
  });
  it('zero calls: voice command', async () => {
    await expectNoModel(await voice(voiceBody()));
  });
  it('zero calls: missing provider configuration still refuses before a model call', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('AI_ANALYSIS_ENABLED', 'false');
    const calls = [
      ['analyze', () => analyze(analyzeBody())],
      ['tax', () => taxAssistant(assistantBody())],
      ['account', () => accountAssistant(accountBody())],
      ['voice', () => voice(voiceBody())],
      ['document', () => documentImport(upload('http://localhost/api/tax/import-document', { docType: 'w2', commit: 'false' }))],
      ['statement', () => statementImport(upload('http://localhost/api/tax/import-bank-statement', { docType: 'receipt', year: '2026' }))],
    ] as const;
    for (const [, call] of calls) await expectNoModel(await call());
  });
});

describe('granted disclosure reaches the model once', () => {
  beforeEach(() => grant());
  it('works for each user-facing entry point', async () => {
    vi.stubEnv('MODEL_IMAGE_PROCESSING_APPROVED', 'true');
    expect((await documentImport(upload('http://localhost/api/tax/import-document', { docType: 'w2', commit: 'false' }))).status).toBe(200);
    expect((await statementImport(upload('http://localhost/api/tax/import-bank-statement', { docType: 'auto', year: '2026' }))).status).toBe(200);
    expect((await statementImport(upload('http://localhost/api/tax/import-bank-statement', { docType: 'bank_statement', year: '2026' }))).status).toBe(200);
    expect((await statementImport(upload('http://localhost/api/tax/import-bank-statement', { docType: 'receipt', year: '2026' }))).status).toBe(200);
    expect((await taxAssistant(assistantBody())).status).toBe(200);
    expect((await accountAssistant(accountBody())).status).toBe(200);
    expect((await voice(voiceBody())).status).toBe(200);
    const analyzed = await analyze(analyzeBody());
    expect(analyzed.status).toBe(200);
    expect(state.create.mock.calls.length).toBeGreaterThanOrEqual(8);
    expect(state.construct).toHaveBeenCalled();
    db().records.delete(`user_profiles/${state.uid}/model_consents/disclosure`);
    state.construct.mockClear();
    state.create.mockClear();
    await expectNoModel(await accountAssistant(accountBody()));
  });
  it('works for the analysis library and worker', async () => {
    const direct = await analyzeTransaction({ tx_id: 'tx1', merchant: 'Adobe', amount_usd: 54.99, date_iso: '2026-03-02' }, {
      user_id: state.uid, profession: ['Graphic Designer'], filing_state: 'CA',
    });
    expect(direct.success).toBe(true);
    const address = { userId: state.uid, accountId: 'acct', transactionId: 'tx1' };
    await enqueueBankTransactionAnalysis(address);
    const taskId = analysisTaskId(address);
    const generation = String(db().records.get(`analysis_tasks/${taskId}`)!.generation);
    const result = await processAnalysisTask(taskId, generation);
    expect(result).toMatchObject({ status: 'completed', retry: false });
    expect(state.create).toHaveBeenCalled();
    db().records.delete(`user_profiles/${state.uid}/model_consents/disclosure`);
    state.construct.mockClear();
    state.create.mockClear();
    const blocked = await analyzeTransaction({ tx_id: 'tx1', merchant: 'Adobe', amount_usd: 54.99, date_iso: '2026-03-02' }, {
      user_id: state.uid, profession: ['Graphic Designer'], filing_state: 'CA',
    });
    expect(blocked).toMatchObject({ success: false, code: 'CONSENT_REQUIRED' });
    expect(state.construct).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });
});

describe('consent refusals make zero model calls on the next request', () => {
  it('withdrawn and expired records refuse the next request', async () => {
    grant();
    const withdrawn = await withdrawConsent(json('http://localhost/api/settings/model-consent', { action: 'withdraw' }));
    expect(withdrawn.status).toBe(200);
    expect(await withdrawn.json()).toMatchObject({ status: 'withdrawn' });
    await expectNoModel(await voice(voiceBody()));
    state.construct.mockClear();
    state.create.mockClear();
    grant();
    db().records.set(`user_profiles/${state.uid}/model_consents/disclosure`, disclosure({ expiresAt: new Date('2020-02-01T00:00:00.000Z') }));
    await expectNoModel(await voice(voiceBody()));
  });
  it('refuses a purpose the disclosure does not cover', async () => {
    grant(['document_text']);
    await expectNoModel(await voice(voiceBody()));
  });
  it('does not treat a reuse record as disclosure', async () => {
    db().records.set(`user_profiles/${state.uid}/model_consents/reuse`, disclosure({ recordType: 'reuse', status: 'granted' }));
    await expectNoModel(await voice(voiceBody()));
    db().records.set(`user_profiles/${state.uid}/model_consents/disclosure`, disclosure({ status: 'declined' }));
    state.construct.mockClear();
    state.create.mockClear();
    await expectNoModel(await voice(voiceBody()));
  });
  it('allows one second before expiry and refuses one second after with no model call', async () => {
    const signedAt = new Date('2026-03-01T00:00:00.000Z');
    const expiresAt = defaultConsentExpiry(signedAt);
    grant();
    db().records.set(`user_profiles/${state.uid}/model_consents/disclosure`, disclosure({
      signedAt, expiresAt, consentLength: MODEL_DISCLOSURE_LENGTH,
    }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date(expiresAt.getTime() - 1000));
    expect((await voice(voiceBody())).status).toBe(200);
    expect(state.create).toHaveBeenCalledTimes(1);
    state.construct.mockClear();
    state.create.mockClear();
    vi.setSystemTime(new Date(expiresAt.getTime() + 1000));
    await expectNoModel(await voice(voiceBody()));
    const view = await readConsent(new NextRequest('http://localhost/api/settings/model-consent'));
    expect(await view.json()).toMatchObject({ status: 'declined' });
  });
  it('defaults a grant with no stored length to one year from signing', async () => {
    const signedAt = new Date('2025-06-01T00:00:00.000Z');
    const expiresAt = defaultConsentExpiry(signedAt);
    const record = disclosure({ signedAt });
    delete record.expiresAt;
    db().records.set(`user_profiles/${state.uid}/model_consents/disclosure`, record);
    expect(db().records.get(`user_profiles/${state.uid}/model_consents/disclosure`)).not.toHaveProperty('consentLength');
    expect(db().records.get(`user_profiles/${state.uid}/model_consents/disclosure`)).not.toHaveProperty('expiresAt');
    vi.useFakeTimers();
    vi.setSystemTime(new Date(expiresAt.getTime() - 1000));
    expect((await voice(voiceBody())).status).toBe(200);
    expect(state.create).toHaveBeenCalledTimes(1);
    state.construct.mockClear();
    state.create.mockClear();
    vi.setSystemTime(new Date(expiresAt.getTime() + 1000));
    await expectNoModel(await voice(voiceBody()));
  });
  it('refuses a request time before signedAt and allows the same instant', async () => {
    const signedAt = new Date('2026-06-01T12:00:00.000Z');
    grant();
    db().records.set(`user_profiles/${state.uid}/model_consents/disclosure`, disclosure({ signedAt, expiresAt: new Date('2099-01-01T00:00:00.000Z') }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date(signedAt.getTime() - 1));
    await expectNoModel(await voice(voiceBody()));
    state.construct.mockClear();
    state.create.mockClear();
    vi.setSystemTime(signedAt);
    state.create.mockResolvedValue(completion({ type: 'unknown', data: {}, confidence: 0.2 }));
    expect((await voice(voiceBody())).status).toBe(200);
    expect(state.create).toHaveBeenCalledTimes(1);
  });
  it('blocks statement auto-detect and document image fallback while image processing is not approved', async () => {
    grant();
    vi.stubEnv('MODEL_IMAGE_PROCESSING_APPROVED', '');
    state.ocr = null;
    const image = await documentImport(upload('http://localhost/api/tax/import-document', { docType: 'w2', commit: 'false', documentImageConsent: 'true' }));
    const detected = await statementImport(upload('http://localhost/api/tax/import-bank-statement', { docType: 'auto', year: '2026' }));
    expect(image.status).toBe(403);
    expect(detected.status).toBe(403);
    expect((await image.json()).code).toBe('IMAGE_PROCESSING_NOT_APPROVED');
    expect((await detected.json()).code).toBe('IMAGE_PROCESSING_NOT_APPROVED');
    expect(state.construct).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });
});

describe('declined review still confirms rule and manual categories', () => {
  it('confirms a rule suggestion and a manually picked category without a model call', async () => {
    const adobe = ruleBasedSuggestion({ merchant_name: 'Adobe Creative Cloud', amount: 54.99 });
    expect(adobe?.category).toBe('software_subscriptions');
    const confirmed = await review(json('http://localhost/api/transactions/tx1/review', {
      action: 'confirm', accountId: 'acct', suggestionId: adobe!.id,
    }), { params: Promise.resolve({ id: 'tx1' }) });
    expect(confirmed.status).toBe(200);
    expect(db().records.get(`user_profiles/${state.uid}/accounts/acct/transactions/tx1`)).toMatchObject({
      review_status: 'confirmed', category: 'SERVICE_SUBSCRIPTION',
    });
    db().records.set(`user_profiles/${state.uid}/accounts/acct/transactions/plain`, {
      userId: state.uid, trans_id: 'plain', account_id: 'acct', amount: 18, date: '2026-04-01',
      merchant_name: 'ZZZ Not A Merchant 991', iso_currency_code: 'USD', pending: false,
    });
    expect(ruleBasedSuggestion({ merchant_name: 'ZZZ Not A Merchant 991', amount: 18 })).toBeNull();
    const manual = await review(json('http://localhost/api/transactions/plain/review', {
      action: 'confirm', accountId: 'acct', category: 'supplies_small_tools', transactionKind: 'expense', isDeductible: false,
    }), { params: Promise.resolve({ id: 'plain' }) });
    expect(manual.status).toBe(200);
    expect(db().records.get(`user_profiles/${state.uid}/accounts/acct/transactions/plain`)).toMatchObject({
      review_status: 'confirmed', review_source: 'user_corrected', is_deductible: false,
    });
    db().records.set(`user_profiles/${state.uid}/accounts/acct/transactions/tx-adobe-2`, {
      userId: state.uid, trans_id: 'tx-adobe-2', account_id: 'acct', amount: 12.99, date: '2026-03-03',
      merchant_name: 'Adobe Creative Cloud', name: 'Adobe Creative Cloud', category: 'SERVICE_SUBSCRIPTION',
      iso_currency_code: 'USD', pending: false,
    });
    const bulk = await bulkConfirmMerchant(state.uid, { merchantKey: 'Adobe Creative Cloud', decision: 'business', category: 'software_subscriptions', businessPurpose: 'Client design work' });
    expect(bulk.updated + bulk.skipped).toBeGreaterThan(0);
    expect(state.construct).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });
  it('reads a missing disclosure as declined and does not accept a grant from the settings API', async () => {
    const missing = await readConsent(new NextRequest('http://localhost/api/settings/model-consent'));
    expect(missing.status).toBe(200);
    expect(await missing.json()).toMatchObject({ status: 'declined', purposes: [] });
    const grantAttempt = await withdrawConsent(json('http://localhost/api/settings/model-consent', { action: 'grant', uid: 'someone-else' }));
    expect(grantAttempt.status).toBe(400);
  });
});

void DOCUMENT_IMPORT_CONSENT_VERSION;
