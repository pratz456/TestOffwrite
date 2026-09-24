import { describe, expect, it } from 'vitest';
import { getPlaidOAuthRedirectUri } from '@/lib/plaid/oauth-config';
import { clearPlaidOAuthSession, readPlaidOAuthResume, savePlaidOAuthSession, PLAID_OAUTH_STORAGE_KEY, PLAID_OAUTH_MAX_AGE_MS, type PlaidOAuthSession } from '@/lib/plaid/oauth-session';
const stage = { WRITEOFF_ENV: 'staging', NEXT_PUBLIC_APP_ENV: 'staging', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'writeoff-production-testing', PLAID_ENV: 'sandbox', PLAID_REDIRECT_URI: 'https://writeoff-production-testing.web.app/plaid/oauth' };
const prod = { WRITEOFF_ENV: 'production', NEXT_PUBLIC_APP_ENV: 'production', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'writeoff-23910', PLAID_ENV: 'production', PLAID_REDIRECT_URI: 'https://writeoffapp.com/plaid/oauth' };
describe('server bank OAuth callback allowlist', () => {
  it('uses explicit canonical callbacks for staging and production', () => {
    expect(getPlaidOAuthRedirectUri(stage)).toBe(stage.PLAID_REDIRECT_URI);
    expect(getPlaidOAuthRedirectUri(prod, 'https://writeoffapp.com')).toBe(prod.PLAID_REDIRECT_URI);
  });
  it('retains popup compatibility before redirect configuration is enabled', () => {
    expect(getPlaidOAuthRedirectUri({ ...prod, PLAID_REDIRECT_URI: '' })).toBeUndefined();
  });
  it.each(['https://evil.test/plaid/oauth', 'https://writeoffapp.com.evil.test/plaid/oauth', 'https://writeoffapp.com/plaid/oauth?next=evil', 'https://writeoffapp.com/plaid/oauth#x', 'https://user:pass@writeoffapp.com/plaid/oauth', 'https://writeoffapp.com/other', 'http://writeoffapp.com/plaid/oauth', stage.PLAID_REDIRECT_URI])('rejects unapproved production callback %s', uri => {
    expect(() => getPlaidOAuthRedirectUri({ ...prod, PLAID_REDIRECT_URI: uri })).toThrow();
  });
  it('rejects conflicting project, provider or browser origins', () => {
    expect(() => getPlaidOAuthRedirectUri({ ...prod, NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'writeoff-production-testing' })).toThrow();
    expect(() => getPlaidOAuthRedirectUri({ ...stage, PLAID_ENV: 'production' })).toThrow();
    expect(() => getPlaidOAuthRedirectUri(prod, 'https://evil.test')).toThrow();
  });
  it('permits loopback only for explicitly isolated local Sandbox', () => {
    const env = { WRITEOFF_ENV: 'local', PLAID_ENV: 'sandbox', NODE_ENV: 'development', PLAID_REDIRECT_URI: 'http://localhost:3000/plaid/oauth' };
    expect(getPlaidOAuthRedirectUri(env)).toBe(env.PLAID_REDIRECT_URI);
    expect(() => getPlaidOAuthRedirectUri({ ...env, NODE_ENV: 'production' })).toThrow();
    expect(() => getPlaidOAuthRedirectUri({ ...env, PLAID_ENV: 'production' })).toThrow();
  });
});
const origin = 'https://writeoff-production-testing.web.app';
const href = `${origin}/plaid/oauth?oauth_state_id=synthetic-state`;
function store() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
}
const session = (extra = {}): PlaidOAuthSession => ({ version: 1, uid: 'owner', token: 'link-sandbox-synthetic', redirectUri: `${origin}/plaid/oauth`, fromSettings: true, createdAt: 1000, ...extra });
describe('tab-bound bank OAuth resume', () => {
  it.each([undefined, 'owned-bank'])('restores the original token and update item (%s) only for the same user and origin', itemId => {
    const storage = store(); const value = session(itemId ? { itemId } : {});
    savePlaidOAuthSession(storage, value, origin, 1100);
    expect(readPlaidOAuthResume(storage, 'owner', href, 2000)).toEqual({ session: value, receivedRedirectUri: href });
    clearPlaidOAuthSession(storage); expect(storage.getItem(PLAID_OAUTH_STORAGE_KEY)).toBeNull();
  });
  it('retains the reconnect review identifier through OAuth', () => {
    const storage = store(); const value = session({ reconnectSessionId: 'review-1' });
    savePlaidOAuthSession(storage, value, origin, 1100);
    expect(readPlaidOAuthResume(storage, 'owner', href, 2000)?.session.reconnectSessionId).toBe('review-1');
  });
  it.each(['wrong-user', 'wrong-origin', 'wrong-path', 'missing-state', 'extra-query', 'hash', 'expired', 'future', 'bad-token', 'bad-item', 'bad-reconnect', 'ambiguous-mode', 'malformed'])('fails closed and clears %s sessions', scenario => {
    const storage = store(); let value: unknown = session(); let target = href; let uid = 'owner'; let now = 2000;
    if (scenario === 'wrong-user') uid = 'different-owner';
    if (scenario === 'wrong-origin') target = href.replace(origin, 'https://evil.test');
    if (scenario === 'wrong-path') target = href.replace('/plaid/oauth', '/other');
    if (scenario === 'missing-state') target = `${origin}/plaid/oauth`;
    if (scenario === 'extra-query') target += '&next=https://evil.test';
    if (scenario === 'hash') target += '#fragment';
    if (scenario === 'expired') now = 1000 + PLAID_OAUTH_MAX_AGE_MS;
    if (scenario === 'future') now = 0;
    if (scenario === 'bad-token') value = session({ token: 'access-sandbox-private' });
    if (scenario === 'bad-reconnect') value = session({ reconnectSessionId: '../other' });
    if (scenario === 'ambiguous-mode') value = session({ itemId: 'item', reconnectSessionId: 'review-1' });
    if (scenario === 'bad-item') value = session({ itemId: '../other' });
    storage.setItem(PLAID_OAUTH_STORAGE_KEY, scenario === 'malformed' ? 'bad-json' : JSON.stringify(value));
    expect(readPlaidOAuthResume(storage, uid, target, now)).toBeNull();
    expect(storage.getItem(PLAID_OAUTH_STORAGE_KEY)).toBeNull();
  });
  it('does not launch an unrecoverable redirect when browser storage is unavailable', () => {
    const storage = { ...store(), setItem: () => { throw new Error('blocked'); } };
    expect(() => savePlaidOAuthSession(storage, session(), origin, 1100)).toThrow('browser storage');
  });
});
