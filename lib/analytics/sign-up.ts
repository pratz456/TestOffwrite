/**
 * sign_up analytics for a new account.
 * Same guard style as safeGtagCall in lib/analytics/tax-filing.ts, with two limits:
 * the call does nothing when the Google tag function is absent, and send_to is the
 * configured measurement ID so no other property receives the event.
 */

import { readStoredAcquisition, type Acquisition, type KeyValueStorage } from '@/lib/analytics/acquisition';
import { gaMeasurementId, type AnalyticsEnv } from '@/lib/analytics/ga-measurement-id';

export type SignupMethod = 'email' | 'google';
const EVENT_KEY_PREFIX = 'writeoff.sign-up-event.';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;

type Gtag = (...args: unknown[]) => void;

export interface SignupIdentity {
  uid: string;
  getIdToken: () => Promise<string>;
}

export interface SignUpTrackingOptions {
  now?: number;
  storage?: KeyValueStorage | null;
  env?: AnalyticsEnv;
  gtag?: Gtag | null;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

function pageGtag(): Gtag | undefined {
  if (typeof window === 'undefined') return undefined;
  const gtag = (window as Window & { gtag?: Gtag }).gtag;
  return typeof gtag === 'function' ? gtag : undefined;
}

function browserStorage(): KeyValueStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function trackSignUp(
  method: SignupMethod,
  uid: string,
  acquisition: Acquisition | null,
  options: SignUpTrackingOptions = {},
): boolean {
  const measurementId = gaMeasurementId(options.env);
  const gtag = options.gtag === undefined ? pageGtag() : options.gtag;
  if (!measurementId || typeof gtag !== 'function' || !uid) return false;
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const key = `${EVENT_KEY_PREFIX}${uid}`;
  try {
    if (storage?.getItem(key)) return false;
    storage?.setItem(key, method);
  } catch {
    // A storage failure should not block the event, and should not throw.
  }
  const params: Record<string, string> = { method, send_to: measurementId };
  for (const name of UTM_KEYS) {
    const value = acquisition?.[name];
    if (value) params[name] = value;
  }
  try {
    gtag('event', 'sign_up', params);
    return true;
  } catch {
    try { storage?.removeItem(key); } catch { /* ignore */ }
    return false;
  }
}

/** Sends sign_up when the tag is loaded, and posts a captured source for the server to store once. */
export async function attributeSignup(
  method: SignupMethod,
  user: SignupIdentity,
  options: SignUpTrackingOptions = {},
): Promise<void> {
  try {
    const now = options.now ?? Date.now();
    const storage = options.storage === undefined ? browserStorage() : options.storage;
    const acquisition = storage ? readStoredAcquisition(storage, now) : null;
    trackSignUp(method, user.uid, acquisition, { ...options, storage });
    if (!acquisition) return;
    const idToken = await user.getIdToken();
    const fetchImpl = options.fetch ?? fetch;
    await fetchImpl('/api/account/acquisition', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ acquisition }),
      keepalive: true,
      signal: options.signal ?? AbortSignal.timeout(4000),
    });
  } catch {
    // Campaign attribution must not block account creation.
  }
}
