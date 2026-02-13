#!/usr/bin/env node

/**
 * Backfill Script: Migrate existing documents to use userId (camelCase)
 * 
 * This script migrates existing analysis_status documents to use the standardized
 * userId field instead of user_id or other variations.
 */

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

async function backfillUserIdMigration() {
  console.log('🔄 Starting userId field migration...\n');

  // Check environment variables
  if (!process.env.FIREBASE_ADMIN_PROJECT_ID || !process.env.FIREBASE_ADMIN_CLIENT_EMAIL || !process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
    console.error('❌ Missing Firebase Admin environment variables');
    console.error('Required: FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY');
    process.exit(1);
  }

  try {
    // Initialize Firebase Admin
    const app = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });

    const adminDb = getFirestore(app);
    console.log('✅ Firebase Admin initialized');

    // Check if analysis_status collection exists
    const statusSnapshot = await adminDb.collection('analysis_status').limit(1).get();
    
    if (statusSnapshot.empty) {
      console.log('ℹ️  No analysis_status documents found. Migration not needed.');
      return;
    }

    console.log('📊 Found analysis_status collection. Starting migration...\n');

    // Get all analysis_status documents
    const snap = await adminDb.collection('analysis_status').get();
    const batch = adminDb.batch();
    let migrationCount = 0;
    let skipCount = 0;

    snap.forEach(doc => {
      const data = doc.data();
      
      // Check if document needs migration
      if (!data.userId && (data.user_id || data.uid)) {
        const userIdValue = data.user_id || data.uid;
        
        console.log(`📝 Migrating document ${doc.id}: ${data.user_id ? 'user_id' : 'uid'} → userId`);
        
        // Add userId field and remove old field
        const updates = {
          userId: userIdValue,
          migrated_at: FieldValue.serverTimestamp()
        };
        
        // Remove old field
        if (data.user_id) {
          updates.user_id = FieldValue.delete();
        }
        if (data.uid) {
          updates.uid = FieldValue.delete();
        }
        
        batch.update(doc.ref, updates);
        migrationCount++;
      } else if (data.userId) {
        console.log(`✅ Document ${doc.id} already has userId field`);
        skipCount++;
      } else {
        console.log(`⚠️  Document ${doc.id} has no user identifier fields`);
        skipCount++;
      }
    });

    if (migrationCount > 0) {
      console.log(`\n🚀 Committing ${migrationCount} migrations...`);
      await batch.commit();
      console.log(`✅ Successfully migrated ${migrationCount} documents`);
    } else {
      console.log('\n✅ No documents needed migration');
    }

    console.log(`📊 Migration Summary:`);
    console.log(`   - Documents migrated: ${migrationCount}`);
    console.log(`   - Documents skipped: ${skipCount}`);
    console.log(`   - Total documents: ${snap.size}`);

    // Also check and migrate any analysisJobs collection if it exists
    console.log('\n🔄 Checking for analysisJobs collection...');
    const jobsSnapshot = await adminDb.collection('analysisJobs').limit(1).get();
    
    // Check transactions collection for user_id fields
    console.log('\n🔄 Checking transactions collection for user_id fields...');
    const transactionsSnapshot = await adminDb.collectionGroup('transactions').where('user_id', '!=', null).limit(10).get();
    
    if (!jobsSnapshot.empty) {
      console.log('📊 Found analysisJobs collection. Migrating to analysis_status...\n');
      
      const jobsSnap = await adminDb.collection('analysisJobs').get();
      const jobsBatch = adminDb.batch();
      let jobsMigrationCount = 0;

      jobsSnap.forEach(doc => {
        const data = doc.data();
        
        console.log(`📝 Migrating analysisJob ${doc.id} to analysis_status`);
        
        // Create new document in analysis_status collection
        const newDocRef = adminDb.collection('analysis_status').doc(doc.id);
        const newData = {
          ...data,
          userId: data.userId || data.user_id || data.uid,
          migrated_from: 'analysisJobs',
          migrated_at: FieldValue.serverTimestamp()
        };
        
        // Remove old fields
        if (newData.user_id) delete newData.user_id;
        if (newData.uid && newData.uid !== newData.userId) delete newData.uid;
        
        jobsBatch.set(newDocRef, newData);
        jobsMigrationCount++;
      });

      if (jobsMigrationCount > 0) {
        await jobsBatch.commit();
        console.log(`✅ Migrated ${jobsMigrationCount} analysisJobs to analysis_status`);
      }
    }
    
    // Migrate transactions with user_id to userId
    if (!transactionsSnapshot.empty) {
      console.log(`📊 Found ${transactionsSnapshot.size} transactions with user_id field`);
      console.log('   Note: Transactions migration will be handled by the main backfill process');
      console.log('   as they are stored in user subcollections.');
    }

    console.log('\n🎉 Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Deploy the updated Firestore rules: firebase deploy --only firestore:rules');
    console.log('2. Update your frontend code to use the new analysis-status API');
    console.log('3. Test the transaction analysis workflow');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
backfillUserIdMigration().catch(console.error);
