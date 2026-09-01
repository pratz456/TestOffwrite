"use client";

import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './client';
import { AuthUser } from './auth';

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
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: User | null) => {
      console.log('[AuthContext] Auth state changed:', {
        hasUser: !!firebaseUser,
        userId: firebaseUser?.uid,
        email: firebaseUser?.email,
        emailVerified: firebaseUser?.emailVerified,
        environment: process.env.NODE_ENV
      });
      
      if (firebaseUser) {
        // Set auth cookie for middleware
        try {
          const token = await firebaseUser.getIdToken();
          const isProduction = process.env.NODE_ENV === 'production';
          document.cookie = `firebase-auth-token=${token}; path=/; max-age=3600; ${isProduction ? 'secure; samesite=none' : 'samesite=lax'}`;
          
          console.log('[AuthContext] User authenticated, setting user state');
          setUser({
            id: firebaseUser.uid,
            email: firebaseUser.email,
            user_metadata: {
              name: firebaseUser.displayName || undefined
            }
          });
        } catch (error) {
          console.error('[AuthContext] Error getting ID token:', error);
          setUser(null);
          // Clear auth cookie on error
          document.cookie = 'firebase-auth-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        }
      } else {
        console.log('[AuthContext] No user, clearing state');
        setUser(null);
        // Clear auth cookie when user signs out
        const isProduction = process.env.NODE_ENV === 'production';
        document.cookie = `firebase-auth-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; ${isProduction ? 'secure; samesite=none' : 'samesite=lax'}`;
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const signOut = async () => {
    try {
      await auth.signOut();
      // Clear auth cookie
      document.cookie = 'firebase-auth-token=; path=/; max-age=0';
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


