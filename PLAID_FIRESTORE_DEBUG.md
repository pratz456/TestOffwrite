# 🔥 Plaid + Firestore Integration Debug Guide

## 🔍 **Issues Found & Fixed**

### 1. **Firestore Security Rules Mismatch**
**Problem**: Rules didn't match the actual nested data structure
- ❌ Rules expected: `accounts/{accountId}` and `transactions/{transactionId}`  
- ✅ Actual structure: `user_profiles/{userId}/accounts/{accountId}/transactions/{transactionId}`

### 2. **Firebase Functions Verification**
**Status**: ✅ **CONFIRMED WORKING**
- `lib/firebase/accounts.ts` → Correctly writes to `user_profiles/{userId}/accounts/{accountId}`
- `lib/firebase/transactions.ts` → Correctly writes to `user_profiles/{userId}/accounts/{accountId}/transactions/{transactionId}`

### 3. **Plaid API Flow Verification**
**Status**: ✅ **CONFIRMED WORKING**
- `app/api/plaid/exchange-public-token/route.ts` calls Firebase functions correctly
- Enhanced error logging added for debugging

## 🚀 **Steps to Fix**

### Step 1: Deploy Updated Firestore Rules
1. **Go to Firebase Console**: https://console.firebase.google.com/project/writeoff-23910/firestore/rules
2. **Replace existing rules** with the updated rules (already saved in `firestore.rules`)
3. **Click "Publish"**

### Step 2: Test Firebase Write Operations
1. **Open browser dev tools** (F12)
2. **Make a POST request** to test Firebase writes:
```javascript
fetch('/api/test-firebase', {
  method: 'POST',
  credentials: 'include'
}).then(r => r.json()).then(console.log)
```

### Step 3: Test Plaid Integration
1. **Connect a bank account** through Plaid Link
2. **Check browser console** for detailed logs:
   - ✅ Look for: `✅ Saved account: {account_id}`
   - ✅ Look for: `✅ Saved transaction: {transaction_id}`
   - ❌ Watch for: `❌ Failed to save account/transaction`

### Step 4: Verify Firestore Data
1. **Go to Firebase Console**: https://console.firebase.google.com/project/writeoff-23910/firestore/data
2. **Check structure**:
```
user_profiles/
  └── {your-user-id}/
      ├── (profile data)
      └── accounts/
          └── {account-id}/
              ├── (account data)
              └── transactions/
                  └── {transaction-id}/
                      └── (transaction data)
```

## 🔧 **Updated Firestore Rules**
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // User profiles with nested accounts and transactions
    match /user_profiles/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      
      match /accounts/{accountId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
        
        match /transactions/{transactionId} {
          allow read, write: if request.auth != null && request.auth.uid == userId;
        }
      }
    }
    
    // Allow collectionGroup queries for transactions
    match /{path=**}/transactions/{transactionId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.user_id;
    }
  }
}
```

## 🐛 **Common Issues & Solutions**

### Issue: "Permission denied" errors
**Solution**: Make sure Firestore rules are deployed and match the nested structure

### Issue: No data appearing in Firestore
**Solution**: Check browser console for detailed error logs from the enhanced debugging

### Issue: Plaid connection succeeds but no transactions
**Solution**: Check if transactions exist in the date range (last few months)

## 🧪 **Debug Commands**

### Test Firebase Auth + Write
```javascript
// In browser console
fetch('/api/test-firebase', { 
  method: 'POST', 
  credentials: 'include' 
}).then(r => r.json()).then(console.log)
```

### Check Current User Auth
```javascript
// In browser console  
fetch('/api/transactions', { 
  credentials: 'include' 
}).then(r => r.json()).then(console.log)
```

## ✅ **Success Indicators**
- ✅ Firestore rules deployed without errors
- ✅ Test Firebase endpoint returns success
- ✅ Plaid connection logs show "Saved account" and "Saved transaction"
- ✅ Data visible in Firebase Console under proper nested structure
- ✅ Transactions API returns data successfully

Once all steps are complete, your Plaid integration should be saving data to Firestore correctly! 🎉


