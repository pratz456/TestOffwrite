import { getApps, initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, signInWithEmailAndPassword, signOut, type Auth, type User } from 'firebase/auth';
// The React Native persistence entry point is exported by the Firebase JS SDK.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- resolved by Metro through firebase/auth's react-native export map.
import { getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config';

/**
 * Public Firebase web configuration. These identify the project; they are not secrets.
 * Populate from the same project the API base URL points at (staging or production).
 */
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};

export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

let cachedAuth: Auth | null = null;

export function mobileAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  const app = getApps()[0] ?? initializeApp(firebaseConfig);
  try {
    cachedAuth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch {
    cachedAuth = getAuth(app);
  }
  return cachedAuth;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const credential = await signInWithEmailAndPassword(mobileAuth(), email.trim(), password);
  if (!credential.user.emailVerified) {
    await signOut(mobileAuth());
    throw new Error('Verify your email address on the web before signing in on mobile.');
  }
  return credential.user;
}

export async function signOutMobile(): Promise<void> {
  const auth = mobileAuth();
  const user = auth.currentUser;
  let revocationError: Error | null = null;
  if (user) {
    try {
      const token = await user.getIdToken();
      const response = await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) revocationError = new Error('Server sign-out could not be confirmed. Please retry.');
    } catch {
      revocationError = new Error('Server sign-out could not be confirmed. Please retry.');
    }
  }
  await signOut(auth);
  if (revocationError) throw revocationError;
}

export async function currentIdToken(): Promise<string> {
  const user = mobileAuth().currentUser;
  if (!user) throw new Error('Sign in to continue.');
  return user.getIdToken();
}
