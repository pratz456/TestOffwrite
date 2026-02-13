/**
 * Simple reconnect test - tests current state and provides reconnect instructions
 * This doesn't require Firebase Admin, just the access token
 *
 * Usage:
 *   node scripts/test-reconnect-simple.js <access_token> <user_id>
 */

require('dotenv').config({ path: '.env.local' });
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || 'production'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

/**
 * Get current transaction state
 */
async function getCurrentState(accessToken) {
  const accountsResponse = await plaidClient.accountsGet({
    access_token: accessToken,
  });

  const accounts = accountsResponse.data.accounts;
  if (accounts.length === 0) {
    throw new Error('No accounts found');
  }

  const account = accounts[0];

  // Get transactions with max range
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const endDateStr = today.toISOString().split('T')[0];

  const startDate = new Date();
  startDate.setTime(today.getTime() - (730 * 24 * 60 * 60 * 1000));
  startDate.setHours(0, 0, 0, 0);
  const startDateStr = startDate.toISOString().split('T')[0];

  const response = await plaidClient.transactionsGet({
    access_token: accessToken,
    start_date: startDateStr,
    end_date: endDateStr,
    options: {
      account_ids: [account.account_id],
      count: 500,
    },
  });

  const transactions = response.data.transactions || [];
  const sorted = transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

  return {
    account,
    totalTransactions: transactions.length,
    firstDate: sorted[0]?.date || null,
    lastDate: sorted[sorted.length - 1]?.date || null,
    accessToken: accessToken.substring(0, 20) + '...',
  };
}

/**
 * Main test
 */
async function testReconnect(accessToken, userId) {
  console.log('='.repeat(80));
  console.log('🔄 PLAID RECONNECT TEST');
  console.log('='.repeat(80));
  console.log(`User ID: ${userId}`);
  console.log(`Environment: ${process.env.PLAID_ENV || 'production'}`);
  console.log('='.repeat(80));

  try {
    // Get current state
    console.log('\n📊 Current State (BEFORE RECONNECT):\n');
    const currentState = await getCurrentState(accessToken);

    console.log(`   Account: ${currentState.account.name}`);
    console.log(`   Account ID: ${currentState.account.account_id}`);
    console.log(`   Total Transactions: ${currentState.totalTransactions}`);
    console.log(`   First Transaction: ${currentState.firstDate || 'N/A'}`);
    console.log(`   Last Transaction: ${currentState.lastDate || 'N/A'}`);

    if (currentState.firstDate) {
      const firstDate = new Date(currentState.firstDate);
      const today = new Date();
      const daysFromFirst = Math.ceil((today.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));
      console.log(`   Days of History: ${daysFromFirst} days`);
      console.log(`   Connection Date: ~${currentState.firstDate}`);
    }

    // Instructions
    console.log('\n' + '='.repeat(80));
    console.log('📋 HOW TO RECONNECT');
    console.log('='.repeat(80));
    console.log('\n✅ GOOD NEWS: Your app now requests 365 days when creating Link tokens!');
    console.log('   The Link token creation API has been updated to include days_requested: 365\n');

    console.log('📝 Steps to reconnect:');
    console.log('\n1. Open your app in the browser');
    console.log('2. Go to Settings → Bank Accounts (or similar)');
    console.log('3. Disconnect your current account');
    console.log('4. Go to "Connect Bank Account" page');
    console.log('5. Click "Connect Bank Account" - this will create a Link token with 365 days requested');
    console.log('6. Complete the Plaid Link flow');
    console.log('7. After reconnecting, get the new access token from Firestore');
    console.log('8. Run this test again:');
    console.log(`   npm run test:plaid:reconnect <new-access-token> ${userId} --after-reconnect`);

    console.log('\n' + '='.repeat(80));
    console.log('💡 IMPORTANT NOTES');
    console.log('='.repeat(80));
    console.log('\n• Reconnecting creates a NEW Plaid item');
    console.log('• The new item will request 365 days of history');
    console.log('• However, Plaid can only return what the bank provides');
    console.log('• Some banks may still only provide limited history');
    console.log('• If you still don\'t get 1 year, CSV import is the best option for tax filing');

    console.log('\n' + '='.repeat(80));
    console.log('✅ TEST COMPLETED');
    console.log('='.repeat(80));
    console.log('\n📊 Current State Summary:');
    console.log(`   Transactions: ${currentState.totalTransactions}`);
    console.log(`   History: ${currentState.firstDate ? new Date(currentState.firstDate).toLocaleDateString() : 'N/A'} to ${currentState.lastDate ? new Date(currentState.lastDate).toLocaleDateString() : 'N/A'}`);
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Error:', error.response?.data || error.message);
    throw error;
  }
}

// Main
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node scripts/test-reconnect-simple.js <access_token> <user_id>');
    console.error('\nExample:');
    console.error('  node scripts/test-reconnect-simple.js access-production-xxx... Q8jMWeUzcbSS64gpmYPJKKwqixJ2');
    process.exit(1);
  }

  const accessToken = args[0];
  const userId = args[1];

  try {
    await testReconnect(accessToken, userId);
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

main();

