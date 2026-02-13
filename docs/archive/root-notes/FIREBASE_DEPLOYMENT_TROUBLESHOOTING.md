# Firebase Deployment Troubleshooting - Next.js 16

## Current Issue

Deployment fails with "An unexpected error has occurred" during Cloud Function creation, even after:
- ✅ Adding `export const dynamic = 'force-dynamic'` to API routes
- ✅ Removing `output: "standalone"` from next.config.ts
- ✅ Build completes successfully

## Debug Steps

### 1. Get Detailed Error Information

Run with debug flag to see the actual error:
```bash
firebase deploy --only hosting --debug
```

This will show the full stack trace and error details.

### 2. Check Firebase CLI Version

Firebase Hosting frameworks integration requires Firebase CLI 12.1.0 or later:
```bash
firebase --version
```

If outdated, update:
```bash
npm install -g firebase-tools@latest
```

### 3. Verify Web Frameworks Experiment

Ensure the web frameworks experiment is enabled:
```bash
firebase experiments:enable webframeworks
```

### 4. Check Billing Status

SSR and Cloud Functions require billing to be enabled on your Firebase project. Verify in:
- Firebase Console → Project Settings → Usage and billing

### 5. Check Node.js Version

Firebase recommends Node.js 20 for optimal compatibility:
```bash
node --version
```

If not using Node 20, switch:
```bash
nvm use 20.18.0  # or your Node 20 version
```

### 6. Check for Known Issues

Common causes of "unexpected error" during Cloud Function creation:

#### a) Package Size Limits
- Cloud Functions have size limits
- Check if `node_modules` or build output is too large
- Try cleaning and rebuilding:
  ```bash
  rm -rf .next node_modules
  npm ci
  npm run build
  ```

#### b) Missing Dependencies
- Ensure all dependencies are in `package.json` (not just devDependencies)
- Firebase Functions need production dependencies

#### c) Environment Variables
- Check if required environment variables are set in Firebase Console
- Go to: Firebase Console → Hosting → Environment variables

#### d) Region Configuration
- Verify the region in `firebase.json` is valid:
  ```json
  "frameworksBackend": {
    "region": "us-central1"
  }
  ```
- Supported regions: `us-central1`, `us-east1`, `europe-west1`, `asia-northeast1`

### 7. Try Alternative Deployment Method

If the frameworks integration continues to fail, try deploying without it:

1. **Build manually:**
   ```bash
   npm run build
   ```

2. **Export static pages (if applicable):**
   ```bash
   npm run export  # if you have static export configured
   ```

3. **Deploy to Firebase Hosting directly:**
   ```bash
   firebase deploy --only hosting
   ```

   Note: This won't work for SSR/API routes - you'd need Cloud Functions separately.

### 8. Check Firebase Console Logs

1. Go to Firebase Console → Functions
2. Check for any error logs or failed function deployments
3. Look for quota or permission errors

### 9. Verify Project Configuration

Check `.firebaserc`:
```bash
cat .firebaserc
```

Ensure the project ID is correct:
```bash
firebase use
```

### 10. Try Minimal Test Deployment

Create a minimal test to isolate the issue:

1. Create a simple API route:
   ```typescript
   // app/api/test/route.ts
   export const runtime = 'nodejs';
   export const dynamic = 'force-dynamic';
   
   export async function GET() {
     return Response.json({ message: 'test' });
   }
   ```

2. Try deploying just this route to see if the issue is specific to certain routes.

## Alternative Solutions

### Option 1: Migrate to Firebase App Hosting

Firebase App Hosting has official support for Next.js 16+ and is recommended for full-stack applications:

1. Review: https://firebase.google.com/docs/app-hosting/get-started
2. This requires a different configuration but provides better support

### Option 2: Use Vercel or Other Platform

If Firebase continues to have issues:
- Vercel has first-class Next.js support
- Netlify also supports Next.js well
- Both have better Next.js 16 compatibility

### Option 3: Downgrade to Next.js 15.x

As a last resort (not recommended):
- Next.js 15.x is officially supported by Firebase Hosting frameworks
- Would require code changes and losing Next.js 16 features

## Next Steps

1. **Run with --debug flag first:**
   ```bash
   firebase deploy --only hosting --debug > deploy-debug.log 2>&1
   ```
   This will capture all debug output to a file.

2. **Share the debug output** to identify the specific error.

3. **Check Firebase Console** for any quota or permission issues.

4. **Consider Firebase App Hosting** if the experimental integration continues to fail.

## Related Files

- `FIREBASE_DEPLOYMENT_FIX.md` - Initial fixes applied
- `FIREBASE_DEPLOYMENT_ERROR_FIX.md` - Standalone output fix
- `FIREBASE_NEXTJS_COMPATIBILITY.md` - Compatibility information
