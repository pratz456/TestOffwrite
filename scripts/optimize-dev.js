#!/usr/bin/env node

/**
 * Development Optimization Script
 * 
 * This script helps optimize the development environment for faster compilation
 */

const fs = require('fs');
const path = require('path');

console.log('🚀 Optimizing development environment...\n');

// 1. Clear Next.js cache
console.log('🧹 Clearing Next.js cache...');
const nextCacheDir = path.join(process.cwd(), '.next');
if (fs.existsSync(nextCacheDir)) {
  fs.rmSync(nextCacheDir, { recursive: true, force: true });
  console.log('✅ Cleared .next cache');
} else {
  console.log('ℹ️  No .next cache found');
}

// 2. Clear TypeScript build info
console.log('🧹 Clearing TypeScript build info...');
const tsBuildInfo = path.join(process.cwd(), 'tsconfig.tsbuildinfo');
if (fs.existsSync(tsBuildInfo)) {
  fs.unlinkSync(tsBuildInfo);
  console.log('✅ Cleared TypeScript build info');
} else {
  console.log('ℹ️  No TypeScript build info found');
}

// 3. Clear Turbo cache
console.log('🧹 Clearing Turbo cache...');
const turboCacheDir = path.join(process.cwd(), '.turbo');
if (fs.existsSync(turboCacheDir)) {
  fs.rmSync(turboCacheDir, { recursive: true, force: true });
  console.log('✅ Cleared Turbo cache');
} else {
  console.log('ℹ️  No Turbo cache found');
}

// 4. Check for large files
console.log('\n📊 Checking for large files...');
const checkLargeFiles = (dir, basePath = '') => {
  const largeFiles = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const relativePath = path.join(basePath, item);
    
    if (['node_modules', '.git', '.next', 'dist', 'build'].includes(item)) {
      continue;
    }
    
    const stats = fs.statSync(fullPath);
    
    if (stats.isDirectory()) {
      largeFiles.push(...checkLargeFiles(fullPath, relativePath));
    } else if (stats.size > 1024 * 1024) { // 1MB
      largeFiles.push({
        path: relativePath,
        size: stats.size,
        sizeMB: (stats.size / 1024 / 1024).toFixed(2)
      });
    }
  }
  
  return largeFiles;
};

const largeFiles = checkLargeFiles(process.cwd());
if (largeFiles.length > 0) {
  console.log('⚠️  Found large files that might slow compilation:');
  largeFiles.forEach(file => {
    console.log(`   ${file.sizeMB}MB - ${file.path}`);
  });
} else {
  console.log('✅ No large files found');
}

// 5. Check package.json for optimization opportunities
console.log('\n📦 Checking package.json...');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

if (packageJson.scripts.dev && packageJson.scripts.dev.includes('--turbopack')) {
  console.log('✅ Turbopack is enabled');
} else {
  console.log('⚠️  Consider enabling Turbopack for faster builds');
}

console.log('\n🎉 Development optimization complete!');
console.log('\n💡 Tips for faster development:');
console.log('   • Use npm run dev to start with Turbopack');
console.log('   • Keep your components small and focused');
console.log('   • Use dynamic imports for large components');
console.log('   • Consider code splitting for better performance');
