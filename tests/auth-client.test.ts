import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserSessionManager, clearPendingBrowserSession } from '../lib/firebase/browser-session';
import { signInUser, signInWithGoogle, handleAuthRedirectResult } from '../lib/firebase/auth';
import { subscribeToBrowserAuth } from '../lib/firebase/auth-context';

const sdk = vi.hoisted(() => ({
  email: vi.fn(), popup: vi.fn(), redirect: vi.fn(), result: vi.fn(), persistence: vi.fn(),
  observer: vi.fn(), unsubscribe: vi.fn(),
}));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: sdk.email, createUserWithEmailAndPassword: vi.fn(), signOut: vi.fn(),
  sendPasswordResetEmail: vi.fn(), sendEmailVerification: vi.fn(), updatePassword: vi.fn(),
  onAuthStateChanged: vi.fn(), onIdTokenChanged: sdk.observer, getAuth: vi.fn(),
  GoogleAuthProvider: class {}, signInWithPopup: sdk.popup, setPersistence: sdk.persistence,
  browserLocalPersistence: {}, signInWithRedirect: sdk.redirect, getRedirectResult: sdk.result,
  browserPopupRedirectResolver: {},
}));
vi.mock('@/lib/firebase/client', () => ({ auth: {}, app: {} }));

const user = (uid = 'user-a', emailVerified = true) => ({
  uid, email: `${uid}@example.test`, displayName: 'Example', emailVerified,
  getIdToken: vi.fn().mockResolvedValue(`synthetic-token-${uid}`),
});
let onToken: (value: ReturnType<typeof user> | null) => Promise<void>;
const request = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  clearPendingBrowserSession();
  request.mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', request);
  sdk.persistence.mockResolvedValue(undefined); sdk.redirect.mockResolvedValue(undefined); sdk.result.mockResolvedValue(null);
  sdk.observer.mockImplementation((_auth, callback) => { onToken = callback; return sdk.unsubscribe; });
});
afterEach(() => { clearPendingBrowserSession(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('sign-in session handoff', () => {
  it('returns success only after email sign-in creates a server session', async () => {
    sdk.email.mockResolvedValue({ user: user() });
    expect((await signInUser('a@example.test', 'synthetic-password')).data?.user.id).toBe('user-a');
    expect(request).toHaveBeenCalledWith('/api/auth/session', expect.objectContaining({ credentials: 'include', method: 'POST' }));
  });
  it('does not swallow failed session creation or expose the server diagnostic', async () => {
    sdk.email.mockResolvedValue({ user: user() });
    request.mockResolvedValue(new Response('private diagnostic', { status: 503 }));
    const result = await signInUser('a@example.test', 'synthetic-password');
    expect(result.data).toBeNull(); expect(result.error.code).toBe('auth/session-unavailable');
    expect(result.error.message).toContain('secure session'); expect(JSON.stringify(result)).not.toContain('private diagnostic');
  });
  it('keeps an unverified sign-in out of the protected session', async () => {
    sdk.email.mockResolvedValue({ user: user('unverified', false) });
    const result = await signInUser('a@example.test', 'synthetic-password');
    expect(result.data).toBeNull(); expect(result.error.code).toBe('email-not-verified'); expect(request).not.toHaveBeenCalled();
  });
  it('honors closing the Google popup instead of starting another sign-in flow', async () => {
    sdk.popup.mockRejectedValue({ code: 'auth/popup-closed-by-user', message: 'raw SDK message' });
    const result = await signInWithGoogle();
    expect(result.error.message).toContain('cancelled'); expect(sdk.redirect).not.toHaveBeenCalled();
  });
  it('falls back to Google redirect only when the popup is blocked', async () => {
    sdk.popup.mockRejectedValue({ code: 'auth/popup-blocked' });
    expect(await signInWithGoogle()).toEqual({ data: null, error: null }); expect(sdk.redirect).toHaveBeenCalledOnce();
  });
  it('maps Google internal errors to a useful message instead of leaking the SDK message', async () => {
    sdk.popup.mockRejectedValue({ code: 'auth/internal-error', message: 'raw private SDK message' });
    const result = await signInWithGoogle();
    expect(result.error.message).toContain('email and password'); expect(result.error.message).not.toContain('raw private');
  });
  it('allows email sign-in after the Google helper fails', async () => {
    sdk.popup.mockRejectedValue({ code: 'auth/internal-error' });
    expect((await signInWithGoogle()).error.code).toBe('auth/internal-error');
    sdk.email.mockResolvedValue({ user: user() });
    const result = await signInUser('a@example.test', 'synthetic-password');
    expect(result.error).toBeNull();
    expect(result.data?.user.id).toBe('user-a');
    expect(request).toHaveBeenCalledOnce();
  });
  it.each(['popup', 'redirect'])('propagates %s session errors', async flow => {
    sdk.popup.mockResolvedValue({ user: user() }); sdk.result.mockResolvedValue({ user: user() });
    request.mockResolvedValue(new Response(null, { status: 401 }));
    const result = await (flow === 'popup' ? signInWithGoogle() : handleAuthRedirectResult());
    expect(result.data).toBeNull(); expect(result.error.code).toBe('auth/session-unavailable');
  });
});

describe('session concurrency and expiration', () => {
  it('coalesces the sign-in handler and auth observer into one request', async () => {
    const manager = createBrowserSessionManager(request); const active = user();
    await Promise.all([manager.establish(active), manager.establish(active)]);
    expect(request).toHaveBeenCalledOnce(); expect(active.getIdToken).toHaveBeenCalledOnce();
  });
  it('aborts an old account before its token can create a session', async () => {
    const manager = createBrowserSessionManager(request); const a = user('a');
    let resolveToken!: (token: string) => void;
    a.getIdToken.mockReturnValue(new Promise(resolve => { resolveToken = resolve; }));
    const old = expect(manager.establish(a)).rejects.toMatchObject({ code: 'auth/session-unavailable' });
    await manager.establish(user('b')); resolveToken('old-synthetic-token'); await old;
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][1].body).toContain('synthetic-token-b');
  });
  it('can retry after the session API recovers', async () => {
    const manager = createBrowserSessionManager(request);
    request.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(manager.establish(user())).rejects.toThrow();
    await expect(manager.establish(user())).resolves.toBeUndefined();
  });
  it('times out even when token retrieval never completes', async () => {
    vi.useFakeTimers(); const manager = createBrowserSessionManager(request); const a = user();
    a.getIdToken.mockReturnValue(new Promise(() => {}));
    const pending = expect(manager.establish(a)).rejects.toMatchObject({ code: 'auth/session-unavailable' });
    await vi.advanceTimersByTimeAsync(20_000); await pending; expect(request).not.toHaveBeenCalled();
  });
});

describe('auth observer state', () => {
  it('retains unverified identity for verification without setting a session or cookie', async () => {
    const publish = vi.fn(); const stop = subscribeToBrowserAuth(publish);
    await onToken(user('unverified', false));
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ user: expect.objectContaining({ emailVerified: false, sessionReady: false }), loading: false }));
    expect(request).not.toHaveBeenCalled(); stop();
  });
  it('publishes a verified user only after the server session succeeds', async () => {
    const publish = vi.fn(); const stop = subscribeToBrowserAuth(publish);
    await onToken(user());
    expect(publish.mock.calls[0][0]).toEqual({ user: null, loading: true, error: null });
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ user: expect.objectContaining({ sessionReady: true }), loading: false })); stop();
  });
  it('does not restore an older user when sign-out overtakes a token request', async () => {
    const publish = vi.fn(); const stop = subscribeToBrowserAuth(publish); const a = user();
    let finish!: (token: string) => void;
    a.getIdToken.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = onToken(a); await onToken(null); finish('synthetic-token'); await pending;
    expect(publish).toHaveBeenLastCalledWith({ user: null, loading: false, error: null });
    expect(publish.mock.calls.some(([state]) => state.user?.id === a.uid)).toBe(false); stop();
  });
  it('keeps the current verified account mounted during a successful background token refresh', async () => {
    const publish = vi.fn(); const stop = subscribeToBrowserAuth(publish);
    await onToken(user());
    publish.mockClear();
    let finish!: (response: Response) => void;
    request.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const refreshing = onToken(user());
    await Promise.resolve();
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: 'user-a', sessionReady: true }), loading: false }));
    finish(new Response(null, { status: 200 })); await refreshing;
    expect(publish.mock.calls.every(([state]) => state.user?.id === 'user-a' && state.loading === false)).toBe(true);
    stop();
  });
  it('presents session failures without publishing an authenticated user', async () => {
    const publish = vi.fn(); const stop = subscribeToBrowserAuth(publish);
    request.mockResolvedValue(new Response(null, { status: 503 })); await onToken(user());
    expect(publish).toHaveBeenLastCalledWith({ user: null, loading: false, error: expect.stringContaining('secure session') }); stop();
  });
  it('unsubscribes without publishing a late successful response after unmount', async () => {
    const publish = vi.fn(); const stop = subscribeToBrowserAuth(publish); const a = user();
    let finish!: (token: string) => void;
    a.getIdToken.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = onToken(a); stop(); finish('synthetic-token'); await pending;
    expect(sdk.unsubscribe).toHaveBeenCalledOnce(); expect(publish).toHaveBeenCalledTimes(1);
  });
});
