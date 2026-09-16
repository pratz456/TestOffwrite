import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  analyze: vi.fn(),
  profile: vi.fn(),
  transaction: vi.fn(),
  convertContext: vi.fn(),
  missingFields: vi.fn(),
  collectionGroup: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: mocks.authenticate }));
vi.mock('@/lib/ai/analyzeTransaction', () => ({
  analyzeTransactionWithRetry: mocks.analyze,
  convertToEnhancedContext: mocks.convertContext,
  findMissingUserFields: mocks.missingFields,
}));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: mocks.profile }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionServer: mocks.transaction }));
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
  for (const mock of [mocks.profile, mocks.transaction, mocks.convertContext,
    mocks.missingFields, mocks.analyze, mocks.collectionGroup, mocks.update]) {
    expect(mock).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-key-provider-is-mocked');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  uid = `availability-test-${++nextUser}`;
  mocks.authenticate.mockResolvedValue({ user: { uid }, error: null });
  mocks.profile.mockResolvedValue({ data: { profession: 'Designer' }, error: null });
  mocks.transaction.mockResolvedValue({ data: {}, error: null });
  mocks.convertContext.mockReturnValue({ profession: 'Designer' });
  mocks.missingFields.mockReturnValue([]);
  mocks.analyze.mockResolvedValue({
    success: true,
    result: {
      status: 'likely_deductible', is_deductible: true, category: 'office_supplies',
      confidence: 0.9, customized_reason: 'Synthetic suggestion requiring review',
      reasoning_summary: 'Synthetic analysis', irs_refs: [],
    },
  });
  const query = { where: mocks.where, limit: mocks.limit, get: mocks.get };
  mocks.collectionGroup.mockReturnValue(query);
  mocks.where.mockReturnValue(query);
  mocks.limit.mockReturnValue(query);
  mocks.get.mockResolvedValue({ empty: false, docs: [{ ref: { update: mocks.update } }] });
  mocks.update.mockResolvedValue(undefined);
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
    expect(mocks.transaction).toHaveBeenCalledWith(uid, body.transactionId);
    expect(mocks.analyze).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tx_id: body.transactionId, amount_usd: 35 }),
      { profession: 'Designer' },
    );
    expect(mocks.collectionGroup).toHaveBeenCalledWith('transactions');
    expect(mocks.where.mock.calls).toEqual([
      ['userId', '==', uid], ['trans_id', '==', body.transactionId],
    ]);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      is_deductible: null, expense_type: null, analyzed: true, analysisStatus: 'completed',
    }));
  });

  it('does not spend the configured-provider rate limit while AI is unavailable', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    for (let i = 0; i < 61; i++) {
      expect((await POST(request())).status).toBe(503);
    }
    expectNoAnalysisWork();
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-key-provider-is-mocked');
    expect((await POST(request())).status).toBe(200);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
  });
});
