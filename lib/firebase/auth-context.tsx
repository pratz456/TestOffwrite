"use client";

import { createContext, useContext, useEffect, useState } from 'react';
import { onIdTokenChanged, type User } from 'firebase/auth';
import { auth } from './client';
import { signOutUser, type AuthUser } from './auth';
import { ensureBrowserSession, clearPendingBrowserSession, isRetryableBrowserSessionError, subscribeToBrowserSessionClears } from './browser-session';
import { createAuthError } from './auth-errors';

type AuthState = { user: AuthUser | null; loading: boolean; error: string | null };
interface AuthContextType extends AuthState { signOut: () => Promise<void> }
const initialState: AuthState = { user: null, loading: true, error: null };
const AuthContext = createContext<AuthContextType>({ ...initialState, signOut: async () => {} });
export function useAuth() { return useContext(AuthContext); }

/** Ignore older token exchanges if sign-out, another account, or unmount overtakes them. */
export function subscribeToBrowserAuth(publish: (state: AuthState) => void) {
  let generation = 0;
  let disposed = false;
  let readyUser: AuthUser | null = null;
  let lastUser: User | null = null;
  let recoveryPending = false;
  let inFlight = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const clearRetry = () => { if (retryTimer !== undefined) clearTimeout(retryTimer); retryTimer = undefined; };
  // Explicit sign-out clears the manager before its asynchronous logout request.
  // Cancel observer recovery at that same moment, not only at the later SDK event.
  const stopClearListener = subscribeToBrowserSessionClears(() => {
    ++generation; clearRetry(); readyUser = null; lastUser = null;
    recoveryPending = false; inFlight = false;
  });
  const processUser = async (firebaseUser: User | null, scheduleRetry = true) => {
    const current = ++generation;
    clearRetry();
    lastUser = firebaseUser;
    inFlight = false;
    if (!firebaseUser) {
      readyUser = null;
      recoveryPending = false;
      clearPendingBrowserSession();
      publish({ user: null, loading: false, error: null });
      return;
    }
    const user: AuthUser = {
      id: firebaseUser.uid, email: firebaseUser.email, emailVerified: firebaseUser.emailVerified,
      sessionReady: false, user_metadata: { name: firebaseUser.displayName || undefined },
    };
    // Verification screens need this identity to resend/check email verification.
    if (!firebaseUser.emailVerified) {
      readyUser = null;
      recoveryPending = false;
      clearPendingBrowserSession();
      publish({ user, loading: false, error: null });
      return;
    }
    const refreshingSameAccount = readyUser?.id === firebaseUser.uid;
    if (!refreshingSameAccount) { readyUser = null; recoveryPending = false; }
    publish({ user: refreshingSameAccount ? readyUser : null, loading: !refreshingSameAccount, error: null });
    inFlight = true;
    try {
      await ensureBrowserSession(firebaseUser);
      if (!disposed && current === generation) {
        readyUser = { ...user, sessionReady: true };
        recoveryPending = false;
        publish({ user: readyUser, loading: false, error: null });
      }
    } catch (error) {
      if (!disposed && current === generation) {
        if (refreshingSameAccount && readyUser?.id === firebaseUser.uid && isRetryableBrowserSessionError(error)) {
          // An unavailable renewal does not invalidate the already established
          // account. Every protected API still verifies credentials server-side.
          recoveryPending = true;
          publish({ user: readyUser, loading: false, error: createAuthError({ code: 'auth/session-refresh-unavailable' }).message });
          if (scheduleRetry) retryTimer = setTimeout(() => {
            retryTimer = undefined;
            if (!disposed && current === generation) void processUser(firebaseUser, false);
          }, 5_000);
        } else {
          readyUser = null;
          recoveryPending = false;
          publish({ user: null, loading: false, error: createAuthError(error).message });
        }
      }
    } finally {
      if (current === generation) inFlight = false;
    }
  };
  const resume = () => {
    if (!disposed && recoveryPending && !inFlight && lastUser && readyUser?.id === lastUser.uid) void processUser(lastUser, false);
  };
  const visible = () => { if (document.visibilityState === 'visible') resume(); };
  if (typeof window !== 'undefined') window.addEventListener('online', resume);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visible);
  const unsubscribe = onIdTokenChanged(auth, firebaseUser => processUser(firebaseUser), () => {
    ++generation;
    clearPendingBrowserSession();
    clearRetry();
    readyUser = null;
    lastUser = null;
    recoveryPending = false;
    inFlight = false;
    if (!disposed) publish({ user: null, loading: false, error: 'We could not verify your session. Please sign in again.' });
  });
  return () => {
    disposed = true; ++generation; clearRetry(); unsubscribe(); clearPendingBrowserSession(); stopClearListener();
    if (typeof window !== 'undefined') window.removeEventListener('online', resume);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visible);
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);
  useEffect(() => subscribeToBrowserAuth(setState), []);
  const signOut = async () => {
    const { error } = await signOutUser();
    if (error) throw new Error(error.message);
  };
  return <AuthContext.Provider value={{ ...state, signOut }}>{children}</AuthContext.Provider>;
}
