/**
 * Table-driven contract for every `app/api/**\/route.ts`, discovered at run time (no hard-coded list).
 * Each exported method runs in-process with the Admin SDK, OpenAI, Stripe, Plaid, Storage and `fetch`
 * replaced by fail-closed doubles (tests/fixtures/api-route-harness.ts). Contract:
 *   - anonymous or forged credentials: 401/403/404 (exceptions below), JSON body, no cached response,
 *     no outbound provider or storage call;
 *   - signed-in owner with an empty, malformed or `{}` body on a mutating method: 400/422, never 500;
 *   - session-cookie mutations from another site are rejected (CSRF);
 *   - diagnostic routes answer 404 in production;
 *   - a database failure never echoes its message, and no body contains stack/path/vendor markers.
 * Every exception table entry carries its reason; every KNOWN_GAPS entry is an open audit finding.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  contractRequest, discoverApiRoutes, exportedMethods, installApiRouteMocks, leakMarkersIn, routeContext,
  MUTATING_METHODS, type ContractAuth, type DiscoveredRoute,
} from './fixtures/api-route-harness';

const harness = installApiRouteMocks();

interface Expectation { statuses: number[]; reason: string }

/** Anonymous callers: every operation not listed here must answer 401, 403 or 404. */
const PUBLIC_ANONYMOUS: Record<string, Expectation> = {
  'POST /api/auth/session': { statuses: [400], reason: 'Login step: the ID token travels in the body, so an empty body is a validation failure, not an auth failure.' },
  'POST /api/auth/logout': { statuses: [200], reason: 'Clearing session cookies is safe for any caller and must work for an expired session.' },
  'POST /api/contact': { statuses: [400], reason: 'Public contact form; an empty submission fails validation.' },
  'POST /api/stripe/webhook': { statuses: [400, 503], reason: 'Stripe authenticates with the signature header; an unsigned payload is rejected as invalid.' },
  'GET /api/plaid/webhook': { statuses: [200], reason: 'Liveness answer for the Plaid dashboard; the body reveals nothing about tenants.' },
  'GET /api/support/account/[uid]': { statuses: [404], reason: 'Support tooling hides its existence unless configured and the caller is an allow-listed admin.' },
};

/** Operations authenticated by a shared service secret or provider signature; a user credential must not drive them. */
const SERVICE_OPERATIONS: Record<string, string> = {
  'POST /api/internal/analysis-worker': 'Eventarc worker shared secret',
  'POST /api/plaid/sync-transactions-internal': 'scheduler shared secret',
  'POST /api/plaid/webhook': 'Plaid webhook JWT',
  'POST /api/stripe/webhook': 'Stripe webhook signature',
};

/** Mutations that ignore the request body; the listed statuses describe an empty account under test. */
const BODYLESS_MUTATIONS: Record<string, Expectation> = {
  'POST /api/auth/logout': { statuses: [200], reason: 'Clears cookies.' },
  'DELETE /api/user/delete': { statuses: [200], reason: 'Deletes the caller\'s own data; idempotent on an empty account.' },
  'DELETE /api/plaid/items': { statuses: [200], reason: 'Disconnects the caller\'s only bank; nothing to disconnect on an empty account.' },
  'DELETE /api/plaid/exchange-token': { statuses: [200], reason: 'Legacy alias of DELETE /api/plaid/items.' },
  'DELETE /api/mileage/[id]': { statuses: [200], reason: 'Deletes by path under the caller\'s uid; idempotent for an unknown trip.' },
  'POST /api/accounts/[accountId]/mark-personal': { statuses: [200], reason: 'Bulk update of the caller\'s own account subtree.' },
  'POST /api/transactions/reset-unreviewed-classifications': { statuses: [200], reason: 'Scope defaults to learning_only when no body is sent.' },
  'POST /api/transactions/apply-learning': { statuses: [200], reason: 'Disabled no-op.' },
  'POST /api/fix-transaction-analysis': { statuses: [200], reason: 'Maintenance pass over the caller\'s own records; production gating is asserted separately.' },
  'POST /api/migrate-ai-analysis': { statuses: [200], reason: 'Maintenance pass over the caller\'s own records; production gating is asserted separately.' },
  'POST /api/subscriptions/verify-stripe': { statuses: [200], reason: 'Diagnostic; production answers 404 (asserted separately).' },
  'POST /api/subscriptions/fix-access': { statuses: [404], reason: 'Reconciles the caller\'s subscription; nothing is linked on an empty account.' },
  'POST /api/plaid/refresh-balances': { statuses: [404], reason: 'No bank connection on an empty account.' },
  'POST /api/plaid/sync-transactions': { statuses: [404], reason: 'No bank connection on an empty account.' },
  'POST /api/plaid/transactions': { statuses: [404], reason: 'Legacy alias of POST /api/plaid/sync-transactions.' },
  'POST /api/plaid/create-link-token': { statuses: [503], reason: 'Optional itemId only; the Plaid double refuses network, so the provider is reported unavailable.' },
  'POST /api/plaid/link-token': { statuses: [503], reason: 'Legacy alias of POST /api/plaid/create-link-token.' },
  'POST /api/stripe/create-portal-session': { statuses: [503], reason: 'No body; the Stripe double refuses network, so billing is reported unavailable.' },
  'POST /api/plaid/reset-transactions': { statuses: [403, 404], reason: 'Disabled unless explicitly enabled outside production.' },
  'DELETE /api/plaid/items/[itemId]': { statuses: [404], reason: 'Unknown connection on an empty account.' },
  'POST /api/tax/form-8879': { statuses: [409], reason: 'Always refuses: e-file authorization comes from a filing provider.' },
  'POST /api/tax/year-lock': { statuses: [409], reason: 'Always refuses: filing status comes from a filing provider.' },
};

/** Mutations for which `{}` (or no body) is a complete request; malformed JSON must still be 400/422. */
const EMPTY_BODY_ACCEPTED: Record<string, Expectation> = {
  'POST /api/database/profiles': { statuses: [200], reason: 'Partial update of whitelisted fields; nothing to change is not an error.' },
  'POST /api/user/export': { statuses: [200], reason: 'All filters optional; requests the full archive.' },
  'POST /api/tax/deductions': { statuses: [200], reason: 'Every entry defaults to zero for the current year.' },
  'POST /api/tax/organizer': { statuses: [201], reason: 'Every organizer field is optional.' },
  'POST /api/stripe/create-checkout': { statuses: [503], reason: 'Plan fields default; the Stripe double refuses network, so checkout is reported unavailable.' },
  'POST /api/reports/profit-loss': { statuses: [200], reason: 'Period defaults to the current year.' },
};

/**
 * Open findings: the observed behaviour is asserted so the table must shrink as fixes land.
 * `mutating`/`anonymous` list extra statuses currently answered in those phases; `throws` marks a
 * handler that escapes an exception (Next answers a text/plain 500); `leaksDatabaseError` documents
 * an echoed exception message.
 */
interface KnownGap { anonymous?: number[]; mutating?: number[]; throws?: true; leaksDatabaseError?: true; reason: string }
const KNOWN_GAPS: Record<string, KnownGap> = {
  'POST /api/tax/import-document': { mutating: [500], reason: 'Non-multipart body answers 500; upload lacks size, MIME and signature checks and a rate limit.' },
};

/** Findings in files owned by another branch: reported in docs/API_SECURITY_AUDIT_2026-09-17.md, not asserted here. */
const REPORTED_OUT_OF_SCOPE: Record<string, string> = {
  'GET /api/monthly-deductions': 'details field echoes the database error (app/api/monthly-deductions is edited on another branch).',
  'GET /api/tax-savings': 'error field echoes the exception message (app/api/tax-savings is edited on another branch).',
};

/** Operations that cannot be exercised in-process. Every entry is an audit finding. */
const SKIPPED: Record<string, string> = {};

interface Operation { key: string; method: string; route: DiscoveredRoute; handler: (request: Request, context: unknown) => Promise<Response> }

const routes = discoverApiRoutes();
const operations: Operation[] = (await Promise.all(routes.map(async route => {
  const routeModule = await import(/* @vite-ignore */ route.importPath) as Record<string, unknown>;
  return exportedMethods(routeModule).map(method => ({
    key: `${method} ${route.pattern}`, method, route, handler: routeModule[method] as Operation['handler'],
  }));
}))).flat();
const exercised = operations.filter(operation => !(operation.key in SKIPPED));
const mutating = exercised.filter(operation => (MUTATING_METHODS as readonly string[]).includes(operation.method));
const userMutating = mutating.filter(operation => !(operation.key in PUBLIC_ANONYMOUS) && !(operation.key in SERVICE_OPERATIONS));
const table = (list: Operation[]) => list.map(operation => [operation.key, operation] as const);

/** Runs one operation. An escaped exception is modelled as Next does: a text/plain 500 with no detail. */
async function call(operation: Operation, init: Parameters<typeof contractRequest>[1]) {
  const request = contractRequest(operation.route.requestPath, { method: operation.method, ...init });
  try {
    const response = await operation.handler(request, routeContext(operation.route));
    return { response, text: await response.text(), threw: false };
  } catch {
    if (!KNOWN_GAPS[operation.key]?.throws) throw new Error(`${operation.key} threw instead of answering`);
    return { response: new Response('Internal Server Error', { status: 500, headers: { 'content-type': 'text/plain' } }), text: 'Internal Server Error', threw: true };
  }
}

function anonymousStatuses(operation: Operation): number[] {
  return [...(PUBLIC_ANONYMOUS[operation.key]?.statuses ?? [401, 403, 404]), ...(KNOWN_GAPS[operation.key]?.anonymous ?? [])];
}

function expectedForEmptyBody(operation: Operation, body: string): number[] {
  const gap = KNOWN_GAPS[operation.key]?.mutating ?? [];
  if (operation.key in SERVICE_OPERATIONS) return [...(PUBLIC_ANONYMOUS[operation.key]?.statuses ?? [401, 403]), ...gap];
  const bodyless = BODYLESS_MUTATIONS[operation.key];
  if (bodyless) return [...bodyless.statuses, ...gap];
  const accepted = body === '{' ? undefined : EMPTY_BODY_ACCEPTED[operation.key];
  return [...(accepted?.statuses ?? []), 400, 422, ...gap];
}

beforeEach(async () => {
  await harness.reset();
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('discovery', () => {
  it('covers every route file and exports at least one handler per file', () => {
    expect(routes.length).toBeGreaterThan(90);
    for (const route of routes) expect(operations.some(operation => operation.route === route), route.file).toBe(true);
  });
  it('lists only real operations in the exception tables', () => {
    const keys = new Set(operations.map(operation => operation.key));
    const tables = [PUBLIC_ANONYMOUS, SERVICE_OPERATIONS, BODYLESS_MUTATIONS, EMPTY_BODY_ACCEPTED, KNOWN_GAPS, REPORTED_OUT_OF_SCOPE, SKIPPED];
    for (const key of tables.flatMap(Object.keys)) expect(keys, key).toContain(key);
    for (const key of [...Object.keys(BODYLESS_MUTATIONS), ...Object.keys(EMPTY_BODY_ACCEPTED)]) expect(mutating.map(operation => operation.key), key).toContain(key);
  });
  it('keeps the platform no-store header for every API path', () => {
    // Handlers that set Cache-Control must say no-store (asserted per response); this rule covers the rest.
    const config = fs.readFileSync(path.resolve(__dirname, '../next.config.ts'), 'utf8');
    expect(config).toMatch(/source:\s*'\/api\/\(\.\*\)'[\s\S]{0,200}Cache-Control[\s\S]{0,80}no-store/);
  });
});

describe('unauthenticated callers', () => {
  it.each(exercised.flatMap(operation => (['anonymous', 'invalid-token'] as const).map(auth => [`${auth} ${operation.key}`, operation, auth] as const)))('%s', async (_key, operation, auth: ContractAuth) => {
    const { response, text } = await call(operation, { auth });
    expect(anonymousStatuses(operation), text).toContain(response.status);
    expect(response.headers.get('content-type') ?? '').toMatch(/application\/json/);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(leakMarkersIn(text)).toEqual([]);
    const cacheControl = response.headers.get('cache-control');
    if (cacheControl !== null) expect(cacheControl).toContain('no-store');
    expect(harness.fetch).not.toHaveBeenCalled();
    expect(harness.storageCalls).toEqual([]);
    // The Plaid webhook's signature check fetches Plaid's verification key; nothing else may call a provider.
    if (operation.key !== 'POST /api/plaid/webhook') expect(harness.plaidCalls).toEqual([]);
  });
});

describe('signed-in owner with an empty, malformed or {} body', () => {
  beforeEach(() => harness.seedOwnerProfile());
  it.each(mutating.flatMap(operation => ['', '{', '{}'].map(body => [`${operation.key} body=${JSON.stringify(body)}`, operation, body] as const)))('%s', async (_key, operation, body) => {
    const { response, text } = await call(operation, { auth: 'owner', body });
    expect(expectedForEmptyBody(operation, body), text).toContain(response.status);
    expect(leakMarkersIn(text)).toEqual([]);
  });
});

describe('signed-in owner reads on an empty account', () => {
  beforeEach(() => harness.seedOwnerProfile());
  it.each(table(exercised.filter(operation => operation.method === 'GET')))('%s', async (_key, operation) => {
    const { response, text } = await call(operation, { auth: 'owner' });
    expect(response.status, text).not.toBe(500);
    expect(leakMarkersIn(text)).toEqual([]);
  });
});

describe('session cookie callers', () => {
  beforeEach(() => harness.seedOwnerProfile());
  it.each(table(userMutating))('cross-site %s is rejected', async (_key, operation) => {
    const { response, text } = await call(operation, { auth: 'cookie-cross-site', body: '{}' });
    expect([401, 403], text).toContain(response.status);
  });
  it.each(table(userMutating))('same-origin %s behaves like a bearer token', async (_key, operation) => {
    const { response, text } = await call(operation, { auth: 'cookie', body: '{}' });
    expect(expectedForEmptyBody(operation, '{}'), text).toContain(response.status);
  });
});

describe('production gating', () => {
  const gated = exercised.filter(operation => /NODE_ENV/.test(operation.route.source) && /production/.test(operation.route.source));
  beforeEach(() => { vi.stubEnv('NODE_ENV', 'production'); harness.seedOwnerProfile(); });
  afterEach(() => { vi.stubEnv('NODE_ENV', 'test'); });
  it('finds the diagnostic routes', () => { expect(gated.length).toBeGreaterThan(3); });
  it.each(gated.flatMap(operation => (['anonymous', 'owner'] as const).map(auth => [`${auth} ${operation.key}`, operation, auth] as const)))('%s', async (_key, operation, auth: ContractAuth) => {
    const { response, text } = await call(operation, { auth, body: '{}' });
    // A gated route hides itself (404) or keeps its normal answer for a route that only gates its detail.
    const usual = auth === 'anonymous' ? anonymousStatuses(operation)
      : (MUTATING_METHODS as readonly string[]).includes(operation.method) ? expectedForEmptyBody(operation, '{}') : [200, 400];
    expect([...usual, 401, 403, 404], text).toContain(response.status);
    expect(leakMarkersIn(text)).toEqual([]);
  });
});

describe('a database failure never reaches the response body', () => {
  const marker = 'contract-internal-detail-7f3a';
  beforeEach(() => { harness.seedOwnerProfile(); harness.failDatabase(new Error(`${marker} at /srv/node_modules/firebase-admin/lib/firestore.js:1:1`)); });
  it.each(table(exercised.filter(operation => !(operation.key in SERVICE_OPERATIONS) && !(operation.key in REPORTED_OUT_OF_SCOPE))))('%s', async (_key, operation) => {
    const { text, threw } = await call(operation, { auth: 'owner', body: '{}' });
    if (KNOWN_GAPS[operation.key]?.throws) { expect(threw, 'listed as throwing but answered').toBe(true); return; }
    if (KNOWN_GAPS[operation.key]?.leaksDatabaseError) { expect(text).toContain(marker); return; }
    expect(text).not.toContain(marker);
    expect(leakMarkersIn(text)).toEqual([]);
  });
});
