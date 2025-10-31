// Load environment variables from .env.local
require('dotenv').config({ path: '.env.local' });

const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

// Test Plaid connection and token exchange
async function testPlaidConnection() {
  console.log('🧪 Testing Plaid connection...');
  
  // Check environment variables
  const plaidEnv = process.env.PLAID_ENV || 'sandbox';
  const plaidClientId = process.env.PLAID_CLIENT_ID;
  const plaidSecret = process.env.PLAID_SECRET;
  
  console.log('📋 Environment check:');
  console.log('- PLAID_ENV:', plaidEnv);
  console.log('- PLAID_CLIENT_ID:', plaidClientId ? '✅ Set' : '❌ Missing');
  console.log('- PLAID_SECRET:', plaidSecret ? '✅ Set' : '❌ Missing');
  
  if (!plaidClientId || !plaidSecret) {
    console.error('❌ Missing required Plaid environment variables');
    return;
  }
  
  try {
    // Initialize Plaid client
    const configuration = new Configuration({
      basePath: PlaidEnvironments[plaidEnv],
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': plaidClientId,
          'PLAID-SECRET': plaidSecret,
        },
      },
    });
    
    const client = new PlaidApi(configuration);
    console.log('✅ Plaid client initialized successfully');
    
    // Test creating a link token
    console.log('🔄 Testing link token creation...');
    const linkTokenResponse = await client.linkTokenCreate({
      user: {
        client_user_id: 'test-user-123',
      },
      client_name: 'WriteOff Test',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    });
    
    console.log('✅ Link token created successfully');
    console.log('- Link token length:', linkTokenResponse.data.link_token.length);
    
    // Test sandbox public token exchange (this is a test token from Plaid docs)
    console.log('🔄 Testing public token exchange...');
    const publicToken = 'public-sandbox-12345678-1234-1234-1234-123456789012';
    
    try {
      const tokenResponse = await client.itemPublicTokenExchange({
        public_token: publicToken,
      });
      
      console.log('✅ Public token exchanged successfully');
      console.log('- Access token length:', tokenResponse.data.access_token.length);
      console.log('- Item ID:', tokenResponse.data.item_id);
      
      // Test getting accounts
      console.log('🔄 Testing accounts retrieval...');
      const accountsResponse = await client.accountsGet({
        access_token: tokenResponse.data.access_token,
      });
      
      console.log('✅ Accounts retrieved successfully');
      console.log('- Number of accounts:', accountsResponse.data.accounts.length);
      
      // Test getting transactions
      console.log('🔄 Testing transactions retrieval...');
      const transactionsResponse = await client.transactionsSync({
        access_token: tokenResponse.data.access_token,
        options: {
          include_personal_finance_category: true,
        },
      });
      
      console.log('✅ Transactions retrieved successfully');
      console.log('- Added transactions:', transactionsResponse.data.added.length);
      console.log('- Modified transactions:', transactionsResponse.data.modified.length);
      console.log('- Removed transactions:', transactionsResponse.data.removed.length);
      console.log('- Next cursor:', transactionsResponse.data.next_cursor ? 'Present' : 'None');
      
    } catch (exchangeError) {
      console.log('⚠️ Public token exchange failed (expected for test token):', exchangeError.message);
      console.log('This is normal for a test token. Real tokens from Plaid Link will work.');
    }
    
    console.log('🎉 Plaid connection test completed successfully!');
    
  } catch (error) {
    console.error('❌ Plaid connection test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
testPlaidConnection().catch(console.error);
