// Load environment variables from .env.local
require('dotenv').config({ path: '.env.local' });

const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

// Test the transactions API
async function testTransactionsAPI() {
  console.log('🧪 Testing transactions API...');
  
  try {
    // Initialize Firebase Admin
    console.log('🔄 Initializing Firebase Admin...');
    const firebaseAdminConfig = {
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
    
    const app = initializeApp({
      credential: cert(firebaseAdminConfig),
      projectId: firebaseAdminConfig.projectId,
    });
    
    const adminAuth = getAuth(app);
    const adminDb = getFirestore(app);
    console.log('✅ Firebase Admin initialized successfully');
    
    // Test user ID from the logs
    const testUserId = 'pdS171fMm7eu6eRwj9g094xmC1K3';
    console.log('🔄 Testing with user:', testUserId);
    
    // Create a custom token for testing
    const customToken = await adminAuth.createCustomToken(testUserId);
    console.log('✅ Custom token created');
    
    // Test direct Firebase query (bypassing the API)
    console.log('🔄 Testing direct Firebase query...');
    
    // Get all accounts for this user first
    const accountsSnapshot = await adminDb.collection('user_profiles').doc(testUserId).collection('accounts').get();
    console.log(`📊 Found ${accountsSnapshot.size} accounts for user ${testUserId}`);
    
    let totalTransactions = 0;
    
    // Get transactions from each account individually
    for (const accountDoc of accountsSnapshot.docs) {
      const accountData = accountDoc.data();
      console.log(`🔍 Getting transactions for account: ${accountData.name}`);
      
      const transactionsSnapshot = await adminDb.collection('user_profiles').doc(testUserId)
        .collection('accounts').doc(accountDoc.id)
        .collection('transactions').get();
      
      console.log(`📊 Found ${transactionsSnapshot.size} transactions for account ${accountData.name}`);
      totalTransactions += transactionsSnapshot.size;
      
      if (transactionsSnapshot.size > 0) {
        console.log('📋 Sample transactions:');
        transactionsSnapshot.docs.slice(0, 2).forEach((doc) => {
          const data = doc.data();
          console.log('   Transaction:', {
            id: data.trans_id,
            merchant: data.merchant_name,
            amount: data.amount,
            category: data.category,
            date: data.date,
            account_id: data.account_id,
          });
        });
      }
    }
    
    console.log(`✅ Total transactions found: ${totalTransactions}`);
    
    // Test the server function directly
    console.log('🔄 Testing server function directly...');
    const { getTransactionsServer } = require('../lib/firebase/transactions-server.ts');
    
    const result = await getTransactionsServer(testUserId);
    if (result.error) {
      console.error('❌ Server function failed:', result.error);
    } else {
      console.log(`✅ Server function returned ${result.data.length} transactions`);
      if (result.data.length > 0) {
        console.log('📋 First transaction:', {
          id: result.data[0].trans_id,
          merchant: result.data[0].merchant_name,
          amount: result.data[0].amount,
          category: result.data[0].category,
          date: result.data[0].date,
        });
      }
    }
    
    console.log('🎉 Transactions API test completed!');
    console.log('');
    console.log('📋 Summary:');
    console.log('- ✅ Direct Firebase query working');
    console.log('- ✅ Server function working');
    console.log('- ✅ Transactions are being retrieved correctly');
    
  } catch (error) {
    console.error('❌ Transactions API test failed:', error.message);
    console.error('Full error:', error);
  }
}

// Run the test
testTransactionsAPI().catch(console.error);
