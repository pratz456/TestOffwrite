import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  updatePassword,
  onAuthStateChanged,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  browserPopupRedirectResolver,
  signInWithRedirect,
  getRedirectResult,
} from "firebase/auth";
import { auth } from "./client";
import { establishVerifiedSession } from "@/lib/onboarding/verification";
import { app } from "./client";
import { ensureBrowserSession, clearPendingBrowserSession } from "./browser-session";
import { createAuthError, logAuthError } from "./auth-errors";

export interface AuthUser {
  id: string;
  email: string | null;
  emailVerified?: boolean;
  sessionReady?: boolean;
  user_metadata?: {
    name?: string;
  };
}

export async function signInUser(email: string, password: string): Promise<{ data: { user: AuthUser } | null; error: any }> {
  try {
    // Reuse initializeAuth's supported persistence, as Google sign-in does.
    // Forcing localStorage can reject an otherwise supported browser session.
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Check if email is verified
    if (!user.emailVerified) {
      return {
        data: null,
        error: {
          message: "Please verify your email before signing in. Check your inbox for a verification link.",
          code: "email-not-verified"
        }
      };
    }
    await ensureBrowserSession(user);
    return {
      data: {
        user: {
          id: user.uid,
          email: user.email,
          user_metadata: {
            name: user.displayName || undefined
          }
        }
      },
      error: null
    };
  } catch (error: any) {
    logAuthError('signInUser', error);
    const authError = createAuthError(error);
    return { data: null, error: authError };
  }
}

export async function signUpUser(email: string, password: string): Promise<{ data: { user: AuthUser } | null; error: any }> {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Send email verification
    await sendEmailVerification(user);

    return {
      data: {
        user: {
          id: user.uid,
          email: user.email,
          user_metadata: {
            name: user.displayName || undefined
          }
        }
      },
      error: null
    };
  } catch (error: any) {
    logAuthError('signUpUser', error);
    const authError = createAuthError(error);
    return { data: null, error: authError };
  }
}

export async function signInWithGoogle(): Promise<{ data: { user: AuthUser } | null; error: any }> {
  try {
    // initializeAuth selects the first supported persistence (IndexedDB, local,
    // then session). Do not override that choice with possibly blocked localStorage.

    const provider = new GoogleAuthProvider();

    // Try popup first, fall back to redirect if blocked
    let userCredential;
    try {
      userCredential = await signInWithPopup(auth, provider, browserPopupRedirectResolver);
    } catch (popupErr: any) {
      // User triggered a second popup before the first finished; ignore and don't surface as error
      if (popupErr?.code === 'auth/cancelled-popup-request') {
        return { data: null, error: null };
      }
      // Check if popup was blocked
      if (popupErr?.code === 'auth/popup-blocked') {
        // Fall back to redirect flow
        console.log('Popup blocked, falling back to redirect flow');
        await signInWithRedirect(auth, provider, browserPopupRedirectResolver);
        // Return null to indicate redirect was initiated (will be handled by handleAuthRedirectResult)
        return { data: null, error: null };
      }
      // For other popup errors, return the error
      return { data: null, error: createAuthError(popupErr) };
    }

    const user = userCredential.user;

    if (!user.emailVerified) throw Object.assign(new Error('Verify your email first.'), { code: 'auth/email-not-verified' });
    await ensureBrowserSession(user);

    return {
      data: {
        user: {
          id: user.uid,
          email: user.email,
          user_metadata: {
            name: user.displayName || undefined
          }
        }
      },
      error: null
    };
  } catch (error: any) {
    logAuthError('signInWithGoogle', error);
    const authError = createAuthError(error);
    return { data: null, error: authError };
  }
}

// Call this once on page load (e.g., in _app.tsx useEffect, or root layout/client entry)
export async function handleAuthRedirectResult(): Promise<{ data: { user: AuthUser } | null; error: any }> {
  try {
    // Firebase checks its pending-redirect marker before loading the helper.
    const result = await getRedirectResult(auth, browserPopupRedirectResolver);
    if (!result) return { data: null, error: null }; // No redirect to process

    const user = result.user;

    await ensureBrowserSession(user);

    return {
      data: {
        user: {
          id: user.uid,
          email: user.email,
          user_metadata: { name: user.displayName || undefined }
        }
      },
      error: null
    };
  } catch (error: any) {
    logAuthError('handleAuthRedirectResult', error);
    const authError = createAuthError(error);
    return { data: null, error: authError };
  }
}


export async function signOutUser(): Promise<{ error: any }> {
    try {
      clearPendingBrowserSession();
      // Tell the server to clear the session cookie
      try {
        const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        if (!response.ok) throw Object.assign(new Error('Unable to complete sign out.'), { code: 'auth/logout-unavailable' });
        console.log('signOutUser: requested server to clear session cookie');
      } catch {
        await signOut(auth);
        throw Object.assign(new Error('Unable to complete sign out.'), { code: 'auth/logout-unavailable' });
      }

      await signOut(auth);

      // Clear client-side fallback cookie as well
      if (typeof document !== 'undefined') {
        try {
          const isProduction = process.env.NODE_ENV === 'production';
          document.cookie = `firebase-auth-token=; path=/; max-age=0; ${isProduction ? 'secure; samesite=none' : 'samesite=lax'}`;
          console.log('signOutUser: cleared firebase-auth-token cookie');
        } catch (err) {
          console.error('signOutUser: failed to clear cookie', err);
        }
      }

      return { error: null };
    } catch (error: any) {
      logAuthError('signOutUser', error);
      const authError = createAuthError(error);
      return { error: authError };
    }
}

export async function resetPassword(email: string): Promise<{ error: any }> {
  try {
    await sendPasswordResetEmail(auth, email);
    return { error: null };
  } catch (error: any) {
    logAuthError('resetPassword', error);
    const authError = createAuthError(error);
    return { error: authError };
  }
}

export async function updateUserPassword(newPassword: string): Promise<{ error: any }> {
  try {
    if (!auth.currentUser) {
      throw new Error('No authenticated user');
    }
    await updatePassword(auth.currentUser, newPassword);
    return { error: null };
  } catch (error: any) {
    logAuthError('updateUserPassword', error);
    const authError = createAuthError(error);
    return { error: authError };
  }
}

export async function resendEmailVerification(): Promise<{ error: any }> {
  try {
    if (!auth.currentUser) {
      throw new Error('No authenticated user');
    }
    await sendEmailVerification(auth.currentUser);
    return { error: null };
  } catch (error: any) {
    logAuthError('resendEmailVerification', error);
    const authError = createAuthError(error);
    return { error: authError };
  }
}

export function getCurrentUser(): Promise<{ data: { user: AuthUser | null }; error: any }> {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      if (user) {
        resolve({
          data: {
            user: {
              id: user.uid,
              email: user.email,
              user_metadata: {
                name: user.displayName || undefined
              }
            }
          },
          error: null
        });
      } else {
        resolve({ data: { user: null }, error: null });
      }
    });
  });
}

export function getSession(): Promise<{ data: { session: any }; error: any }> {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      if (user) {
        resolve({
          data: {
            session: {
              user: {
                id: user.uid,
                email: user.email,
                user_metadata: {
                  name: user.displayName || undefined
                }
              }
            }
          },
          error: null
        });
      } else {
        resolve({ data: { session: null }, error: null });
      }
    });
  });
}

// Wait for authentication to be ready before making Firestore calls
export function waitForAuth(): Promise<string> {
  const auth = getAuth(app);
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        unsub();
        resolve(u.uid);
      }
    }, reject);
  });
}

export async function checkAndSignInIfVerified(): Promise<{ verified: boolean; error: any }> {
  try {
    return { verified: await establishVerifiedSession(auth.currentUser), error: null };
  } catch (error: unknown) {
    return { verified: false, error: { message: error instanceof Error ? error.message : 'Could not check verification. Try again.' } };
  }
}
