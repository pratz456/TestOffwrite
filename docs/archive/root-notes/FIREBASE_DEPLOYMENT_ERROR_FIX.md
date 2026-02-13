# Firebase Deployment Error Fix - "An unexpected error has occurred"

## Problem

After adding `export const dynamic = 'force-dynamic'` to API routes, deployment still fails with:
```
Building a Cloud Function to run this application. This is needed due to:
 • non-static component /api/accounts/[accountId]/mark-personal/route
 • non-static component /api/accounts/[accountId]/usage/route
 • non-static component /api/accounts/route
 • non-static component /api/ai/analyze-transaction/route
 • non-static component /api/ai/parse-voice-command/route
 • and 84 other reasons, use --debug to see more

Error: An unexpected error has occurred.
```

## Root Cause

The `output: "standalone"` configuration in `next.config.ts` is **incompatible** with Firebase Hosting's frameworks integration. Firebase Hosting expects to manage the build output itself and create Cloud Functions automatically. The standalone output mode conflicts with this process.

## Solution Applied

**Removed `output: "standalone"` from `next.config.ts`**

Firebase Hosting's frameworks integration will:
- Automatically detect Next.js
- Build the application appropriately
- Create necessary Cloud Functions for dynamic routes
- Handle the deployment process

## Changes Made

### `next.config.ts`
```typescript
// Before:
output: "standalone",

// After:
// Note: output: "standalone" is not compatible with Firebase Hosting frameworks integration
// Firebase handles the build output automatically
// output: "standalone",
```

## Next Steps

1. **Try deploying again:**
   ```bash
   npm run build
   firebase deploy --only hosting
   ```

2. **If errors persist, try with debug flag:**
   ```bash
   firebase deploy --only hosting --debug
   ```
   This will provide more detailed error information.

3. **Alternative: Use Firebase App Hosting**
   If the experimental frameworks integration continues to have issues, consider migrating to Firebase App Hosting, which has official support for Next.js 16+.

## Why This Happens

Firebase Hosting's experimental frameworks integration:
- Automatically detects and builds Next.js applications
- Creates Cloud Functions for dynamic routes (API routes, SSR pages)
- Manages the deployment process end-to-end

When `output: "standalone"` is set, Next.js creates a self-contained build that Firebase cannot properly integrate with its Cloud Functions setup, causing the deployment to fail.

## Related Issues

- The "non-static component" warnings are expected and normal - Firebase is correctly detecting dynamic routes
- The actual error occurs during Cloud Function creation, which fails due to the incompatible build output

## Verification

After removing `output: "standalone"`, the deployment should:
1. Build successfully
2. Create Cloud Functions for dynamic routes automatically
3. Deploy without the "unexpected error"

If issues persist, the debug flag will provide more information about what's failing during the Cloud Function creation process.
