#!/usr/bin/env ts-node
/**
 * Script to add missing 'export const dynamic = "force-dynamic"' to API routes
 * This fixes Firebase Hosting deployment warnings for Next.js 16
 */

import * as fs from 'fs';
import * as path from 'path';

const API_ROUTES_DIR = path.join(__dirname, '..', 'app', 'api');

function findRouteFiles(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      findRouteFiles(filePath, fileList);
    } else if (file === 'route.ts') {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

async function fixApiRoutes() {
  console.log('🔍 Scanning API routes for missing dynamic exports...\n');

  // Find all route.ts files in the API directory
  const routeFiles = findRouteFiles(API_ROUTES_DIR);

  let fixedCount = 0;
  let skippedCount = 0;
  const fixedFiles: string[] = [];

  for (const filePath of routeFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Check if file has runtime export
    const hasRuntime = /export\s+const\s+runtime\s*=\s*['"]nodejs['"]/i.test(content);
    
    // Check if file already has dynamic export
    const hasDynamic = /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/i.test(content);
    
    if (hasRuntime && !hasDynamic) {
      // Find the line with runtime export
      const lines = content.split('\n');
      let runtimeLineIndex = -1;
      
      for (let i = 0; i < lines.length; i++) {
        if (/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/i.test(lines[i])) {
          runtimeLineIndex = i;
          break;
        }
      }
      
      if (runtimeLineIndex >= 0) {
        // Insert dynamic export after runtime export
        lines.splice(runtimeLineIndex + 1, 0, "export const dynamic = 'force-dynamic';");
        const newContent = lines.join('\n');
        fs.writeFileSync(filePath, newContent, 'utf-8');
        
        const relativePath = path.relative(process.cwd(), filePath);
        console.log(`✅ Fixed: ${relativePath}`);
        fixedFiles.push(relativePath);
        fixedCount++;
      }
    } else if (!hasRuntime && !hasDynamic) {
      // Route doesn't have runtime export - might need it
      // Check if it's a server-side route (uses NextRequest/NextResponse)
      if (/NextRequest|NextResponse|Request|Response/.test(content)) {
        const relativePath = path.relative(process.cwd(), filePath);
        console.log(`⚠️  Warning: ${relativePath} might need runtime and dynamic exports`);
      }
      skippedCount++;
    } else {
      skippedCount++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Fixed: ${fixedCount} files`);
  console.log(`   ⏭️  Skipped: ${skippedCount} files`);
  
  if (fixedFiles.length > 0) {
    console.log(`\n📝 Fixed files:`);
    fixedFiles.forEach(file => console.log(`   - ${file}`));
  }
  
  console.log('\n✨ Done! API routes are now configured for Firebase Hosting with Next.js 16.');
}

fixApiRoutes().catch(console.error);
