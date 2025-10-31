const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin SDK
const serviceAccount = require('../path/to/serviceAccountKey.json'); // Update this path
const app = initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = getFirestore(app);

async function createIndexes() {
  try {
    console.log('🔧 Creating Firestore indexes...');
    
    // Index for collectionGroup queries on transactions
    // This index is needed for: collectionGroup('transactions').where('trans_id', '==', value)
    console.log('📝 Creating index for transactions collectionGroup query...');
    
    // Note: Firestore indexes are typically created automatically when queries fail
    // But you can also create them manually through the Firebase Console or CLI
    
    console.log('✅ Index creation process initiated');
    console.log('');
    console.log('📋 Manual steps to create indexes:');
    console.log('1. Go to Firebase Console > Firestore Database > Indexes');
    console.log('2. Click "Create Index"');
    console.log('3. Collection ID: transactions (Collection Group)');
    console.log('4. Fields to index:');
    console.log('   - trans_id (Ascending)');
    console.log('   - user_id (Ascending) - if using userId filter');
    console.log('5. Click "Create"');
    console.log('');
    console.log('🔗 Or use Firebase CLI:');
    console.log('firebase deploy --only firestore:indexes');
    
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
  }
}

// Function to check if indexes exist
async function checkIndexes() {
  try {
    console.log('🔍 Checking Firestore indexes...');
    
    // Try a collectionGroup query to see if it works
    const query = db.collectionGroup('transactions')
      .where('trans_id', '==', 'test_transaction_id')
      .limit(1);
    
    const snapshot = await query.get();
    console.log('✅ CollectionGroup query works! Indexes are properly configured.');
    
  } catch (error) {
    console.error('❌ CollectionGroup query failed:', error);
    if (error.code === 9 || error.code === 'FAILED_PRECONDITION') {
      console.log('🔧 This indicates missing indexes. Please create the required indexes.');
    }
  }
}

// Run the functions
async function main() {
  await checkIndexes();
  await createIndexes();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { createIndexes, checkIndexes };
