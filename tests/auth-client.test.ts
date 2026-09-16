import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserSessionManager, clearPendingBrowserSession, isRetryableBrowserSessionError } from '../lib/firebase/browser-session';
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
let onObserverError: () => void;
const request = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  clearPendingBrowserSession();
  request.mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', request);
  sdk.persistence.mockResolvedValue(undefined); sdk.redirect.mockResolvedValue(undefined); sdk.result.mockResolvedValue(null);
  sdk.observer.mockImplementation((_auth, callback, error) => { onToken = callback; onObserverError = error; return sdk.unsubscribe; });
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
  it('preserves initialized storage fallback for Google sign-in instead of requiring localStorage', async () => {
    sdk.persistence.mockRejectedValue({ code: 'auth/web-storage-unsupported' });
    sdk.popup.mockResolvedValue({ user: user('google-user') });
    const result = await signInWithGoogle();
    expect(sdk.persistence).not.toHaveBeenCalled();
    expect(sdk.popup).toHaveBeenCalledOnce();
    expect(result.error).toBeNull();
    expect(result.data?.user.id).toBe('google-user');
    expect(request).toHaveBeenCalledWith('/api/auth/session', expect.objectContaining({ method: 'POST', credentials: 'include' }));
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
    request.mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(manager.establish(user())).rejects.toThrow();
    await expect(manager.establish(user())).resolves.toBeUndefined();
  });
  it('times out even when token retrieval never completes', async () => {
    vi.useFakeTimers(); const manager = createBrowserSessionManager(request); const a = user();
    a.getIdToken.mockReturnValue(new Promise(() => {}));
    const pending = expect(manager.establish(a)).rejects.toMatchObject({ code: 'auth/session-unavailable' });
    await vi.advanceTimersByTimeAsync(40_500); await pending; expect(request).not.toHaveBeenCalled();
    expect(a.getIdToken).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 400])('never retries explicit session denial HTTP %s', async status => {
    const manager = createBrowserSessionManager(request);
    request.mockResolvedValue(new Response('private server diagnostic', { status }));
    await expect(manager.establish(user())).rejects.toMatchObject({ code: 'auth/session-unavailable', retryable: false });
    expect(request).toHaveBeenCalledOnce();
  });
  it.each(['auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-disabled'])('never retries rejected SDK credentials %s', async code => {
    const manager = createBrowserSessionManager(request); const active = user();
    active.getIdToken.mockRejectedValue({ code, message: 'private SDK diagnostic' });
    await expect(manager.establish(active)).rejects.toMatchObject({ code: 'auth/session-unavailable', retryable: false });
    expect(active.getIdToken).toHaveBeenCalledOnce(); expect(request).not.toHaveBeenCalled();
  });
  it.each(['network', 'server', 'token'])('recovers initial session creation after one transient %s failure', async source => {
    vi.useFakeTimers(); const manager = createBrowserSessionManager(request); const active = user();
    if (source === 'network') request.mockRejectedValueOnce(new TypeError('private network detail'));
    if (source === 'server') request.mockResolvedValueOnce(new Response(null, { status: 503 }));
    if (source === 'token') active.getIdToken.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    const pending = manager.establish(active);
    await vi.advanceTimersByTimeAsync(500); await expect(pending).resolves.toBeUndefined();
    expect(active.getIdToken).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(source === 'token' ? 1 : 2);
  });
  it('bounds a stalled HTTP request even when its transport ignores AbortSignal', async () => {
    vi.useFakeTimers(); const manager = createBrowserSessionManager(request);
    request.mockImplementation(() => new Promise(() => {}));
    const pending = expect(manager.establish(user())).rejects.toMatchObject({ retryable: true });
    await vi.advanceTimersByTimeAsync(40_500); await pending;
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('cancels a pending retry when another account establishes its session', async () => {
    vi.useFakeTimers(); const manager = createBrowserSessionManager(request);
    request.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const first = expect(manager.establish(user('first'))).rejects.toMatchObject({ retryable: false });
    await vi.advanceTimersByTimeAsync(0);
    await manager.establish(user('second')); await first;
    await vi.advanceTimersByTimeAsync(500);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1].body).toContain('synthetic-token-second');
  });
  it('never treats an untyped or rejected authentication error as a transient renewal', () => {
    expect(isRetryableBrowserSessionError({ code: 'auth/session-unavailable' })).toBe(false);
    expect(isRetryableBrowserSessionError({ code: 'auth/user-token-expired', retryable: true })).toBe(false);
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
  it('preserves the ready same account through failed renewal and clears the warning after bounded recovery', async () => {
    vi.useFakeTimers(); const publish = vi.fn(); const stop = subscribeToBrowserAuth(publish);
    await onToken(user()); publish.mockClear();
    request.mockResolvedValue(new Response(null, { status: 503 }));
    const renewal = onToken(user()); await vi.advanceTimersByTimeAsync(500); await renewal;
    expect(publish.mock.calls.every(([state]) => state.user?.id === 'user-a' && state.loading === false)).toBe(true);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ error: expect.stringContaining('connection was interrupted') }));
    request.mockResolvedValue(new Response(null, { status: 200 }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: 'user-a', sessionReady: true }), loading: false, error: null }));
    expect(request).toHaveBeenCalledTimes(4); stop();
  });
  it('bounds automatic recovery then resumes a failed ready session when connectivity returns', async () => {
    vi.useFakeTimers(); const events = new EventTarget(); vi.stubGlobal('window', events);
    const publish = vi.fn(); const stop = subscribeToBrowserAuth(publish); await onToken(user());
    request.mockResolvedValue(new Response(null, { status: 503 }));
    const renewal = onToken(user()); await vi.advanceTimersByTimeAsync(500); await renewal;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(5); // Initial, two renewal attempts, two recovery attempts.
    request.mockResolvedValue(new Response(null, { status: 200 }));
    events.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(6);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ error: null, user: expect.objectContaining({ id: 'user-a' }) }));
    stop(); events.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(6);
  });
  it.each([401, 403])('discards the ready account on explicit HTTP %s renewal rejection', async status => {
    const publish = vi.fn(); const stop = subscribeToBrowserAuth(publish); await onToken(user());
    request.mockResolvedValue(new Response(null, { status })); await onToken(user());
    expect(publish).toHaveBeenLastCalledWith({ user: null, loading: false, error: expect.any(String) });
    expect(request).toHaveBeenCalledTimes(2); stop();
  });
  it('discards the ready account when the SDK reports revoked or expired credentials', async () => {
    const publish = vi.fn(); const stop = subscribeToBrowserAuth(publish); await onToken(user());
    const expired = user(); expired.getIdToken.mockRejectedValue({ code: 'auth/user-token-expired' });
    await onToken(expired);
    expect(publish).toHaveBeenLastCalledWith({ user: null, loading: false, error: expect.any(String) });
    expect(request).toHaveBeenCalledOnce(); stop();
  });
  it.each(['signout', 'unverified', 'switch', 'clear', 'observer-error', 'dispose'])('cancels scheduled recovery on %s', async action => {
    vi.useFakeTimers(); const events = new EventTarget(); vi.stubGlobal('window', events);
    const publish = vi.fn(); const stop = subscribeToBrowserAuth(publish); await onToken(user());
    request.mockResolvedValue(new Response(null, { status: 503 }));
    const renewal = onToken(user()); await vi.advanceTimersByTimeAsync(500); await renewal;
    request.mockResolvedValue(new Response(null, { status: 200 }));
    if (action === 'signout') await onToken(null);
    if (action === 'unverified') await onToken(user('user-a', false));
    if (action === 'switch') await onToken(user('second'));
    if (action === 'clear') clearPendingBrowserSession();
    if (action === 'observer-error') onObserverError();
    if (action === 'dispose') stop();
    const calls = request.mock.calls.length;
    events.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(calls);
    if (action === 'switch') expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: 'second' }) }));
    if (action !== 'dispose') stop();
  });
  it.each(['observer-error', 'dispose'])('cancels an in-flight retry on %s without late authenticated state', async action => {
    vi.useFakeTimers(); const publish = vi.fn(); const stop = subscribeToBrowserAuth(publish); await onToken(user());
    request.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const renewal = onToken(user()); await vi.advanceTimersByTimeAsync(0);
    if (action === 'observer-error') onObserverError(); else stop();
    const calls = publish.mock.calls.length; await vi.advanceTimersByTimeAsync(60_000); await renewal;
    expect(request).toHaveBeenCalledTimes(2); expect(publish).toHaveBeenCalledTimes(calls);
    if (action === 'observer-error') stop();
  });
});
