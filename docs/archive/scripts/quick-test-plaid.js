/**
 * Quick test script to get Plaid access token from Firestore and test transactions
 * This script helps you quickly test Plaid transaction retrieval
 *
 * Usage:
 *   node scripts/quick-test-plaid.js <user_id>
 *
 * Example:
 *   node scripts/quick-test-plaid.js <your-firebase-user-id>
 */

require('dotenv').config({ path: '.env.local' });
const admin = require('firebase-admin');

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  try {
    const serviceAccount = require('../serviceAccountKey.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id || process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  } catch (error) {
    // Try using default credentials (for Firebase Functions or GCP)
    try {
      const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
      if (projectId) {
        admin.initializeApp({
          projectId: projectId,
        });
      } else {
        admin.initializeApp();
      }
    } catch (e) {
      console.error('Failed to initialize Firebase Admin:', e.message);
      console.error('\nPlease ensure you have:');
      console.error('1. serviceAccountKey.json in the project root, OR');
      console.error('2. FIREBASE_ADMIN_PROJECT_ID or NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local');
      process.exit(1);
    }
  }
}

const db = admin.firestore();

async function getPlaidAccessToken(userId) {
  try {
    const userDoc = await db.collection('user_profiles').doc(userId).get();

    if (!userDoc.exists) {
      throw new Error(`User ${userId} not found in Firestore`);
    }

    const userData = userDoc.data();
    const accessToken = userData.plaid_token;

    if (!accessToken) {
      throw new Error(`No Plaid access token found for user ${userId}. User may not have connected a bank account yet.`);
    }

    return accessToken;
  } catch (error) {
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: node scripts/quick-test-plaid.js <user_id>');
    console.error('\nTo find your user ID:');
    console.error('1. Check Firebase Console → Firestore → user_profiles collection');
    console.error('2. Or check the browser console when logged in (user.id)');
    console.error('3. Or use: firebase auth:export users.json and check the file');
    process.exit(1);
  }

  const userId = args[0];

  console.log('🔍 Fetching Plaid access token from Firestore...\n');

  try {
    const accessToken = await getPlaidAccessToken(userId);
    console.log(`✅ Found Plaid access token: ${accessToken.substring(0, 20)}...\n`);
    console.log('🚀 Running transaction tests...\n');
    console.log('='.repeat(80));

    // Import and run the test functions
    const { testOneYearTransactions, testMaxTransactions } = require('./test-plaid-transactions.js');

    await testOneYearTransactions(accessToken, userId);
    await testMaxTransactions(accessToken);

    console.log('\n' + '='.repeat(80));
    console.log('✅ ALL TESTS COMPLETED');
    console.log('='.repeat(80));

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.message.includes('not found')) {
      console.error('\n💡 Tips:');
      console.error('1. Make sure the user has connected a bank account via Plaid');
      console.error('2. Check that the user_id is correct');
      console.error('3. Verify Firestore has the user profile with plaid_token field');
    }
    process.exit(1);
  }
}

main();

