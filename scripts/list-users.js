/**
 * Helper script to list all users and their IDs from Firestore
 * This helps you find your user ID quickly
 *
 * Usage:
 *   node scripts/list-users.js
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

async function listUsers() {
  try {
    console.log('🔍 Fetching users from Firestore...\n');

    const usersSnapshot = await db.collection('user_profiles').get();

    if (usersSnapshot.empty) {
      console.log('❌ No users found in Firestore');
      return;
    }

    console.log(`✅ Found ${usersSnapshot.size} user(s):\n`);
    console.log('='.repeat(80));

    usersSnapshot.forEach((doc) => {
      const data = doc.data();
      console.log(`\n📋 User ID: ${doc.id}`);
      console.log(`   Email: ${data.email || 'N/A'}`);
      console.log(`   Name: ${data.name || 'N/A'}`);
      console.log(`   Has Plaid Token: ${data.plaid_token ? '✅ Yes' : '❌ No'}`);
      console.log(`   Subscription Status: ${data.subscriptionStatus || 'none'}`);
      if (data.trialEnd) {
        const trialEnd = data.trialEnd.toDate ? data.trialEnd.toDate() : new Date(data.trialEnd);
        console.log(`   Trial End: ${trialEnd.toLocaleString()}`);
      }
      console.log('-'.repeat(80));
    });

    console.log('\n💡 Copy any User ID above to use with: npm run test:plaid:quick <user-id>');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Error listing users:', error.message);
    process.exit(1);
  }
}

listUsers();

