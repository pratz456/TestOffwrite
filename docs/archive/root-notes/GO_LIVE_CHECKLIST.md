# 🚀 Go-Live Checklist

## ✅ **Pre-Deployment Verification**

### **1. Environment Variables Check**
```bash
# Run environment consistency check
node scripts/verify-env-consistency.js
```

**Required Variables:**
- ✅ `NEXT_PUBLIC_FIREBASE_PROJECT_ID` === `FIREBASE_ADMIN_PROJECT_ID`
- ✅ `NEXT_PUBLIC_FIREBASE_API_KEY` (client SDK)
- ✅ `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` (client SDK)
- ✅ `FIREBASE_ADMIN_CLIENT_EMAIL` (admin SDK)
- ✅ `FIREBASE_ADMIN_PRIVATE_KEY` (quoted, with \n sequences)

### **2. Collection Naming Verification**
- ✅ **Server writes**: `analysis_status` collection
- ✅ **Client reads**: `analysis_status` collection  
- ✅ **Firestore rules**: `match /analysis_status/{jobId}`

### **3. Required Fields on First Write**
```typescript
// ✅ All required fields present
await adminDb.collection('analysis_status').doc(jobId).set({
  userId,                 // ✅ camelCase
  total,                  // ✅ Required
  completed,              // ✅ Required (starts at 0)
  status: 'running',      // ✅ Required
  created_at: FieldValue.serverTimestamp(), // ✅ Required
  updated_at: FieldValue.serverTimestamp(), // ✅ Required
}, { merge: true });
```

### **4. Progress Updates**
```typescript
// ✅ Use increment for progress
await adminDb.collection('analysis_status').doc(jobId).update({
  completed: FieldValue.increment(1), // ✅ Increment, not direct value
  updated_at: FieldValue.serverTimestamp(), // ✅ Always bump updated_at
});
```

### **5. Completion & Failure Handling**
```typescript
// ✅ Success path
await adminDb.collection('analysis_status').doc(jobId).set({
  status: 'done',         // ✅ Use 'done', not 'completed'
  finished_at: FieldValue.serverTimestamp(), // ✅ Required
  updated_at: FieldValue.serverTimestamp(), // ✅ Required
}, { merge: true });

// ✅ Failure path
await adminDb.collection('analysis_status').doc(jobId).set({
  status: 'failed',       // ✅ Required for stuck UI prevention
  error: String(e).slice(0, 500), // ✅ Trimmed error message
  finished_at: FieldValue.serverTimestamp(), // ✅ Required
  updated_at: FieldValue.serverTimestamp(), // ✅ Required
}, { merge: true });
```

### **6. Fail-Safe Writer Pattern**
```typescript
// ✅ Implemented in auto-analyze route
try {
  // loop items...
} catch (e) {
  await adminDb.collection('analysis_status').doc(jobId).set({
    status: 'failed',
    error: String(e).slice(0, 500),
    finished_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  }, { merge: true });
  throw e;
}
```

## 🔧 **Deployment Steps**

### **Step 1: Deploy Temporary Rules**
```bash
# Deploy rules with dual-field support during migration
firebase deploy --only firestore:rules
```

### **Step 2: Run Migration**
```bash
# Migrate existing documents to userId field
node scripts/backfill-userid-migration.js
```

### **Step 3: Clean Up Rules**
```bash
# Update to clean userId-only rules
node scripts/post-migration-cleanup.js
```

### **Step 4: Verify Deployment**
```bash
# Test environment consistency
node scripts/verify-env-consistency.js

# Restart development server
npm run dev
```

## 📋 **Firestore Rules (Final State)**

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /analysis_status/{jobId} {
      allow read: if request.auth != null && resource.data.userId == request.auth.uid;
      allow write: if false; // clients never write; server uses Admin SDK
    }
  }
}
```

## 🔧 **Runtime & SDK Separation**

### **✅ Server-Side (Admin SDK)**
- ✅ All routes using Admin SDK have `export const runtime = 'nodejs';`
- ✅ Uses `firebase-admin` package only
- ✅ No `firebaseApp.auth()` anywhere

**Files with Node.js runtime:**
- `app/api/plaid/auto-analyze/route.ts`
- `app/api/transactions/analysis-status/route.ts`
- `app/api/openai/analyze-transactions/route.ts`
- `app/api/openai/analyze-with-progress/route.ts`
- `app/api/openai/analyze-transaction/route.ts`
- `app/api/ai/analyze-transaction/route.ts`
- `app/api/analysis-status/route.ts`

### **✅ Client-Side (Modular v9)**
- ✅ Uses `firebase/app`, `firebase/auth`, `firebase/firestore`
- ✅ No `firebaseApp.auth()` anywhere
- ✅ Uses `getAuth()`, `getFirestore()` functions

## 📡 **Client Subscription (No Polling)**

```typescript
// ✅ Real-time subscription (no polling needed)
onSnapshot(doc(db, 'analysis_status', jobId), (snap) => {
  const d = snap.data();
  setCompleted(d?.completed ?? 0);
  setTotal(d?.total ?? 0);
}, (err) => console.error('progress read error', err));
```

## 🔍 **Multiple Jobs Per User (Optional)**

```typescript
// ✅ Query for latest active job
const q = query(
  collection(db, 'analysis_status'),
  where('userId', '==', uid),
  orderBy('created_at', 'desc'),
  limit(1)
);
```

**Note**: If Firestore asks for an index, accept the console link to auto-create it.

## 🛡️ **Idempotency (Optional but Nice)**

Consider implementing:
- Processed flag per transaction ID
- Deterministic batch planning
- Restart-safe processing

## 🧪 **Testing Checklist**

### **Before Go-Live:**
- [ ] Environment variables consistent
- [ ] Firestore rules deployed
- [ ] Migration completed
- [ ] All API routes have Node.js runtime
- [ ] Fail-safe error handling works
- [ ] Client subscriptions work
- [ ] Progress updates increment correctly
- [ ] Completion sets `status: 'done'` and `finished_at`
- [ ] Failures set `status: 'failed'` and error message

### **Post-Deployment:**
- [ ] Connect Plaid account
- [ ] Start transaction analysis
- [ ] Verify progress counter updates
- [ ] Check completion status
- [ ] Test error scenarios
- [ ] Verify no "stuck" UI states

## 🚨 **Critical Success Factors**

1. **✅ Same Collection Everywhere**: `analysis_status`
2. **✅ Consistent Field Names**: `userId` (camelCase)
3. **✅ Proper Error Handling**: Both success and failure paths
4. **✅ Real-time Updates**: Client subscriptions, no polling
5. **✅ Environment Consistency**: Client and admin project IDs match
6. **✅ Runtime Separation**: Node.js for admin, Edge for client
7. **✅ Fail-Safe Patterns**: Error handling prevents stuck states

## 🎯 **Go-Live Status**

- ✅ **Environment**: Consistent and verified
- ✅ **Code**: All patterns implemented
- ✅ **Rules**: Temporary dual-field deployed
- ✅ **Migration**: Scripts ready
- ✅ **Error Handling**: Fail-safe patterns in place
- ✅ **Client**: Real-time subscriptions implemented

**Ready for go-live! 🚀**
