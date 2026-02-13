# 🔥 Deploy Firestore Security Rules

## The Issue
You're getting "Missing or insufficient permissions" because your Firestore database doesn't have proper security rules set up to allow authenticated users to create and read their own profiles.

## Quick Fix - Deploy Security Rules

### Option 1: Using Firebase Console (Recommended)

1. **Go to Firebase Console**: https://console.firebase.google.com
2. **Select your project**: `writeoff-23910`
3. **Navigate to Firestore Database** → **Rules** tab
4. **Replace the existing rules** with this content:

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    // Allow users to read and write their own profile
    match /user_profiles/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Allow users to read and write their own accounts
    match /accounts/{accountId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.user_id;
    }
    
    // Allow users to read and write their own transactions
    match /transactions/{transactionId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.user_id;
    }
    
    // Allow users to create new documents with their own user_id
    match /{document=**} {
      allow create: if request.auth != null && request.auth.uid == request.resource.data.user_id;
    }
  }
}
```

5. **Click "Publish"**

### Option 2: Using Firebase CLI

If you have Firebase CLI installed:

```bash
# Install Firebase CLI if not already installed
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase in your project (if not done)
firebase init firestore

# Deploy the rules
firebase deploy --only firestore:rules
```

## What These Rules Do

✅ **Allow authenticated users to**:
- Create and read their own user profiles
- Create and manage their own accounts
- Create and manage their own transactions
- Only access data that belongs to them (based on user_id)

✅ **Security Features**:
- Users can only access their own data
- Authentication is required for all operations
- Prevents unauthorized access to other users' data

## Test After Deployment

1. **Refresh your app**: `http://localhost:3002`
2. **Try creating a profile** - should work without permission errors
3. **Check browser console** - should see successful profile creation

## Alternative: Temporary Testing Rules (NOT for production!)

If you want to test quickly (ONLY for development), you can use these permissive rules temporarily:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

**⚠️ WARNING**: These rules allow any authenticated user to read/write any document. Only use for testing!

## Once Rules Are Deployed

Your Firebase authentication system will work completely:
- ✅ Profile creation will work
- ✅ User data will be properly secured
- ✅ All Firebase operations will have proper permissions


