import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  analyze: vi.fn(),
  profile: vi.fn(),
  convertContext: vi.fn(),
  missingFields: vi.fn(),
  collectionGroup: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  get: vi.fn(),
  claim: vi.fn(),
  persist: vi.fn(),
  release: vi.fn(),
}));

vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: mocks.authenticate }));
vi.mock('@/lib/ai/analyzeTransaction', () => ({
  analyzeTransactionWithRetry: mocks.analyze,
  convertToEnhancedContext: mocks.convertContext,
  findMissingUserFields: mocks.missingFields,
}));
vi.mock('@/lib/ai/profile-context', () => ({ getAnalysisProfile: mocks.profile, analysisProfileHash: () => 'synthetic-profile-hash' }));
vi.mock('@/lib/ai/analysis-persistence', () => ({
  claimAnalysisLease: mocks.claim, persistAnalysisSuggestion: mocks.persist, releaseAnalysisLease: mocks.release,
  analysisSuggestionUpdate: () => ({ ai: { status_label: 'Likely Deductible' }, analysisUpdatedAt: '2026-09-16T12:00:00.000Z' }),
}));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collectionGroup: mocks.collectionGroup } }));

import { POST } from '../app/api/ai/analyze-transaction/route';

const body = {
  transactionId: 'synthetic-office-transaction',
  transaction: {
    merchant_name: 'Synthetic office supplies', amount: 35,
    category: 'office_supplies', date: '2026-06-15',
  },
};
let nextUser = 0;
let uid: string;

function request(value: unknown = body) {
  return new NextRequest('http://localhost/api/ai/analyze-transaction', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
  });
}

function expectNoAnalysisWork() {
  for (const mock of [mocks.profile, mocks.claim, mocks.convertContext,
    mocks.missingFields, mocks.analyze, mocks.collectionGroup, mocks.persist]) {
    expect(mock).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-key-provider-is-mocked');
  vi.stubEnv('AI_ANALYSIS_ENABLED', undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  uid = `availability-test-${++nextUser}`;
  mocks.authenticate.mockResolvedValue({ user: { uid }, error: null });
  mocks.profile.mockResolvedValue({ data: { profession: 'Designer' }, error: null });
  mocks.claim.mockResolvedValue({ status: 'claimed', lease: { token: 'synthetic-lease', inputHash: 'hash', expiresAt: Date.now()+60000 }, data: { ...body.transaction, iso_currency_code: 'USD', pending: false, notes: 'Saved owner context' } });
  mocks.persist.mockResolvedValue({ status: 'saved' });
  mocks.release.mockResolvedValue(undefined);
  mocks.convertContext.mockReturnValue({ profession: 'Designer' });
  mocks.missingFields.mockReturnValue([]);
  mocks.analyze.mockResolvedValue({
    success: true,
    result: {
      status: 'ok', is_deductible: true, category: 'supplies_small_tools',
      confidence: 0.9, customized_reason: 'Synthetic suggestion requiring review',
      reasoning_summary: 'Synthetic analysis', irs_refs: [],
    },
  });
  const query = { where: mocks.where, limit: mocks.limit, get: mocks.get };
  mocks.collectionGroup.mockReturnValue(query);
  mocks.where.mockReturnValue(query);
  mocks.limit.mockReturnValue(query);
  mocks.get.mockResolvedValue({ empty: false, docs: [{ ref: { path: `user_profiles/${uid}/accounts/owned-account/transactions/${body.transactionId}` } }] });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('transaction analysis availability', () => {
  it.each([undefined, '', ' \t\n '])('returns a quiet manual-review response for an unavailable key (%j)', async (key) => {
    vi.stubEnv('OPENAI_API_KEY', key);
    const req = request();
    const readBody = vi.spyOn(req, 'json');
    const response = await POST(req);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 'AI_UNAVAILABLE',
      error: 'AI analysis is currently unavailable. You can review and classify this transaction manually.',
    });
    expect(mocks.authenticate).toHaveBeenCalledWith(req);
    expect(readBody).not.toHaveBeenCalled();
    expectNoAnalysisWork();
    expect(console.error).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([undefined, ' ', 'synthetic-key-provider-is-mocked'])('requires authentication before checking availability (%j)', async (key) => {
    vi.stubEnv('OPENAI_API_KEY', key);
    mocks.authenticate.mockResolvedValue({ user: null, error: 'Unauthorized' });
    const req = request();
    const readBody = vi.spyOn(req, 'json');
    const response = await POST(req);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(readBody).not.toHaveBeenCalled();
    expectNoAnalysisWork();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('keeps configured-provider request validation before profile or analysis work', async () => {
    const response = await POST(request({ transactionId: body.transactionId, transaction: { amount: 35 } }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Invalid request data');
    expectNoAnalysisWork();
  });

  it('allows configured analysis, scopes the write to the authenticated owner, and leaves suggestions unconfirmed', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    expect(mocks.profile).toHaveBeenCalledWith(uid);
    expect(mocks.analyze).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tx_id: body.transactionId, amount_usd: 35 }),
      { profession: 'Designer' },
    );
    expect(mocks.collectionGroup).toHaveBeenCalledWith('transactions');
    expect(mocks.where.mock.calls).toEqual([
      ['userId', '==', uid], ['trans_id', '==', body.transactionId],
    ]);
    expect(mocks.persist).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ path: `user_profiles/${uid}/accounts/owned-account/transactions/${body.transactionId}` }),
      expect.objectContaining({ status: 'ok', is_deductible: true }),
      expect.objectContaining({ token: 'synthetic-lease' }),
      'synthetic-profile-hash',
    );
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it('does not spend the configured-provider rate limit while AI is unavailable', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    for (let i = 0; i < 61; i++) {
      expect((await POST(request())).status).toBe(503);
    }
    expectNoAnalysisWork();
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-key-provider-is-mocked');
  vi.stubEnv('AI_ANALYSIS_ENABLED', undefined);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
  });
  it('uses saved financial values and context rather than client-submitted replacements', async () => {
    const response = await POST(request({ ...body, transaction: { ...body.transaction, amount: 900000, merchant_name: 'Forged merchant', notes: 'Unsaved replacement' } }));
    expect(response.status).toBe(200);
    expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ amount_usd: 35, merchant: 'Synthetic office supplies', note: 'Saved owner context', iso_currency_code: 'USD', account_id: 'owned-account' }), expect.anything());
  });

  it('does not send missing or foreign-owner records to the provider', async () => {
    mocks.get.mockResolvedValue({ empty: false, docs: [{ ref: { path: 'user_profiles/another-user/accounts/a/transactions/tx' } }] });
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('does not duplicate an automatic or manual analysis already holding the lease', async () => {
    mocks.claim.mockResolvedValue({ status: 'busy' });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('AI_IN_PROGRESS');
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it.each([{ pending: true }, { iso_currency_code: undefined }, { iso_currency_code: 'EUR' }, { amount: Number.NaN }, { date: 'invalid' }, { date: '2026-02-30' }, { date: 'September 1, 2026' }])('refuses unresolved saved financial inputs %j', async patch => {
    mocks.claim.mockResolvedValue({ status: 'claimed', lease: { token: 'synthetic-lease' }, data: { ...body.transaction, iso_currency_code: 'USD', ...patch } });
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('returns a safe unavailable response and releases the lease when funding is exhausted', async () => {
    mocks.analyze.mockResolvedValue({ success: false, error: 'provider-private-detail', code: 'AI_UNAVAILABLE', retryable: false });
    const response = await POST(request());
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.code).toBe('AI_UNAVAILABLE');
    expect(JSON.stringify(payload)).not.toContain('provider-private-detail');
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'AI_UNAVAILABLE');
  });

  it('does not claim success when the saved record changed during analysis', async () => {
    mocks.persist.mockResolvedValue({ status: 'stale' });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('AI_RECORD_CHANGED');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

});
