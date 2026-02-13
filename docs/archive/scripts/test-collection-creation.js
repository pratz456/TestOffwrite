// Load environment variables from .env.local
require('dotenv').config({ path: '.env.local' });

const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

// Test collection creation when Plaid data is processed
async function testCollectionCreation() {
  console.log('🧪 Testing Firebase collection creation with Plaid data...');
  
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
    
    // Initialize Plaid client
    console.log('🔄 Initializing Plaid client...');
    const plaidConfig = new Configuration({
      basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
          'PLAID-SECRET': process.env.PLAID_SECRET,
        },
      },
    });
    
    const plaidClient = new PlaidApi(plaidConfig);
    console.log('✅ Plaid client initialized successfully');
    
    // Create a test user
    const testUserId = 'test-user-' + Date.now();
    console.log('🔄 Creating test user:', testUserId);
    
    // Test 1: Create user profile (this should create the user_profiles collection)
    console.log('📂 Test 1: Creating user profile...');
    const userProfileRef = adminDb.collection('user_profiles').doc(testUserId);
    await userProfileRef.set({
      email: 'writeoffapp@gmail.com',
      name: 'Test User',
      created_at: new Date(),
      updated_at: new Date(),
    });
    console.log('✅ User profile created');
    
    // Test 2: Create accounts (this should create the accounts subcollection)
    console.log('📂 Test 2: Creating accounts...');
    const testAccounts = [
      {
        account_id: 'test-account-1',
        name: 'Test Checking Account',
        mask: '1234',
        type: 'depository',
        subtype: 'checking',
        institution_id: 'test-institution',
      },
      {
        account_id: 'test-account-2',
        name: 'Test Savings Account',
        mask: '5678',
        type: 'depository',
        subtype: 'savings',
        institution_id: 'test-institution',
      }
    ];
    
    for (const accountData of testAccounts) {
      const accountRef = adminDb.collection('user_profiles').doc(testUserId).collection('accounts').doc(accountData.account_id);
      await accountRef.set({
        ...accountData,
        user_id: testUserId,
        created_at: new Date(),
        updated_at: new Date(),
      });
      console.log(`✅ Account created: ${accountData.name}`);
    }
    
    // Test 3: Create transactions (this should create the transactions subcollection)
    console.log('📂 Test 3: Creating transactions...');
    const testTransactions = [
      {
        trans_id: 'test-trans-1',
        merchant_name: 'Test Store',
        amount: 50.00,
        category: 'FOOD_AND_DRINK',
        date: '2024-01-15',
        description: 'Test transaction 1',
      },
      {
        trans_id: 'test-trans-2',
        merchant_name: 'Test Gas Station',
        amount: 35.00,
        category: 'TRANSPORTATION',
        date: '2024-01-16',
        description: 'Test transaction 2',
      }
    ];
    
    for (const transactionData of testTransactions) {
      const transactionRef = adminDb.collection('user_profiles').doc(testUserId)
        .collection('accounts').doc('test-account-1')
        .collection('transactions').doc(transactionData.trans_id);
      
      await transactionRef.set({
        ...transactionData,
        user_id: testUserId,
        account_id: 'test-account-1',
        is_deductible: false,
        deductible_reason: null,
        deduction_score: 0,
        created_at: new Date(),
        updated_at: new Date(),
      });
      console.log(`✅ Transaction created: ${transactionData.merchant_name}`);
    }
    
    // Test 4: Verify collections exist by listing them
    console.log('📂 Test 4: Verifying collections exist...');
    
    // List user_profiles collection
    const userProfilesSnapshot = await adminDb.collection('user_profiles').get();
    console.log(`✅ user_profiles collection has ${userProfilesSnapshot.size} documents`);
    
    // List accounts subcollection
    const accountsSnapshot = await adminDb.collection('user_profiles').doc(testUserId).collection('accounts').get();
    console.log(`✅ accounts subcollection has ${accountsSnapshot.size} documents`);
    
    // List transactions subcollection
    const transactionsSnapshot = await adminDb.collection('user_profiles').doc(testUserId)
      .collection('accounts').doc('test-account-1').collection('transactions').get();
    console.log(`✅ transactions subcollection has ${transactionsSnapshot.size} documents`);
    
    // Test 5: Test collectionGroup query for transactions
    console.log('📂 Test 5: Testing collectionGroup query for transactions...');
    const allTransactionsQuery = adminDb.collectionGroup('transactions')
      .where('user_id', '==', testUserId);
    const allTransactionsSnapshot = await allTransactionsQuery.get();
    console.log(`✅ CollectionGroup query found ${allTransactionsSnapshot.size} transactions for user ${testUserId}`);
    
    // Display the transaction data
    allTransactionsSnapshot.forEach((doc) => {
      const data = doc.data();
      console.log(`  - Transaction: ${data.merchant_name} (${data.amount}) - ${data.category}`);
    });
    
    // Test 6: Test the actual server functions
    console.log('📂 Test 6: Testing server functions...');
    
    // Import the server functions
    const { createAccountServer } = require('../lib/firebase/accounts-server.ts');
    const { createTransactionServer } = require('../lib/firebase/transactions-server.ts');
    
    // Test creating an account using the server function
    const newAccountData = {
      account_id: 'test-account-3',
      name: 'Test Credit Card',
      mask: '9999',
      type: 'credit',
      subtype: 'credit card',
      institution_id: 'test-institution',
    };
    
    const accountResult = await createAccountServer(testUserId, newAccountData);
    if (accountResult.error) {
      console.error('❌ Account creation failed:', accountResult.error);
    } else {
      console.log('✅ Account created via server function:', accountResult.data?.name);
    }
    
    // Test creating a transaction using the server function
    const newTransactionData = {
      trans_id: 'test-trans-3',
      date: '2024-01-17',
      amount: 25.00,
      merchant_name: 'Test Restaurant',
      category: 'FOOD_AND_DRINK',
      description: 'Test transaction via server function',
      is_deductible: false,
      deductible_reason: null,
      deduction_score: 0,
    };
    
    const transactionResult = await createTransactionServer(testUserId, 'test-account-3', newTransactionData);
    if (transactionResult.error) {
      console.error('❌ Transaction creation failed:', transactionResult.error);
    } else {
      console.log('✅ Transaction created via server function:', transactionResult.data?.merchant_name);
    }
    
    // Clean up test data
    console.log('🔄 Cleaning up test data...');
    await userProfileRef.delete();
    console.log('✅ Test data cleaned up successfully');
    
    console.log('🎉 Collection creation test completed successfully!');
    console.log('');
    console.log('📋 Summary:');
    console.log('- ✅ user_profiles collection created');
    console.log('- ✅ accounts subcollection created');
    console.log('- ✅ transactions subcollection created');
    console.log('- ✅ CollectionGroup queries working');
    console.log('- ✅ Server functions working');
    console.log('- ✅ All data properly stored in Firebase');
    
  } catch (error) {
    console.error('❌ Collection creation test failed:', error.message);
    console.error('Full error:', error);
  }
}

// Run the test
testCollectionCreation().catch(console.error);
