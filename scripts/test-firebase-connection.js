#!/usr/bin/env node

/**
 * Simple Firebase Connection Test
 * Tests Firebase connection using the built-in fallback configuration
 */

const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator } = require('firebase/firestore');
const { getAuth } = require('firebase/auth');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️ ${message}`, 'blue');
}

async function testFirebaseConnection() {
  log('🔥 Testing Firebase Connection (Client SDK)', 'cyan');
  log('==========================================', 'cyan');
  
  try {
    // Use the same configuration as the client.ts file
    const firebaseConfig = {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyCVvpY-M571W0I3Faz-i8mAyofLobqm5ZE",
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "writeoff-23910.firebaseapp.com",
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "writeoff-23910",
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "writeoff-23910.firebasestorage.app",
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "930596534802",
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:930596534802:web:e4c7c12ead77a9d92336cb",
      measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-LE26KP7E9N",
    };

    logInfo('Firebase Configuration:');
    logInfo(`Project ID: ${firebaseConfig.projectId}`);
    logInfo(`Auth Domain: ${firebaseConfig.authDomain}`);
    logInfo(`Using fallback values: ${!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ? 'YES' : 'NO'}`);

    // Initialize Firebase
    const app = initializeApp(firebaseConfig);
    logSuccess('Firebase app initialized');

    // Initialize Firestore
    const db = getFirestore(app);
    logSuccess('Firestore initialized');

    // Initialize Auth
    const auth = getAuth(app);
    logSuccess('Firebase Auth initialized');

    // Test Firestore connection by trying to read a document
    logInfo('Testing Firestore connection...');
    try {
      const { collection, getDocs, limit } = require('firebase/firestore');
      const testCollection = collection(db, 'user_profiles');
      const snapshot = await getDocs(testCollection, limit(1));
      logSuccess(`Firestore connection successful - found ${snapshot.size} user profiles`);
    } catch (firestoreError) {
      logError(`Firestore connection failed: ${firestoreError.message}`);
      logError(`Error code: ${firestoreError.code}`);
      
      // Check if it's a permission error
      if (firestoreError.code === 'permission-denied') {
        logInfo('This is expected - Firestore rules require authentication');
        logSuccess('Firestore is working (permission denied is normal for unauthenticated requests)');
      } else {
        throw firestoreError;
      }
    }

    log('\n🎉 Firebase Connection Test Complete!', 'green');
    log('=====================================', 'green');
    logSuccess('Firebase client SDK is working correctly');
    logSuccess('App should be able to connect to Firebase');
    logInfo('Next step: Test with authentication and real data');

    return true;

  } catch (error) {
    logError(`Firebase connection test failed: ${error.message}`);
    logError(`Stack trace: ${error.stack}`);
    return false;
  }
}

// Run the test
if (require.main === module) {
  testFirebaseConnection().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { testFirebaseConnection };

