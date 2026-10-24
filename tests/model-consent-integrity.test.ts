import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeFirestore, type FakeFirestore } from './fixtures/fake-firestore';
import { signDocumentImportConsent, CONSENT_TERMS_VERSION } from '@/lib/onboarding/consents';
import { MODEL_CONSENT_UNAVAILABLE, type ModelPurpose } from '@/lib/openai/consent-contract';

const state = vi.hoisted(() => ({
  create: vi.fn(),
  construct: vi.fn(),
  uid: 'owner-1',
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

import { POST as analyze } from '@/app/api/ai/analyze-transaction/route';
import { POST as voice } from '@/app/api/ai/parse-voice-command/route';
import { GET as readConsent, POST as postConsent } from '@/app/api/settings/model-consent/route';
import { getOpenAIClientOrThrow } from '@/lib/openai/client';
import { readReuseConsent } from '@/lib/openai/consent';

const zone = 'America/Los_Angeles';
const version = 'pending-legal-review';
const db = () => state.db!;
const disclosurePath = () => `user_profiles/${state.uid}/model_consents/disclosure`;
const reusePath = () => `user_profiles/${state.uid}/model_consents/reuse`;
const signedA = new Date('2026-01-10T20:00:00.000Z');
const expiresA = new Date('2027-01-10T20:00:00.000Z');
const signedB = new Date('2026-06-10T19:00:00.000Z');
const expiresB = new Date('2027-06-10T19:00:00.000Z');
const during = new Date('2026-06-01T17:00:00.000Z');
const jan9 = new Date('2027-01-09T20:00:00.000Z');
const jan10 = new Date('2027-01-10T20:00:00.000Z');
const june9 = new Date('2027-06-09T19:00:00.000Z');
const june10 = new Date('2027-06-10T19:00:00.000Z');

function profileConsents() {
  return signDocumentImportConsent({
    version: CONSENT_TERMS_VERSION, source: 'sign-up', accepted_at: '2026-01-01T00:00:00.000Z',
    terms: true, bank_data: true, ai_review: true,
  }, 'Synthetic Owner', new Date('2026-01-02T00:00:00.000Z'));
}
function seedOwner() {
  const uid = state.uid;
  db().records.set(`user_profiles/${uid}`, {
    userId: uid, profession: 'Graphic Designer', state: 'CA', business_entity_type: 'sole_proprietor',
    consents: profileConsents(),
  });
  db().records.set(`user_profiles/${uid}/accounts/acct`, { userId: uid, type: 'depository', usageType: 'business', account_id: 'acct' });
  db().records.set(`user_profiles/${uid}/accounts/acct/transactions/tx1`, {
    userId: uid, trans_id: 'tx1', account_id: 'acct', amount: 54.99, date: '2026-03-02',
    merchant_name: 'Adobe Creative Cloud', name: 'Adobe Creative Cloud', category: 'SERVICE_SUBSCRIPTION',
    iso_currency_code: 'USD', pending: false,
  });
}
function json(url: string, body: unknown) {
  return new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
function completion(content: unknown) {
  return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content), refusal: null } }], model: 'gpt-test' };
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
function voiceBody() {
  return json('http://localhost/api/ai/parse-voice-command', { text: 'Add 12 dollars for synthetic stationery' });
}
function analyzeBody() {
  return json('http://localhost/api/ai/analyze-transaction', {
    transactionId: 'tx1',
    transaction: { merchant_name: 'Adobe Creative Cloud', amount: 54.99, category: 'software', date: '2026-03-02' },
  });
}
function disclosure(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'granted', recordType: 'disclosure', consentDocumentVersion: version,
    purposes: ['voice_command'], signedAt: signedA, expiresAt: expiresA, timeZone: zone,
    ...overrides,
  };
}
function storeDisclosure(overrides: Record<string, unknown> = {}) {
  db().records.set(disclosurePath(), disclosure(overrides));
}
async function accept(purpose: ModelPurpose, at: Date) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
  const response = await postConsent(json('http://localhost/api/settings/model-consent', {
    action: 'accept', acknowledged: true, signedName: 'Synthetic Owner', purpose, timeZone: zone,
  }));
  expect(response.status, await response.clone().text()).toBe(200);
}
function clearCalls() {
  state.construct.mockClear();
  state.create.mockClear();
}
async function expectRouteBlocked(response: Response) {
  const body = await response.json() as { code?: string; error?: string; reason?: string };
  expect(state.construct).not.toHaveBeenCalled();
  expect(state.create).not.toHaveBeenCalled();
  expect(response.status).toBe(403);
  expect(body).toMatchObject({ code: 'CONSENT_REQUIRED', error: MODEL_CONSENT_UNAVAILABLE });
  expect(body.reason).toBeUndefined();
}
async function expectClientRefusal(purpose: ModelPurpose, reason: string) {
  clearCalls();
  await expect(getOpenAIClientOrThrow({
    uid: state.uid, purpose, requestedAt: new Date(),
  })).rejects.toMatchObject({ status: 403, code: 'CONSENT_REQUIRED', reason });
  expect(state.construct).not.toHaveBeenCalled();
  expect(state.create).not.toHaveBeenCalled();
}

beforeEach(() => {
  state.create.mockReset();
  state.construct.mockReset();
  state.uid = 'owner-1';
  db().records.clear();
  seedOwner();
  state.create.mockImplementation(request => {
    const text = JSON.stringify(request);
    if (text.includes('voice command parser')) return completion({ type: 'add_expense', data: { amount: 12, merchant: 'Synthetic stationery' }, confidence: 0.9 });
    return completion(modelOutput());
  });
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-no-network-key');
  vi.stubEnv('AI_ANALYSIS_ENABLED', 'true');
  vi.stubEnv('MODEL_IMAGE_PROCESSING_APPROVED', '');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('missing or unreadable consent dates fail closed', () => {
  it.each([
    ['missing', undefined],
    ['empty string', ''],
    ['garbage', 'garbage'],
    ['plain object', {}],
    ['NaN', Number.NaN],
    ['boolean', true],
  ])('refuses expiresAt %s through the real client and returns 403', async (_label, expiresAt) => {
    const record = disclosure();
    if (expiresAt === undefined) delete record.expiresAt;
    else record.expiresAt = expiresAt;
    db().records.set(disclosurePath(), record);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(during);
    await expectClientRefusal('voice_command', 'invalid_record');
    await expectRouteBlocked(await voice(voiceBody()));
  });

  it.each([
    ['empty string', ''],
    ['garbage', 'garbage'],
    ['plain object', {}],
    ['NaN', Number.NaN],
    ['boolean', true],
  ])('refuses signedAt %s through the real client and returns 403', async (_label, signedAt) => {
    storeDisclosure({ signedAt });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(during);
    await expectClientRefusal('voice_command', 'invalid_record');
    await expectRouteBlocked(await voice(voiceBody()));
  });

  it('refuses an expiresAt of 9999-12-31', async () => {
    storeDisclosure({ expiresAt: '9999-12-31' });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(during);
    await expectClientRefusal('voice_command', 'invalid_record');
    await expectRouteBlocked(await voice(voiceBody()));
  });

  it('refuses an expiresAt equal to signedAt', async () => {
    storeDisclosure({ signedAt: signedA, expiresAt: new Date(signedA.getTime()) });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(signedA);
    await expectClientRefusal('voice_command', 'invalid_record');
    await expectRouteBlocked(await voice(voiceBody()));
  });

  it('refuses an expiresAt one day past the anniversary in the signing zone', async () => {
    storeDisclosure({ signedAt: signedA, expiresAt: new Date('2027-01-11T20:00:00.000Z'), timeZone: zone });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(during);
    await expectClientRefusal('voice_command', 'invalid_record');
    await expectRouteBlocked(await voice(voiceBody()));
  });
});

describe('purpose grants keep their own dates', () => {
  it('lets purpose A keep its year after purpose B is granted', async () => {
    await accept('transaction_analysis', signedA);
    await accept('voice_command', signedB);
    const stored = db().records.get(disclosurePath())!;
    const grants = stored.purposeGrants as Record<string, { signedAt: Date; expiresAt: Date; timeZone: string }>;
    expect(grants.transaction_analysis.signedAt.toISOString()).toBe(signedA.toISOString());
    expect(grants.transaction_analysis.expiresAt.toISOString()).toBe(expiresA.toISOString());
    expect(grants.transaction_analysis.timeZone).toBe(zone);
    expect(grants.voice_command.signedAt.toISOString()).toBe(signedB.toISOString());
    expect(grants.voice_command.expiresAt.toISOString()).toBe(expiresB.toISOString());
    expect(stored.purposes).toEqual(['transaction_analysis', 'voice_command']);

    vi.setSystemTime(jan9);
    clearCalls();
    await expect(getOpenAIClientOrThrow({
      uid: state.uid, purpose: 'transaction_analysis', requestedAt: new Date(),
    })).resolves.toBeTruthy();
    expect(state.construct).toHaveBeenCalled();
    clearCalls();
    expect((await analyze(analyzeBody())).status).toBe(200);
    expect(state.create).toHaveBeenCalled();
    clearCalls();
    expect((await voice(voiceBody())).status).toBe(200);
    expect(state.create).toHaveBeenCalled();

    vi.setSystemTime(jan10);
    await expectClientRefusal('transaction_analysis', 'expired');
    await expectRouteBlocked(await analyze(analyzeBody()));
    clearCalls();
    expect((await voice(voiceBody())).status).toBe(200);
    expect(state.create).toHaveBeenCalled();

    vi.setSystemTime(june9);
    clearCalls();
    expect((await voice(voiceBody())).status).toBe(200);
    expect(state.create).toHaveBeenCalled();
    vi.setSystemTime(june10);
    await expectClientRefusal('voice_command', 'expired');
    await expectRouteBlocked(await voice(voiceBody()));
  });

  it('blocks both purposes after withdrawal clears them', async () => {
    await accept('transaction_analysis', signedA);
    await accept('voice_command', signedB);
    vi.setSystemTime(during);
    const withdrawn = await postConsent(json('http://localhost/api/settings/model-consent', { action: 'withdraw' }));
    expect(withdrawn.status).toBe(200);
    expect(await withdrawn.json()).toMatchObject({ status: 'withdrawn', purposes: [] });
    const stored = db().records.get(disclosurePath())!;
    expect(stored.status).toBe('withdrawn');
    expect(stored.purposes).toEqual([]);
    expect(stored.purposeGrants).toEqual({});
    await expectClientRefusal('transaction_analysis', 'not_granted');
    await expectRouteBlocked(await analyze(analyzeBody()));
    await expectClientRefusal('voice_command', 'not_granted');
    await expectRouteBlocked(await voice(voiceBody()));
  });

  it('reads a legacy record as one shared window for each listed purpose', async () => {
    db().records.set(disclosurePath(), {
      status: 'granted', recordType: 'disclosure', consentDocumentVersion: version,
      purposes: ['transaction_analysis', 'voice_command'],
      signedAt: signedA, expiresAt: expiresA, timeZone: zone,
    });
    expect(db().records.get(disclosurePath())).not.toHaveProperty('purposeGrants');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(jan9);
    clearCalls();
    expect((await analyze(analyzeBody())).status).toBe(200);
    expect(state.create).toHaveBeenCalled();
    clearCalls();
    expect((await voice(voiceBody())).status).toBe(200);
    expect(state.create).toHaveBeenCalled();
    vi.setSystemTime(jan10);
    await expectClientRefusal('transaction_analysis', 'expired');
    await expectRouteBlocked(await analyze(analyzeBody()));
    await expectClientRefusal('voice_command', 'expired');
    await expectRouteBlocked(await voice(voiceBody()));
  });

  it('keeps a legacy purpose year when a later purpose is granted', async () => {
    db().records.set(disclosurePath(), {
      status: 'granted', recordType: 'disclosure', consentDocumentVersion: version,
      purposes: ['transaction_analysis'], signedAt: signedA, expiresAt: expiresA, timeZone: zone,
    });
    await accept('voice_command', signedB);
    const grants = db().records.get(disclosurePath())!.purposeGrants as Record<string, { signedAt: Date; expiresAt: Date }>;
    expect(grants.transaction_analysis.signedAt.toISOString()).toBe(signedA.toISOString());
    expect(grants.transaction_analysis.expiresAt.toISOString()).toBe(expiresA.toISOString());
    vi.setSystemTime(jan9);
    clearCalls();
    await expect(getOpenAIClientOrThrow({
      uid: state.uid, purpose: 'transaction_analysis', requestedAt: new Date(),
    })).resolves.toBeTruthy();
    vi.setSystemTime(jan10);
    await expectClientRefusal('transaction_analysis', 'expired');
    clearCalls();
    await expect(getOpenAIClientOrThrow({
      uid: state.uid, purpose: 'voice_command', requestedAt: new Date(),
    })).resolves.toBeTruthy();
  });

  it('fails closed for a per purpose entry with no expiresAt', async () => {
    db().records.set(disclosurePath(), {
      status: 'granted', recordType: 'disclosure', consentDocumentVersion: version,
      purposes: ['voice_command', 'transaction_analysis'],
      signedAt: signedA, expiresAt: expiresA, timeZone: zone,
      purposeGrants: {
        voice_command: { signedAt: signedA, timeZone: zone },
        transaction_analysis: { signedAt: signedA, expiresAt: expiresA, timeZone: zone },
      },
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(during);
    await expectClientRefusal('voice_command', 'invalid_record');
    await expectRouteBlocked(await voice(voiceBody()));
    clearCalls();
    await expect(getOpenAIClientOrThrow({
      uid: state.uid, purpose: 'transaction_analysis', requestedAt: new Date(),
    })).resolves.toBeTruthy();
    expect(state.construct).toHaveBeenCalled();
  });
});

describe('reuse records use the same date rules', () => {
  function reuse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      status: 'granted', recordType: 'reuse', consentDocumentVersion: version,
      purposes: [] as string[], signedAt: signedA, expiresAt: expiresA, timeZone: zone,
      ...overrides,
    };
  }

  it.each([
    ['missing', undefined],
    ['empty string', ''],
    ['garbage', 'garbage'],
    ['plain object', {}],
    ['9999-12-31', '9999-12-31'],
  ])('does not treat reuse expiresAt %s as granted', async (_label, expiresAt) => {
    const record = reuse();
    if (expiresAt === undefined) delete record.expiresAt;
    else record.expiresAt = expiresAt;
    expect(readReuseConsent(record, during)).toBeNull();
    db().records.set(reusePath(), record);
    const response = await readConsent(new NextRequest('http://localhost/api/settings/model-consent'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reuse: { status: 'declined', recordType: null } });
  });

  it('refuses reuse when expiresAt equals signedAt or is one day past the anniversary', () => {
    expect(readReuseConsent(reuse({ expiresAt: new Date(signedA.getTime()) }), signedA)).toBeNull();
    expect(readReuseConsent(reuse({ expiresAt: new Date('2027-01-11T20:00:00.000Z') }), during)).toBeNull();
  });

  it('checks reuse expiry per purpose and fails closed when a purpose has no expiresAt', () => {
    const record = reuse({
      purposes: ['voice_command', 'transaction_analysis'],
      purposeGrants: {
        voice_command: { signedAt: signedA, timeZone: zone },
        transaction_analysis: { signedAt: signedA, expiresAt: new Date('2026-02-10T20:00:00.000Z'), timeZone: zone },
      },
    });
    expect(readReuseConsent(record, during)?.purposes).toEqual([]);
    const live = reuse({
      purposes: ['voice_command', 'transaction_analysis'],
      purposeGrants: {
        voice_command: { signedAt: signedA, expiresAt: new Date('2026-02-10T20:00:00.000Z'), timeZone: zone },
        transaction_analysis: { signedAt: signedA, expiresAt: expiresA, timeZone: zone },
      },
    });
    expect(readReuseConsent(live, during)?.purposes).toEqual(['transaction_analysis']);
  });
});
