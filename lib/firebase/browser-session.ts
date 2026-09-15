import type { User } from 'firebase/auth';

type SessionUser = Pick<User, 'uid' | 'emailVerified' | 'getIdToken'>;
function sessionError() {
  return Object.assign(new Error('Unable to start your session. Please try signing in again.'), { code: 'auth/session-unavailable' });
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
      const timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const idToken = await new Promise<string>((resolve, reject) => {
          const abort = () => reject(sessionError());
          controller.signal.addEventListener('abort', abort, { once: true });
          user.getIdToken().then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
        });
        if (controller.signal.aborted || active !== current) throw sessionError();
        const response = await request('/api/auth/session', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ idToken }), signal: controller.signal,
        });
        if (!response.ok || controller.signal.aborted || active !== current) throw sessionError();
      } catch { throw sessionError(); }
      finally { clearTimeout(timeout); if (active === current) active = null; }
    })();
    return current.promise;
  };
  return { establish, clear };
}

const browserSession = createBrowserSessionManager();
export const ensureBrowserSession = browserSession.establish;
export const clearPendingBrowserSession = browserSession.clear;
