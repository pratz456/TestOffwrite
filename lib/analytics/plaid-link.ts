/**
 * Plaid Link events. Same delivery as `safeGtagCall` in `lib/analytics/tax-filing.ts`:
 * call `gtag` when it is a function, otherwise push onto `dataLayer` when that array exists.
 * Neither means the Google tag is not loaded, and the call does nothing.
 */

export type PlaidLinkEventName = 'plaid_link_open' | 'plaid_link_handoff' | 'plaid_link_exit';

export type PlaidLinkEventParams = {
  link_session_id?: string;
  status?: string;
  error_code?: string;
};

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PLAID_CODE = /^[A-Za-z0-9_]{1,64}$/;

function safeGtagCall(args: any[]) {
  try {
    const w = window as any;
    const g = typeof w?.gtag === 'function' ? w.gtag : (globalThis as any).gtag;
    if (typeof g === 'function') {
      g(...args);
      return;
    }
    if (Array.isArray(w?.dataLayer)) w.dataLayer.push({ event: args[1], ...(args[2] || {}) });
  } catch {
    // ignore analytics failures
  }
}

function emit(name: PlaidLinkEventName, params: PlaidLinkEventParams) {
  if (typeof window === 'undefined') return;
  safeGtagCall(['event', name, params]);
}

function sessionId(value: unknown): string | undefined {
  return typeof value === 'string' && SESSION_ID.test(value) ? value : undefined;
}

function plaidCode(value: unknown): string | undefined {
  return typeof value === 'string' && PLAID_CODE.test(value) ? value : undefined;
}

function sessionParams(metadata: { link_session_id?: unknown } | null | undefined): PlaidLinkEventParams {
  const link_session_id = sessionId(metadata?.link_session_id);
  return link_session_id ? { link_session_id } : {};
}

export function trackPlaidLinkOpen(metadata: { link_session_id?: unknown } | null | undefined) {
  emit('plaid_link_open', sessionParams(metadata));
}

/** Public token received. Call this before the token is sent to the exchange route. */
export function trackPlaidLinkHandoff(metadata: { link_session_id?: unknown } | null | undefined) {
  emit('plaid_link_handoff', sessionParams(metadata));
}

/** Exit status and error code only. Account, institution, and credential fields are dropped. */
export function trackPlaidLinkExit(
  metadata: { link_session_id?: unknown; status?: unknown; error_code?: unknown } | null | undefined,
  error?: { error_code?: unknown } | null,
) {
  const params: PlaidLinkEventParams = {};
  const link_session_id = sessionId(metadata?.link_session_id);
  const status = plaidCode(metadata?.status);
  const error_code = plaidCode(error?.error_code ?? metadata?.error_code);
  if (link_session_id) params.link_session_id = link_session_id;
  if (status) params.status = status;
  if (error_code) params.error_code = error_code;
  emit('plaid_link_exit', params);
}
