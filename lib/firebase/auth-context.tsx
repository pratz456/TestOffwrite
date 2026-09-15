"use client";

import { createContext, useContext, useEffect, useState } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { auth } from './client';
import { signOutUser, type AuthUser } from './auth';
import { ensureBrowserSession, clearPendingBrowserSession } from './browser-session';
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
  const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
    const current = ++generation;
    if (!firebaseUser) {
      readyUser = null;
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
      clearPendingBrowserSession();
      publish({ user, loading: false, error: null });
      return;
    }
    const refreshingSameAccount = readyUser?.id === firebaseUser.uid;
    if (!refreshingSameAccount) readyUser = null;
    publish({ user: refreshingSameAccount ? readyUser : null, loading: !refreshingSameAccount, error: null });
    try {
      await ensureBrowserSession(firebaseUser);
      if (!disposed && current === generation) {
        readyUser = { ...user, sessionReady: true };
        publish({ user: readyUser, loading: false, error: null });
      }
    } catch (error) {
      if (!disposed && current === generation) {
        readyUser = null;
        publish({ user: null, loading: false, error: createAuthError(error).message });
      }
    }
  }, () => {
    ++generation;
    readyUser = null;
    if (!disposed) publish({ user: null, loading: false, error: 'We could not verify your session. Please sign in again.' });
  });
  return () => { disposed = true; ++generation; unsubscribe(); };
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
