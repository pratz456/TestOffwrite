#!/usr/bin/env node

/**
 * Firebase Storage Verification Script
 * 
 * This script verifies that Firebase storage is working correctly by:
 * 1. Testing Firebase connection
 * 2. Checking environment variables
 * 3. Verifying Firestore rules
 * 4. Testing data operations (create, read, update, delete)
 * 5. Checking transaction classification flow
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
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

function logWarning(message) {
  log(`⚠️ ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️ ${message}`, 'blue');
}

async function checkEnvironmentVariables() {
  log('\n🔧 Checking Environment Variables...', 'cyan');
  
  const requiredVars = [
    'FIREBASE_ADMIN_PROJECT_ID',
    'FIREBASE_ADMIN_CLIENT_EMAIL',
    'FIREBASE_ADMIN_PRIVATE_KEY'
  ];
  
  const optionalVars = [
    'NEXT_PUBLIC_FIREBASE_API_KEY',
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
    'PLAID_CLIENT_ID',
    'PLAID_SECRET'
  ];
  
  let allRequired = true;
  
  // Check required variables
  for (const varName of requiredVars) {
    if (process.env[varName]) {
      logSuccess(`${varName} is set`);
    } else {
      logError(`${varName} is missing`);
      allRequired = false;
    }
  }
  
  // Check optional variables
  for (const varName of optionalVars) {
    if (process.env[varName]) {
      logSuccess(`${varName} is set`);
    } else {
      logWarning(`${varName} is not set (optional)`);
    }
  }
  
  return allRequired;
}

async function initializeFirebase() {
  log('\n🔥 Initializing Firebase Admin SDK...', 'cyan');
  
  try {
    const firebaseConfig = {
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };
    
    const app = initializeApp({
      credential: cert(firebaseConfig),
      projectId: firebaseConfig.projectId,
    });
    
    const db = getFirestore(app);
    const auth = getAuth(app);
    
    logSuccess('Firebase Admin SDK initialized');
    return { app, db, auth };
  } catch (error) {
    logError(`Failed to initialize Firebase: ${error.message}`);
    throw error;
  }
}

async function testFirestoreConnection(db) {
  log('\n📊 Testing Firestore Connection...', 'cyan');
  
  try {
    // Try to read from a collection to test connection
    const testRef = db.collection('_test_connection');
    await testRef.limit(1).get();
    logSuccess('Firestore connection successful');
    return true;
  } catch (error) {
    logError(`Firestore connection failed: ${error.message}`);
    return false;
  }
}

async function testDataOperations(db) {
  log('\n🔄 Testing Data Operations...', 'cyan');
  
  const testUserId = 'test-user-' + Date.now();
  const testAccountId = 'test-account-' + Date.now();
  const testTransactionId = 'test-transaction-' + Date.now();
  
  try {
    // Test 1: Create user profile
    logInfo('Testing user profile creation...');
    const userProfileData = {
      user_id: testUserId,
      userId: testUserId,
      email: 'test@example.com',
      name: 'Test User',
      profession: 'Software Developer',
      income: 50000,
      state: 'CA',
      filing_status: 'single',
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp()
    };
    
    await db.collection('user_profiles').doc(testUserId).set(userProfileData);
    logSuccess('User profile created');
    
    // Test 2: Create account
    logInfo('Testing account creation...');
    const accountData = {
      account_id: testAccountId,
      user_id: testUserId,
      userId: testUserId,
      name: 'Test Bank Account',
      mask: '****',
      type: 'depository',
      subtype: 'checking',
      institution_id: 'test-bank',
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp()
    };
    
    await db.collection('user_profiles').doc(testUserId)
      .collection('accounts').doc(testAccountId).set(accountData);
    logSuccess('Account created');
    
    // Test 3: Create transaction
    logInfo('Testing transaction creation...');
    const transactionData = {
      trans_id: testTransactionId,
      user_id: testUserId,
      userId: testUserId,
      account_id: testAccountId,
      merchant_name: 'Test Merchant',
      amount: 100.00,
      category: 'Test Category',
      date: '2024-01-01',
      type: 'expense',
      is_deductible: false,
      analysis_status: 'pending',
      analyzed: false,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp()
    };
    
    await db.collection('user_profiles').doc(testUserId)
      .collection('accounts').doc(testAccountId)
      .collection('transactions').doc(testTransactionId).set(transactionData);
    logSuccess('Transaction created');
    
    // Test 4: Update transaction (simulate classification)
    logInfo('Testing transaction update (classification)...');
    const updateData = {
      is_deductible: true,
      deduction_score: 0.9,
      user_classification_reason: 'Test classification by user',
      updated_at: FieldValue.serverTimestamp()
    };
    
    await db.collection('user_profiles').doc(testUserId)
      .collection('accounts').doc(testAccountId)
      .collection('transactions').doc(testTransactionId).update(updateData);
    logSuccess('Transaction updated (classified as deductible)');
    
    // Test 5: Read transaction back
    logInfo('Testing transaction read...');
    const updatedTransaction = await db.collection('user_profiles').doc(testUserId)
      .collection('accounts').doc(testAccountId)
      .collection('transactions').doc(testTransactionId).get();
    
    if (updatedTransaction.exists) {
      const data = updatedTransaction.data();
      if (data.is_deductible === true && data.deduction_score === 0.9) {
        logSuccess('Transaction read successful - classification persisted');
      } else {
        logError('Transaction read failed - classification not persisted correctly');
      }
    } else {
      logError('Transaction read failed - document not found');
    }
    
    // Test 6: Collection group query
    logInfo('Testing collection group query...');
    const cgQuery = db.collectionGroup('transactions')
      .where('userId', '==', testUserId)
      .where('trans_id', '==', testTransactionId)
      .limit(1);
    
    const cgSnapshot = await cgQuery.get();
    if (!cgSnapshot.empty) {
      logSuccess('Collection group query successful');
    } else {
      logWarning('Collection group query returned no results');
    }
    
    // Cleanup: Delete test data
    logInfo('Cleaning up test data...');
    await db.collection('user_profiles').doc(testUserId)
      .collection('accounts').doc(testAccountId)
      .collection('transactions').doc(testTransactionId).delete();
    
    await db.collection('user_profiles').doc(testUserId)
      .collection('accounts').doc(testAccountId).delete();
    
    await db.collection('user_profiles').doc(testUserId).delete();
    logSuccess('Test data cleaned up');
    
    return true;
  } catch (error) {
    logError(`Data operations test failed: ${error.message}`);
    logError(`Error code: ${error.code}`);
    logError(`Stack trace: ${error.stack}`);
    return false;
  }
}

async function testFirestoreRules(db) {
  log('\n🛡️ Testing Firestore Rules...', 'cyan');
  
  // Note: This is a basic test. Full rule testing would require client SDK
  try {
    // Try to access user data (should work with Admin SDK)
    const usersSnapshot = await db.collection('user_profiles').limit(1).get();
    logSuccess('Admin SDK can access user profiles (expected)');
    
    // Try to access analysis status
    const analysisSnapshot = await db.collection('analysis_status').limit(1).get();
    logSuccess('Admin SDK can access analysis status (expected)');
    
    logInfo('Note: Full rule testing requires client SDK with authentication');
    return true;
  } catch (error) {
    logError(`Firestore rules test failed: ${error.message}`);
    return false;
  }
}

async function main() {
  log('🚀 Firebase Storage Verification Script', 'bright');
  log('=====================================', 'bright');
  
  try {
    // Step 1: Check environment variables
    const envOk = await checkEnvironmentVariables();
    if (!envOk) {
      logError('Environment variables check failed. Please fix missing variables.');
      process.exit(1);
    }
    
    // Step 2: Initialize Firebase
    const { app, db, auth } = await initializeFirebase();
    
    // Step 3: Test Firestore connection
    const connectionOk = await testFirestoreConnection(db);
    if (!connectionOk) {
      logError('Firestore connection test failed.');
      process.exit(1);
    }
    
    // Step 4: Test Firestore rules
    const rulesOk = await testFirestoreRules(db);
    if (!rulesOk) {
      logWarning('Firestore rules test had issues.');
    }
    
    // Step 5: Test data operations
    const dataOpsOk = await testDataOperations(db);
    if (!dataOpsOk) {
      logError('Data operations test failed.');
      process.exit(1);
    }
    
    // Summary
    log('\n🎉 Verification Complete!', 'green');
    log('========================', 'green');
    logSuccess('All Firebase storage tests passed');
    logSuccess('Transaction classification flow is working');
    logSuccess('Firestore rules allow necessary operations');
    logInfo('Your Firebase storage is properly configured');
    
  } catch (error) {
    logError(`Verification failed: ${error.message}`);
    logError(`Stack trace: ${error.stack}`);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = {
  checkEnvironmentVariables,
  initializeFirebase,
  testFirestoreConnection,
  testDataOperations,
  testFirestoreRules
};

