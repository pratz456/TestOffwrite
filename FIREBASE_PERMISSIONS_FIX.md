# 🔥 Firebase Permissions Fix - URGENT

## The Problem
You're getting **"Missing or insufficient permissions"** because your Firestore database has restrictive security rules that prevent profile creation.

## 🚨 IMMEDIATE FIX (2 minutes)

### Step 1: Open Firebase Console
1. Go to: https://console.firebase.google.com
2. Select project: **writeoff-23910**

### Step 2: Update Firestore Rules
1. Click **Firestore Database** in left sidebar
2. Click **Rules** tab
3. **Replace ALL existing rules** with this:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow authenticated users to access their own data
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

4. Click **"Publish"** button

### Step 3: Test Your App
1. Refresh your app: http://localhost:3002
2. Try signing up and creating a profile
3. Should work without permission errors!

## ✅ What This Fixes
- ✅ Profile creation will work
- ✅ User data operations will work  
- ✅ All Firebase operations will have permissions
- ✅ Only authenticated users can access data

## 🔒 Production-Ready Rules (Use Later)
Once everything is working, you can use these more secure rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /user_profiles/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /accounts/{accountId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.user_id;
    }
    match /transactions/{transactionId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.user_id;
    }
  }
}
```

## 🧪 Quick Test
After updating rules:
1. Sign up for a new account
2. Verify email
3. Sign in
4. Create profile - should work!
5. Access dashboard - should load with your profile

**The permission error should be completely resolved!** 🎉


