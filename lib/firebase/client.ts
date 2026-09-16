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

const firebaseConfig = localEmulatorConfig ? LOCAL_FIREBASE_OPTIONS : {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY            || "AIzaSyCVvpY-M571W0I3Faz-i8mAyofLobqm5ZE",
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN        || "writeoff-23910.firebaseapp.com",
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID         || "writeoff-23910",
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET     || "writeoff-23910.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "930596534802",
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID             || "1:930596534802:web:e4c7c12ead77a9d92336cb",
  measurementId:     process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID     || "G-LE26KP7E9N",
};

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
