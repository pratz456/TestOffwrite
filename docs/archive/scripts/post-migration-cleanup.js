#!/usr/bin/env node

/**
 * Post-Migration Cleanup Script
 * 
 * This script updates the Firestore rules back to the clean version
 * after the userId migration is complete.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🧹 Post-Migration Cleanup: Updating Firestore Rules...\n');

// Check if Firebase CLI is installed
try {
  execSync('firebase --version', { stdio: 'ignore' });
} catch (error) {
  console.error('❌ Firebase CLI not found. Please install it first:');
  console.error('npm install -g firebase-tools\n');
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

// Read current firestore.rules
const rulesPath = path.join(process.cwd(), 'firestore.rules');
if (!fs.existsSync(rulesPath)) {
  console.error('❌ firestore.rules file not found in project root');
  process.exit(1);
}

const currentRules = fs.readFileSync(rulesPath, 'utf8');

// Check if rules still have the temporary dual-field logic
if (currentRules.includes('|| resource.data.user_id == request.auth.uid')) {
  console.log('⚠️  Warning: Rules still contain temporary dual-field logic');
  console.log('   This means the migration may not be complete yet.');
  console.log('   Please run the backfill script first: node scripts/backfill-userid-migration.js\n');
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  rl.question('Do you want to proceed anyway? (y/N): ', (answer) => {
    rl.close();
    
    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      updateRulesToClean();
    } else {
      console.log('❌ Cleanup cancelled. Please complete the migration first.');
      process.exit(1);
    }
  });
} else {
  console.log('✅ Rules already use the clean userId-only format');
  console.log('   No cleanup needed.');
}

function updateRulesToClean() {
  try {
    console.log('📝 Updating Firestore rules to clean version...');
    
    // Update the rules to remove the temporary dual-field logic
    const cleanRules = currentRules.replace(
      /allow read: if request\.auth != null\s+&& \(resource\.data\.userId == request\.auth\.uid\s+\|\| resource\.data\.user_id == request\.auth\.uid\);/g,
      'allow read: if request.auth != null && resource.data.userId == request.auth.uid;'
    );
    
    // Write the clean rules back to file
    fs.writeFileSync(rulesPath, cleanRules);
    console.log('✅ Rules file updated to clean version');
    
    // Deploy the clean rules
    console.log('\n🚀 Deploying clean Firestore rules...');
    execSync('firebase deploy --only firestore:rules', { stdio: 'inherit' });
    
    console.log('\n🎉 Post-migration cleanup completed successfully!');
    console.log('\n✅ Firestore rules now use clean userId-only format');
    console.log('✅ Migration is complete');
    console.log('✅ No more temporary dual-field logic');
    
    console.log('\n📋 Summary:');
    console.log('   - All documents now use standardized userId field');
    console.log('   - Firestore rules are clean and optimized');
    console.log('   - No more backward compatibility with old field names');
    console.log('   - System is ready for production use');
    
  } catch (error) {
    console.error('\n❌ Failed to update rules:', error.message);
    console.error('\nPlease check:');
    console.error('1. You have proper permissions for the Firebase project');
    console.error('2. The firestore.rules syntax is valid');
    console.error('3. You are connected to the correct project');
    process.exit(1);
  }
}
