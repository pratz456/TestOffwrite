"use client";

import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut, User } from 'firebase/auth';
import { auth } from './client';
import { AuthUser } from './auth';
import { AUTH_SETTLE_TIMEOUT_MS } from '@/lib/welcome-view-state';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signOut: async () => {},
});

function toAuthUser(firebaseUser: User): AuthUser {
  return {
    id: firebaseUser.uid,
    email: firebaseUser.email,
    user_metadata: {
      name: firebaseUser.displayName || undefined
    }
  };
}

function writeAuthCookie(token: string) {
  const isProduction = process.env.NODE_ENV === 'production';
  document.cookie = `firebase-auth-token=${token}; path=/; max-age=3600; ${isProduction ? 'secure; samesite=none' : 'samesite=lax'}`;
}

function clearAuthCookie() {
  const isProduction = process.env.NODE_ENV === 'production';
  document.cookie = `firebase-auth-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; ${isProduction ? 'secure; samesite=none' : 'samesite=lax'}`;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let settled = false;

    const markSettled = () => {
      if (settled) return;
      settled = true;
      setLoading(false);
    };

    // Never leave the app on an indefinite spinner if Firebase auth hangs.
    const timeoutId = window.setTimeout(() => {
      console.warn('[AuthContext] Auth did not settle in time; continuing without a session');
      markSettled();
    }, AUTH_SETTLE_TIMEOUT_MS);

    let unsubscribe = () => {};
    try {
      unsubscribe = onAuthStateChanged(auth, (firebaseUser: User | null) => {
        console.log('[AuthContext] Auth state changed:', {
          hasUser: !!firebaseUser,
          userId: firebaseUser?.uid,
          email: firebaseUser?.email,
          emailVerified: firebaseUser?.emailVerified,
          environment: process.env.NODE_ENV
        });

        if (firebaseUser) {
          // Expose the user immediately. Token/cookie work must not block the UI.
          setUser(toAuthUser(firebaseUser));
          markSettled();
          firebaseUser.getIdToken()
            .then((token) => {
              writeAuthCookie(token);
            })
            .catch((error) => {
              console.error('[AuthContext] Error getting ID token:', error);
              clearAuthCookie();
            });
        } else {
          console.log('[AuthContext] No user, clearing state');
          setUser(null);
          clearAuthCookie();
          markSettled();
        }
      });
    } catch (error) {
      console.error('[AuthContext] Failed to subscribe to auth state:', error);
      setUser(null);
      markSettled();
    }

    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, []);

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
      clearAuthCookie();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
