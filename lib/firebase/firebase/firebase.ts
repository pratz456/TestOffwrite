'use client';

/**
 * @deprecated This file is deprecated. Use '@/lib/firebase/client' instead.
 * This file is kept for backward compatibility but should not be used in new code.
 * It will be removed in a future version.
 */

import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

// Graceful environment variable handling with fallbacks
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyCVvpY-M571W0I3Faz-i8mAyofLobqm5ZE",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "writeoff-23910.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "writeoff-23910",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "writeoff-23910.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "930596534802",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:930596534802:web:e4c7c12ead77a9d92336cb",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-LE26KP7E9N",
};

// Prevent multiple initialization
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Optional - only initialize analytics in browser
let analytics: ReturnType<typeof getAnalytics> | null = null;
if (typeof window !== 'undefined') {
  try {
    analytics = getAnalytics(app);
  } catch (error) {
    // Analytics already initialized or not available
    console.warn('Firebase Analytics initialization skipped:', error);
  }
}

// Required
export const db = getFirestore(app);
