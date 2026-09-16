import type { User } from 'firebase/auth';

type SessionUser = Pick<User, 'uid' | 'emailVerified' | 'getIdToken'>;
function sessionError(retryable = false) {
  return Object.assign(new Error('Unable to start your session. Please try signing in again.'), { code: 'auth/session-unavailable', retryable });
}

export function isRetryableBrowserSessionError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'auth/session-unavailable'
    && 'retryable' in error && error.retryable === true);
}

function classifySessionError(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'auth/session-unavailable') return sessionError(isRetryableBrowserSessionError(error));
    return sessionError(['auth/network-request-failed', 'auth/internal-error', 'auth/too-many-requests'].includes(String(error.code)));
  }
  return sessionError(error instanceof TypeError);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal, cancelled: () => Error): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled());
    if (signal.aborted) { reject(cancelled()); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Coalesces auth observers and sign-in; an old account must never finish a new session exchange. */
export function createBrowserSessionManager(request: typeof fetch = (...args) => fetch(...args)) {
  let active: { uid: string; controller: AbortController; promise: Promise<void> } | null = null;
  const clear = () => { active?.controller.abort(); active = null; };
  const establish = (user: SessionUser): Promise<void> => {
    if (!user.emailVerified) return Promise.reject(Object.assign(new Error('Verify your email first.'), { code: 'auth/email-not-verified' }));
    if (active?.uid === user.uid) return active.promise;
    clear();
    const controller = new AbortController();
    const current = { uid: user.uid, controller, promise: Promise.resolve() };
    active = current;
    current.promise = (async () => {
      try {
        // A single bounded retry also helps initial sign-in after sleep/network
        // recovery. Rejected credentials and account switches never retry.
        for (let attempt = 0; attempt < 2; attempt++) {
          const attemptController = new AbortController();
          const cancelAttempt = () => attemptController.abort();
          controller.signal.addEventListener('abort', cancelAttempt, { once: true });
          const timeout = setTimeout(cancelAttempt, 20_000);
          const abortError = () => sessionError(!controller.signal.aborted && active === current);
          try {
            if (controller.signal.aborted || active !== current) throw sessionError();
            const idToken = await abortable(user.getIdToken(), attemptController.signal, abortError);
            if (controller.signal.aborted || active !== current) throw sessionError();
            const response = await abortable(request('/api/auth/session', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
              body: JSON.stringify({ idToken }), signal: attemptController.signal,
            }), attemptController.signal, abortError);
            if (controller.signal.aborted || active !== current) throw sessionError();
            if (!response.ok) throw sessionError(response.status >= 500 || [408, 429].includes(response.status));
            return;
          } catch (error) {
            const safeError = controller.signal.aborted || active !== current ? sessionError() : classifySessionError(error);
            if (attempt === 1 || !isRetryableBrowserSessionError(safeError)) throw safeError;
          } finally {
            clearTimeout(timeout);
            controller.signal.removeEventListener('abort', cancelAttempt);
          }
          // Yield briefly before the final attempt; clearing the manager cancels
          // this wait as well as any token/request already in flight.
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(sessionError()); };
            const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, 500);
            if (controller.signal.aborted) abort();
            else controller.signal.addEventListener('abort', abort, { once: true });
          });
        }
      } finally { if (active === current) active = null; }
    })();
    return current.promise;
  };
  return { establish, clear };
}

const browserSession = createBrowserSessionManager();
const clearListeners = new Set<() => void>();
export const ensureBrowserSession = browserSession.establish;
export function subscribeToBrowserSessionClears(listener: () => void) {
  clearListeners.add(listener);
  return () => { clearListeners.delete(listener); };
}
export function clearPendingBrowserSession() {
  browserSession.clear();
  for (const listener of clearListeners) listener();
}
