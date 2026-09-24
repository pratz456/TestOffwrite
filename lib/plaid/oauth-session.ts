/** Only the short-lived public Link token belongs in tab storage, never a bank access token. */
export const PLAID_OAUTH_STORAGE_KEY = 'writeoff.plaid.oauth.v1';
export const PLAID_OAUTH_MAX_AGE_MS = 30 * 60_000;
export interface PlaidOAuthSession {
  version: 1;
  uid: string;
  token: string;
  redirectUri: string;
  createdAt: number;
  fromSettings: boolean;
  itemId?: string;
  reconnectSessionId?: string;
}
export type PlaidOAuthResume = { session: PlaidOAuthSession; receivedRedirectUri: string };
type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const validItem = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(value);
function validCallback(value: string, origin: string) {
  try {
    const url = new URL(value);
    const secure = url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
    return secure && url.origin === origin && url.pathname === '/plaid/oauth' && !url.search && !url.hash && !url.username && !url.password;
  } catch { return false; }
}
function validSession(value: unknown, uid: string, origin: string, now: number): value is PlaidOAuthSession {
  const session = value as PlaidOAuthSession | null;
  return !!session && session.version === 1 && session.uid === uid && uid.length > 0
    && typeof session.token === 'string' && /^link-(sandbox|production)-[a-zA-Z0-9-]{1,256}$/.test(session.token)
    && typeof session.redirectUri === 'string' && validCallback(session.redirectUri, origin)
    && typeof session.createdAt === 'number' && Number.isFinite(session.createdAt)
    && now >= session.createdAt && now - session.createdAt < PLAID_OAUTH_MAX_AGE_MS
    && typeof session.fromSettings === 'boolean' && (session.itemId === undefined || validItem(session.itemId))
    && (session.reconnectSessionId === undefined || validItem(session.reconnectSessionId))
    && !(session.itemId && session.reconnectSessionId);
}
export function clearPlaidOAuthSession(storage: SessionStorage): void {
  try { storage.removeItem(PLAID_OAUTH_STORAGE_KEY); } catch { /* Storage may be disabled. */ }
}
export function savePlaidOAuthSession(storage: SessionStorage, session: PlaidOAuthSession, origin: string, now = Date.now()): void {
  if (!validSession(session, session.uid, origin, now)) throw new Error('Bank sign-in session is invalid. Please restart the connection.');
  // A failed write must stop OAuth launch: otherwise the returning user cannot resume.
  try { storage.setItem(PLAID_OAUTH_STORAGE_KEY, JSON.stringify(session)); }
  catch { throw new Error('Allow browser storage to connect this bank, or open WriteOff in your browser.'); }
}
export function readPlaidOAuthResume(storage: SessionStorage, uid: string, href: string, now = Date.now()): PlaidOAuthResume | null {
  try {
    const url = new URL(href);
    const state = url.searchParams.get('oauth_state_id');
    if (!state || !/^[a-zA-Z0-9_-]{1,512}$/.test(state) || url.searchParams.size !== 1 || url.hash || url.username || url.password) throw new Error();
    const session: unknown = JSON.parse(storage.getItem(PLAID_OAUTH_STORAGE_KEY) || 'null');
    if (!validSession(session, uid, url.origin, now) || `${url.origin}${url.pathname}` !== session.redirectUri) throw new Error();
    return { session, receivedRedirectUri: href };
  } catch { clearPlaidOAuthSession(storage); return null; }
}
