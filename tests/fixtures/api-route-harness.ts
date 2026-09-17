/**
 * Shared doubles for exercising `app/api/**` route modules with no Admin SDK,
 * OpenAI, Stripe, Plaid, Cloud Storage or network I/O.
 *
 *   const harness = installApiRouteMocks();          // before any route import
 *   const route = await import('../app/api/mileage/route');
 *   const response = await route.POST(contractRequest('/api/mileage', { method: 'POST', auth: 'owner', body: '{}' }));
 *
 * Route modules must be imported dynamically after installation: mocks are
 * registered with `vi.doMock`, which applies to the next import of a module.
 * Boundaries are mocked at the SDK edge (the `stripe` package, the Plaid
 * client module, the OpenAI client factory, `firebase-admin/storage`, global
 * `fetch`), so `lib/stripe/*`, `lib/plaid/*` and `lib/ai/*` run their real
 * code against doubles that fail closed instead of reaching the network.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import OpenAI from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeFirestore, type FakeFirestore } from './fake-firestore';

export const SITE_URL = 'https://writeoff-contract.example.test';
export const CONTRACT_OWNER = { uid: 'contract-owner', email: 'contract-owner@example.test' } as const;
export const CONTRACT_ADMIN = { uid: 'contract-admin', email: 'contract-admin@example.test' } as const;
export const OWNER_ID_TOKEN = 'contract-owner-id-token-not-live';
export const ADMIN_ID_TOKEN = 'contract-admin-id-token-not-live';
export const OWNER_SESSION_COOKIE = 'contract-owner-session-not-live';
export const SERVICE_SECRET = 'contract-service-secret-not-live';
export const STORAGE_BUCKET = 'contract-receipts.example.test';

export const LEAK_MARKERS = ['stack', 'at /', 'node_modules', 'firebase-admin'] as const;

const networkDisabled = (service: string) =>
  Object.assign(new Error(`${service} network access is disabled in route contract tests`), { code: 'ECONNREFUSED' });

const decodedToken = (identity: { uid: string; email: string }, extra: Record<string, unknown> = {}) => ({
  uid: identity.uid, sub: identity.uid, email: identity.email, email_verified: true,
  auth_time: Math.floor(Date.now() / 1000) - 60, firebase: { sign_in_provider: 'password', identities: {} }, ...extra,
});

/** Every property is an async function that rejects; `then` stays undefined so the double is not awaited as a promise. */
function rejectingClient(service: string, calls: string[]): any {
  const handler: ProxyHandler<any> = {
    get: (_target, property) => {
      if (property === 'then' || typeof property === 'symbol') return undefined;
      return new Proxy(async () => { calls.push(String(property)); throw networkDisabled(service); }, handler);
    },
  };
  return new Proxy(async () => { throw networkDisabled(service); }, handler);
}

export interface ApiRouteHarness {
  db: FakeFirestore;
  auth: {
    verifyIdToken: ReturnType<typeof vi.fn>; verifySessionCookie: ReturnType<typeof vi.fn>; createSessionCookie: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>; getUserByEmail: ReturnType<typeof vi.fn>; deleteUser: ReturnType<typeof vi.fn>;
    revokeRefreshTokens: ReturnType<typeof vi.fn>; updateUser: ReturnType<typeof vi.fn>; setCustomUserClaims: ReturnType<typeof vi.fn>;
  };
  fetch: ReturnType<typeof vi.fn>;
  /** Names of Plaid client methods invoked, in order. */
  plaidCalls: string[];
  /** Storage file operations invoked, in order. */
  storageCalls: string[];
  /** Makes every Firestore read, write and transaction throw this error (null restores service). */
  failDatabase(error: Error | null): void;
  /** Saves a verified owner profile with an active trial so entitlement-gated routes reach their own validation. */
  seedOwnerProfile(extra?: Record<string, unknown>): void;
  /** Clears records, call logs and rate-limit windows between tests. */
  reset(): Promise<void>;
}

let installed: ApiRouteHarness | null = null;

/** Registers module doubles and environment. Idempotent within a test file. */
export function installApiRouteMocks(): ApiRouteHarness {
  if (installed) return installed;
  const state: { databaseFailure: Error | null } = { databaseFailure: null };
  const db = createFakeFirestore({ failure: () => state.databaseFailure });
  const plaidCalls: string[] = [];
  const storageCalls: string[] = [];
  const fetchDouble = vi.fn(async (input: unknown) => { throw networkDisabled(`fetch(${String(input instanceof Request ? input.url : input)})`); });

  const auth = {
    verifyIdToken: vi.fn(async (token: string) => {
      if (token === OWNER_ID_TOKEN) return decodedToken(CONTRACT_OWNER);
      if (token === ADMIN_ID_TOKEN) return decodedToken(CONTRACT_ADMIN, { admin: true });
      throw Object.assign(new Error('Decoding Firebase ID token failed'), { code: 'auth/argument-error' });
    }),
    verifySessionCookie: vi.fn(async (cookie: string) => {
      if (cookie === OWNER_SESSION_COOKIE) return decodedToken(CONTRACT_OWNER);
      throw Object.assign(new Error('Session cookie is invalid'), { code: 'auth/argument-error' });
    }),
    createSessionCookie: vi.fn(async () => 'contract-created-session-cookie'),
    getUser: vi.fn(async (uid: string) => ({ uid, email: uid === CONTRACT_OWNER.uid ? CONTRACT_OWNER.email : null, emailVerified: true, disabled: false,
      providerData: [{ providerId: 'password' }], metadata: { creationTime: new Date(0).toUTCString(), lastSignInTime: new Date(0).toUTCString() }, customClaims: {} })),
    getUserByEmail: vi.fn(async () => { throw Object.assign(new Error('No user record'), { code: 'auth/user-not-found' }); }),
    deleteUser: vi.fn(async () => undefined),
    revokeRefreshTokens: vi.fn(async () => undefined),
    updateUser: vi.fn(async (uid: string, fields: Record<string, unknown>) => ({ uid, ...fields })),
    setCustomUserClaims: vi.fn(async () => undefined),
  };

  vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE_URL);
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'contract-project');
  vi.stubEnv('FIREBASE_ADMIN_PROJECT_ID', 'contract-project');
  vi.stubEnv('FIREBASE_STORAGE_BUCKET', STORAGE_BUCKET);
  vi.stubEnv('OPENAI_API_KEY', 'contract-openai-key-not-live');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_contract_not_live');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_contract_not_live');
  vi.stubEnv('STRIPE_PRICE_ID_MONTHLY', 'price_contract_monthly');
  vi.stubEnv('STRIPE_PRICE_ID_YEARLY', 'price_contract_yearly');
  vi.stubEnv('PLAID_CLIENT_ID', 'contract-plaid-client-id');
  vi.stubEnv('PLAID_SECRET', 'contract-plaid-secret-not-live');
  vi.stubEnv('PLAID_ENV', 'sandbox');
  vi.stubEnv('ANALYSIS_WORKER_SECRET', SERVICE_SECRET);
  vi.stubEnv('CLOUD_FUNCTION_SECRET', SERVICE_SECRET);
  vi.stubGlobal('fetch', fetchDouble);

  vi.doMock('@/lib/firebase/admin', () => ({
    adminApp: { name: '[DEFAULT]', options: { projectId: 'contract-project', storageBucket: STORAGE_BUCKET } },
    adminAuth: auth, adminDb: db, admin: { firestore: { FieldValue, Timestamp } }, FieldValue, Timestamp,
    verifyIdToken: async (token: string) => { try { const decoded = await auth.verifyIdToken(token); return { success: true, uid: decoded.uid, email: decoded.email }; } catch (error) { return { success: false, error }; } },
    getUserByEmail: async (email: string) => { try { return { success: true, user: await auth.getUserByEmail(email) }; } catch (error) { return { success: false, error }; } },
    updateEmailVerified: async () => ({ success: true }),
  }));
  vi.doMock('@/lib/security/rate-limit-store', () => import('./rate-limit-store'));
  vi.doMock('firebase-admin/storage', () => {
    const file = (name: string) => ({
      name,
      exists: async () => { storageCalls.push(`exists ${name}`); return [false]; },
      download: async () => { storageCalls.push(`download ${name}`); throw Object.assign(new Error('No such object'), { code: 404 }); },
      getMetadata: async () => { storageCalls.push(`getMetadata ${name}`); throw Object.assign(new Error('No such object'), { code: 404 }); },
      save: async () => { storageCalls.push(`save ${name}`); throw networkDisabled('Cloud Storage'); },
      delete: async () => { storageCalls.push(`delete ${name}`); },
      getSignedUrl: async () => { storageCalls.push(`getSignedUrl ${name}`); throw networkDisabled('Cloud Storage'); },
      createReadStream: () => { storageCalls.push(`createReadStream ${name}`); throw networkDisabled('Cloud Storage'); },
    });
    const bucket = (name: string) => ({ name, file, getFiles: async () => { storageCalls.push('getFiles'); return [[]]; }, deleteFiles: async () => { storageCalls.push('deleteFiles'); } });
    return { getStorage: () => ({ app: { options: { storageBucket: STORAGE_BUCKET } }, bucket }) };
  });
  vi.doMock('@/lib/plaid/client', () => {
    const client = rejectingClient('Plaid', plaidCalls);
    return { createPlaidClient: () => client, plaidClient: client };
  });
  vi.doMock('@/lib/openai/client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/openai/client')>();
    return { ...actual, getOpenAIClientOrThrow: (options: { timeout?: number } = {}) => new OpenAI({
      apiKey: 'contract-openai-key-not-live', baseURL: 'https://openai.contract.invalid/v1', fetch: fetchDouble as unknown as typeof fetch,
      maxRetries: 0, timeout: options.timeout ?? 1_000, logLevel: 'off',
    }) };
  });
  vi.doMock('stripe', async (importOriginal) => {
    const actual = await importOriginal<typeof import('stripe')>();
    const Real = actual.default as any;
    // Real SDK classes and error types, but every HTTP call goes through the rejecting fetch double.
    const Double: any = function (this: unknown, key: string, config: Record<string, unknown> = {}) {
      return new Real(key, { ...config, httpClient: Real.createFetchHttpClient(fetchDouble), maxNetworkRetries: 0, timeout: 1_000 });
    };
    Object.setPrototypeOf(Double, Real);
    Double.prototype = Real.prototype;
    return { ...actual, default: Double };
  });

  installed = {
    db, auth, fetch: fetchDouble, plaidCalls, storageCalls,
    failDatabase: error => { state.databaseFailure = error; },
    seedOwnerProfile: (extra = {}) => {
      const now = Date.now();
      db.records.set(`user_profiles/${CONTRACT_OWNER.uid}`, {
        userId: CONTRACT_OWNER.uid, email: CONTRACT_OWNER.email, displayName: 'Contract Owner', createdAt: new Date(now - 86_400_000),
        subscriptionStatus: 'trial', trialStart: new Date(now - 86_400_000), trialEnd: new Date(now + 20 * 86_400_000), hasHistoricalAccess: true,
        businessType: 'sole_proprietor', filingStatus: 'single', state: 'CA', ...extra,
      });
    },
    reset: async () => {
      state.databaseFailure = null;
      db.records.clear(); plaidCalls.length = 0; storageCalls.length = 0; fetchDouble.mockClear();
      for (const double of Object.values(auth)) double.mockClear();
      (await import('./rate-limit-store')).resetRateLimitStore();
    },
  };
  return installed;
}

export type ContractAuth = 'anonymous' | 'owner' | 'admin' | 'cookie' | 'cookie-cross-site' | 'service' | 'invalid-token';

export interface ContractRequestInit {
  method?: string;
  auth?: ContractAuth;
  /** Raw body; `undefined` sends no body. Objects are JSON-encoded. */
  body?: string | Record<string, unknown> | null;
  headers?: Record<string, string>;
}

/** Builds a request against the configured site origin with the chosen credential shape. */
export function contractRequest(routePath: string, init: ContractRequestInit = {}): NextRequest {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  switch (init.auth ?? 'anonymous') {
    case 'owner': headers.set('authorization', `Bearer ${OWNER_ID_TOKEN}`); break;
    case 'admin': headers.set('authorization', `Bearer ${ADMIN_ID_TOKEN}`); break;
    case 'invalid-token': headers.set('authorization', 'Bearer contract-forged-token'); break;
    case 'cookie': headers.set('cookie', `__session=${OWNER_SESSION_COOKIE}`); headers.set('origin', SITE_URL); headers.set('sec-fetch-site', 'same-origin'); break;
    case 'cookie-cross-site': headers.set('cookie', `__session=${OWNER_SESSION_COOKIE}`); headers.set('origin', 'https://attacker.example.test'); headers.set('sec-fetch-site', 'cross-site'); break;
    case 'service': headers.set('x-analysis-worker-secret', SERVICE_SECRET); headers.set('x-cloud-function-secret', SERVICE_SECRET); break;
    case 'anonymous': break;
  }
  let body: string | undefined;
  if (init.body !== undefined && init.body !== null && !['GET', 'HEAD'].includes(method)) {
    body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  }
  return new NextRequest(`${SITE_URL}${routePath}`, { method, headers, body });
}

export const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const ROUTE_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

export interface DiscoveredRoute {
  /** Repository-relative file, e.g. `app/api/accounts/[accountId]/usage/route.ts`. */
  file: string;
  /** Absolute path for dynamic import. */
  importPath: string;
  /** URL pattern with bracket segments, e.g. `/api/accounts/[accountId]/usage`. */
  pattern: string;
  /** Concrete request path with synthetic identifiers substituted. */
  requestPath: string;
  params: Record<string, string | string[]>;
  source: string;
}

const PLACEHOLDERS: Record<string, string> = {
  accountId: 'contract-account', id: 'contract-record', itemId: 'contract-item', uid: 'contract-lookup-uid', filename: 'contract-receipt.png',
};

/** Walks `app/api` for every `route.ts`; nothing is hard-coded so new routes are covered automatically. */
export function discoverApiRoutes(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app/api')): DiscoveredRoute[] {
  const repoRoot = path.resolve(root, '../..');
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === 'route.ts') files.push(full);
    }
  };
  walk(root);
  return files.sort().map(importPath => {
    const file = path.relative(repoRoot, importPath).split(path.sep).join('/');
    const pattern = '/' + path.relative(repoRoot, path.dirname(importPath)).split(path.sep).slice(1).join('/');
    const params: Record<string, string | string[]> = {};
    const requestPath = pattern.split('/').map(segment => {
      const catchAll = segment.match(/^\[\.\.\.(\w+)\]$/);
      if (catchAll) { params[catchAll[1]] = ['contract-owner', 'contract-receipt.png']; return (params[catchAll[1]] as string[]).join('/'); }
      const dynamic = segment.match(/^\[(\w+)\]$/);
      if (dynamic) { params[dynamic[1]] = PLACEHOLDERS[dynamic[1]] ?? `contract-${dynamic[1]}`; return params[dynamic[1]] as string; }
      return segment;
    }).join('/');
    return { file, importPath, pattern, requestPath, params, source: fs.readFileSync(importPath, 'utf8') };
  });
}

/** Next 15 hands routes a `params` promise; older handlers read it synchronously, so both shapes resolve. */
export function routeContext(route: DiscoveredRoute): { params: Promise<Record<string, string | string[]>> & Record<string, string | string[]> } {
  return { params: Object.assign(Promise.resolve({ ...route.params }), route.params) };
}

export function exportedMethods(module: Record<string, unknown>): string[] {
  return ROUTE_METHODS.filter(method => typeof module[method] === 'function');
}

export function leakMarkersIn(text: string): string[] {
  return LEAK_MARKERS.filter(marker => text.includes(marker));
}
