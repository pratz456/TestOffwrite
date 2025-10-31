# 📋 Naming Alignment Report

## ✅ **All Naming is Now Correctly Aligned**

### **1. Firestore Rules** ✅
```javascript
// ✅ Matches your reference exactly
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /analysis_status/{jobId} {
      // TEMP during migration - allow both userId and user_id fields
      allow read: if request.auth != null
                  && (resource.data.userId == request.auth.uid
                      || resource.data.user_id == request.auth.uid);
      allow write: if false; // clients never write; server uses Admin SDK
    }
  }
}
```

### **2. Server Create/Update Job** ✅
```typescript
// ✅ Matches your reference exactly
await adminDb.collection('analysis_status').doc(jobId).set({
  userId,                 // <-- REQUIRED (camelCase)
  total,
  completed: 0,
  status: 'running',
  created_at: FieldValue.serverTimestamp(),
  updated_at: FieldValue.serverTimestamp(),
}, { merge: true });

// ✅ Progress updates with increment
await adminDb.collection('analysis_status').doc(jobId).update({
  completed: FieldValue.increment(1),
  updated_at: FieldValue.serverTimestamp(),
});

// ✅ Completion with finished_at
await adminDb.collection('analysis_status').doc(jobId).set({
  status: 'done',
  finished_at: FieldValue.serverTimestamp(),
  updated_at: FieldValue.serverTimestamp(),
}, { merge: true });
```

### **3. Client Subscription** ✅
```typescript
// ✅ Matches your reference exactly
onSnapshot(doc(db, 'analysis_status', jobId), (snap) => {
  const d = snap.data();
  // d.userId must equal current uid per rules
  setCompleted(d?.completed ?? 0);
  setTotal(d?.total ?? 0);
});
```

### **4. Environment Variables** ✅
```env
# ✅ Client SDK (NEXT_PUBLIC_*)
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key_here
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=writeoff-23910.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=writeoff-23910
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=writeoff-23910.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=your_measurement_id

# ✅ Admin SDK (FIREBASE_ADMIN_*)
FIREBASE_ADMIN_PROJECT_ID=writeoff-23910
FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-fbsvc@writeoff-23910.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
```

## 📊 **Field Naming Standards**

### **✅ Consistent camelCase Fields:**
- `userId` (not `user_id` or `uid`)
- `created_at` (timestamp fields use snake_case)
- `updated_at` (timestamp fields use snake_case)
- `finished_at` (timestamp fields use snake_case)

### **✅ Collection Names:**
- `analysis_status` (snake_case for collections)
- `user_profiles` (snake_case for collections)

### **✅ Document IDs:**
- `{jobId}` (camelCase for document ID variables)
- `{uid}` (short form for user ID variables)

## 🔧 **Files Updated for Alignment**

1. **`firestore.rules`** - Updated comment to match reference
2. **`app/api/plaid/auto-analyze/route.ts`** - Added `finished_at` and `status: 'done'`
3. **`app/api/analysis-status/route.ts`** - Added `FieldValue.increment(1)` logic
4. **`lib/firebase/analysis-subscription.ts`** - Created client subscription helper

## 🎯 **Final State Alignment**

All implementations now match your reference snippets exactly:

- ✅ **Collection**: `analysis_status`
- ✅ **Fields**: `userId`, `total`, `completed`, `status`, `created_at`, `updated_at`, `finished_at`
- ✅ **Operations**: `FieldValue.increment(1)`, `FieldValue.serverTimestamp()`
- ✅ **Status Values**: `'running'`, `'done'`, `'failed'`
- ✅ **Security**: `userId` ownership validation
- ✅ **Comments**: Match reference format exactly

## 🚀 **Ready for Deployment**

All naming conventions are now perfectly aligned with your reference snippets. The system is ready for:

1. **Deploy temporary rules**: `firebase deploy --only firestore:rules`
2. **Run migration**: `node scripts/backfill-userid-migration.js`
3. **Clean up rules**: `node scripts/post-migration-cleanup.js`
4. **Use in production**: All naming matches your standards exactly
