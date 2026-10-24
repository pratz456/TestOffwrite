import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { CONTRACT_OWNER, OWNER_ID_TOKEN, SITE_URL, installApiRouteMocks } from './fixtures/api-route-harness';
import { fakeRateLimitFirestore, recordedRateLimitCount } from './fixtures/rate-limit-store';
import { DEFAULT_JSON_BODY_MAX_BYTES } from '../lib/http/json-body';
import { MAX_REQUEST_BYTES } from '../lib/tax-assistant/contract';

const harness = installApiRouteMocks();
const uid = CONTRACT_OWNER.uid;

function partialBody(): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode('{"probe":"partial","value":');
  let sent = false;
  return new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(encoded);
        return;
      }
      controller.error(new Error('stopped'));
    },
  });
}

function abortedBody(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.error(new DOMException('The operation was aborted.', 'AbortError'));
    },
  });
}

function request(path: string, body: BodyInit, headers: Record<string, string> = {}) {
  return new NextRequest(`${SITE_URL}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${OWNER_ID_TOKEN}`,
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.9',
      ...headers,
    },
    body,
    duplex: 'half',
  } as RequestInit);
}

function unsigned(path: string) {
  return new NextRequest(`${SITE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: '{',
  });
}

type LimitSpy = { mock: { calls: unknown[][] } };

function usageCalls(limitSpy: LimitSpy, scope: string, key: string) {
  return limitSpy.mock.calls.filter(call => {
    const options = call[0] as { scope?: string; key?: string } | undefined;
    return options?.scope === scope && options?.key === key;
  });
}

function separateCounterCount(usageScope: string) {
  let total = 0;
  for (const [path, data] of fakeRateLimitFirestore.records) {
    if (path.startsWith('rate_limits/') && data.scope !== usageScope) total += Number(data.count) || 0;
  }
  return total;
}

function expectUsageUntouched(limitSpy: LimitSpy, scope: string, key: string) {
  expect(usageCalls(limitSpy, scope, key)).toHaveLength(0);
  expect(recordedRateLimitCount(scope)).toBe(0);
  expect(separateCounterCount(scope)).toBe(1);
  expect(harness.plaidCalls).toEqual([]);
  expect(harness.fetch).not.toHaveBeenCalled();
  expect(harness.storageCalls).toEqual([]);
}

async function prepareAnalyze() {
  harness.db.records.set(`user_profiles/${uid}`, {
    profession: 'Designer', state: 'CA', filing_status: 'single', business_entity_type: 'sole_proprietor',
  });
  harness.db.records.set(`user_profiles/${uid}/accounts/acct/transactions/tx1`, {
    userId: uid, trans_id: 'tx1', merchant_name: 'Office supplies', amount: 35,
    date: '2026-06-15', iso_currency_code: 'USD', pending: false, category: 'office',
  });
  const analysis = await import('@/lib/ai/analyzeTransaction');
  const persistence = await import('@/lib/ai/analysis-persistence');
  vi.spyOn(analysis, 'analyzeTransactionWithRetry').mockResolvedValue({
    success: true,
    result: {
      status: 'needs_more_info', is_deductible: null, category: null, confidence: 0.4,
      customized_reason: 'Need a purpose', reasoning_summary: 'Need a purpose', irs_refs: [], questions: ['What was this for?'],
    },
  });
  vi.spyOn(persistence, 'persistAnalysisSuggestion').mockResolvedValue({
    status: 'saved',
    suggestion: { id: 'persisted', status: 'needs_more_info' },
    explanation: { headline: 'Needs more information' },
    display: {
      status: 'needs_more_info', statusLabel: 'Needs more information', confidence: 0.4,
      reasoning: 'Need a purpose', irsPublication: null, irsSection: null,
      updatedAt: '2026-06-15T00:00:00.000Z', ai: { status: 'needs_more_info' },
    },
  } as Awaited<ReturnType<typeof persistence.persistAnalysisSuggestion>>);
}

async function prepareAssistant(content: unknown) {
  const openai = await import('@/lib/openai/client');
  vi.spyOn(openai, 'getOpenAIClientOrThrow').mockReturnValue({
    chat: { completions: { create: vi.fn().mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content), refusal: null } }],
    }) } },
  } as unknown as ReturnType<typeof openai.getOpenAIClientOrThrow>);
}

const guidanceSelection = { topic: 'vehicles-records', missingFactIds: ['vehicles-records:1'], photoCategories: ['vehicle'] };

const ROUTES = [
  {
    name: 'reconnect',
    path: '/api/plaid/reconnect',
    policy: 'plaidSync',
    key: `reconnect:${uid}`,
    maxBytes: DEFAULT_JSON_BODY_MAX_BYTES,
    validBody: { action: 'start' },
    load: () => import('../app/api/plaid/reconnect/route'),
    prepareValid: async () => {},
  },
  {
    name: 'analyze transaction',
    path: '/api/ai/analyze-transaction',
    policy: 'aiAnalyzeTransaction',
    key: uid,
    maxBytes: DEFAULT_JSON_BODY_MAX_BYTES,
    validBody: {
      transactionId: 'tx1',
      transaction: { merchant_name: 'Office supplies', amount: 35, category: 'office', date: '2026-06-15' },
    },
    load: () => import('../app/api/ai/analyze-transaction/route'),
    prepareValid: prepareAnalyze,
  },
  {
    name: 'account assistant',
    path: '/api/ai/account-assistant',
    policy: 'aiTaxAssistant',
    key: `account:${uid}`,
    maxBytes: MAX_REQUEST_BYTES,
    validBody: { message: 'What needs review?', taxYear: 2026 },
    load: () => import('../app/api/ai/account-assistant/route'),
    prepareValid: () => prepareAssistant({ intent: 'prepare_handoff' }),
  },
  {
    name: 'tax assistant',
    path: '/api/ai/tax-assistant',
    policy: 'aiTaxAssistant',
    key: uid,
    maxBytes: MAX_REQUEST_BYTES,
    validBody: { message: 'Can I write this off?', taxYear: 2026 },
    load: () => import('../app/api/ai/tax-assistant/route'),
    prepareValid: () => prepareAssistant(guidanceSelection),
  },
] as const;

describe('request body validation before usage counters', () => {
  let limitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await harness.reset();
    const rateLimit = await import('@/lib/security/rate-limit');
    limitSpy = vi.spyOn(rateLimit, 'enforceRateLimit');
    for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function scopeFor(policy: typeof ROUTES[number]['policy']) {
    const limits = (await import('@/lib/security/rate-limit')).RATE_LIMITS;
    return limits[policy].scope;
  }

  for (const route of ROUTES) {
    it(`reads a partial ${route.name} request before counting it`, async () => {
      const scope = await scopeFor(route.policy);
      const { POST } = await route.load();
      const response = await POST(request(route.path, partialBody()));
      expectUsageUntouched(limitSpy, scope, route.key);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
    });

    it(`reads an aborted ${route.name} request before counting it`, async () => {
      const scope = await scopeFor(route.policy);
      const { POST } = await route.load();
      const response = await POST(request(route.path, abortedBody()));
      expectUsageUntouched(limitSpy, scope, route.key);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
    });

    it(`reads invalid ${route.name} JSON before counting it`, async () => {
      const scope = await scopeFor(route.policy);
      const { POST } = await route.load();
      const response = await POST(request(route.path, '{'));
      expectUsageUntouched(limitSpy, scope, route.key);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
    });

    it(`reads an oversize ${route.name} request before counting it`, async () => {
      const scope = await scopeFor(route.policy);
      const { POST } = await route.load();
      const body = 'x'.repeat(route.maxBytes + 1);
      const response = await POST(request(route.path, body, { 'content-length': String(body.length) }));
      expectUsageUntouched(limitSpy, scope, route.key);
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toEqual({ error: 'Request body is too large' });
    });

    it(`counts one valid ${route.name} request`, async () => {
      const scope = await scopeFor(route.policy);
      await route.prepareValid();
      const { POST } = await route.load();
      const response = await POST(request(route.path, JSON.stringify(route.validBody)));
      expect(limitSpy).toHaveBeenCalledTimes(1);
      expect(usageCalls(limitSpy, scope, route.key)).toHaveLength(1);
      expect(response.status).toBe(200);
    });

    it(`answers 401 before counting an unsigned ${route.name} request`, async () => {
      const scope = await scopeFor(route.policy);
      const { POST } = await route.load();
      const response = await POST(unsigned(route.path));
      expect(usageCalls(limitSpy, scope, route.key)).toHaveLength(0);
      expect(recordedRateLimitCount(scope)).toBe(0);
      expect(separateCounterCount(scope)).toBe(0);
      expect(response.status).toBe(401);
    });

    it(`applies a separate limit for ${route.name} requests that fail validation`, async () => {
      const scope = await scopeFor(route.policy);
      const { POST } = await route.load();
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const response = await POST(request(route.path, '{'));
        statuses.push(response.status);
      }
      expect(statuses).toContain(429);
      expect(statuses[0]).toBe(400);
      expect(usageCalls(limitSpy, scope, route.key)).toHaveLength(0);
      expect(recordedRateLimitCount(scope)).toBe(0);
      expect(harness.plaidCalls).toEqual([]);
      expect(harness.fetch).not.toHaveBeenCalled();
      await route.prepareValid();
      const allowed = await POST(request(route.path, JSON.stringify(route.validBody)));
      expect(allowed.status).toBe(200);
      expect(usageCalls(limitSpy, scope, route.key)).toHaveLength(1);
      expect(recordedRateLimitCount(scope)).toBe(1);
    });
  }
});
