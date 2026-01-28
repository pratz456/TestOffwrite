#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Clean Next.js build cache (.next directory)
 * Handles Windows file locking issues with retries
 */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function removeDir(dirPath, retries = 3) {
  if (!fs.existsSync(dirPath)) {
    console.log(`ℹ️  ${dirPath} not found, nothing to clean`);
    return true;
  }

  for (let i = 0; i < retries; i++) {
    try {
      // On Windows, sometimes we need to wait a bit for file handles to be released
      if (i > 0) {
        console.log(`⏳ Retrying... (attempt ${i + 1}/${retries})`);
        await sleep(1000 * i); // Exponential backoff
      }

      fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      console.log(`✅ Successfully cleaned ${dirPath}`);
      return true;
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'ENOENT') {
        if (i === retries - 1) {
          console.error(`❌ Failed to delete ${dirPath} after ${retries} attempts`);
          console.error(`   Error: ${error.message}`);
          console.error(`\n💡 Solution:`);
          console.error(`   1. Make sure the dev server is stopped (Ctrl+C)`);
          console.error(`   2. Close any file explorers or IDEs that might have the folder open`);
          console.error(`   3. Try running: npm run clean`);
          console.error(`   4. Or manually delete the .next folder`);
          return false;
        }
        // Continue to retry
      } else {
        console.error(`❌ Unexpected error: ${error.message}`);
        return false;
      }
    }
  }
  return false;
}

async function main() {
  const dirs = process.argv.slice(2);
  
  if (dirs.length === 0) {
    // Default: clean .next directory
    dirs.push('.next');
  }

  console.log('🧹 Cleaning Next.js build cache...\n');

  let allSuccess = true;
  for (const dir of dirs) {
    const success = await removeDir(dir);
    if (!success) {
      allSuccess = false;
    }
  }

  if (allSuccess) {
    console.log('\n✨ Cleanup complete!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Cleanup completed with errors. See above for details.');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
