# 🚀 Deploy to writeoffapp.com - Complete Guide

This guide will help you deploy your WriteOff app to Firebase with the custom domain `writeoffapp.com`.

## Prerequisites

1. ✅ Firebase CLI installed (`firebase --version` should show version)
2. ✅ Logged into Firebase (`firebase login`)
3. ✅ Project configured: `writeoff-23910`
4. ✅ Domain `writeoffapp.com` registered and DNS configured

## Step 1: Verify Firebase Login

```bash
firebase login
```

If not logged in, you'll be prompted to authenticate via browser.

## Step 2: Verify Project Configuration

```bash
firebase use writeoff-23910
```

## Step 3: Configure Custom Domain in Firebase Console

**IMPORTANT:** Before deploying, ensure the custom domain is configured:

1. Go to [Firebase Console](https://console.firebase.google.com/project/writeoff-23910/hosting)
2. Click **"Add custom domain"** or verify `writeoffapp.com` is already added
3. Follow DNS configuration instructions:
   - Add A records pointing to Firebase hosting IPs
   - Or add CNAME records as instructed
4. Wait for SSL certificate provisioning (can take a few minutes to hours)

## Step 4: Build and Deploy

### Option A: Use the deployment script (Recommended)

```bash
npm run deploy
```

This will:
- Clean previous builds
- Install dependencies
- Build the Next.js application
- Deploy to Firebase (hosting + firestore rules)

### Option B: Manual deployment

```bash
# Clean build
rm -rf .next

# Install dependencies
npm ci

# Build the application
npm run build

# Deploy to Firebase
firebase deploy --only hosting,firestore
```

## Step 5: Verify Deployment

After deployment completes:

1. **Check Firebase Hosting:**
   - Visit: https://writeoff-23910.web.app
   - Should redirect to https://writeoffapp.com

2. **Check Custom Domain:**
   - Visit: https://writeoffapp.com
   - Should show your application

3. **Check SSL Certificate:**
   - Verify the lock icon in browser
   - Certificate should be valid

## Step 6: Verify Domain Configuration

### In Firebase Console:

1. **Hosting → Custom domains:**
   - `writeoffapp.com` should be listed
   - Status should be "Connected" (green checkmark)
   - SSL certificate should be "Active"

2. **Authentication → Settings → Authorized domains:**
   - Ensure `writeoffapp.com` is listed
   - Ensure `www.writeoffapp.com` is listed (if using)

## Troubleshooting

### Domain not working?

1. **Check DNS records:**
   ```bash
   # Check A records
   dig writeoffapp.com

   # Check CNAME (if using)
   dig www.writeoffapp.com
   ```

2. **Verify in Firebase Console:**
   - Hosting → Custom domains → Check status
   - Look for any error messages

3. **SSL Certificate issues:**
   - Wait 24-48 hours for certificate provisioning
   - Check Firebase Console for certificate status

### Build fails?

1. **Check Node.js version:**
   ```bash
   node --version  # Should be v20.x
   ```

2. **Clear cache and rebuild:**
   ```bash
   rm -rf .next node_modules
   npm ci
   npm run build
   ```

### Deployment fails?

1. **Check Firebase CLI version:**
   ```bash
   firebase --version  # Should be latest
   npm install -g firebase-tools  # Update if needed
   ```

2. **Check authentication:**
   ```bash
   firebase projects:list  # Should show your project
   ```

## Environment Variables

Ensure these are set in Firebase Hosting environment:

1. Go to Firebase Console → Hosting → Environment variables
2. Add all `NEXT_PUBLIC_*` variables
3. Add all server-side variables (for Cloud Functions/Backend)

## Post-Deployment Checklist

- [ ] Application loads at https://writeoffapp.com
- [ ] SSL certificate is active (lock icon in browser)
- [ ] Authentication works (login/signup)
- [ ] All API routes work correctly
- [ ] Firestore rules are deployed
- [ ] Custom domain redirects work (www → non-www)
- [ ] Firebase default domains redirect to custom domain

## Quick Deploy Command

For future deployments, simply run:

```bash
npm run deploy
```

Or for faster deployment (if already built):

```bash
firebase deploy --only hosting,firestore
```

## Notes

- The `firebase.json` is configured for Firebase Frameworks (Next.js)
- The deployment uses `frameworksBackend` which handles Next.js automatically
- Custom domain must be configured in Firebase Console before deployment
- SSL certificates are automatically provisioned by Firebase

