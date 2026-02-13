# Upload Bundle Scripts

These scripts help create clean, optimized upload bundles for your WriteOff app project.

## Scripts

### `make-upload-bundle.ts`
Creates a compressed zip file containing only the essential project files needed for deployment.

**What's included:**
- `app/` - Next.js app directory
- `components/` - React components
- `lib/` - Utility libraries
- `public/` - Public assets (images, etc.)
- Configuration files (package.json, tsconfig.json, next.config.ts, etc.)
- README.md and other essential docs

**What's excluded:**
- `node_modules/` - Dependencies (will be installed from package.json)
- `.git/` - Version control
- `.next/` - Build artifacts
- `dist/`, `build/` - Build outputs
- Test files and logs
- Files larger than 2MB (images limited to 500KB)

**Output:** `upload_bundles/writeoff-{timestamp}.zip`

### `find-large.ts`
Scans your project to identify files larger than 1MB, helping you understand what might be bloating your project size.

**Features:**
- Lists files sorted by size (largest first)
- Categorizes files by type
- Provides size breakdowns
- Offers optimization recommendations

## Usage

### Install dependencies first:
```bash
npm install
```

### Find large files:
```bash
npm run upload:find-large
```

### Create upload bundle:
```bash
npm run upload:bundle
```

## NPM Scripts

```json
{
  "upload:bundle": "ts-node scripts/make-upload-bundle.ts",
  "upload:find-large": "ts-node scripts/find-large.ts"
}
```

## Bundle Contents

The resulting zip file will contain:
- ✅ Source code (app/, components/, lib/)
- ✅ Public assets (public/)
- ✅ Configuration files
- ✅ Package files for dependency installation
- ❌ No build artifacts or dependencies
- ❌ No large files that could cause upload issues

## Target Size

The goal is to create bundles under 100MB that contain only the essential source code and configuration needed to rebuild and deploy your application.

