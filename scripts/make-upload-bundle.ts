#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { promisify } from 'util';

const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);

interface FileInfo {
  path: string;
  size: number;
  relativePath: string;
}

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_IMAGE_SIZE = 500 * 1024; // 500KB for images
const BUNDLE_DIR = 'upload_bundles';

// Directories to include
const INCLUDE_DIRS = [
  'app',
  'components', 
  'lib',
  'public'
];

// Files to include
const INCLUDE_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'next.config.ts',
  'tailwind.config.ts',
  'postcss.config.mjs',
  'eslint.config.mjs',
  'middleware.ts',
  'next-env.d.ts',
  'components.json',
  'README.md',
  'firestore.rules'
];

// Patterns to exclude
const EXCLUDE_PATTERNS = [
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
  '.DS_Store',
  '*.map',
  '**/*.test.*',
  '**/*.spec.*',
  'firebase-debug.log',
  'test-*.html',
  'test-*.js',
  'test-*.ts',
  'tests'
];

// Image extensions that should have smaller size limits
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];

function shouldExclude(filePath: string): boolean {
  const relativePath = path.relative(process.cwd(), filePath);
  
  // Check exclude patterns
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.includes('*')) {
      // Handle glob patterns
      if (pattern === '*.map' && filePath.endsWith('.map')) return true;
      if (pattern === '**/*.test.*' && /\.test\./.test(filePath)) return true;
      if (pattern === '**/*.spec.*' && /\.spec\./.test(filePath)) return true;
    } else {
      // Exact match
      if (relativePath.includes(pattern)) return true;
    }
  }
  
  return false;
}

function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

function getMaxAllowedSize(filePath: string): number {
  if (isImageFile(filePath)) {
    return MAX_IMAGE_SIZE;
  }
  return MAX_FILE_SIZE;
}

async function scanDirectory(dirPath: string, basePath: string = ''): Promise<FileInfo[]> {
  const files: FileInfo[] = [];
  
  try {
    const items = await fs.promises.readdir(dirPath);
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const relativePath = path.join(basePath, item);
      
      if (shouldExclude(fullPath)) {
        continue;
      }
      
      const stats = await stat(fullPath);
      
      if (stats.isDirectory()) {
        // Recursively scan subdirectories
        const subFiles = await scanDirectory(fullPath, relativePath);
        files.push(...subFiles);
      } else if (stats.isFile()) {
        const maxSize = getMaxAllowedSize(fullPath);
        
        if (stats.size <= maxSize) {
          files.push({
            path: fullPath,
            size: stats.size,
            relativePath
          });
        } else {
          console.log(`⚠️  Skipping large file: ${relativePath} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
  }
  
  return files;
}

async function createUploadBundle(): Promise<void> {
  console.log('🚀 Creating upload bundle...');
  
  // Create bundle directory
  await mkdir(BUNDLE_DIR, { recursive: true });
  
  // Generate timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const bundleName = `writeoff-${timestamp}.zip`;
  const bundlePath = path.join(BUNDLE_DIR, bundleName);
  
  // Create zip archive
  const output = fs.createWriteStream(bundlePath);
  const archive = archiver('zip', {
    zlib: { level: 9 } // Maximum compression
  });
  
  output.on('close', () => {
    const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
    console.log(`✅ Bundle created: ${bundleName}`);
    console.log(`📦 Total size: ${sizeMB}MB`);
    console.log(`📍 Location: ${bundlePath}`);
  });
  
  archive.on('error', (err: Error) => {
    throw err;
  });
  
  archive.pipe(output);
  
  // Add include directories
  for (const dir of INCLUDE_DIRS) {
    if (fs.existsSync(dir)) {
      console.log(`📁 Adding directory: ${dir}`);
      const files = await scanDirectory(dir, dir);
      
      for (const file of files) {
        archive.file(file.path, { name: file.relativePath });
      }
      
      console.log(`   Added ${files.length} files from ${dir}`);
    } else {
      console.log(`⚠️  Directory not found: ${dir}`);
    }
  }
  
  // Add include files
  for (const file of INCLUDE_FILES) {
    if (fs.existsSync(file)) {
      console.log(`📄 Adding file: ${file}`);
      archive.file(file, { name: file });
    } else {
      console.log(`⚠️  File not found: ${file}`);
    }
  }
  
  // Finalize archive
  await archive.finalize();
}

// Run the script
createUploadBundle().catch((error) => {
  console.error('❌ Error creating upload bundle:', error);
  process.exit(1);
});
