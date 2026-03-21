'use client';

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY            || "AIzaSyCVvpY-M571W0I3Faz-i8mAyofLobqm5ZE",
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN        || "writeoff-23910.firebaseapp.com",
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID         || "writeoff-23910",
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET     || "writeoff-23910.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "930596534802",
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID             || "1:930596534802:web:e4c7c12ead77a9d92336cb",
  measurementId:     process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID     || "G-LE26KP7E9N",
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseApp = app;
export const auth = getAuth(app);
export const db = getFirestore(app);
