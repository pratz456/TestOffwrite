#!/usr/bin/env node

/**
 * Environment Variable Consistency Checker
 * 
 * This script verifies that client and admin Firebase configurations
 * are properly aligned and consistent.
 */

// Load environment variables
require('dotenv').config({ path: '.env.local' });

console.log('🔍 Verifying Environment Variable Consistency...\n');

// Check required environment variables
const clientVars = {
  'NEXT_PUBLIC_FIREBASE_API_KEY': process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN': process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID': process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET': process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID': process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  'NEXT_PUBLIC_FIREBASE_APP_ID': process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const adminVars = {
  'FIREBASE_ADMIN_PROJECT_ID': process.env.FIREBASE_ADMIN_PROJECT_ID,
  'FIREBASE_ADMIN_CLIENT_EMAIL': process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
  'FIREBASE_ADMIN_PRIVATE_KEY': process.env.FIREBASE_ADMIN_PRIVATE_KEY,
};

console.log('📋 Environment Variable Status:');
console.log('\n🔧 Client SDK Variables (NEXT_PUBLIC_FIREBASE_*):');
let clientIssues = 0;
Object.entries(clientVars).forEach(([key, value]) => {
  if (value) {
    console.log(`   ✅ ${key}: Set`);
  } else {
    console.log(`   ❌ ${key}: Missing`);
    clientIssues++;
  }
});

console.log('\n🔧 Admin SDK Variables (FIREBASE_ADMIN_*):');
let adminIssues = 0;
Object.entries(adminVars).forEach(([key, value]) => {
  if (value) {
    console.log(`   ✅ ${key}: Set`);
  } else {
    console.log(`   ❌ ${key}: Missing`);
    adminIssues++;
  }
});

// Check project ID consistency
console.log('\n🎯 Project ID Consistency Check:');
const clientProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const adminProjectId = process.env.FIREBASE_ADMIN_PROJECT_ID;

if (clientProjectId && adminProjectId) {
  if (clientProjectId === adminProjectId) {
    console.log(`   ✅ Project IDs match: ${clientProjectId}`);
  } else {
    console.log(`   ❌ Project ID mismatch:`);
    console.log(`      Client: ${clientProjectId}`);
    console.log(`      Admin:  ${adminProjectId}`);
  }
} else {
  console.log('   ⚠️  Cannot verify - missing project ID variables');
}

// Check private key format
console.log('\n🔑 Private Key Format Check:');
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
if (privateKey) {
  if (privateKey.includes('-----BEGIN PRIVATE KEY-----') && privateKey.includes('-----END PRIVATE KEY-----')) {
    console.log('   ✅ Private key has proper PEM format');
    
    // Check for proper newline handling
    if (privateKey.includes('\\n')) {
      console.log('   ✅ Private key has \\n sequences (correct for .env files)');
    } else {
      console.log('   ⚠️  Private key may need \\n sequences for proper formatting');
    }
  } else {
    console.log('   ❌ Private key missing PEM headers/footers');
  }
} else {
  console.log('   ❌ No private key found');
}

// Summary
console.log('\n📊 Summary:');
if (clientIssues === 0 && adminIssues === 0) {
  console.log('   ✅ All required environment variables are set');
} else {
  console.log(`   ❌ ${clientIssues + adminIssues} missing environment variables`);
}

if (clientProjectId === adminProjectId && clientProjectId) {
  console.log('   ✅ Project IDs are consistent');
} else {
  console.log('   ❌ Project ID inconsistency detected');
}

if (privateKey && privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
  console.log('   ✅ Private key format is correct');
} else {
  console.log('   ❌ Private key format issues detected');
}

// Overall status
const hasIssues = (clientIssues + adminIssues) > 0 || 
                  clientProjectId !== adminProjectId || 
                  !privateKey || 
                  !privateKey.includes('-----BEGIN PRIVATE KEY-----');

if (!hasIssues) {
  console.log('\n🎉 Environment configuration is ready for go-live!');
  console.log('\n✅ All checks passed:');
  console.log('   - Client SDK variables configured');
  console.log('   - Admin SDK variables configured');
  console.log('   - Project IDs consistent');
  console.log('   - Private key format correct');
} else {
  console.log('\n⚠️  Environment configuration needs attention before go-live');
  console.log('\n📝 Next steps:');
  if (clientIssues > 0 || adminIssues > 0) {
    console.log('   1. Add missing environment variables to .env.local');
  }
  if (clientProjectId !== adminProjectId) {
    console.log('   2. Ensure client and admin use the same project ID');
  }
  if (!privateKey || !privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    console.log('   3. Fix private key format in .env.local');
  }
  process.exit(1);
}
