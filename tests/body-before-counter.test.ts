import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { CONTRACT_OWNER, OWNER_ID_TOKEN, SITE_URL, installApiRouteMocks } from './fixtures/api-route-harness';
import { failRateLimitStore, fakeRateLimitFirestore, recordedRateLimitCount } from './fixtures/rate-limit-store';
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

function countedStream(maxBytes: number) {
  const chunkSize = 16 * 1024;
  const chunksToPass = Math.floor(maxBytes / chunkSize) + 1;
  const available = chunksToPass + 8;
  const state = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled += 1;
      if (state.pulled > available) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(chunkSize));
    },
  });
  return { stream, state, chunksToPass };
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

function streamedRequest(path: string, body: BodyInit, headers: Record<string, string> = {}) {
  return new Request(`${SITE_URL}${path}`, {
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
type LimitPolicy = { scope: string; limit: number; windowMs: number; onUnavailable?: string };
type RouteHandler = { POST: (request: NextRequest) => Promise<Response> };

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

function expectCache(response: Response, cache: string | null) {
  expect(response.headers.get('cache-control')).toBe(cache);
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

function longHistory(message: string, taxYear: number) {
  return {
    message,
    taxYear,
    conversationHistory: Array.from({ length: 13 }, () => ({ role: 'user', content: 'hello' })),
  };
}

interface RouteCase {
  name: string;
  path: string;
  policy: 'plaidSync' | 'aiAnalyzeTransaction' | 'aiTaxAssistant';
  invalidPolicy: string;
  key: string;
  maxBytes: number;
  invalidLimit: number;
  windowMs: number;
  invalidJsonError: string;
  tooLargeError: string;
  invalidJsonCache: string | null;
  tooLargeCache: string | null;
  invalidFieldsBody: unknown;
  invalidFieldsError: string;
  usageLimit: number;
  usageLimitName: string;
  usageLimitError: string;
  usageLimitCode: string;
  longHistoryBody?: unknown;
  longHistoryError?: string;
  badImageBody?: unknown;
  badImageError?: string;
  validBody: unknown;
  load: () => Promise<RouteHandler>;
  prepareValid: () => Promise<void>;
}

const ACCOUNT_FIELD_ERROR = 'Use a valid question, tax year, and photo under 2 MB.';
const TAX_FIELD_ERROR = 'Use tax year 2026 or 2027, a question under 4,000 characters, and at most 12 recent messages.';
const PRIVATE_NO_STORE = 'private, no-store';

const ROUTES: RouteCase[] = [
  {
    name: 'reconnect',
    path: '/api/plaid/reconnect',
    policy: 'plaidSync',
    invalidPolicy: 'reconnectInvalidRequest',
    key: `reconnect:${uid}`,
    maxBytes: DEFAULT_JSON_BODY_MAX_BYTES,
    invalidLimit: 240,
    windowMs: 10 * 60_000,
    invalidJsonError: 'Invalid JSON body',
    tooLargeError: 'Request body is too large',
    invalidJsonCache: PRIVATE_NO_STORE,
    tooLargeCache: PRIVATE_NO_STORE,
    invalidFieldsBody: { action: 'nope' },
    invalidFieldsError: 'Invalid bank review action',
    usageLimit: 120,
    usageLimitName: 'RECONNECT_USER_LIMIT',
    usageLimitError: 'Please wait a moment before continuing bank review.',
    usageLimitCode: 'RATE_LIMITED',
    validBody: { action: 'start' },
    load: () => import('../app/api/plaid/reconnect/route'),
    prepareValid: async () => {},
  },
  {
    name: 'analyze transaction',
    path: '/api/ai/analyze-transaction',
    policy: 'aiAnalyzeTransaction',
    invalidPolicy: 'analyzeTransactionInvalidRequest',
    key: uid,
    maxBytes: DEFAULT_JSON_BODY_MAX_BYTES,
    invalidLimit: 120,
    windowMs: 60 * 60_000,
    invalidJsonError: 'Invalid request data',
    tooLargeError: 'Request body is too large',
    invalidJsonCache: null,
    tooLargeCache: PRIVATE_NO_STORE,
    invalidFieldsBody: { transactionId: 'tx1', transaction: { amount: 35 } },
    invalidFieldsError: 'Invalid request data',
    usageLimit: 60,
    usageLimitName: 'ANALYZE_TRANSACTION_USER_LIMIT',
    usageLimitError: 'Analysis request limit reached. Please try again later.',
    usageLimitCode: 'AI_RATE_LIMITED',
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
    invalidPolicy: 'accountAssistantInvalidRequest',
    key: `account:${uid}`,
    maxBytes: MAX_REQUEST_BYTES,
    invalidLimit: 60,
    windowMs: 10 * 60_000,
    invalidJsonError: 'Invalid request body.',
    tooLargeError: 'Request is too large.',
    invalidJsonCache: PRIVATE_NO_STORE,
    tooLargeCache: PRIVATE_NO_STORE,
    invalidFieldsBody: { message: 'What needs review?', taxYear: 2024 },
    invalidFieldsError: ACCOUNT_FIELD_ERROR,
    usageLimit: 30,
    usageLimitName: 'ACCOUNT_ASSISTANT_USER_LIMIT',
    usageLimitError: 'Too many assistant requests. Please retry in a few minutes.',
    usageLimitCode: 'RATE_LIMITED',
    longHistoryBody: longHistory('What needs review?', 2026),
    longHistoryError: ACCOUNT_FIELD_ERROR,
    badImageBody: { message: 'What needs review?', taxYear: 2026, imageDataUrl: 'https://example.com/photo.png' },
    badImageError: ACCOUNT_FIELD_ERROR,
    validBody: { message: 'What needs review?', taxYear: 2026 },
    load: () => import('../app/api/ai/account-assistant/route'),
    prepareValid: () => prepareAssistant({ intent: 'prepare_handoff' }),
  },
  {
    name: 'tax assistant',
    path: '/api/ai/tax-assistant',
    policy: 'aiTaxAssistant',
    invalidPolicy: 'taxAssistantInvalidRequest',
    key: uid,
    maxBytes: MAX_REQUEST_BYTES,
    invalidLimit: 60,
    windowMs: 10 * 60_000,
    invalidJsonError: 'Invalid request body',
    tooLargeError: 'Request is too large. Use a photo under 2 MB.',
    invalidJsonCache: null,
    tooLargeCache: null,
    invalidFieldsBody: { message: 'Can I write this off?', taxYear: 2025 },
    invalidFieldsError: TAX_FIELD_ERROR,
    usageLimit: 30,
    usageLimitName: 'TAX_ASSISTANT_USER_LIMIT',
    usageLimitError: 'Too many assistant requests. Please wait a few minutes and try again.',
    usageLimitCode: 'RATE_LIMITED',
    longHistoryBody: longHistory('Can I write this off?', 2026),
    longHistoryError: TAX_FIELD_ERROR,
    badImageBody: { message: 'Can I write this off?', taxYear: 2026, imageDataUrl: 'https://example.com/photo.png' },
    badImageError: 'Attach a valid JPEG, PNG, or WebP photo under 2 MB.',
    validBody: { message: 'Can I write this off?', taxYear: 2026 },
    load: () => import('../app/api/ai/tax-assistant/route'),
    prepareValid: () => prepareAssistant(guidanceSelection),
  },
];

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

  async function scopeFor(policy: RouteCase['policy']) {
    const limits = (await import('@/lib/security/rate-limit')).RATE_LIMITS;
    return limits[policy].scope;
  }

  async function readPolicy(name: string): Promise<LimitPolicy | undefined> {
    const limits = (await import('@/lib/security/rate-limit')).RATE_LIMITS as Record<string, LimitPolicy | undefined>;
    return limits[name];
  }

  async function invalidCount(name: string) {
    const policy = await readPolicy(name);
    return recordedRateLimitCount(policy?.scope ?? `missing:${name}`);
  }

  async function usageLimitFor(route: RouteCase) {
    const rateLimit = await import('@/lib/security/rate-limit') as Record<string, unknown>;
    return rateLimit[route.usageLimitName] as number | undefined;
  }

  async function expectFieldRejection(route: RouteCase, body: unknown, error: string) {
    const scope = await scopeFor(route.policy);
    const invalid = await readPolicy(route.invalidPolicy);
    const { POST } = await route.load();
    const response = await POST(request(route.path, JSON.stringify(body)));
    expect(usageCalls(limitSpy, scope, route.key)).toHaveLength(0);
    expect(recordedRateLimitCount(scope)).toBe(0);
    expect(recordedRateLimitCount(invalid?.scope ?? `missing:${route.invalidPolicy}`)).toBe(1);
    expect(invalid?.limit).toBe(route.invalidLimit);
    expect(invalid?.windowMs).toBe(route.windowMs);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expectCache(response, route.invalidJsonCache);
    const scopeName = invalid?.scope ?? `missing:${route.invalidPolicy}`;
    const { rateLimitKeyHash } = await import('@/lib/security/rate-limit');
    expect(fakeRateLimitFirestore.records.has(`rate_limits/${rateLimitKeyHash(scopeName, uid)}`)).toBe(true);
    expect(harness.plaidCalls).toEqual([]);
    expect(harness.fetch).not.toHaveBeenCalled();
  }

  for (const route of ROUTES) {
    it(`reads a partial ${route.name} request before counting it`, async () => {
      const recordSet = vi.spyOn(harness.db.records, 'set');
      const recordDelete = vi.spyOn(harness.db.records, 'delete');
      const scope = await scopeFor(route.policy);
      const { POST } = await route.load();
      const response = await POST(request(route.path, partialBody()));
      expect(recordSet).not.toHaveBeenCalled();
      expect(recordDelete).not.toHaveBeenCalled();
      expectUsageUntouched(limitSpy, scope, route.key);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: route.invalidJsonError });
      expectCache(response, route.invalidJsonCache);
    });

    it(`reads an aborted ${route.name} request before counting it`, async () => {
      const scope = await scopeFor(route.policy);
      const { POST } = await route.load();
      const response = await POST(request(route.path, abortedBody()));
      expectUsageUntouched(limitSpy, scope, route.key);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: route.invalidJsonError });
      expectCache(response, route.invalidJsonCache);
    });

    it(`reads invalid ${route.name} JSON before counting it`, async () => {
      const scope = await scopeFor(route.policy);
      const { POST } = await route.load();
      const response = await POST(request(route.path, '{'));
      expectUsageUntouched(limitSpy, scope, route.key);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: route.invalidJsonError });
      expectCache(response, route.invalidJsonCache);
    });

    it(`reads an oversize ${route.name} request before counting it`, async () => {
      const scope = await scopeFor(route.policy);
      const { POST } = await route.load();
      const body = 'x'.repeat(route.maxBytes + 1);
      const response = await POST(request(route.path, body, { 'content-length': String(body.length) }));
      expectUsageUntouched(limitSpy, scope, route.key);
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toEqual({ error: route.tooLargeError });
      expectCache(response, route.tooLargeCache);
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
      for (let attempt = 0; attempt < route.invalidLimit + 1; attempt += 1) {
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

    it(`returns 400 for valid ${route.name} JSON with invalid fields before counting usage`, async () => {
      await expectFieldRejection(route, route.invalidFieldsBody, route.invalidFieldsError);
    });

    if (route.longHistoryBody) {
      it(`returns 400 for a long ${route.name} history before counting usage`, async () => {
        await expectFieldRejection(route, route.longHistoryBody, route.longHistoryError ?? '');
      });
    }

    if (route.badImageBody) {
      it(`returns 400 for an unsupported ${route.name} photo before counting usage`, async () => {
        await expectFieldRejection(route, route.badImageBody, route.badImageError ?? '');
      });
    }

    it(`returns 429 for ${route.name} once the invalid request limit is reached`, async () => {
      const scope = await scopeFor(route.policy);
      const invalid = await readPolicy(route.invalidPolicy);
      const { POST } = await route.load();
      const statuses: number[] = [];
      for (let attempt = 0; attempt < route.invalidLimit + 1; attempt += 1) {
        const response = await POST(request(route.path, '{'));
        statuses.push(response.status);
      }
      expect(statuses.slice(0, route.invalidLimit).every(status => status === 400)).toBe(true);
      expect(statuses).toHaveLength(route.invalidLimit + 1);
      expect(statuses.at(-1)).toBe(429);
      expect(usageCalls(limitSpy, scope, route.key)).toHaveLength(0);
      expect(recordedRateLimitCount(scope)).toBe(0);
      expect(invalid?.limit).toBe(route.invalidLimit);
      expect(invalid?.windowMs).toBe(route.windowMs);
      expect(recordedRateLimitCount(invalid?.scope ?? `missing:${route.invalidPolicy}`)).toBe(route.invalidLimit);
      const denied = await POST(request(route.path, '{')).then(async response => ({ status: response.status, body: await response.json() }));
      expect(denied.status).toBe(429);
      expect(denied.body.code).toBe('RATE_LIMITED');
      await route.prepareValid();
      const allowed = await POST(request(route.path, JSON.stringify(route.validBody)));
      expect(allowed.status).toBe(200);
      expect(usageCalls(limitSpy, scope, route.key)).toHaveLength(1);
      expect(recordedRateLimitCount(scope)).toBe(1);
    });

    it(`stops reading an oversize streamed ${route.name} body when no length is declared`, async () => {
      const scope = await scopeFor(route.policy);
      const opened = countedStream(route.maxBytes);
      const incoming = streamedRequest(route.path, opened.stream);
      expect(incoming.headers.get('content-length')).toBeNull();
      const { POST } = await route.load();
      const response = await POST(incoming as NextRequest);
      expect(usageCalls(limitSpy, scope, route.key)).toHaveLength(0);
      expect(recordedRateLimitCount(scope)).toBe(0);
      expect(opened.state.pulled).toBeGreaterThanOrEqual(opened.chunksToPass);
      expect(opened.state.pulled).toBeLessThanOrEqual(opened.chunksToPass + 1);
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toEqual({ error: route.tooLargeError });
      expect((await invalidCount(route.invalidPolicy))).toBe(1);
    });

    it(`stops reading an oversize streamed ${route.name} body when the declared length is too small`, async () => {
      const scope = await scopeFor(route.policy);
      const opened = countedStream(route.maxBytes);
      const incoming = streamedRequest(route.path, opened.stream, { 'content-length': '1' });
      expect(incoming.headers.get('content-length')).toBe('1');
      const { POST } = await route.load();
      const response = await POST(incoming as NextRequest);
      expect(usageCalls(limitSpy, scope, route.key)).toHaveLength(0);
      expect(recordedRateLimitCount(scope)).toBe(0);
      expect(opened.state.pulled).toBeGreaterThanOrEqual(opened.chunksToPass);
      expect(opened.state.pulled).toBeLessThanOrEqual(opened.chunksToPass + 1);
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toEqual({ error: route.tooLargeError });
      expect((await invalidCount(route.invalidPolicy))).toBe(1);
    });

    it(`leaves other invalid request counters unchanged after a bad ${route.name} body`, async () => {
      const before = new Map<string, number>();
      for (const other of ROUTES) before.set(other.invalidPolicy, await invalidCount(other.invalidPolicy));
      const { POST } = await route.load();
      const response = await POST(request(route.path, '{'));
      expect(usageCalls(limitSpy, await scopeFor(route.policy), route.key)).toHaveLength(0);
      expect(response.status).toBe(400);
      for (const other of ROUTES) {
        const after = await invalidCount(other.invalidPolicy);
        const previous = before.get(other.invalidPolicy) ?? 0;
        expect(after).toBe(other.invalidPolicy === route.invalidPolicy ? previous + 1 : previous);
      }
    });

    it(`keeps the ${route.name} invalid request counter when the forwarded address changes`, async () => {
      const scope = await scopeFor(route.policy);
      const invalid = await readPolicy(route.invalidPolicy);
      const { POST } = await route.load();
      const statuses: number[] = [];
      for (let attempt = 0; attempt < route.invalidLimit + 1; attempt += 1) {
        const response = await POST(request(route.path, '{', { 'x-forwarded-for': `198.51.100.${attempt % 250}` }));
        statuses.push(response.status);
      }
      expect(statuses.slice(0, route.invalidLimit).every(status => status === 400)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
      expect(usageCalls(limitSpy, scope, route.key)).toHaveLength(0);
      expect(recordedRateLimitCount(scope)).toBe(0);
      expect(recordedRateLimitCount(invalid?.scope ?? `missing:${route.invalidPolicy}`)).toBe(route.invalidLimit);
      const scopeName = invalid?.scope ?? `missing:${route.invalidPolicy}`;
      const { rateLimitKeyHash } = await import('@/lib/security/rate-limit');
      const records = [...fakeRateLimitFirestore.records.entries()].filter(([path, data]) => path.startsWith('rate_limits/') && data.scope === scopeName);
      expect(records.map(([path]) => path)).toEqual([`rate_limits/${rateLimitKeyHash(scopeName, uid)}`]);
    });

    it(`returns 429 for ${route.name} once the usage limit is reached`, async () => {
      const usageLimit = await usageLimitFor(route);
      expect(usageLimit).toBe(route.usageLimit);
      const scope = await scopeFor(route.policy);
      await route.prepareValid();
      const { POST } = await route.load();
      const statuses: number[] = [];
      for (let attempt = 0; attempt < route.usageLimit; attempt += 1) {
        if (route.policy === 'aiAnalyzeTransaction') {
          // A completed analysis leaves its lease on the saved record. Clear that lease so the next request is still valid.
          const path = `user_profiles/${uid}/accounts/acct/transactions/tx1`;
          const saved = harness.db.records.get(path);
          if (saved) {
            const next = { ...saved };
            delete next.analysisLeaseToken;
            delete next.analysisLeaseExpiresAt;
            harness.db.records.set(path, next);
          }
        }
        const response = await POST(request(route.path, JSON.stringify(route.validBody)));
        statuses.push(response.status);
      }
      expect(statuses).toHaveLength(route.usageLimit);
      expect(statuses.every(status => status === 200)).toBe(true);
      const denied = await POST(request(route.path, JSON.stringify(route.validBody)));
      expect(denied.status).toBe(429);
      await expect(denied.json()).resolves.toMatchObject({ error: route.usageLimitError, code: route.usageLimitCode });
      expect(usageCalls(limitSpy, scope, route.key)).toHaveLength(route.usageLimit + 1);
      expect(recordedRateLimitCount(scope)).toBe(route.usageLimit);
    });

    it(`returns the original ${route.name} field rejection when the invalid request counter cannot be stored`, async () => {
      failRateLimitStore();
      const scope = await scopeFor(route.policy);
      const { POST } = await route.load();
      const response = await POST(request(route.path, JSON.stringify(route.invalidFieldsBody)));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: route.invalidFieldsError });
      expect(usageCalls(limitSpy, scope, route.key)).toHaveLength(0);
    });

    it(`returns the original oversize ${route.name} rejection when no length is declared and the invalid request counter cannot be stored`, async () => {
      failRateLimitStore();
      const scope = await scopeFor(route.policy);
      const opened = countedStream(route.maxBytes);
      const incoming = streamedRequest(route.path, opened.stream);
      expect(incoming.headers.get('content-length')).toBeNull();
      const { POST } = await route.load();
      const response = await POST(incoming as NextRequest);
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toEqual({ error: route.tooLargeError });
      expect(usageCalls(limitSpy, scope, route.key)).toHaveLength(0);
      expect(opened.state.pulled).toBeGreaterThan(0);
      expect(opened.state.pulled).toBeLessThanOrEqual(opened.chunksToPass + 1);
    });

    it(`returns the original ${route.name} rejection when the invalid request counter cannot be stored`, async () => {
      failRateLimitStore();
      const scope = await scopeFor(route.policy);
      const { POST } = await route.load();
      const invalid = await POST(request(route.path, '{'));
      expect(invalid.status).toBe(400);
      await expect(invalid.json()).resolves.toEqual({ error: route.invalidJsonError });
      expect(usageCalls(limitSpy, scope, route.key)).toHaveLength(0);
      const body = 'x'.repeat(route.maxBytes + 1);
      const oversize = await POST(request(route.path, body, { 'content-length': String(body.length) }));
      expect(oversize.status).toBe(413);
      await expect(oversize.json()).resolves.toEqual({ error: route.tooLargeError });
      expect(usageCalls(limitSpy, scope, route.key)).toHaveLength(0);
    });
  }
});
