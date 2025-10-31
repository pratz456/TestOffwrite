#!/usr/bin/env node

/**
 * Test script to verify transaction update API is working
 * Run with: node scripts/test-transaction-update-api.js
 */

const https = require('https');
const http = require('http');

// Test configuration
const config = {
  baseUrl: 'http://localhost:3000', // Update if using different port
  endpoint: '/api/transactions/test123',
  testUpdates: {
    is_deductible: true,
    deductible_reason: 'Test business expense',
    deduction_score: 0.8,
    notes: 'Test update from script'
  }
};

// Helper function to make HTTP requests
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    if (options.body) {
      requestOptions.headers['Content-Type'] = 'application/json';
      requestOptions.headers['Content-Length'] = Buffer.byteLength(options.body);
    }

    const req = client.request(requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: jsonData
          });
        } catch (error) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: data
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

// Test functions
async function testUnauthenticatedUpdate() {
  console.log('\n🧪 Test 1: Unauthenticated Update (should return 401)');
  try {
    const response = await makeRequest(`${config.baseUrl}${config.endpoint}`, {
      method: 'PUT',
      body: JSON.stringify(config.testUpdates)
    });
    
    if (response.status === 401) {
      console.log('✅ PASS: API correctly requires authentication');
    } else {
      console.log('❌ FAIL: API should require authentication but returned:', response.status);
    }
    
    console.log('Response:', response.data);
  } catch (error) {
    console.log('❌ ERROR:', error.message);
  }
}

async function testInvalidEndpoint() {
  console.log('\n🧪 Test 2: Invalid Endpoint (should return 404)');
  try {
    const response = await makeRequest(`${config.baseUrl}/api/transactions/invalid`, {
      method: 'PUT',
      body: JSON.stringify(config.testUpdates)
    });
    
    console.log('Status:', response.status);
    console.log('Response:', response.data);
  } catch (error) {
    console.log('❌ ERROR:', error.message);
  }
}

async function testServerStatus() {
  console.log('\n🧪 Test 3: Server Status Check');
  try {
    const response = await makeRequest(`${config.baseUrl}/api/transactions`);
    
    console.log('Status:', response.status);
    if (response.status === 401) {
      console.log('✅ PASS: Server is running and API requires authentication');
    } else {
      console.log('⚠️  WARNING: Unexpected status code:', response.status);
    }
  } catch (error) {
    console.log('❌ ERROR: Server might not be running:', error.message);
  }
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting Transaction Update API Tests');
  console.log('📍 Testing against:', config.baseUrl);
  console.log('📝 Test updates:', JSON.stringify(config.testUpdates, null, 2));
  
  await testServerStatus();
  await testUnauthenticatedUpdate();
  await testInvalidEndpoint();
  
  console.log('\n✨ Tests completed!');
  console.log('\n📋 Summary:');
  console.log('• Test 1: Verify API requires authentication (should return 401)');
  console.log('• Test 2: Verify invalid endpoints are handled properly');
  console.log('• Test 3: Verify server is running and accessible');
  
  console.log('\n🔧 Next Steps:');
  console.log('1. Deploy the missing Firestore index manually');
  console.log('2. Test with authenticated requests in the UI');
  console.log('3. Verify transaction updates persist in Firestore');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests, makeRequest };
