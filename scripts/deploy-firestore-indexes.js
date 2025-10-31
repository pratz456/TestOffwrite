#!/usr/bin/env node

/**
 * Deploy Firestore Indexes
 * 
 * This script deploys the required composite indexes for analysis_status queries.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('📊 Deploying Firestore Indexes...\n');

// Check if Firebase CLI is installed
try {
  execSync('firebase --version', { stdio: 'ignore' });
} catch (error) {
  console.error('❌ Firebase CLI not found. Please install it first:');
  console.error('npm install -g firebase-tools\n');
  process.exit(1);
}

// Check if firestore.indexes.json exists
const indexesPath = path.join(process.cwd(), 'firestore.indexes.json');
if (!fs.existsSync(indexesPath)) {
  console.error('❌ firestore.indexes.json file not found in project root');
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
  console.log('📋 Deploying Firestore indexes...');
  
  // Deploy only Firestore indexes
  execSync('firebase deploy --only firestore:indexes', { stdio: 'inherit' });
  
  console.log('\n✅ Firestore indexes deployed successfully!');
  console.log('\n🎉 Required indexes are now live:');
  console.log('   - analysis_status: status + userId + created_at');
  console.log('   - analysis_status: userId + created_at (for latest job queries)');
  
  console.log('\n📊 Index Details:');
  console.log('   Collection: analysis_status');
  console.log('   Index 1: status (ASC) + userId (ASC) + created_at (DESC)');
  console.log('   Index 2: userId (ASC) + created_at (DESC)');
  
  console.log('\n⚠️  Note: Index creation may take a few minutes.');
  console.log('   Your queries will work once the indexes are built.');
  
} catch (error) {
  console.error('\n❌ Failed to deploy Firestore indexes');
  console.error('Error:', error.message);
  console.error('\nPlease check:');
  console.error('1. You have proper permissions for the Firebase project');
  console.error('2. The firestore.indexes.json syntax is valid');
  console.error('3. You are connected to the correct project');
  process.exit(1);
}