#!/usr/bin/env node

/**
 * Deploy Firestore Security Rules
 * 
 * This script deploys the updated Firestore security rules to fix
 * the backend errors in transaction analysis workflow.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔥 Deploying Firestore Security Rules...\n');

// Check if Firebase CLI is installed
try {
  execSync('firebase --version', { stdio: 'ignore' });
} catch (error) {
  console.error('❌ Firebase CLI not found. Please install it first:');
  console.error('npm install -g firebase-tools\n');
  process.exit(1);
}

// Check if firestore.rules exists
const rulesPath = path.join(process.cwd(), 'firestore.rules');
if (!fs.existsSync(rulesPath)) {
  console.error('❌ firestore.rules file not found in project root');
  process.exit(1);
}

// Check if user is logged in
try {
  execSync('firebase projects:list', { stdio: 'ignore' });
} catch (error) {
  console.error('❌ Not logged in to Firebase. Please run:');
  console.error('firebase login\n');
  process.exit(1);
}

try {
  console.log('📋 Validating Firestore rules...');
  // Validate rules syntax
  execSync('firebase firestore:rules', { stdio: 'inherit' });
  
  console.log('\n🚀 Deploying rules to Firebase...');
  // Deploy only Firestore rules
  execSync('firebase deploy --only firestore:rules', { stdio: 'inherit' });
  
  console.log('\n✅ Firestore rules deployed successfully!');
  console.log('\n🎉 Backend error fixes are now live:');
  console.log('   - Analysis status collection with proper read/write restrictions');
  console.log('   - TEMPORARY dual-field support (userId + user_id) during migration');
  console.log('   - Server-side analysis updates are now allowed');
  console.log('   - Transaction progress monitoring should work properly');
  console.log('   - No more "Missing or insufficient permissions" errors');
  
  console.log('\n⚠️  IMPORTANT: These are temporary rules for migration:');
  console.log('   1. Run backfill script: node scripts/backfill-userid-migration.js');
  console.log('   2. After migration, run: node scripts/post-migration-cleanup.js');
  console.log('   3. This will update rules to clean userId-only format');
  
} catch (error) {
  console.error('\n❌ Failed to deploy Firestore rules');
  console.error('Error:', error.message);
  console.error('\nPlease check:');
  console.error('1. You have proper permissions for the Firebase project');
  console.error('2. The firestore.rules syntax is valid');
  console.error('3. You are connected to the correct project');
  process.exit(1);
}
