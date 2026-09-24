'use client';

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
} from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { resolveLocalEmulatorConfig, LOCAL_FIREBASE_OPTIONS, assertLocalEmulatorApp, connectLocalEmulatorOnce } from './local-emulator-config';

// Keep literal NEXT_PUBLIC reads so Next can inline these values in browser code.
export const localEmulatorConfig = resolveLocalEmulatorConfig({
  enabled: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS, nodeEnv: process.env.NODE_ENV,
  appEnv: process.env.NEXT_PUBLIC_APP_ENV, projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
}, typeof window === 'undefined' ? null : window.location.hostname);

// A staging build must never silently connect to production data.
if (process.env.NEXT_PUBLIC_APP_ENV === 'staging' && (
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== 'writeoff-production-testing' ||
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN !== 'writeoff-production-testing.firebaseapp.com' ||
  !process.env.NEXT_PUBLIC_FIREBASE_API_KEY || !process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET !== 'writeoff-production-testing.firebasestorage.app'
)) {
  throw new Error('Staging Firebase configuration is incomplete or points outside the testing project.');
}

const configuredFirebase = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};
const missingFirebaseClientConfig = !localEmulatorConfig && [
  configuredFirebase.apiKey,
  configuredFirebase.authDomain,
  configuredFirebase.projectId,
  configuredFirebase.storageBucket,
  configuredFirebase.messagingSenderId,
  configuredFirebase.appId,
].some(value => !value);
if (missingFirebaseClientConfig && process.env.NODE_ENV !== 'test') {
  throw new Error('Firebase client configuration is incomplete. Refusing to fall back to a production project.');
}
// Unit tests receive a non-routable, non-production project. Staging and production never do.
const unitTestFirebaseConfig = {
  apiKey: 'unit-test-not-live',
  authDomain: 'writeoff-unit-test.invalid',
  projectId: 'writeoff-unit-test',
  storageBucket: 'writeoff-unit-test.invalid',
  messagingSenderId: '0',
  appId: '1:0:web:unit-test',
};
const firebaseConfig = localEmulatorConfig
  ? LOCAL_FIREBASE_OPTIONS
  : missingFirebaseClientConfig ? unitTestFirebaseConfig : configuredFirebase;

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
assertLocalEmulatorApp(app.options, localEmulatorConfig);
export const firebaseApp = app;
// Load the Google popup/redirect helper only for an OAuth operation. Preloading
// it can delay all auth initialization when an embedded browser blocks it.
// Keep Firebase's default persistence order so existing sessions still restore.
export const auth = (() => {
  let instance;
  try {
    instance = initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
    });
  } catch (error) {
    // Fast Refresh or another entry point may already have initialized Auth.
    if ((error as { code?: string }).code === 'auth/already-initialized') instance = getAuth(app);
    else throw error;
  }
  // Firebase requires this synchronously after initializeAuth, before any operations.
  if (localEmulatorConfig) connectLocalEmulatorOnce(instance, 'auth', localEmulatorConfig, () => connectAuthEmulator(instance, localEmulatorConfig.authOrigin, { disableWarnings: true }));
  return instance;
})();
export const db = (() => {
  const instance = getFirestore(app);
  if (localEmulatorConfig) connectLocalEmulatorOnce(instance, 'firestore', localEmulatorConfig, () => connectFirestoreEmulator(instance, localEmulatorConfig.host, localEmulatorConfig.firestorePort));
  return instance;
})();
