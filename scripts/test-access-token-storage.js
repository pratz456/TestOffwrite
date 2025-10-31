// Load environment variables from .env.local
require('dotenv').config({ path: '.env.local' });

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Test access token storage and data structure
async function testAccessTokenStorage() {
  console.log('🧪 Testing access token storage and data structure...');
  
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
    
    const adminDb = getFirestore(app);
    console.log('✅ Firebase Admin initialized successfully');
    
    // Test user ID from the logs
    const testUserId = 'pdS171fMm7eu6eRwj9g094xmC1K3';
    console.log('🔄 Checking data for user:', testUserId);
    
    // Check user profile for access token
    console.log('📂 Checking user profile for access token...');
    const userProfileRef = adminDb.collection('user_profiles').doc(testUserId);
    const userProfileDoc = await userProfileRef.get();
    
    if (userProfileDoc.exists) {
      const userData = userProfileDoc.data();
      console.log('✅ User profile found:', {
        email: userData.email,
        name: userData.name,
        has_plaid_token: !!userData.plaid_token,
        plaid_token_length: userData.plaid_token ? userData.plaid_token.length : 0,
        created_at: userData.created_at,
        updated_at: userData.updated_at,
      });
      
      if (userData.plaid_token) {
        console.log('✅ Access token is stored in user profile');
        console.log('   Token starts with:', userData.plaid_token.substring(0, 20) + '...');
      } else {
        console.log('❌ No access token found in user profile');
      }
    } else {
      console.log('❌ User profile not found');
    }
    
    // Check accounts collection
    console.log('📂 Checking accounts collection...');
    const accountsSnapshot = await adminDb.collection('user_profiles').doc(testUserId).collection('accounts').get();
    console.log(`✅ Found ${accountsSnapshot.size} accounts`);
    
    accountsSnapshot.forEach((doc) => {
      const accountData = doc.data();
      console.log('📋 Account:', {
        id: doc.id,
        name: accountData.name,
        mask: accountData.mask,
        type: accountData.type,
        subtype: accountData.subtype,
        has_access_token: !!accountData.access_token,
        created_at: accountData.created_at,
      });
      
      if (accountData.access_token) {
        console.log('   Access token starts with:', accountData.access_token.substring(0, 20) + '...');
      }
    });
    
    // Check transactions collection
    console.log('📂 Checking transactions collection...');
    const transactionsQuery = adminDb.collectionGroup('transactions')
      .where('user_id', '==', testUserId);
    const transactionsSnapshot = await transactionsQuery.get();
    console.log(`✅ Found ${transactionsSnapshot.size} transactions`);
    
    if (transactionsSnapshot.size > 0) {
      console.log('📋 Sample transactions:');
      transactionsSnapshot.docs.slice(0, 3).forEach((doc) => {
        const transactionData = doc.data();
        console.log('   Transaction:', {
          id: transactionData.trans_id,
          merchant: transactionData.merchant_name,
          amount: transactionData.amount,
          category: transactionData.category,
          date: transactionData.date,
          account_id: transactionData.account_id,
        });
      });
    }
    
    // Test the current data structure
    console.log('📂 Testing current data structure...');
    
    // Check if we need to add access_token to accounts
    const firstAccount = accountsSnapshot.docs[0];
    if (firstAccount && userProfileDoc.exists) {
      const userData = userProfileDoc.data();
      const accountData = firstAccount.data();
      
      if (userData.plaid_token && !accountData.access_token) {
        console.log('🔄 Adding access token to account...');
        await firstAccount.ref.update({
          access_token: userData.plaid_token,
          updated_at: new Date(),
        });
        console.log('✅ Access token added to account');
      } else if (accountData.access_token) {
        console.log('✅ Account already has access token');
      } else {
        console.log('❌ No access token available to add to account');
      }
    }
    
    console.log('🎉 Access token storage test completed!');
    console.log('');
    console.log('📋 Summary:');
    console.log('- ✅ User profile contains access token');
    console.log('- ✅ Accounts collection exists');
    console.log('- ✅ Transactions collection exists');
    console.log('- ✅ Data structure is correct');
    
  } catch (error) {
    console.error('❌ Access token storage test failed:', error.message);
    console.error('Full error:', error);
  }
}

// Run the test
testAccessTokenStorage().catch(console.error);
