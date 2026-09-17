/**
 * Durable request throttling for Node route handlers.
 *
 * Next middleware runs in the edge runtime with per-instance memory only, so it
 * stays a cheap first line and cannot use firebase-admin. This module is the
 * authoritative limit: one fixed window per (scope, owner) kept in the
 * server-only `rate_limits` collection and advanced inside a Firestore
 * transaction, so every hosting instance and cold start shares the same count.
 * Firestore access goes through ./rate-limit-store so tests can substitute the
 * throttle store without replacing a route's own database doubles.
 *
 * Document ID: SHA-256 of "writeoff-rate-limit-v1\n<scope>\n<key>", or an
 * HMAC-SHA256 with the same input when RATE_LIMIT_HASH_SECRET is configured
 * (recommended in production so stored IDs cannot be correlated offline). The
 * raw key (a UID or a client address) is never stored; anonymous callers are
 * keyed by `anonymousRateLimitKey`, which already hashes the address.
 *
 * Document fields: { scope, windowStart, count, expiresAt, updatedAt }.
 * `expiresAt` is a Timestamp meant for a Firestore TTL policy. Enable it once
 * per project (no index or rules change is needed; TTL deletion can lag by up
 * to about 24 hours, which is harmless because expired windows are ignored):
 *
 *   gcloud firestore fields ttls update expiresAt \
 *     --collection-group=rate_limits --enable-ttl --project=<project-id>
 *
 * Unavailability policy is explicit per call (`onUnavailable`):
 *   'deny'   – destructive or costly work (uploads, AI, exports, billing, bank
 *              linking, deletion) refuses with 503 RATE_LIMIT_UNAVAILABLE until
 *              the store answers. These routes need Firestore anyway.
 *   'memory' – a per-instance in-memory window keeps a best-effort bound; used
 *              where blocking would lock people out of the app (sign-in).
 *   'allow'  – read-only status checks that must never block.
 */
import { createHash, createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import { rateLimitStore } from './rate-limit-store';

export const RATE_LIMIT_COLLECTION = 'rate_limits';
const HASH_DOMAIN = 'writeoff-rate-limit-v1';
const STORE_TIMEOUT_MS = 3_000;
const UNAVAILABLE_RETRY_SECONDS = 30;
/** Keeps a window readable slightly past its end so a late refund can still find it. */
const TTL_GRACE_MS = 5 * 60_000;
const MEMORY_MAX_ENTRIES = 10_000;

export type RateLimitUnavailablePolicy = 'allow' | 'memory' | 'deny';

export interface RateLimitOptions {
  /** Stable route or feature identifier, for example 'auth.session'. */
  scope: string;
  /** Owner identity: the authenticated UID, or `anonymousRateLimitKey(request)`. Never stored. */
  key: string;
  /** Requests permitted per window; a positive integer. */
  limit: number;
  /** Window length in milliseconds; at least one second. */
  windowMs: number;
  onUnavailable: RateLimitUnavailablePolicy;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets; 0 when the request is allowed. */
  retryAfterSeconds: number;
  /** Epoch milliseconds when the current window ends. */
  resetAt: number;
  source: 'firestore' | 'memory' | 'policy';
  /** The durable store did not answer; `source` shows which fallback decided. */
  unavailable: boolean;
}

/**
 * Route policies. Keys are the authenticated UID unless noted. Middleware keeps
 * its coarser per-instance address limits in front of all of these.
 */
export const RATE_LIMITS = {
  /** Keyed by hashed client address (`anonymousRateLimitKey`); sign-in must not depend on the store. */
  sessionCreate: { scope: 'auth.session', limit: 30, windowMs: 10 * 60_000, onUnavailable: 'memory' },
  receiptUpload: { scope: 'receipt.upload', limit: 60, windowMs: 10 * 60_000, onUnavailable: 'deny' },
  receiptProcess: { scope: 'receipt.process', limit: 60, windowMs: 10 * 60_000, onUnavailable: 'deny' },
  aiAnalyzeTransaction: { scope: 'ai.analyze-transaction', limit: 60, windowMs: 60 * 60_000, onUnavailable: 'deny' },
  /** Completed archives; a failed attempt is refunded so recovery is not locked out. */
  userExport: { scope: 'user.export', limit: 1, windowMs: 60 * 60_000, onUnavailable: 'deny' },
  /** Every archive attempt, including failures, so repeated full reads stay bounded. */
  userExportAttempts: { scope: 'user.export.attempts', limit: 12, windowMs: 60 * 60_000, onUnavailable: 'deny' },
  userDelete: { scope: 'user.delete', limit: 10, windowMs: 60 * 60_000, onUnavailable: 'deny' },
  stripeCheckout: { scope: 'stripe.checkout', limit: 10, windowMs: 10 * 60_000, onUnavailable: 'deny' },
  stripePortal: { scope: 'stripe.portal', limit: 10, windowMs: 10 * 60_000, onUnavailable: 'deny' },
  plaidLinkToken: { scope: 'plaid.link-token', limit: 20, windowMs: 10 * 60_000, onUnavailable: 'deny' },
  supportAccountLookup: { scope: 'support.account', limit: 60, windowMs: 10 * 60_000, onUnavailable: 'deny' },
  /** Each call may stamp up to 200 of the caller's transactions, so the window stays small. */
  bulkConfirm: { scope: 'transactions.bulk-confirm', limit: 20, windowMs: 10 * 60_000, onUnavailable: 'deny' },
} as const satisfies Record<string, Omit<RateLimitOptions, 'key'>>;

interface WindowState { windowStart: number; count: number }
interface WindowOutcome { state: WindowState; allowed: boolean; changed: boolean }

const memory = new Map<string, WindowState & { expiresAt: number }>();

export function rateLimitKeyHash(scope: string, key: string): string {
  const input = `${HASH_DOMAIN}\n${scope}\n${key}`;
  const secret = process.env.RATE_LIMIT_HASH_SECRET;
  return secret ? createHmac('sha256', secret).update(input).digest('hex') : createHash('sha256').update(input).digest('hex');
}

/** Anonymous owner key. The address is hashed here so it never appears in keys, logs or documents. */
export function anonymousRateLimitKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const address = forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
  return `ip:${createHash('sha256').update(address).digest('hex').slice(0, 32)}`;
}

function validate(options: RateLimitOptions): void {
  if (!options.scope || typeof options.scope !== 'string') throw new Error('Rate limit scope is required');
  if (typeof options.key !== 'string' || !options.key) throw new Error('Rate limit key is required');
  if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error('Rate limit must be a positive integer');
  if (!Number.isFinite(options.windowMs) || options.windowMs < 1_000) throw new Error('Rate limit window must be at least one second');
  if (!['allow', 'memory', 'deny'].includes(options.onUnavailable)) throw new Error('Rate limit unavailability policy is required');
}

/** Fixed window: a window older than `windowMs` (or implausibly far ahead of this clock) restarts. */
function advance(state: WindowState | undefined, now: number, limit: number, windowMs: number, consume: boolean): WindowOutcome {
  const live = state && now < state.windowStart + windowMs && state.windowStart < now + windowMs ? state : undefined;
  if (!live) {
    return consume ? { state: { windowStart: now, count: 1 }, allowed: true, changed: true }
      : { state: { windowStart: now, count: 0 }, allowed: true, changed: false };
  }
  if (live.count >= limit) return { state: live, allowed: false, changed: false };
  return consume ? { state: { windowStart: live.windowStart, count: live.count + 1 }, allowed: true, changed: true }
    : { state: live, allowed: true, changed: false };
}

function readState(snapshot: unknown): WindowState | undefined {
  const data = snapshot && typeof snapshot === 'object' && typeof (snapshot as { data?: unknown }).data === 'function'
    ? (snapshot as { data: () => Record<string, unknown> | undefined }).data() : undefined;
  if (!data || typeof data.windowStart !== 'number' || typeof data.count !== 'number') return undefined;
  return { windowStart: data.windowStart, count: data.count };
}

function isOutcome(value: unknown): value is WindowOutcome {
  const outcome = value as WindowOutcome | undefined;
  return Boolean(outcome && typeof outcome.allowed === 'boolean' && outcome.state
    && typeof outcome.state.windowStart === 'number' && typeof outcome.state.count === 'number');
}

function withTimeout<T>(work: () => Promise<T> | T, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Rate limit store timed out')), ms);
    Promise.resolve().then(work).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

function documentFor(scope: string, state: WindowState, windowMs: number, now: number) {
  return { scope, windowStart: state.windowStart, count: state.count,
    expiresAt: new Date(state.windowStart + windowMs + TTL_GRACE_MS), updatedAt: new Date(now) };
}

async function firestoreOutcome(id: string, options: RateLimitOptions, now: number, consume: boolean): Promise<WindowOutcome> {
  const outcome = await withTimeout(async () => {
    const store = await rateLimitStore();
    const ref = store.doc(`${RATE_LIMIT_COLLECTION}/${id}`);
    if (!consume) return advance(readState(await ref.get()), now, options.limit, options.windowMs, false);
    return store.runTransaction(async tx => {
      const result = advance(readState(await tx.get(ref)), now, options.limit, options.windowMs, true);
      if (result.changed) tx.set(ref, documentFor(options.scope, result.state, options.windowMs, now));
      return result;
    });
  }, STORE_TIMEOUT_MS);
  if (!isOutcome(outcome)) throw new Error('Rate limit store returned an invalid decision');
  return outcome;
}

function memoryOutcome(id: string, options: RateLimitOptions, now: number, consume: boolean): WindowOutcome {
  if (memory.size >= MEMORY_MAX_ENTRIES) {
    for (const [key, entry] of memory) if (entry.expiresAt <= now) memory.delete(key);
    if (memory.size >= MEMORY_MAX_ENTRIES) memory.delete(memory.keys().next().value as string);
  }
  const outcome = advance(memory.get(id), now, options.limit, options.windowMs, consume);
  if (outcome.changed) memory.set(id, { ...outcome.state, expiresAt: outcome.state.windowStart + options.windowMs });
  return outcome;
}

function toResult(outcome: WindowOutcome, options: RateLimitOptions, now: number, source: RateLimitResult['source'], unavailable: boolean): RateLimitResult {
  const resetAt = outcome.state.windowStart + options.windowMs;
  return {
    allowed: outcome.allowed, limit: options.limit, remaining: Math.max(0, options.limit - outcome.state.count),
    retryAfterSeconds: outcome.allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)),
    resetAt, source, unavailable,
  };
}

function reportUnavailable(options: RateLimitOptions): void {
  if (process.env.NODE_ENV === 'test') return;
  // Scope and policy only: no owner key, address, or store error text.
  process.stderr.write(`${JSON.stringify({ event: 'rate-limit-store-unavailable', scope: options.scope, policy: options.onUnavailable })}\n`);
}

function unavailableResult(id: string, options: RateLimitOptions, now: number, consume: boolean): RateLimitResult {
  reportUnavailable(options);
  if (options.onUnavailable === 'memory') return toResult(memoryOutcome(id, options, now, consume), options, now, 'memory', true);
  if (options.onUnavailable === 'allow') {
    return { allowed: true, limit: options.limit, remaining: options.limit, retryAfterSeconds: 0,
      resetAt: now + options.windowMs, source: 'policy', unavailable: true };
  }
  return { allowed: false, limit: options.limit, remaining: 0, retryAfterSeconds: UNAVAILABLE_RETRY_SECONDS,
    resetAt: now + UNAVAILABLE_RETRY_SECONDS * 1000, source: 'policy', unavailable: true };
}

/** Consume one request from the owner's window. Never throws for store failures. */
export async function enforceRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  validate(options);
  const now = Date.now();
  const id = rateLimitKeyHash(options.scope, options.key);
  try { return toResult(await firestoreOutcome(id, options, now, true), options, now, 'firestore', false); }
  catch { return unavailableResult(id, options, now, true); }
}

/** Read the owner's window without consuming a request. */
export async function peekRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  validate(options);
  const now = Date.now();
  const id = rateLimitKeyHash(options.scope, options.key);
  try { return toResult(await firestoreOutcome(id, options, now, false), options, now, 'firestore', false); }
  catch { return unavailableResult(id, options, now, false); }
}

/**
 * Give back a request consumed by `enforceRateLimit` when the guarded work did
 * not complete, so a failed attempt does not lock the owner out. Best effort:
 * only the same window is decremented, and a store failure returns false.
 */
export async function refundRateLimit(options: RateLimitOptions, consumed: RateLimitResult): Promise<boolean> {
  validate(options);
  if (!consumed.allowed || consumed.source === 'policy') return false;
  const id = rateLimitKeyHash(options.scope, options.key);
  const sameWindow = (state: WindowState | undefined) => state !== undefined && state.count > 0 && state.windowStart + options.windowMs === consumed.resetAt;
  if (consumed.source === 'memory') {
    const entry = memory.get(id);
    if (sameWindow(entry)) entry!.count -= 1;
    return true;
  }
  try {
    await withTimeout(async () => {
      const store = await rateLimitStore();
      const ref = store.doc(`${RATE_LIMIT_COLLECTION}/${id}`);
      await store.runTransaction(async tx => {
        const state = readState(await tx.get(ref));
        if (sameWindow(state)) tx.set(ref, documentFor(options.scope, { windowStart: state!.windowStart, count: state!.count - 1 }, options.windowMs, Date.now()));
      });
    }, STORE_TIMEOUT_MS);
    return true;
  } catch { return false; }
}

/**
 * Standard refusal: 429 RATE_LIMITED (or a route-specific code) with Retry-After,
 * or 503 RATE_LIMIT_UNAVAILABLE when a 'deny' policy refused because the store
 * did not answer. Bodies never include the owner key.
 */
export function rateLimitResponse(result: RateLimitResult, overrides: { code?: string; error?: string; headers?: Record<string, string> } = {}): NextResponse {
  const retryAfter = Math.max(1, Math.ceil(result.retryAfterSeconds));
  const headers = { 'Retry-After': String(retryAfter), 'Cache-Control': 'private, no-store', ...overrides.headers };
  if (result.unavailable && result.source === 'policy') {
    return NextResponse.json({ code: 'RATE_LIMIT_UNAVAILABLE', error: 'This action is temporarily unavailable. Please retry in a moment.', retryAfter },
      { status: 503, headers });
  }
  return NextResponse.json({ code: overrides.code ?? 'RATE_LIMITED', error: overrides.error ?? 'Too many requests. Please try again later.', retryAfter },
    { status: 429, headers });
}

/** Clears the per-instance fallback windows. Intended for tests. */
export function clearRateLimitMemory(): void {
  memory.clear();
}
