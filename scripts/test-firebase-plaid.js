// Load environment variables from .env.local
require('dotenv').config({ path: '.env.local' });

const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

// Test Firebase and Plaid integration
async function testFirebasePlaidIntegration() {
  console.log('🧪 Testing Firebase and Plaid integration...');
  
  // Check environment variables
  console.log('📋 Environment check:');
  console.log('- FIREBASE_ADMIN_PROJECT_ID:', process.env.FIREBASE_ADMIN_PROJECT_ID ? '✅ Set' : '❌ Missing');
  console.log('- FIREBASE_ADMIN_CLIENT_EMAIL:', process.env.FIREBASE_ADMIN_CLIENT_EMAIL ? '✅ Set' : '❌ Missing');
  console.log('- FIREBASE_ADMIN_PRIVATE_KEY:', process.env.FIREBASE_ADMIN_PRIVATE_KEY ? '✅ Set' : '❌ Missing');
  console.log('- PLAID_CLIENT_ID:', process.env.PLAID_CLIENT_ID ? '✅ Set' : '❌ Missing');
  console.log('- PLAID_SECRET:', process.env.PLAID_SECRET ? '✅ Set' : '❌ Missing');
  
  if (!process.env.FIREBASE_ADMIN_PROJECT_ID || !process.env.FIREBASE_ADMIN_CLIENT_EMAIL || !process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
    console.error('❌ Missing required Firebase environment variables');
    return;
  }
  
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    console.error('❌ Missing required Plaid environment variables');
    return;
  }
  
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
    
    // Test Firebase connection by reading from Firestore
    console.log('🔄 Testing Firestore connection...');
    const testDoc = adminDb.collection('test').doc('connection-test');
    await testDoc.set({ timestamp: new Date(), test: true });
    const testRead = await testDoc.get();
    console.log('✅ Firestore read/write test successful:', testRead.data());
    
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
    
    // Test creating a link token
    console.log('🔄 Testing Plaid link token creation...');
    const linkTokenResponse = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: 'test-user-123',
      },
      client_name: 'WriteOff Test',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    });
    
    console.log('✅ Plaid link token created successfully');
    console.log('- Link token length:', linkTokenResponse.data.link_token.length);
    
    // Test Firebase user profile operations
    console.log('🔄 Testing Firebase user profile operations...');
    const testUserId = 'test-user-' + Date.now();
    
    // Create a test user profile
    const userProfileRef = adminDb.collection('user_profiles').doc(testUserId);
    await userProfileRef.set({
      email: 'writeoffapp@gmail.com',
      name: 'Test User',
      profession: 'Developer',
      income: '50000',
      state: 'CA',
      filing_status: 'single',
      created_at: new Date(),
      updated_at: new Date(),
    });
    
    console.log('✅ Test user profile created successfully');
    
    // Test reading the user profile
    const userProfileDoc = await userProfileRef.get();
    console.log('✅ User profile read successfully:', userProfileDoc.data());
    
    // Test updating with Plaid token
    const testPlaidToken = 'test-access-token-' + Date.now();
    await userProfileRef.update({
      plaid_token: testPlaidToken,
      updated_at: new Date(),
    });
    
    console.log('✅ Plaid token saved to user profile successfully');
    
    // Test reading the updated profile
    const updatedProfileDoc = await userProfileRef.get();
    console.log('✅ Updated profile read successfully:', updatedProfileDoc.data());
    
    // Clean up test data
    await testDoc.delete();
    await userProfileRef.delete();
    console.log('✅ Test data cleaned up successfully');
    
    console.log('🎉 Firebase and Plaid integration test completed successfully!');
    
  } catch (error) {
    console.error('❌ Firebase and Plaid integration test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    console.error('Full error:', error);
  }
}

// Run the test
testFirebasePlaidIntegration().catch(console.error);
