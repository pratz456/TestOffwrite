/**
 * Test Plaid Reconnect Flow
 * This script helps test reconnection and checks if requesting more days helps
 *
 * Usage:
 *   node scripts/test-reconnect-flow.js <user_id>
 */

require('dotenv').config({ path: '.env.local' });
const { Configuration, PlaidApi, PlaidEnvironments, CountryCode, Products } = require('plaid');
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
    try {
      const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
      if (projectId) {
        admin.initializeApp({ projectId });
      } else {
        admin.initializeApp();
      }
    } catch (e) {
      console.error('Failed to initialize Firebase Admin:', e.message);
      process.exit(1);
    }
  }
}

const adminDb = admin.firestore();

const plaidConfig = {
  basePath: PlaidEnvironments[process.env.PLAID_ENV || 'production'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
};

const plaidClient = new PlaidApi(new Configuration(plaidConfig));

/**
 * Get current access token from Firestore
 */
async function getCurrentAccessToken(userId) {
  const userDoc = await adminDb.doc(`user_profiles/${userId}`).get();
  if (!userDoc.exists) {
    throw new Error(`User ${userId} not found`);
  }
  const data = userDoc.data();
  return data.plaid_token;
}

/**
 * Get current transaction count
 */
async function getCurrentTransactionCount(accessToken, accountId) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const endDateStr = today.toISOString().split('T')[0];

  const startDate = new Date();
  startDate.setTime(today.getTime() - (730 * 24 * 60 * 60 * 1000));
  startDate.setHours(0, 0, 0, 0);
  const startDateStr = startDate.toISOString().split('T')[0];

  try {
    const response = await plaidClient.transactionsGet({
      access_token: accessToken,
      start_date: startDateStr,
      end_date: endDateStr,
      options: {
        account_ids: [accountId],
        count: 500,
      },
    });

    const transactions = response.data.transactions || [];
    const sorted = transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

    return {
      total: transactions.length,
      firstDate: sorted[0]?.date || null,
      lastDate: sorted[sorted.length - 1]?.date || null,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Create Link token with days_requested parameter
 */
async function createLinkTokenWithDaysRequested(userId, daysRequested = 365) {
  const configs = {
    user: {
      client_user_id: userId,
    },
    client_name: 'WriteOff',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
    transactions: {
      days_requested: daysRequested, // Request specific number of days
    },
    webhook: `${process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || 'http://localhost:3000'}/api/plaid/webhook`,
  };

  console.log(`\n🔑 Creating Link token with days_requested: ${daysRequested}...`);
  const response = await plaidClient.linkTokenCreate(configs);

  return response.data.link_token;
}

/**
 * Main test flow
 */
async function testReconnectFlow(userId) {
  console.log('='.repeat(80));
  console.log('🔄 PLAID RECONNECT TEST FLOW');
  console.log('='.repeat(80));
  console.log(`User ID: ${userId}`);
  console.log(`Environment: ${process.env.PLAID_ENV || 'production'}`);
  console.log('='.repeat(80));

  try {
    // Step 1: Get current state
    console.log('\n📋 Step 1: Checking current connection state...\n');

    const currentAccessToken = await getCurrentAccessToken(userId);
    console.log(`✅ Current access token: ${currentAccessToken.substring(0, 20)}...`);

    // Get account info
    const accountsResponse = await plaidClient.accountsGet({
      access_token: currentAccessToken,
    });

    const accounts = accountsResponse.data.accounts;
    if (accounts.length === 0) {
      console.error('❌ No accounts found. Cannot test reconnect.');
      return;
    }

    const account = accounts[0];
    console.log(`✅ Found account: ${account.name} (${account.account_id})`);

    // Get current transaction count
    console.log('\n📊 Step 2: Checking current transaction count...\n');
    const currentState = await getCurrentTransactionCount(currentAccessToken, account.account_id);
    console.log(`   Total Transactions: ${currentState.total}`);
    console.log(`   First Transaction: ${currentState.firstDate || 'N/A'}`);
    console.log(`   Last Transaction: ${currentState.lastDate || 'N/A'}`);

    // Step 3: Create Link token with days_requested
    console.log('\n🔑 Step 3: Creating Link token for reconnection...\n');
    console.log('   ⚠️  IMPORTANT: To get more history, you need to:');
    console.log('   1. Disconnect your current account in the app');
    console.log('   2. Use this Link token to reconnect');
    console.log('   3. This will create a NEW Plaid item with 365 days requested\n');

    const linkToken = await createLinkTokenWithDaysRequested(userId, 365);
    console.log(`✅ Link token created: ${linkToken.substring(0, 20)}...`);
    console.log(`\n📝 Link Token (full): ${linkToken}`);
    console.log(`\n💡 This token requests 365 days of transaction history`);

    // Step 4: Instructions
    console.log('\n' + '='.repeat(80));
    console.log('📋 RECONNECTION INSTRUCTIONS');
    console.log('='.repeat(80));
    console.log('\n1. Open your app in the browser');
    console.log('2. Go to Settings → Bank Accounts');
    console.log('3. Disconnect your current account');
    console.log('4. Go to Connect Bank Account page');
    console.log('5. Open browser console (F12) and run:');
    console.log(`   localStorage.setItem('plaid_link_token', '${linkToken}');`);
    console.log('6. Refresh the page and click "Connect Bank Account"');
    console.log('7. Complete the Plaid Link flow');
    console.log('8. After reconnecting, run:');
    console.log(`   npm run test:plaid:reconnect <new-access-token> ${userId} --after-reconnect`);
    console.log('\n' + '='.repeat(80));

    // Save state for comparison
    const stateFile = require('path').join(__dirname, '.reconnect-state.json');
    require('fs').writeFileSync(stateFile, JSON.stringify({
      userId,
      beforeReconnect: {
        accessToken: currentAccessToken.substring(0, 20) + '...',
        transactionCount: currentState.total,
        firstDate: currentState.firstDate,
        lastDate: currentState.lastDate,
        accountId: account.account_id,
      },
      linkToken,
      timestamp: new Date().toISOString(),
    }, null, 2));

    console.log('\n✅ State saved to .reconnect-state.json');
    console.log('   You can compare results after reconnecting\n');

  } catch (error) {
    console.error('\n❌ Error:', error.response?.data || error.message);
    throw error;
  }
}

// Main
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: node scripts/test-reconnect-flow.js <user_id>');
    console.error('\nExample:');
    console.error('  node scripts/test-reconnect-flow.js Q8jMWeUzcbSS64gpmYPJKKwqixJ2');
    process.exit(1);
  }

  const userId = args[0];

  try {
    await testReconnectFlow(userId);
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

main();

