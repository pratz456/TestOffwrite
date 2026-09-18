#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Firebase deployment with optimizations...');

// Check Node.js version
const nodeVersion = process.version;
console.log(`📋 Current Node.js version: ${nodeVersion}`);

// Firebase Admin 14 requires Node 22 or newer.
const nodeMajor = Number.parseInt(nodeVersion.slice(1).split('.')[0], 10);
if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
  console.error('❌ Firebase deployment requires Node.js 22 or newer. Current version:', nodeVersion);
  process.exit(1);
}

try {
  // Clean build directory
  console.log('🧹 Cleaning previous build...');
  if (fs.existsSync('.next')) {
    execSync('rm -rf .next', { stdio: 'inherit' });
  }

  // Install dependencies
  console.log('📦 Installing dependencies...');
  execSync('npm ci --production=false', { stdio: 'inherit' });

  // Build the application
  console.log('🔨 Building application...');
  execSync('npm run build', { stdio: 'inherit' });

  // Deploy to Firebase
  console.log('🚀 Deploying to Firebase...');
  execSync('firebase deploy --only hosting,firestore', { stdio: 'inherit' });

  console.log('✅ Deployment completed successfully!');
} catch (error) {
  console.error('❌ Deployment failed:', error.message);
  process.exit(1);
}
