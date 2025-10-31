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
  setPersistence,
  browserLocalPersistence,
  signInWithRedirect,
  getRedirectResult,
} from "firebase/auth";
import { auth } from "./client";
import { app } from "./client";
import { createAuthError, logAuthError } from "./auth-errors";

export interface AuthUser {
  id: string;
  email: string | null;
  user_metadata?: {
    name?: string;
  };
}

export async function signInUser(email: string, password: string): Promise<{ data: { user: AuthUser } | null; error: any }> {
  try {
    // Set persistence to local so session persists across tabs and reloads
    await setPersistence(auth, browserLocalPersistence);

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
    // Set a cookie with the user's ID token so server-side middleware can detect the session
    try {
      const token = await user.getIdToken();
      // Debug: show token presence (trimmed) to help verify sign-in ran
      if (typeof window !== 'undefined') {
        try {
          console.log('signInUser: got id token (first 20 chars):', token?.slice?.(0, 20));
        } catch (_) {
          // ignore logging errors
        }
      }

      // Exchange the ID token for a server-set, httpOnly session cookie.
      // This is necessary because Next.js Middleware runs on the server/edge and
      // can only read cookies set by server responses (httpOnly). Client-side
      // document.cookie is not sufficient for the middleware.
      try {
        if (typeof window !== 'undefined') {
          const sessionResponse = await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ idToken: token }),
          });

          if (!sessionResponse.ok) {
            const errorText = await sessionResponse.text();
            console.error('signInUser: session cookie exchange failed:', errorText);
            throw new Error('Failed to create session. Please try again.');
          }

          console.log('signInUser: session cookie set successfully');
        }
      } catch (sessionErr) {
        console.error('signInUser: failed to exchange idToken for session cookie', sessionErr);
        throw sessionErr; // Propagate error to prevent redirect
      }
    } catch (cookieError) {
      console.error('Failed to get id token or set auth cookie after sign in:', cookieError);
    }
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
    // Set persistence to local so session persists across tabs and reloads
    await setPersistence(auth, browserLocalPersistence);

    const provider = new GoogleAuthProvider();

    // Always use popup (do not fall back to redirect)
    let userCredential;
    try {
      userCredential = await signInWithPopup(auth, provider);
    } catch (popupErr) {
      // Popup blocked or cancelled
      return { data: null, error: popupErr };
    }

    const user = userCredential.user;

    // Set up session cookie (same as email/password flow)
    try {
      const token = await user.getIdToken();
      if (typeof window !== 'undefined') {
        try {
          console.log('signInWithGoogle: got id token (first 20 chars):', token?.slice?.(0, 20));
        } catch (_) {
          // ignore logging errors
        }

        // Exchange the ID token for a server-set, httpOnly session cookie
        try {
          const sessionResponse = await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ idToken: token }),
          });

          if (!sessionResponse.ok) {
            const errorText = await sessionResponse.text();
            console.error('signInWithGoogle: session cookie exchange failed:', errorText);
            throw new Error('Failed to create session. Please try again.');
          }

          console.log('signInWithGoogle: session cookie set successfully');
        } catch (sessionErr) {
          console.error('signInWithGoogle: failed to exchange idToken for session cookie', sessionErr);
          throw sessionErr; // Propagate error to prevent redirect
        }
      }
    } catch (cookieError) {
      console.error('Failed to get id token or set auth cookie after Google sign in:', cookieError);
    }

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
    const result = await getRedirectResult(auth);
    if (!result) return { data: null, error: null }; // No redirect to process

    const user = result.user;

    // Same session-cookie exchange as above
    try {
      const token = await user.getIdToken();
      if (typeof window !== 'undefined') {
        const sessionResponse = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ idToken: token }),
        });
        if (!sessionResponse.ok) {
          const errorText = await sessionResponse.text();
          console.error('handleAuthRedirectResult: session cookie exchange failed:', errorText);
          throw new Error('Failed to create session. Please try again.');
        }
      }
    } catch (sessionErr) {
      console.error('handleAuthRedirectResult: failed to exchange idToken for session cookie', sessionErr);
      throw sessionErr;
    }

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
      // Tell the server to clear the session cookie
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        console.log('signOutUser: requested server to clear session cookie');
      } catch (e) {
        console.warn('signOutUser: failed to call logout API', e);
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
    if (!auth.currentUser) {
      return { verified: false, error: { message: "No authenticated user" } };
    }

    // Reload user data to get latest verification status
    await auth.currentUser.reload();

    if (auth.currentUser.emailVerified) {
      // User is verified, set up session cookie like in signInUser
      try {
        const token = await auth.currentUser.getIdToken();

        if (typeof window !== 'undefined') {
          // Set up session cookie via API
          await fetch('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ idToken: token }),
          });
          console.log('checkAndSignInIfVerified: set up session cookie');
        }

        return { verified: true, error: null };
      } catch (sessionError) {
        console.error('checkAndSignInIfVerified: failed to set up session cookie', sessionError);
        return { verified: true, error: sessionError }; // Still verified, just session setup failed
      }
    }

    return { verified: false, error: null };
  } catch (error: any) {
    logAuthError('checkAndSignInIfVerified', error);
    const authError = createAuthError(error);
    return { verified: false, error: authError };
  }
}
