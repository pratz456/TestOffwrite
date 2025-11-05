'use client';

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

// Determine the correct auth domain based on environment
const getAuthDomain = () => {
  // In production, use the custom domain if set, otherwise fall back to Firebase default
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    // If we're on the custom domain, use it; otherwise use Firebase default
    if (hostname === 'writeoffapp.com' || hostname === 'www.writeoffapp.com') {
      return process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'writeoffapp.com';
    }
  }
  // Use environment variable or fall back to Firebase default domain
  return process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'writeoff-23910.firebaseapp.com';
};

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyCVvpY-M571W0I3Faz-i8mAyofLobqm5ZE",
  authDomain: getAuthDomain(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "writeoff-23910",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "writeoff-23910.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "930596534802",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:930596534802:web:e4c7c12ead77a9d92336cb",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-LE26KP7E9N", // optional
};

// Initialize Firebase (prevent multiple initialization)
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseApp = app; // backward compatibility

// Initialize Firebase Auth
export const auth = getAuth(app);

// Initialize Firestore
export const db = getFirestore(app);

// Connect to emulators in development (disabled for now)
// Uncomment these lines if you want to use Firebase emulators
// if (process.env.NODE_ENV === 'development' && process.env.USE_FIREBASE_EMULATOR === 'true') {
//   try {
//     if (!auth.config.emulator) {
//       connectAuthEmulator(auth, "http://localhost:9099");
//     }
//   } catch (error) {
//     console.log('Firebase Auth emulator already connected or not available');
//   }
//
//   try {
//     if (!(db as any)._delegate._databaseId.projectId.includes('demo-')) {
//       connectFirestoreEmulator(db, 'localhost', 8080);
//     }
//   } catch (error) {
//     console.log('Firestore emulator already connected or not available');
//   }
// }

// Client-side Firebase client
export function createClient() {
  return { auth, db };
}
