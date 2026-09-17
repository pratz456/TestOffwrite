#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Firebase deployment with optimizations...');

// Check Node.js version
const nodeVersion = process.version;
console.log(`📋 Current Node.js version: ${nodeVersion}`);

// Build with the same major version that Firebase runs for the SSR backend.
const requiredNodeMajor = require('../package.json').engines.node;
if (nodeVersion.split('.')[0] !== `v${requiredNodeMajor}`) {
  console.error(`Deployment requires Node.js ${requiredNodeMajor}; current version is ${nodeVersion}.`);
  console.error('Select the version in .nvmrc before deploying.');
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
