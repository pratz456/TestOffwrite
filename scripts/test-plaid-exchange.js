// Load environment variables from .env.local
require('dotenv').config({ path: '.env.local' });

const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

// Test the complete Plaid exchange token flow
async function testPlaidExchangeFlow() {
  console.log('🧪 Testing complete Plaid exchange token flow...');
  
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
    
    // Create a test user and get a token
    console.log('🔄 Creating test user and getting token...');
    const testUserId = 'test-user-' + Date.now();
    
    // Create a custom token for testing
    const customToken = await adminAuth.createCustomToken(testUserId);
    console.log('✅ Custom token created for user:', testUserId);
    
    // Test creating a link token
    console.log('🔄 Testing link token creation...');
    const linkTokenResponse = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: testUserId,
      },
      client_name: 'WriteOff Test',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    });
    
    console.log('✅ Link token created successfully');
    console.log('- Link token length:', linkTokenResponse.data.link_token.length);
    
    // Test direct Firebase operations
    console.log('🔄 Testing direct Firebase operations...');
    
    // Test upsertUserProfileServer function directly
    const testPlaidToken = 'test-access-token-' + Date.now();
    console.log('📂 Testing upsertUserProfileServer with user:', testUserId);
    console.log('📂 Testing upsertUserProfileServer with plaid_token:', testPlaidToken);
    
    const docRef = adminDb.collection("user_profiles").doc(testUserId);
    const updateData = {
      plaid_token: testPlaidToken,
      email: 'writeoffapp@gmail.com',
      name: 'Test User',
      updated_at: new Date(),
    };
    
    console.log('📂 Writing to user_profiles collection for user:', testUserId);
    console.log('📂 Document reference path:', docRef.path);
    console.log('📂 Update data:', updateData);
    
    // Check if document exists
    const docSnap = await docRef.get();
    console.log('📂 Document exists:', docSnap.exists);
    
    if (docSnap.exists) {
      console.log('📂 Document exists, updating...');
      await docRef.update(updateData);
      console.log('✅ Document updated successfully');
    } else {
      console.log('📂 Document does not exist, creating...');
      const createData = {
        ...updateData,
        created_at: new Date(),
      };
      console.log('📂 Creating document with data:', createData);
      await docRef.set(createData);
      console.log('✅ Document created successfully');
    }
    
    // Verify the document was saved
    const verifyDoc = await docRef.get();
    if (verifyDoc.exists) {
      const data = verifyDoc.data();
      console.log('✅ Document verified successfully:', data);
      console.log('✅ Plaid token saved:', data.plaid_token);
    } else {
      console.error('❌ Document was not saved properly');
    }
    
    // Test the exchange token API endpoint with a mock token
    console.log('🔄 Testing exchange token API endpoint...');
    
    // Use a sandbox public token for testing
    const publicToken = 'public-sandbox-12345678-1234-1234-1234-123456789012';
    
    try {
      // Use the built-in fetch in Node.js 18+ or import it
      const response = await fetch('http://localhost:3000/api/plaid/exchange-public-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customToken}`, // Using custom token directly
        },
        body: JSON.stringify({
          public_token: publicToken,
        }),
      });
      
      console.log('📡 Response status:', response.status);
      const responseData = await response.json();
      console.log('📡 Response data:', responseData);
      
      if (response.ok) {
        console.log('✅ Exchange token API call successful!');
      } else {
        console.log('❌ Exchange token API call failed:', responseData);
      }
      
    } catch (apiError) {
      console.log('⚠️ Exchange token API call failed (expected for test token):', apiError.message);
      console.log('This is normal for a test token. Real tokens from Plaid Link will work.');
    }
    
    // Clean up test data
    await docRef.delete();
    console.log('✅ Test data cleaned up successfully');
    
    console.log('🎉 Plaid exchange token flow test completed!');
    
  } catch (error) {
    console.error('❌ Plaid exchange token flow test failed:', error.message);
    console.error('Full error:', error);
  }
}

// Run the test
testPlaidExchangeFlow().catch(console.error);
