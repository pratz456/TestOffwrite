# 🔥 Firebase Deployment Fixes - Complete Guide

## Issues Fixed

This document addresses the three main issues encountered when deploying to Firebase:

1. ✅ **Domain Integration** - App not integrating with `writeoffapp.com`
2. ✅ **Bank Accounts Not Visible** - Connected bank accounts not showing up
3. ✅ **Limited Transaction History** - Only getting records from 1 month ago

---

## 1. Domain Integration Fix ✅

### Problem
The app wasn't properly configured to work with the custom domain `writeoffapp.com`. Firebase Authentication wasn't recognizing the custom domain.

### Solution Applied
- **File Modified**: `lib/firebase/client.ts`
- **Change**: Added dynamic `authDomain` detection based on the current hostname
- **How it works**:
  - Detects if running on `writeoffapp.com` or `www.writeoffapp.com`
  - Uses the custom domain for Firebase Auth when on custom domain
  - Falls back to Firebase default domain otherwise

### Manual Configuration Required

**In Firebase Console:**

1. Go to [Firebase Console](https://console.firebase.google.com/project/writeoff-23910)
2. Navigate to **Authentication** → **Settings** → **Authorized domains**
3. Ensure these domains are added:
   - ✅ `writeoffapp.com`
   - ✅ `www.writeoffapp.com`
   - ✅ `writeoff-23910.web.app`
   - ✅ `writeoff-23910.firebaseapp.com`
   - ✅ `localhost` (for development)

4. **Environment Variable**: Set `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` in your deployment:
   ```env
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=writeoffapp.com
   ```

**In Firebase Hosting:**

1. Go to **Hosting** → **Add custom domain**
2. Add `writeoffapp.com` if not already added
3. Configure DNS records as instructed
4. Ensure SSL certificate is active

---

## 2. Bank Accounts Not Visible Fix ✅

### Problem
Connected bank accounts were not appearing in the UI after connecting via Plaid.

### Root Cause
Accounts were being stored in `exchange-public-token` route but:
- Not all required fields were being saved (missing `type`, `subtype`, `institution_id`)
- Only one account was being stored instead of all accounts returned by Plaid
- Account structure didn't match what the UI expected

### Solution Applied
- **File Modified**: `app/api/plaid/exchange-public-token/route.ts`
- **Changes**:
  1. **Store ALL accounts** returned by Plaid, not just one
  2. **Include all required fields**: `account_id`, `name`, `mask`, `type`, `subtype`, `institution_id`, `user_id`
  3. **Fetch institution ID** from Plaid to properly identify the bank
  4. **Proper date fields**: Added `created_at` and `updated_at` timestamps

### Code Changes
```typescript
// Now stores ALL accounts with complete information
for (const plaidAccount of allAccounts) {
  await accountRef.set({
    id: accountId,
    account_id: accountId,
    name: plaidAccount.name ?? plaidAccount.official_name,
    mask: plaidAccount.mask ?? null,
    type: plaidAccount.type || 'depository',
    subtype: plaidAccount.subtype || 'checking',
    institution_id: institutionId || '',
    user_id: uid,
    createdAt: Date.now(),
    created_at: new Date(),
    updated_at: new Date(),
  }, { merge: true });
}
```

### Verification Steps
1. Connect a bank account via Plaid
2. Check Firebase Console → Firestore → `user_profiles/{userId}/accounts/`
3. Verify all accounts are stored with complete fields
4. Check UI - all connected accounts should now be visible

---

## 3. Transaction History Limited to 1 Month Fix ✅

### Problem
Only transactions from the last 1 month were being imported, instead of a full year.

### Root Cause
Multiple places in the code had default import timeframes set to `'6months'` or `'1month'`, limiting historical data.

### Solution Applied
Changed default import timeframe from `'6months'` to `'1year'` in:

1. **File**: `app/api/plaid/exchange-public-token/route.ts`
   - Changed: `import_timeframe = '6months'` → `import_timeframe = '1year'`

2. **File**: `app/api/plaid/import-transactions/route.ts`
   - Changed: `import_timeframe = '6months'` → `import_timeframe = '1year'`

3. **File**: `lib/plaid/sync-helper.ts`
   - Changed: `importTimeframe: string = '6months'` → `importTimeframe: string = '1year'`

4. **File**: `lib/plaid/transactions.ts`
   - Changed: `startDate.setMonth(endDate.getMonth() - 6)` → `startDate.setFullYear(endDate.getFullYear() - 1)`

### Impact
- **Before**: Only 1-6 months of transaction history
- **After**: Full 1 year of transaction history (up to Plaid's limits)

### Note
Users can still manually specify different timeframes:
- `'1month'` - Last 1 month
- `'6months'` - Last 6 months
- `'1year'` - Last 1 year (now default)

---

## Deployment Checklist

### Before Deploying
- [ ] All code changes are committed
- [ ] Environment variables are set in Firebase Hosting
- [ ] Firebase Console domains are configured

### Firebase Console Configuration
- [ ] `writeoffapp.com` added to Authorized Domains
- [ ] Custom domain is connected in Hosting
- [ ] SSL certificate is active
- [ ] Firestore rules are deployed
- [ ] Storage rules are deployed

### Environment Variables (Firebase Hosting)
Set these in Firebase Hosting environment variables:
```env
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=writeoffapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=writeoff-23910
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=writeoff-23910.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=930596534802
NEXT_PUBLIC_FIREBASE_APP_ID=1:930596534802:web:e4c7c12ead77a9d92336cb
FIREBASE_ADMIN_PROJECT_ID=writeoff-23910
FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-fbsvc@writeoff-23910.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
PLAID_CLIENT_ID=your_plaid_client_id
PLAID_SECRET=your_plaid_secret
PLAID_ENV=production
```

### Deploy Commands
```bash
# Deploy everything
firebase deploy

# Or deploy specific services
firebase deploy --only hosting
firebase deploy --only firestore:rules
firebase deploy --only storage:rules
```

---

## Testing After Deployment

### 1. Domain Integration Test
- [ ] Visit `https://writeoffapp.com`
- [ ] Verify no redirect loops
- [ ] Sign in works correctly
- [ ] Protected routes accessible after sign in

### 2. Bank Account Visibility Test
- [ ] Connect a bank account via Plaid
- [ ] Verify account appears in "Connected Banks" screen
- [ ] Check that all account details are visible (name, type, last 4 digits)
- [ ] Verify multiple accounts (if connected) all appear

### 3. Transaction History Test
- [ ] Connect a bank account with transaction history
- [ ] Verify transactions from the past year are imported
- [ ] Check transaction dates in the UI
- [ ] Verify older transactions (6+ months) are visible

---

## Troubleshooting

### Domain Issues
**Problem**: Still redirecting or auth not working on custom domain
**Solution**:
1. Clear browser cache and cookies
2. Verify `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` is set correctly
3. Check Firebase Console → Authentication → Authorized domains
4. Verify DNS records are correct

### Bank Accounts Still Not Showing
**Problem**: Connected account doesn't appear in UI
**Solution**:
1. Check Firebase Console → Firestore → `user_profiles/{userId}/accounts/`
2. Verify account document has all required fields
3. Check browser console for API errors
4. Try disconnecting and reconnecting the bank account

### Limited Transaction History
**Problem**: Still only seeing recent transactions
**Solution**:
1. Disconnect and reconnect bank account (this will re-import with new default)
2. Or manually trigger sync with `import_timeframe: '1year'`
3. Check Firebase Console → Firestore for transaction dates
4. Verify Plaid account actually has historical data available

---

## Files Modified

1. ✅ `lib/firebase/client.ts` - Dynamic auth domain detection
2. ✅ `app/api/plaid/exchange-public-token/route.ts` - Store all accounts with complete fields, default 1 year
3. ✅ `app/api/plaid/import-transactions/route.ts` - Default 1 year timeframe
4. ✅ `lib/plaid/sync-helper.ts` - Default 1 year timeframe
5. ✅ `lib/plaid/transactions.ts` - Default 1 year date range

---

## Next Steps

1. **Deploy the changes** to Firebase
2. **Configure Firebase Console** as outlined above
3. **Test all three fixes** on production
4. **Monitor logs** for any issues
5. **Update users** if re-connection is needed for full transaction history

---

## Support

If issues persist after following this guide:
1. Check Firebase Hosting logs
2. Check browser console for errors
3. Verify Firestore data structure
4. Review Plaid API logs for transaction import issues
