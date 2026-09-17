import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], request: vi.fn(), fetch: vi.fn(), open: vi.fn(), push: vi.fn(), replace: vi.fn(), link: null as any,
  currentUser: { uid: 'owner', getIdToken: vi.fn().mockResolvedValue('synthetic-id-token') } as any, authUser: { id: 'owner' } as any, authLoading: false }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial: any) { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next; }]; },
    useRef(initial: any) { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
    useCallback(callback: any, deps: any[]) { const i = h.cursor++; if (!same(h.slots[i]?.deps, deps)) h.slots[i] = { callback, deps }; return h.slots[i].callback; },
    useEffect(effect: () => void | (() => void), deps: any[]) { const i = h.cursor++, old = h.slots[i]; if (!same(old?.deps, deps)) { const next: any = { deps }; h.slots[i] = next; h.effects.push(() => { old?.cleanup?.(); next.cleanup = effect(); }); } },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('react-plaid-link', () => ({ usePlaidLink: (config: any) => { h.link = config; return { ready: !!config.token, open: h.open }; } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, replace: h.replace }) }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: h.request }));
vi.mock('@/lib/firebase/client', () => ({ auth: { get currentUser() { return h.currentUser; } } }));
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: h.authUser, loading: h.authLoading }) }));
vi.mock('@/lib/hooks/useJobProgress', () => ({ useJobProgress: () => ({ job: null, error: null }) }));
import { PlaidLinkScreen } from '@/components/plaid-link-screen';
import PlaidOAuthPage from '@/app/plaid/oauth/page';
import { savePlaidOAuthSession, PLAID_OAUTH_STORAGE_KEY, type PlaidOAuthSession } from '@/lib/plaid/oauth-session';
const origin = 'https://writeoff-production-testing.web.app';
const href = `${origin}/plaid/oauth?oauth_state_id=synthetic-state`;
let storage: Storage;
const session = (itemId?: string): PlaidOAuthSession => ({ version: 1, uid: 'owner', token: 'link-sandbox-original', redirectUri: `${origin}/plaid/oauth`, createdAt: Date.now(), fromSettings: true, ...(itemId ? { itemId } : {}) });
const walk = (node: any): any[] => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
const content = (node: any): string => Array.isArray(node) ? node.map(content).join('') : node && typeof node === 'object' ? content(node.props?.children) : String(node ?? '');
function render(component: () => any) { h.cursor = 0; const tree = component(); h.effects.splice(0).forEach(f => f()); return tree; }
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
beforeEach(() => {
  h.slots = []; h.cursor = 0; h.effects = []; vi.clearAllMocks(); h.link = null;
  h.currentUser = { uid: 'owner', getIdToken: vi.fn().mockResolvedValue('synthetic-id-token') }; h.authUser = { id: 'owner' }; h.authLoading = false;
  const records = new Map<string, string>();
  storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => { records.set(key, value); }, removeItem: key => { records.delete(key); } } as Storage;
  vi.stubGlobal('window', { location: { origin, href, pathname: '/plaid/oauth', search: '?oauth_state_id=synthetic-state' }, sessionStorage: storage });
  vi.stubGlobal('document', { querySelector: () => null });
  vi.stubGlobal('fetch', h.fetch);
  h.fetch.mockImplementation(async () => Response.json({ link_token: 'link-sandbox-new', redirect_uri: `${origin}/plaid/oauth` }));
  h.request.mockResolvedValue(Response.json({ success: true, transactions_saved: 0 }));
});
afterEach(() => { h.slots.forEach(slot => slot?.cleanup?.()); vi.unstubAllGlobals(); });
describe('Plaid OAuth client resume', () => {
  it('reopens the original Link token with the full received URI without issuing a second Link token', () => {
    const saved = session(); savePlaidOAuthSession(storage, saved, origin);
    const component = () => PlaidLinkScreen({ user: { id: 'owner' }, oauthResume: { session: saved, receivedRedirectUri: href }, onSuccess() {}, onBack() {} });
    render(component); render(component); render(component);
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.open).toHaveBeenCalledOnce();
    expect(h.link).toMatchObject({ token: 'link-sandbox-original', receivedRedirectUri: href });
  });
  it('finishes resumed repair with exact-item sync and no public token exchange, then clears session', async () => {
    const saved = session('owned-item'); savePlaidOAuthSession(storage, saved, origin); const done = vi.fn();
    const component = () => PlaidLinkScreen({ user: { id: 'owner' }, updateItemId: 'owned-item', oauthResume: { session: saved, receivedRedirectUri: href }, onSuccess: done, onBack() {} });
    render(component); render(component); await h.link.onSuccess(null);
    expect(h.request).toHaveBeenCalledWith('/api/plaid/sync-transactions', { method: 'POST', body: JSON.stringify({ itemId: 'owned-item', incremental: true }) });
    expect(h.fetch).not.toHaveBeenCalled(); expect(done).toHaveBeenCalledOnce();
    expect(storage.getItem(PLAID_OAUTH_STORAGE_KEY)).toBeNull();
  });
  it('exchanges the returned public token only after a resumed new connection succeeds', async () => {
    const saved = session(); savePlaidOAuthSession(storage, saved, origin);
    h.fetch.mockResolvedValue(Response.json({ accountId: 'saved-account', imported: 3 }));
    const component = () => PlaidLinkScreen({ user: { id: 'owner' }, oauthResume: { session: saved, receivedRedirectUri: href }, onSuccess() {}, onBack() {} });
    render(component); render(component); await h.link.onSuccess('public-sandbox-fixture');
    expect(h.fetch).toHaveBeenCalledExactlyOnceWith(`${origin}/api/plaid/exchange-public-token`, expect.objectContaining({ body: JSON.stringify({ public_token: 'public-sandbox-fixture' }) }));
    expect(h.push).toHaveBeenCalledWith('/protected/account-usage/saved-account?imported=3');
    expect(storage.getItem(PLAID_OAUTH_STORAGE_KEY)).toBeNull();
  });
  it('clears canceled sessions and never exchanges or syncs on exit', () => {
    const saved = session(); savePlaidOAuthSession(storage, saved, origin);
    const component = () => PlaidLinkScreen({ user: { id: 'owner' }, oauthResume: { session: saved, receivedRedirectUri: href }, onSuccess() {}, onBack() {} });
    render(component); render(component); h.link.onExit(null);
    expect(storage.getItem(PLAID_OAUTH_STORAGE_KEY)).toBeNull(); expect(h.request).not.toHaveBeenCalled();
    expect(content(render(component))).toContain('Bank sign-in was not completed');
  });
  it('rejects account switching before processing provider completion', async () => {
    const saved = session('owned-item'); savePlaidOAuthSession(storage, saved, origin);
    const component = () => PlaidLinkScreen({ user: { id: 'owner' }, updateItemId: 'owned-item', oauthResume: { session: saved, receivedRedirectUri: href }, onSuccess() {}, onBack() {} });
    render(component); render(component); h.currentUser.uid = 'other-owner'; await h.link.onSuccess(null);
    expect(h.request).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
    expect(content(render(component))).toContain('same WriteOff account');
  });
  it('persists a normal connection only after consent and before opening Link', async () => {
    window.location.href = `${origin}/protected?screen=plaid-link`; window.location.search = '?screen=plaid-link';
    const component = () => PlaidLinkScreen({ user: { id: 'owner' }, onSuccess() {}, onBack() {}, fromSettings: true });
    render(component); await flush(); let tree = render(component);
    expect(storage.getItem(PLAID_OAUTH_STORAGE_KEY)).toBeNull();
    const checkbox = walk(tree).find(node => node.props?.type === 'checkbox');
    checkbox.props.onChange({ target: { checked: true } }); tree = render(component);
    const connect = walk(tree).find(node => node.props?.onClick && content(node).includes('Connect') && !content(node).includes('Skip'));
    await connect.props.onClick();
    expect(h.open).toHaveBeenCalledOnce();
    expect(JSON.parse(storage.getItem(PLAID_OAUTH_STORAGE_KEY)!)).toMatchObject({ uid: 'owner', token: 'link-sandbox-new', fromSettings: true });
  });
  it('does not expose a previous account Link token while the next account token request is pending', async () => {
    window.location.href = `${origin}/protected?screen=plaid-link`; window.location.search = '?screen=plaid-link';
    let uid = 'owner';
    const component = () => PlaidLinkScreen({ user: { id: uid }, onSuccess() {}, onBack() {} });
    render(component); await flush(); render(component);
    expect(h.link.token).toBe('link-sandbox-new');
    uid = 'other-owner'; h.currentUser.uid = uid; h.fetch.mockImplementation(() => new Promise(() => {}));
    render(component); expect(h.link.token).toBeNull();
  });
});
describe('OAuth callback page recovery', () => {
  it('routes a signed-out user back through sign-in with the original state URL', () => {
    h.authUser = null; render(PlaidOAuthPage); const tree = render(PlaidOAuthPage);
    const link = walk(tree).find(node => node.props?.href?.startsWith('/auth/login?'));
    expect(link.props.href).toBe('/auth/login?redirect=%2Fplaid%2Foauth%3Foauth_state_id%3Dsynthetic-state');
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('shows safe restart when the original browser session is missing instead of connecting another bank', () => {
    render(PlaidOAuthPage); const tree = render(PlaidOAuthPage);
    expect(content(tree)).toContain('Restart your bank connection'); expect(h.fetch).not.toHaveBeenCalled();
  });
  it('passes the stored update Item to Link and returns to the bank list', () => {
    const saved = session('owned-item'); savePlaidOAuthSession(storage, saved, origin);
    render(PlaidOAuthPage); const tree = render(PlaidOAuthPage);
    expect(tree.type).toBe(PlaidLinkScreen); expect(tree.props).toMatchObject({ updateItemId: 'owned-item', oauthResume: { session: saved, receivedRedirectUri: href } });
    tree.props.onSuccess(); expect(h.replace).toHaveBeenCalledWith('/protected?screen=banks-detail');
  });
});
