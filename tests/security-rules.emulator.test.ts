/**
 * Real Firestore + Storage allow/deny tests, using only synthetic demo data.
 * Start Firebase emulators with this repo's rules, then run:
 * WRITEOFF_RULES_EMULATOR_TESTS=1 npx vitest run tests/security-rules.emulator.test.ts
 * Defaults: Firestore 127.0.0.1:8180, Storage 127.0.0.1:9299.
 * These tests clear their emulator database. For an independent run, set
 * WRITEOFF_RULES_PROJECT_ID (must start demo-), WRITEOFF_RULES_FIRESTORE_PORT
 * and WRITEOFF_RULES_STORAGE_PORT to a dedicated emulator instance.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { collection, collectionGroup, connectFirestoreEmulator, deleteDoc, deleteField, doc, getDoc, getDocs, getFirestore, query, setDoc, updateDoc, where, type Firestore } from 'firebase/firestore';
import { connectStorageEmulator, deleteObject, getBytes, getStorage, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';

const enabled = process.env.WRITEOFF_RULES_EMULATOR_TESTS === '1';
const projectId = process.env.WRITEOFF_RULES_PROJECT_ID || 'demo-writeoff-security';
const firestorePort = Number(process.env.WRITEOFF_RULES_FIRESTORE_PORT || 8180);
const storagePort = Number(process.env.WRITEOFF_RULES_STORAGE_PORT || 9299);
if (enabled && (!/^demo-[a-z0-9-]+$/.test(projectId) ||
    [firestorePort, storagePort].some(port => !Number.isInteger(port) || port < 1024 || port > 65535))) {
  throw new Error('Rules tests require a demo project and valid local emulator ports.');
}
const databaseUrl = `http://127.0.0.1:${firestorePort}/v1/projects/${projectId}/databases/(default)/documents`;
const apps: FirebaseApp[] = [];
let alice: Firestore;
let bob: Firestore;
let anonymous: Firestore;
let aliceStorage: FirebaseStorage;
let bobStorage: FirebaseStorage;
const owner = 'alice_uid';
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function client(uid?: string) {
  const app = initializeApp({ projectId, apiKey: 'demo-api-key', storageBucket: `${projectId}.appspot.com` }, `rules-${uid || 'anonymous'}`);
  apps.push(app);
  const db = getFirestore(app);
  const storage = getStorage(app);
  const options = uid ? { mockUserToken: { sub: uid, user_id: uid } } : undefined;
  connectFirestoreEmulator(db, '127.0.0.1', firestorePort, options);
  connectStorageEmulator(storage, '127.0.0.1', storagePort, options);
  return { db, storage };
}
async function seed(path: string, values: Record<string, string | number | boolean>) {
  const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'string' ? { stringValue: value } : typeof value === 'number' ? { integerValue: String(value) } : { booleanValue: value }]));
  const response = await fetch(`${databaseUrl}/${path}`, { method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields }) });
  expect(response.status).toBe(200);
}

// No network requests, SDK initialization or production configuration when disabled.
(enabled ? describe : describe.skip)('Firebase security rules with synthetic emulator records', () => {
  beforeAll(async () => {
    const response = await fetch(`http://127.0.0.1:${firestorePort}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
    expect(response.ok).toBe(true);
    ({ db: alice, storage: aliceStorage } = client(owner));
    ({ db: bob, storage: bobStorage } = client('bob'));
    ({ db: anonymous } = client());
    await seed('analysis_jobs/alice_uid_account', { userId: owner, status: 'running' });
    await seed('analysis_jobs/bob_account', { user_id: 'bob', status: 'running' });
    // The ID alone must never grant access to an existing job with another owner.
    await seed('analysis_jobs/alice_uid_misleading', { userId: 'bob', status: 'done' });
    await seed('analysis_status/legacy-alice', { userId: owner, status: 'running' });
    await seed('analysis_status/legacy-bob', { user_id: 'bob', status: 'running' });
    await seed('user_profiles/alice_uid/accounts/account/transactions/tx', { userId: owner, amount: 100, notes: 'before' });
    await seed('user_profiles/bob/accounts/account/transactions/tx', { user_id: 'bob', amount: 100, notes: 'before' });
    await seed('transactions/legacy', { user_id: owner, amount: 100, notes: 'before' });
    await seed('transactions/top-bob', { userId: 'bob', amount: 100 });
  });
  afterAll(async () => { await Promise.all(apps.map(app => deleteApp(app))); });

  it('allows each job owner while denying other authenticated users and anonymous readers', async () => {
    expect((await getDoc(doc(alice, 'analysis_jobs/alice_uid_account'))).exists()).toBe(true);
    expect((await getDoc(doc(bob, 'analysis_jobs/bob_account'))).exists()).toBe(true);
    await expect(getDoc(doc(bob, 'analysis_jobs/alice_uid_account'))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(getDoc(doc(anonymous, 'analysis_jobs/alice_uid_account'))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(getDoc(doc(alice, 'analysis_jobs/alice_uid_misleading'))).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('preserves pre-create subscriptions only for the full owner UID prefix', async () => {
    expect((await getDoc(doc(alice, 'analysis_jobs/alice_uid_not-created'))).exists()).toBe(false);
    await expect(getDoc(doc(bob, 'analysis_jobs/alice_uid_not-created'))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(getDoc(doc(alice, 'analysis_jobs/alice_uidvictim_missing'))).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('requires owner filters for job queries and denies client job writes', async () => {
    expect((await getDocs(query(collection(alice, 'analysis_jobs'), where('userId', '==', owner)))).size).toBe(1);
    await expect(getDocs(collection(alice, 'analysis_jobs'))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setDoc(doc(alice, 'analysis_jobs/alice_uid_created-by-client'), { userId: owner })).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('protects both legacy owner field spellings', async () => {
    expect((await getDoc(doc(alice, 'analysis_status/legacy-alice'))).exists()).toBe(true);
    expect((await getDoc(doc(bob, 'analysis_status/legacy-bob'))).exists()).toBe(true);
    await expect(getDoc(doc(alice, 'analysis_status/legacy-bob'))).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('permits legitimate transaction field additions/changes/removals but prevents owner or amount changes', async () => {
    const tx = doc(alice, 'user_profiles/alice_uid/accounts/account/transactions/tx');
    await updateDoc(tx, { notes: 'updated', business_purpose: 'Client meeting' });
    await updateDoc(tx, { business_purpose: deleteField() });
    await expect(updateDoc(tx, { amount: deleteField() })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(tx, { user_id: 'bob' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(tx, { userId: 'bob' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(tx, { unrestricted_new_field: true })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(doc(bob, tx.path), { notes: 'not mine' })).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('enforces the same update boundary for legacy top-level transactions', async () => {
    const tx = doc(alice, 'transactions/legacy');
    await updateDoc(tx, { notes: 'owner update', receipt_url: '/api/receipts/example' });
    await expect(updateDoc(tx, { userId: 'bob' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(tx, { amount: deleteField() })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(deleteDoc(tx)).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('keeps is_deductible owner-editable only until the server records a review', async () => {
    // Pre-review records keep the current client flow, on both storage paths.
    await updateDoc(doc(alice, 'user_profiles/alice_uid/accounts/account/transactions/tx'), { is_deductible: true, expense_type: 'business' });
    await updateDoc(doc(alice, 'transactions/legacy'), { is_deductible: false });
    for (const path of ['user_profiles/alice_uid/accounts/account/transactions/reviewed', 'transactions/legacy-reviewed']) {
      await seed(path, { userId: owner, amount: 100, is_deductible: true, review_status: 'confirmed', notes: 'before' });
      const reviewed = doc(alice, path);
      await updateDoc(reviewed, { notes: 'notes stay editable', business_purpose: 'Client meeting' });
      await expect(updateDoc(reviewed, { is_deductible: false })).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(updateDoc(reviewed, { is_deductible: deleteField() })).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(updateDoc(reviewed, { review_status: deleteField() })).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(updateDoc(doc(bob, path), { is_deductible: false })).rejects.toMatchObject({ code: 'permission-denied' });
    }
  });
  it('keeps historical-overlap fields Admin SDK only on both storage paths', async () => {
    const canonical = 'user_profiles/alice_uid/accounts/old/transactions/original';
    for (const path of ['user_profiles/alice_uid/accounts/account/transactions/relinked', 'transactions/legacy-relinked']) {
      await seed(path, { userId: owner, amount: 100, notes: 'before' });
      const tx = doc(alice, path);
      await expect(updateDoc(tx, { superseded_by: canonical })).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(updateDoc(tx, { overlap_reviewed: true })).rejects.toMatchObject({ code: 'permission-denied' });
      // Once the operator command has superseded a record, the owner can still annotate it but never clear the marker.
      await seed(path, { userId: owner, amount: 100, notes: 'before', superseded_by: canonical, superseded_reason: 'historical_overlap', superseded_decision_id: 'decision' });
      await updateDoc(tx, { notes: 'still editable' });
      await expect(updateDoc(tx, { superseded_by: deleteField() })).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(updateDoc(tx, { superseded_by: 'user_profiles/alice_uid/accounts/old/transactions/other' })).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(updateDoc(tx, { superseded_decision_id: deleteField() })).rejects.toMatchObject({ code: 'permission-denied' });
    }
  });
  it('retains owner-filtered collection-group transaction reads', async () => {
    const documents = await getDocs(query(collectionGroup(alice, 'transactions'), where('userId', '==', owner)));
    // Earlier cases seed additional owner records; every returned document must belong to the owner and Bob's must never appear.
    expect(documents.size).toBeGreaterThanOrEqual(1);
    expect(documents.docs.every(snapshot => snapshot.data().userId === owner)).toBe(true);
    expect(documents.docs.some(snapshot => snapshot.ref.path === 'user_profiles/alice_uid/accounts/account/transactions/tx')).toBe(true);
    expect(documents.docs.some(snapshot => snapshot.ref.path === 'transactions/top-bob')).toBe(false);
    await expect(getDocs(query(collectionGroup(alice, 'transactions'), where('userId', '==', 'bob')))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(getDoc(doc(alice, 'transactions/top-bob'))).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('allows ordinary profile creation and edits, denies subscription escalation on create/update', async () => {
    await expect(setDoc(doc(bob, 'user_profiles/bob'), { name: 'Bob', subscriptionPlan: 'premium' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setDoc(doc(bob, 'user_profiles/bob'), { name: 'Bob', subscriptionStatus: 'active', hasHistoricalAccess: true })).rejects.toMatchObject({ code: 'permission-denied' });
    await setDoc(doc(bob, 'user_profiles/bob'), { name: 'Bob', onboardingIntroCompleted: false });
    await updateDoc(doc(bob, 'user_profiles/bob'), { name: 'Bob Updated', profession: 'Designer' });
    await expect(updateDoc(doc(bob, 'user_profiles/bob'), { subscriptionStatus: 'active' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(doc(bob, 'user_profiles/bob'), { subscriptionPlan: 'premium' })).rejects.toMatchObject({ code: 'permission-denied' });
    // Admin/server writers bypass client rules, as do the real trial manager/webhook.
    await seed('user_profiles/bob', { name: 'Bob', subscriptionStatus: 'trial', hasHistoricalAccess: true });
    expect((await getDoc(doc(bob, 'user_profiles/bob'))).data()?.subscriptionStatus).toBe('trial');
    await seed('user_profiles/bob', { name: 'Bob', subscriptionPlan: 'basic' });
    await expect(updateDoc(doc(bob, 'user_profiles/bob'), { subscriptionPlan: 'premium' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(doc(bob, 'user_profiles/bob'), { subscriptionPlan: deleteField() })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setDoc(doc(alice, 'user_profiles/somebody-else'), { name: 'Wrong owner' })).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('keeps the sign-up consent record server-only on create and update', async () => {
    const consents = { version: '2026-09-17', source: 'profile-setup', accepted_at: '2026-09-17T12:00:00.000Z', bank_data: true, ai_review: true, communications: false };
    await expect(setDoc(doc(alice, `user_profiles/${owner}`), { name: 'Alice', consents })).rejects.toMatchObject({ code: 'permission-denied' });
    await seed(`user_profiles/${owner}`, { name: 'Alice', consents_recorded_at: 'server-stamped' });
    await updateDoc(doc(alice, `user_profiles/${owner}`), { profession: 'Designer' });
    await expect(updateDoc(doc(alice, `user_profiles/${owner}`), { consents })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(doc(alice, `user_profiles/${owner}`), { consents_recorded_at: 'forged' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(doc(alice, `user_profiles/${owner}`), { consents_recorded_at: deleteField() })).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await getDoc(doc(alice, `user_profiles/${owner}`))).data()?.consents_recorded_at).toBe('server-stamped');
  });
  it('denies all client reads and writes of private Plaid connections, including the owner', async () => {
    await seed('plaid_connections/bank-synthetic', { uid: owner, encryptedAccessToken: 'synthetic-ciphertext', cursor: 'cursor' });
    for (const db of [alice, bob, anonymous]) {
      await expect(getDoc(doc(db, 'plaid_connections/bank-synthetic'))).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(getDocs(query(collection(db, 'plaid_connections'), where('uid', '==', owner)))).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(setDoc(doc(db, 'plaid_connections/forged'), { uid: owner, accessToken: 'synthetic' })).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(updateDoc(doc(db, 'plaid_connections/bank-synthetic'), { uid: 'bob' })).rejects.toMatchObject({ code: 'permission-denied' });
    }
  });
  it('requires server migration before a legacy public token document can be read', async () => {
    await seed(`user_profiles/${owner}`, { name: 'Alice', plaid_token: 'synthetic-legacy-secret' });
    await expect(getDoc(doc(alice, `user_profiles/${owner}`))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(doc(alice, `user_profiles/${owner}`), { plaid_token: deleteField() })).rejects.toMatchObject({ code: 'permission-denied' });
    await seed(`user_profiles/${owner}`, { name: 'Alice', bankConnected: true });
    expect((await getDoc(doc(alice, `user_profiles/${owner}`))).data()?.bankConnected).toBe(true);
    for (const field of ['plaid_token', 'access_token', 'plaid_item_id', 'plaid_transactions_cursor', 'bankConnected', 'plaid_credentials_migrated']) {
      await expect(updateDoc(doc(alice, `user_profiles/${owner}`), { [field]: 'forged' })).rejects.toMatchObject({ code: 'permission-denied' });
    }
    await seed(`user_profiles/${owner}/accounts/secret-account`, { user_id: owner, access_token: 'synthetic' });
    await expect(getDoc(doc(alice, `user_profiles/${owner}/accounts/secret-account`))).rejects.toMatchObject({ code: 'permission-denied' });
    await seed(`user_profiles/${owner}/accounts/secret-account`, { user_id: owner, name: 'Clean account', plaid_item_id: 'bank' });
    expect((await getDoc(doc(alice, `user_profiles/${owner}/accounts/secret-account`))).data()?.name).toBe('Clean account');
    expect((await getDocs(collection(alice, `user_profiles/${owner}/accounts`))).docs.some(account => account.id === 'secret-account')).toBe(true);
    await expect(updateDoc(doc(alice, `user_profiles/${owner}/accounts/secret-account`), { plaid_item_id: 'other-bank' })).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('keeps deletion tombstones and provider recovery records private and immutable from every client', async () => {
    const paths = [`account_deletions/${owner}`, `account_deletions/${owner}/plaid_revocations/synthetic`];
    await seed(paths[0], { deletionRequested: true });
    await seed(paths[1], { uid: owner, encryptedAccessToken: 'synthetic-ciphertext' });
    for (const db of [alice, bob, anonymous]) {
      for (const path of paths) {
        await expect(getDoc(doc(db, path))).rejects.toMatchObject({ code: 'permission-denied' });
        await expect(setDoc(doc(db, path), { deletionRequested: false })).rejects.toMatchObject({ code: 'permission-denied' });
        await expect(deleteDoc(doc(db, path))).rejects.toMatchObject({ code: 'permission-denied' });
      }
      await expect(getDocs(collection(db, 'account_deletions'))).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(getDocs(collection(db, `account_deletions/${owner}/plaid_revocations`))).rejects.toMatchObject({ code: 'permission-denied' });
    }
  });
  it('denies every client read and write of rate-limit windows and the support audit trail', async () => {
    await seed('rate_limits/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', { scope: 'auth.session', windowStart: 1, count: 1 });
    await seed('support_audit/synthetic-entry', { actorUid: owner, subjectUid: 'bob', action: 'account-diagnostics' });
    for (const db of [alice, bob, anonymous]) {
      for (const path of ['rate_limits/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'support_audit/synthetic-entry']) {
        await expect(getDoc(doc(db, path))).rejects.toMatchObject({ code: 'permission-denied' });
        await expect(setDoc(doc(db, path), { count: 0 })).rejects.toMatchObject({ code: 'permission-denied' });
        await expect(updateDoc(doc(db, path), { count: 0 })).rejects.toMatchObject({ code: 'permission-denied' });
        await expect(deleteDoc(doc(db, path))).rejects.toMatchObject({ code: 'permission-denied' });
      }
      await expect(getDocs(collection(db, 'rate_limits'))).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(getDocs(query(collection(db, 'support_audit'), where('actorUid', '==', owner)))).rejects.toMatchObject({ code: 'permission-denied' });
      // A client cannot reset its own window by creating a fresh document either.
      await expect(setDoc(doc(db, 'rate_limits/forged-window'), { scope: 'auth.session', windowStart: 1, count: 0 })).rejects.toMatchObject({ code: 'permission-denied' });
    }
  });
  it('allows valid owner receipt uploads, reads, replacements and deletes', async () => {
    const receipt = ref(aliceStorage, `receipts/${owner}/tx/rules-valid.png`);
    await uploadBytes(receipt, png, { contentType: 'image/png' });
    expect((await getBytes(receipt)).byteLength).toBe(png.byteLength);
    await uploadBytes(receipt, png, { contentType: 'image/png' });
    await expect(getBytes(ref(bobStorage, receipt.fullPath))).rejects.toMatchObject({ code: 'storage/unauthorized' });
    await expect(deleteObject(ref(bobStorage, receipt.fullPath))).rejects.toMatchObject({ code: 'storage/unauthorized' });
    await deleteObject(receipt);
  });
  it('rejects unauthorized, unsupported, empty and oversized receipt uploads', async () => {
    await expect(uploadBytes(ref(bobStorage, `receipts/${owner}/tx/foreign.png`), png, { contentType: 'image/png' })).rejects.toMatchObject({ code: 'storage/unauthorized' });
    await expect(uploadBytes(ref(aliceStorage, `receipts/${owner}/tx/active.svg`), png, { contentType: 'image/svg+xml' })).rejects.toMatchObject({ code: 'storage/unauthorized' });
    await expect(uploadBytes(ref(aliceStorage, `receipts/${owner}/tx/empty.png`), new Uint8Array(), { contentType: 'image/png' })).rejects.toMatchObject({ code: 'storage/unauthorized' });
    await expect(uploadBytes(ref(aliceStorage, `receipts/${owner}/tx/large.png`), new Uint8Array(10 * 1024 * 1024 + 1), { contentType: 'image/png' })).rejects.toMatchObject({ code: 'storage/unauthorized' });
  });
  it('applies content-type restrictions to replacements too', async () => {
    const receipt = ref(aliceStorage, `receipts/${owner}/tx/replacement.png`);
    await uploadBytes(receipt, png, { contentType: 'image/png' });
    await expect(uploadBytes(receipt, png, { contentType: 'text/html' })).rejects.toMatchObject({ code: 'storage/unauthorized' });
    await deleteObject(receipt);
  });
});
