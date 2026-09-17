/**
 * Proof of the legacy-credential rollout sequence against the real Firestore
 * rules: a profile that still carries a public Plaid token is unreadable by its
 * own browser client, the shared migration core (Admin SDK, exactly what the bulk
 * script and the profile route run) removes the token, and the same client can
 * read the profile again while the private connection stays denied.
 * Start Firebase emulators with this repo's rules, then run:
 * WRITEOFF_RULES_EMULATOR_TESTS=1 npx vitest run tests/plaid-migration.emulator.test.ts
 * Defaults: Firestore 127.0.0.1:8180, project demo-writeoff-security. Only
 * synthetic records under fresh `plaidmig_*` uids are written and removed again.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { connectFirestoreEmulator, doc, getDoc, getFirestore, type Firestore } from 'firebase/firestore';
import type { Firestore as AdminFirestore, FieldValue as AdminFieldValue } from 'firebase-admin/firestore';
import { migrateLegacyPlaidCredentials } from '@/lib/plaid/legacy-migration';
import { decryptPlaidToken } from '@/lib/plaid/connection-primitives';
import { runPlaidCredentialMigration } from '../scripts/production-plaid-credential-migration.mjs';

const enabled = process.env.WRITEOFF_RULES_EMULATOR_TESTS === '1';
const projectId = process.env.WRITEOFF_RULES_PROJECT_ID || 'demo-writeoff-security';
const firestorePort = Number(process.env.WRITEOFF_RULES_FIRESTORE_PORT || 8180);
if (enabled && (!/^demo-[a-z0-9-]+$/.test(projectId) || !Number.isInteger(firestorePort) || firestorePort < 1024 || firestorePort > 65535)) {
  throw new Error('Migration emulator tests require a demo project and a valid local emulator port.');
}
const emulatorHost = `127.0.0.1:${firestorePort}`;
const databaseUrl = `http://${emulatorHost}/v1/projects/${projectId}/databases/(default)/documents`;
const encryptionKey = '5'.repeat(64);
const suffix = randomBytes(4).toString('hex');
const apps: FirebaseApp[] = [];
const seededUids: string[] = [];
const seededItems: string[] = [];
const directories: string[] = [];
let admin: AdminFirestore;
let FieldValue: typeof AdminFieldValue;
let closeAdmin: () => Promise<void>;

function client(uid: string): Firestore {
  const app = initializeApp({ projectId, apiKey: 'demo-api-key' }, `plaid-migration-${uid}`);
  apps.push(app);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', firestorePort, { mockUserToken: { sub: uid, user_id: uid } });
  return db;
}
/** Seed exactly as the Admin/owner endpoint does: REST with the emulator owner token, bypassing rules. */
async function seed(documentPath: string, values: Record<string, string | number | boolean>) {
  const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [key,
    typeof value === 'string' ? { stringValue: value } : typeof value === 'number' ? { integerValue: String(value) } : { booleanValue: value }]));
  const response = await fetch(`${databaseUrl}/${documentPath}`, { method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields }) });
  expect(response.status).toBe(200);
}
function legacyUid(label: string) {
  const uid = `plaidmig_${label}_${suffix}`;
  seededUids.push(uid);
  return uid;
}
const denied = (promise: Promise<unknown>) => expect(promise).rejects.toMatchObject({ code: 'permission-denied' });

// No network requests, SDK initialization or production configuration when disabled.
(enabled ? describe : describe.skip)('legacy Plaid credential migration against the emulator rules', () => {
  beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = emulatorHost;
    process.env.PLAID_TOKEN_ENCRYPTION_KEY = encryptionKey;
    const [{ initializeApp: initializeAdmin, deleteApp: deleteAdmin }, firestore] = await Promise.all([
      import('firebase-admin/app'), import('firebase-admin/firestore'),
    ]);
    const app = initializeAdmin({ projectId }, `plaid-migration-admin-${suffix}`);
    admin = firestore.getFirestore(app);
    FieldValue = firestore.FieldValue;
    closeAdmin = () => deleteAdmin(app);
  });
  afterAll(async () => {
    for (const uid of seededUids) await admin.recursiveDelete(admin.doc(`user_profiles/${uid}`));
    for (const itemId of seededItems) await admin.doc(`plaid_connections/${itemId}`).delete();
    await Promise.all(apps.map(app => deleteApp(app)));
    await closeAdmin();
    for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  });

  it('locks a token-bearing legacy owner out until the shared core migrates, then restores reads and keeps the connection private', async () => {
    const uid = legacyUid('owner');
    const itemId = `plaidmig-item-${suffix}`;
    seededItems.push(itemId);
    await seed(`user_profiles/${uid}`, { name: 'Legacy owner', plaid_token: 'synthetic-legacy-secret', plaid_item_id: itemId, plaid_transactions_cursor: 'synthetic-cursor' });
    await seed(`user_profiles/${uid}/accounts/checking`, { user_id: uid, name: 'Checking', plaid_item_id: itemId, access_token: 'synthetic-account-secret' });
    await seed(`user_profiles/${uid}/accounts/checking/transactions/tx`, { userId: uid, amount: 42, review_status: 'confirmed' });
    const owner = client(uid);
    // This is the old-client failure mode: the browser SDK reads the profile before any API handshake ran.
    await denied(getDoc(doc(owner, `user_profiles/${uid}`)));
    await denied(getDoc(doc(owner, `user_profiles/${uid}/accounts/checking`)));

    const result = await migrateLegacyPlaidCredentials(admin, FieldValue, uid, { paginateAccounts: true });
    expect(result).toEqual({ outcome: 'migrated', tokenMoved: true, accountTokensCleared: 1, paginated: false });

    expect((await getDoc(doc(owner, `user_profiles/${uid}`))).data()).toEqual({ name: 'Legacy owner', plaid_credentials_migrated: true, bankConnected: false });
    expect((await getDoc(doc(owner, `user_profiles/${uid}/accounts/checking`))).data()).toEqual({ user_id: uid, name: 'Checking', plaid_item_id: itemId });
    expect((await getDoc(doc(owner, `user_profiles/${uid}/accounts/checking/transactions/tx`))).data()).toEqual({ userId: uid, amount: 42, review_status: 'confirmed' });
    await denied(getDoc(doc(owner, `plaid_connections/${itemId}`)));
    await denied(getDoc(doc(client(`plaidmig_other_${suffix}`), `plaid_connections/${itemId}`)));

    const connection = (await admin.doc(`plaid_connections/${itemId}`).get()).data()!;
    expect(connection).toMatchObject({ uid, itemId, status: 'relink_required', clientId: null, environment: null, cursor: 'synthetic-cursor', accountIds: ['checking'] });
    expect(connection.encryptedAccessToken).toMatch(/^v1\./);
    expect(JSON.stringify(connection)).not.toContain('synthetic-legacy-secret');
    expect(decryptPlaidToken(uid, itemId, connection.encryptedAccessToken)).toBe('synthetic-legacy-secret');
    expect(await migrateLegacyPlaidCredentials(admin, FieldValue, uid)).toMatchObject({ outcome: 'already_migrated' });
    expect((await getDoc(doc(owner, `user_profiles/${uid}`))).data()).toEqual({ name: 'Legacy owner', plaid_credentials_migrated: true, bankConnected: false });
  });

  it('cleans a 450-account legacy profile through the paginated path on real Firestore transactions', async () => {
    const uid = legacyUid('big');
    const itemId = `plaidmig-big-${suffix}`;
    seededItems.push(itemId);
    await seed(`user_profiles/${uid}`, { name: 'Big', plaid_token: 'synthetic-big-secret', plaid_item_id: itemId });
    const batch = admin.batch();
    for (let index = 0; index < 450; index++) {
      batch.set(admin.doc(`user_profiles/${uid}/accounts/acct-${index}`), { user_id: uid, name: `Account ${index}`, plaid_item_id: itemId, access_token: `synthetic-${index}` });
    }
    await batch.commit();
    const owner = client(uid);
    await denied(getDoc(doc(owner, `user_profiles/${uid}`)));
    await denied(getDoc(doc(owner, `user_profiles/${uid}/accounts/acct-0`)));
    await expect(migrateLegacyPlaidCredentials(admin, FieldValue, uid)).rejects.toThrow('paginated administrative cleanup');
    await denied(getDoc(doc(owner, `user_profiles/${uid}`)));

    const result = await migrateLegacyPlaidCredentials(admin, FieldValue, uid, { paginateAccounts: true });
    expect(result).toEqual({ outcome: 'migrated', tokenMoved: true, accountTokensCleared: 450, paginated: true });
    const accounts = await admin.collection(`user_profiles/${uid}/accounts`).select('access_token', 'plaid_token').get();
    expect(accounts.size).toBe(450);
    expect(accounts.docs.filter(account => 'access_token' in account.data() || 'plaid_token' in account.data())).toEqual([]);
    expect((await getDoc(doc(owner, `user_profiles/${uid}`))).data()).toEqual({ name: 'Big', plaid_credentials_migrated: true, bankConnected: false });
    expect((await getDoc(doc(owner, `user_profiles/${uid}/accounts/acct-449`))).data()).toEqual({ user_id: uid, name: 'Account 449', plaid_item_id: itemId });
    await denied(getDoc(doc(owner, `plaid_connections/${itemId}`)));
    expect((await admin.doc(`plaid_connections/${itemId}`).get()).data()?.accountIds).toHaveLength(450);
  });

  it('the bulk command plan and verify modes see the emulator state read-only and flag the remaining token', async () => {
    const uid = legacyUid('planned');
    await seed(`user_profiles/${uid}`, { name: 'Planned', access_token: 'synthetic-planned-secret' });
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'writeoff-plaid-migration-emulator-'));
    directories.push(backupDir);
    const run = (options: Record<string, unknown>) => runPlaidCredentialMigration({
      project: projectId, backupDir, allowEmulator: true, sourceCommit: 'a'.repeat(40),
      inheritedEnv: { FIRESTORE_EMULATOR_HOST: emulatorHost, PLAID_TOKEN_ENCRYPTION_KEY: encryptionKey },
      connect: async () => ({ db: admin, FieldValue, close: async () => {} }),
      ...options,
    });
    const plan = await run({ confirmation: `plan:${projectId}` });
    expect(plan.writesPerformed).toBe(false);
    const planned = JSON.parse(fs.readFileSync(plan.planFile, 'utf8')).profiles.find((entry: { uid: string }) => entry.uid === uid);
    expect(planned).toMatchObject({ action: 'migrate', profileTokenPresent: true, accountTokenCount: 0, itemIdPresent: false, existingConnection: 'none', expectedRefusal: null });
    expect(fs.readFileSync(plan.planFile, 'utf8')).not.toContain('synthetic-planned-secret');
    const failing = await run({ verify: true, confirmation: `verify:${projectId}` });
    expect(failing.clean).toBe(false);
    expect(JSON.parse(fs.readFileSync(failing.reportFile, 'utf8')).remaining.profiles).toContain(uid);
    expect((await admin.doc(`user_profiles/${uid}`).get()).data()).toEqual({ name: 'Planned', access_token: 'synthetic-planned-secret' });

    seededItems.push(`legacy-${uid}`);
    expect(await migrateLegacyPlaidCredentials(admin, FieldValue, uid, { paginateAccounts: true })).toMatchObject({ outcome: 'migrated', tokenMoved: true });
    const passing = await run({ verify: true, confirmation: `verify:${projectId}` });
    expect(JSON.parse(fs.readFileSync(passing.reportFile, 'utf8')).remaining.profiles).not.toContain(uid);
    expect((await getDoc(doc(client(uid), `user_profiles/${uid}`))).data()).toEqual({ name: 'Planned', plaid_credentials_migrated: true, bankConnected: false });
  });
});
