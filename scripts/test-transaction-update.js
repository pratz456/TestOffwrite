const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin SDK
const serviceAccount = require('../path/to/serviceAccountKey.json'); // Update this path
const app = initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = getFirestore(app);

// Import the functions we want to test
const { updateTransactionServer, updateTransactionServerWithUserId } = require('../lib/firebase/transactions-server');

async function testTransactionUpdate() {
  console.log('🧪 Testing transaction update functions...\n');

  const testUserId = 'test_user_123';
  const testTransactionId = 'test_transaction_456';
  const testUpdates = {
    is_deductible: true,
    deductible_reason: 'Test business expense',
    deduction_score: 0.8,
    notes: 'Test update'
  };

  // Test 1: updateTransactionServer (original function)
  console.log('📝 Test 1: updateTransactionServer (original function)');
  try {
    const result1 = await updateTransactionServer(testTransactionId, testUpdates);
    console.log('✅ Result:', result1);
  } catch (error) {
    console.log('❌ Error:', error.message);
    if (error.code === 9 || error.code === 'FAILED_PRECONDITION') {
      console.log('🔧 This is expected if indexes are missing');
    }
  }
  console.log('');

  // Test 2: updateTransactionServerWithUserId (recommended function)
  console.log('📝 Test 2: updateTransactionServerWithUserId (recommended function)');
  try {
    const result2 = await updateTransactionServerWithUserId(testUserId, testTransactionId, testUpdates);
    console.log('✅ Result:', result2);
  } catch (error) {
    console.log('❌ Error:', error.message);
    if (error.code === 9 || error.code === 'FAILED_PRECONDITION') {
      console.log('🔧 This is expected if indexes are missing');
    }
  }
  console.log('');

  // Test 3: Test with non-existent transaction
  console.log('📝 Test 3: Non-existent transaction');
  try {
    const result3 = await updateTransactionServerWithUserId(testUserId, 'non_existent_transaction', testUpdates);
    console.log('✅ Result:', result3);
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
  console.log('');

  // Test 4: Test collectionGroup query directly
  console.log('📝 Test 4: Direct collectionGroup query test');
  try {
    const query = db.collectionGroup('transactions')
      .where('trans_id', '==', testTransactionId)
      .limit(1);
    
    const snapshot = await query.get();
    console.log('✅ CollectionGroup query successful');
    console.log('📊 Found documents:', snapshot.size);
  } catch (error) {
    console.log('❌ CollectionGroup query failed:', error.message);
    if (error.code === 9 || error.code === 'FAILED_PRECONDITION') {
      console.log('🔧 Missing index detected. Please create the required index:');
      console.log('   Collection Group: transactions');
      console.log('   Fields: trans_id (Ascending)');
    }
  }
  console.log('');

  // Test 5: Test with userId filter
  console.log('📝 Test 5: CollectionGroup query with userId filter');
  try {
    const query = db.collectionGroup('transactions')
      .where('user_id', '==', testUserId)
      .where('trans_id', '==', testTransactionId)
      .limit(1);
    
    const snapshot = await query.get();
    console.log('✅ CollectionGroup query with userId filter successful');
    console.log('📊 Found documents:', snapshot.size);
  } catch (error) {
    console.log('❌ CollectionGroup query with userId filter failed:', error.message);
    if (error.code === 9 || error.code === 'FAILED_PRECONDITION') {
      console.log('🔧 Missing composite index detected. Please create the required index:');
      console.log('   Collection Group: transactions');
      console.log('   Fields: user_id (Ascending), trans_id (Ascending)');
    }
  }
  console.log('');

  console.log('🎉 Testing completed!');
  console.log('');
  console.log('📋 Summary:');
  console.log('- If you see FAILED_PRECONDITION errors, you need to create Firestore indexes');
  console.log('- If you see "Transaction not found" errors, that\'s expected for test data');
  console.log('- If you see successful updates, the functions are working correctly');
}

// Run the test
if (require.main === module) {
  testTransactionUpdate().catch(console.error);
}

module.exports = { testTransactionUpdate };
