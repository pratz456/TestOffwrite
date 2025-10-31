#!/usr/bin/env node

// Simple script to test Firebase configuration
const fs = require('fs');
const path = require('path');

console.log('🔥 Firebase Setup Checker\n');

// Check if .env.local exists
const envPath = path.join(process.cwd(), '.env.local');
if (!fs.existsSync(envPath)) {
  console.log('❌ .env.local file not found');
  console.log('📝 Create .env.local file in your project root');
  process.exit(1);
}

// Read .env.local
const envContent = fs.readFileSync(envPath, 'utf8');

// Check required environment variables
const requiredVars = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'FIREBASE_ADMIN_PROJECT_ID',
  'FIREBASE_ADMIN_CLIENT_EMAIL',
  'FIREBASE_ADMIN_PRIVATE_KEY'
];

let allConfigured = true;

console.log('Checking environment variables:\n');

requiredVars.forEach(varName => {
  const hasVar = envContent.includes(`${varName}=`) && 
                 !envContent.includes(`${varName}=your_`) && 
                 !envContent.includes(`${varName}=PASTE_`);
  
  if (hasVar) {
    console.log(`✅ ${varName}`);
  } else {
    console.log(`❌ ${varName} - needs configuration`);
    allConfigured = false;
  }
});

console.log('\n' + '='.repeat(50));

if (allConfigured) {
  console.log('🎉 All Firebase environment variables are configured!');
  console.log('🚀 You can now test the authentication flow');
  console.log('\nNext steps:');
  console.log('1. npm run dev');
  console.log('2. Go to http://localhost:3000/auth/sign-up');
  console.log('3. Create a test account');
  console.log('4. Check your email for verification');
} else {
  console.log('⚠️  Some environment variables need configuration');
  console.log('📖 See FIREBASE_SETUP.md for detailed instructions');
  console.log('\nQuick checklist:');
  console.log('1. Copy client-side config from Firebase Console');
  console.log('2. Add your private key from service account JSON');
  console.log('3. Run this script again to verify');
}

console.log('\n📚 For help: check FIREBASE_SETUP.md');


