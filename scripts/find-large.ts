#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

interface LargeFile {
  path: string;
  size: number;
  sizeMB: number;
  relativePath: string;
}

const MIN_SIZE_THRESHOLD = 1024 * 1024; // 1MB
const EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.vercel',
  '.firebase',
  '.cache',
  '.turbo',
  'upload_bundles'
];

async function findLargeFiles(dirPath: string, basePath: string = ''): Promise<LargeFile[]> {
  const largeFiles: LargeFile[] = [];
  
  try {
    const items = await readdir(dirPath);
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const relativePath = path.join(basePath, item);
      
      // Skip excluded directories
      if (EXCLUDE_DIRS.includes(item)) {
        continue;
      }
      
      const stats = await stat(fullPath);
      
      if (stats.isDirectory()) {
        // Recursively scan subdirectories
        const subFiles = await findLargeFiles(fullPath, relativePath);
        largeFiles.push(...subFiles);
      } else if (stats.isFile() && stats.size >= MIN_SIZE_THRESHOLD) {
        largeFiles.push({
          path: fullPath,
          size: stats.size,
          sizeMB: stats.size / 1024 / 1024,
          relativePath
        });
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
  }
  
  return largeFiles;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
  } else if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  } else if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)}KB`;
  } else {
    return `${bytes}B`;
  }
}

async function main(): Promise<void> {
  console.log('🔍 Scanning for large files...\n');
  
  const largeFiles = await findLargeFiles(process.cwd());
  
  if (largeFiles.length === 0) {
    console.log('✅ No files larger than 1MB found!');
    return;
  }
  
  // Sort by size (largest first)
  largeFiles.sort((a, b) => b.size - a.size);
  
  console.log(`📊 Found ${largeFiles.length} files larger than 1MB:\n`);
  
  let totalSize = 0;
  
  for (const file of largeFiles) {
    const sizeStr = formatSize(file.size);
    const relativePath = file.relativePath || path.relative(process.cwd(), file.path);
    
    console.log(`${sizeStr.padStart(8)}  ${relativePath}`);
    totalSize += file.size;
  }
  
  console.log('\n' + '─'.repeat(50));
  console.log(`📦 Total size of large files: ${formatSize(totalSize)}`);
  
  // Categorize files
  const categories = {
    'Images': largeFiles.filter(f => /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(f.path)),
    'Build artifacts': largeFiles.filter(f => /\.(map|js|css)$/i.test(f.path) && f.size > 5 * 1024 * 1024),
    'Logs': largeFiles.filter(f => /\.(log|txt)$/i.test(f.path)),
    'Other': largeFiles.filter(f => !/\.(png|jpg|jpeg|gif|svg|webp|map|js|css|log|txt)$/i.test(f.path))
  };
  
  console.log('\n📋 Breakdown by category:');
  for (const [category, files] of Object.entries(categories)) {
    if (files.length > 0) {
      const categorySize = files.reduce((sum, f) => sum + f.size, 0);
      console.log(`  ${category}: ${files.length} files (${formatSize(categorySize)})`);
    }
  }
  
  // Recommendations
  console.log('\n💡 Recommendations:');
  if (categories['Build artifacts'].length > 0) {
    console.log('  • Consider excluding build artifacts (.map, .js, .css files >5MB)');
  }
  if (categories['Logs'].length > 0) {
    console.log('  • Log files can usually be excluded from uploads');
  }
  if (categories['Images'].some(f => f.size > 2 * 1024 * 1024)) {
    console.log('  • Large images (>2MB) might need optimization or exclusion');
  }
}

// Run the script
main().catch((error) => {
  console.error('❌ Error scanning for large files:', error);
  process.exit(1);
});
