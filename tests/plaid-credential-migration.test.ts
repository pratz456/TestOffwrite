import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { createFakeFirestore, fakeFieldValue, type FakeFirestore } from './fixtures/fake-firestore';
import * as core from '@/lib/plaid/legacy-migration';
import { decryptPlaidToken } from '@/lib/plaid/connection-primitives';
import {
  buildPlaidCredentialMigrationPlan, loadPlaidCredentialMigrationState, runPlaidCredentialMigration, serializeFirestoreValue,
} from '../scripts/production-plaid-credential-migration.mjs';

const KEY = '3'.repeat(64);
const project = 'writeoff-23910';
const uid = 'legacy-user';
const profilePath = `user_profiles/${uid}`;
const env = { PLAID_TOKEN_ENCRYPTION_KEY: KEY, PLAID_CLIENT_ID: 'new-client', PLAID_ENV: 'production' };
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type FakeWork = Parameters<FakeFirestore['runTransaction']>[0];
const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;
const snapshot = (fake: FakeFirestore) => structuredClone(Object.fromEntries(fake.records));
const directories: string[] = [];
let db: FakeFirestore;
let tick = 0;

function seedLegacyRecords(fake = db) {
  fake.records.set(profilePath, { name: 'Legacy', profession: 'Designer', plaid_token: 'legacy-secret', plaid_item_id: 'old-item', plaid_transactions_cursor: 'cursor-1' });
  fake.records.set(`${profilePath}/accounts/checking`, { user_id: uid, plaid_item_id: 'old-item', name: 'Checking', access_token: 'account-secret' });
  fake.records.set(`${profilePath}/accounts/checking/transactions/tx`, { amount: 12, review_status: 'confirmed', is_deductible: true });
  fake.records.set(`${profilePath}/accounts/manual`, { source: 'manual', name: 'Cash' });
  fake.records.set('user_profiles/clean', { name: 'Never linked' });
  fake.records.set('user_profiles/marked', { name: 'Already migrated', plaid_credentials_migrated: true });
}
function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'writeoff-plaid-migration-test-'));
  directories.push(root);
  const checkout = path.join(root, 'checkout');
  fs.mkdirSync(checkout);
  return { checkout, backup: path.join(root, 'private') };
}
function runner(checkout: string, backup: string) {
  return (options: Record<string, unknown>) => runPlaidCredentialMigration({
    project, backupDir: backup, cwd: checkout, inheritedEnv: env, sourceCommit: 'a'.repeat(40), core,
    now: () => new Date(Date.UTC(2026, 8, 17, 12, 0, 0, tick++)),
    connect: async () => ({ db: asDb(db), FieldValue: fakeFieldValue, close: async () => {} }),
    ...options,
  });
}

beforeEach(() => {
  db = createFakeFirestore();
  vi.stubEnv('PLAID_TOKEN_ENCRYPTION_KEY', KEY); vi.stubEnv('PLAID_CLIENT_ID', 'new-client'); vi.stubEnv('PLAID_ENV', 'production');
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('shared legacy Plaid credential migration core', () => {
  it('moves a profile-level token into an encrypted relink_required connection and clears the public fields', async () => {
    seedLegacyRecords();
    db.records.set(`${profilePath}/accounts/checking`, { user_id: uid, plaid_item_id: 'old-item', name: 'Checking' });
    const result = await core.migrateLegacyPlaidCredentials(asDb(db), fakeFieldValue, uid);
    expect(result).toEqual({ outcome: 'migrated', tokenMoved: true, accountTokensCleared: 0, paginated: false });
    expect(db.records.get(profilePath)).toEqual({ name: 'Legacy', profession: 'Designer', plaid_credentials_migrated: true, bankConnected: false });
    const connection = db.records.get('plaid_connections/old-item')!;
    expect(connection).toMatchObject({ uid, itemId: 'old-item', status: 'relink_required', clientId: null, environment: null, cursor: 'cursor-1', accountIds: ['checking'] });
    expect(connection).not.toHaveProperty('accessToken');
    expect(JSON.stringify(connection)).not.toContain('legacy-secret');
    expect(decryptPlaidToken(uid, 'old-item', connection.encryptedAccessToken)).toBe('legacy-secret');
    expect(db.records.get(`${profilePath}/accounts/checking/transactions/tx`)).toEqual({ amount: 12, review_status: 'confirmed', is_deductible: true });
    expect(db.records.get(`${profilePath}/accounts/manual`)).toEqual({ source: 'manual', name: 'Cash' });
  });
  it('clears account-level tokens in both spellings while keeping every other account field and transaction', async () => {
    db.records.set(profilePath, { name: 'Legacy', access_token: 'alternate-secret' });
    db.records.set(`${profilePath}/accounts/a`, { user_id: uid, name: 'A', access_token: 'secret-a', balance: 10 });
    db.records.set(`${profilePath}/accounts/b`, { user_id: uid, name: 'B', plaid_token: 'secret-b' });
    db.records.set(`${profilePath}/accounts/b/transactions/tx`, { amount: 5, notes: 'keep' });
    db.records.set(`${profilePath}/accounts/manual`, { source: 'manual', name: 'Cash' });
    const result = await core.migrateLegacyPlaidCredentials(asDb(db), fakeFieldValue, uid);
    expect(result).toEqual({ outcome: 'migrated', tokenMoved: true, accountTokensCleared: 2, paginated: false });
    expect(db.records.get(`${profilePath}/accounts/a`)).toEqual({ user_id: uid, name: 'A', balance: 10 });
    expect(db.records.get(`${profilePath}/accounts/b`)).toEqual({ user_id: uid, name: 'B' });
    expect(db.records.get(`${profilePath}/accounts/b/transactions/tx`)).toEqual({ amount: 5, notes: 'keep' });
    expect(db.records.get(`${profilePath}/accounts/manual`)).toEqual({ source: 'manual', name: 'Cash' });
    expect(db.records.get(profilePath)).toEqual({ name: 'Legacy', plaid_credentials_migrated: true, bankConnected: false });
    expect(decryptPlaidToken(uid, `legacy-${uid}`, db.records.get(`plaid_connections/legacy-${uid}`)!.encryptedAccessToken)).toBe('alternate-secret');
  });
  it('cleans a 450-account profile in follow-up transactions of at most 400 writes and marks completion last', async () => {
    db.records.set(profilePath, { name: 'Big', plaid_token: 'legacy-secret', plaid_item_id: 'big-item' });
    for (let index = 0; index < 450; index++) {
      db.records.set(`${profilePath}/accounts/acct-${index}`, { user_id: uid, plaid_item_id: 'big-item', name: `Account ${index}`, access_token: `secret-${index}` });
    }
    const before = snapshot(db);
    await expect(core.migrateLegacyPlaidCredentials(asDb(db), fakeFieldValue, uid)).rejects.toThrow('paginated administrative cleanup');
    expect(snapshot(db)).toEqual(before);

    const writeCounts: number[] = [];
    const profileStates: Array<Record<string, unknown> | undefined> = [];
    const original = db.runTransaction;
    db.runTransaction = async (work: FakeWork) => {
      const result = await original(async tx => {
        let writes = 0;
        const counting = { ...tx, set: (...args: unknown[]) => { writes++; return tx.set(...args); }, update: (...args: unknown[]) => { writes++; return tx.update(...args); } };
        const value = await work(counting);
        writeCounts.push(writes);
        return value;
      });
      profileStates.push(structuredClone(db.records.get(profilePath)));
      return result;
    };
    const result = await core.migrateLegacyPlaidCredentials(asDb(db), fakeFieldValue, uid, { paginateAccounts: true });
    expect(result).toEqual({ outcome: 'migrated', tokenMoved: true, accountTokensCleared: 450, paginated: true });
    expect(writeCounts).toEqual([2, 400, 50, 1, 1]);
    expect(Math.max(...writeCounts)).toBeLessThanOrEqual(core.LEGACY_ACCOUNT_TRANSACTION_LIMIT);
    // The token leaves the profile in the first transaction (rules allow the read again) but the
    // completion marker waits until every account is clean, so an interrupted run resumes on rerun.
    expect(profileStates[0]).toEqual({ name: 'Big', bankConnected: false });
    expect(profileStates.at(-1)).toEqual({ name: 'Big', bankConnected: false, plaid_credentials_migrated: true });
    for (let index = 0; index < 450; index++) {
      expect(db.records.get(`${profilePath}/accounts/acct-${index}`)).toEqual({ user_id: uid, plaid_item_id: 'big-item', name: `Account ${index}` });
    }
    expect(db.records.get('plaid_connections/big-item')!.accountIds).toHaveLength(450);
    expect(await core.migrateLegacyPlaidCredentials(asDb(db), fakeFieldValue, uid, { paginateAccounts: true })).toMatchObject({ outcome: 'already_migrated' });
  });
  it('resumes an interrupted paginated cleanup instead of leaving account tokens behind', async () => {
    db.records.set(profilePath, { name: 'Big', plaid_token: 'legacy-secret', plaid_item_id: 'big-item' });
    for (let index = 0; index < 401; index++) db.records.set(`${profilePath}/accounts/acct-${index}`, { user_id: uid, access_token: `secret-${index}` });
    const original = db.runTransaction;
    let transactions = 0;
    db.runTransaction = async (work: FakeWork) => {
      if (++transactions === 2) throw new Error('simulated outage');
      return original(work);
    };
    await expect(core.migrateLegacyPlaidCredentials(asDb(db), fakeFieldValue, uid, { paginateAccounts: true })).rejects.toThrow('simulated outage');
    expect(db.records.get(profilePath)).toEqual({ name: 'Big', bankConnected: false });
    expect(db.records.get(`${profilePath}/accounts/acct-0`)!.access_token).toBe('secret-0');
    db.runTransaction = original;
    const rerun = await core.migrateLegacyPlaidCredentials(asDb(db), fakeFieldValue, uid, { paginateAccounts: true });
    expect(rerun).toEqual({ outcome: 'migrated', tokenMoved: false, accountTokensCleared: 401, paginated: true });
    expect(db.records.get(profilePath)).toEqual({ name: 'Big', bankConnected: false, plaid_credentials_migrated: true });
    expect([...db.records].filter(([key, data]) => key.startsWith(`${profilePath}/accounts/`) && 'access_token' in data)).toEqual([]);
    expect(decryptPlaidToken(uid, 'big-item', db.records.get('plaid_connections/big-item')!.encryptedAccessToken)).toBe('legacy-secret');
  });
  it('is a no-op on rerun after a successful migration', async () => {
    seedLegacyRecords();
    await core.migrateLegacyPlaidCredentials(asDb(db), fakeFieldValue, uid);
    const after = snapshot(db);
    expect(await core.migrateLegacyPlaidCredentials(asDb(db), fakeFieldValue, uid)).toEqual({ outcome: 'already_migrated', tokenMoved: false, accountTokensCleared: 0, paginated: false });
    expect(snapshot(db)).toEqual(after);
    expect(await core.migrateLegacyPlaidCredentials(asDb(db), fakeFieldValue, 'nobody')).toMatchObject({ outcome: 'missing' });
  });
  it('refuses when the legacy Item already belongs to another user and changes nothing', async () => {
    seedLegacyRecords();
    db.records.set('plaid_connections/old-item', { uid: 'someone-else', status: 'active', encryptedAccessToken: 'theirs' });
    const before = snapshot(db);
    await expect(core.migrateLegacyPlaidCredentials(asDb(db), fakeFieldValue, uid)).rejects.toThrow('ownership mismatch');
    expect(snapshot(db)).toEqual(before);
  });
});

describe('production Plaid credential migration command', () => {
  it('dry run writes only a private plan, changes nothing and prints no identifiers', async () => {
    seedLegacyRecords();
    const { checkout, backup } = workspace();
    const run = runner(checkout, backup);
    const before = snapshot(db);
    const result = await run({ confirmation: `plan:${project}` });
    expect(result).toMatchObject({ mode: 'dry_run', writesPerformed: false, totals: {
      profiles: 3, toMigrate: 1, profilesWithProfileToken: 1, profilesWithAccountTokens: 1, accountsWithToken: 1, profilesWithItemId: 1, paginated: 0, manualReview: 0, expectedRefusals: 0,
    } });
    expect(snapshot(db)).toEqual(before);
    expect(fs.readdirSync(backup)).toEqual([path.basename(result.planFile)]);
    expect(fs.statSync(result.planFile).mode & 0o077).toBe(0);
    const planText = fs.readFileSync(result.planFile, 'utf8');
    expect(sha256(planText)).toBe(result.planDigest);
    const plan = JSON.parse(planText);
    expect(plan.profiles).toEqual([{
      uid, action: 'migrate', profileTokenPresent: true, accountTokenCount: 1, itemIdPresent: true, itemIdShared: false, accountCount: 2, paginated: false,
      alreadyMarked: false, existingConnection: 'none', expectedRefusal: null,
    }]);
    for (const secret of ['legacy-secret', 'account-secret', 'old-item']) { expect(planText).not.toContain(secret); }
    for (const secret of ['legacy-secret', 'account-secret', 'old-item', uid]) { expect(JSON.stringify(result)).not.toContain(secret); }
  });
  it('apply needs the reviewed plan digest, backs up every affected document before the first write, then migrates once', async () => {
    seedLegacyRecords();
    const { checkout, backup } = workspace();
    const run = runner(checkout, backup);
    const original = snapshot(db);
    const plan = await run({ confirmation: `plan:${project}` });
    await expect(run({ apply: true, confirmation: `apply:${project}:${'0'.repeat(64)}` })).rejects.toThrow('run the dry run first');
    await expect(run({ apply: true, confirmation: `apply:${project}` })).rejects.toThrow('sha256 of the reviewed dry-run plan');
    expect(snapshot(db)).toEqual(original);

    const originalTransaction = db.runTransaction;
    let backupPresentAtFirstWrite: boolean | null = null;
    db.runTransaction = async (work: FakeWork) => {
      if (backupPresentAtFirstWrite === null) {
        const files = fs.readdirSync(backup).filter(name => name.includes('-backup-'));
        backupPresentAtFirstWrite = files.length === 1 && JSON.parse(fs.readFileSync(path.join(backup, files[0]), 'utf8')).documents.length === 1;
      }
      return originalTransaction(work);
    };
    const result = await run({ apply: true, confirmation: `apply:${project}:${plan.planDigest}` });
    expect(backupPresentAtFirstWrite).toBe(true);
    expect(result).toMatchObject({ mode: 'apply', writesPerformed: true, planDigest: plan.planDigest, failures: [],
      totals: { planned: 1, migrated: 1, alreadyMigrated: 0, tokensMoved: 1, accountTokensCleared: 1, paginated: 0, failed: 0 } });
    const backupText = fs.readFileSync(result.backupFile, 'utf8');
    expect(sha256(backupText)).toBe(result.backupDigest);
    expect(fs.statSync(result.backupFile).mode & 0o077).toBe(0);
    expect(JSON.parse(backupText)).toMatchObject({ kind: 'backup', planDigest: plan.planDigest, documents: [{
      uid, path: profilePath, exists: true, data: original[profilePath],
      accounts: [{ path: `${profilePath}/accounts/checking`, exists: true, data: original[`${profilePath}/accounts/checking`] }],
    }] });
    expect(JSON.parse(fs.readFileSync(result.resultFile, 'utf8')).outcomes).toEqual([{ uid, outcome: 'migrated', tokenMoved: true, accountTokensCleared: 1, paginated: false }]);
    for (const secret of ['legacy-secret', 'account-secret', 'old-item', uid]) { expect(JSON.stringify(result)).not.toContain(secret); }
    expect(db.records.get(profilePath)).toEqual({ name: 'Legacy', profession: 'Designer', plaid_credentials_migrated: true, bankConnected: false });
    expect(db.records.get(`${profilePath}/accounts/checking`)).toEqual({ user_id: uid, plaid_item_id: 'old-item', name: 'Checking' });
    expect(db.records.get(`${profilePath}/accounts/checking/transactions/tx`)).toEqual(original[`${profilePath}/accounts/checking/transactions/tx`]);
    expect(db.records.get('user_profiles/clean')).toEqual({ name: 'Never linked' });
    expect(db.records.get('user_profiles/marked')).toEqual({ name: 'Already migrated', plaid_credentials_migrated: true });
    expect(decryptPlaidToken(uid, 'old-item', db.records.get('plaid_connections/old-item')!.encryptedAccessToken)).toBe('legacy-secret');

    db.runTransaction = originalTransaction;
    await expect(run({ apply: true, confirmation: `apply:${project}:${plan.planDigest}` })).rejects.toThrow('already contains a backup for this plan');
    const migrated = snapshot(db);
    const rerunPlan = await run({ confirmation: `plan:${project}` });
    expect(rerunPlan.totals).toMatchObject({ toMigrate: 0, profilesWithProfileToken: 0, accountsWithToken: 0 });
    const rerun = await run({ apply: true, confirmation: `apply:${project}:${rerunPlan.planDigest}` });
    expect(rerun).toMatchObject({ mode: 'apply', writesPerformed: false, totals: { planned: 0, migrated: 0 } });
    expect(snapshot(db)).toEqual(migrated);
    expect(fs.readdirSync(backup).filter(name => name.includes('-backup-'))).toHaveLength(1);
  });
  it('refuses stale plans, a changed key, wrong projects, emulators without the flag and backups inside the checkout', async () => {
    seedLegacyRecords();
    const { checkout, backup } = workspace();
    const run = runner(checkout, backup);
    const before = snapshot(db);
    const plan = await run({ confirmation: `plan:${project}` });
    db.records.set('user_profiles/newcomer', { plaid_token: 'another-secret' });
    await expect(run({ apply: true, confirmation: `apply:${project}:${plan.planDigest}` })).rejects.toThrow('changed since the reviewed plan');
    db.records.delete('user_profiles/newcomer');
    await expect(run({ apply: true, confirmation: `apply:${project}:${plan.planDigest}`, inheritedEnv: { ...env, PLAID_TOKEN_ENCRYPTION_KEY: '4'.repeat(64) } })).rejects.toThrow('differs from the key');
    await expect(run({ confirmation: `plan:${project}`, inheritedEnv: { ...env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' } })).rejects.toThrow('refuses a Firestore emulator');
    await expect(run({ confirmation: 'plan:writeoff-production-testing', project: 'writeoff-production-testing' })).rejects.toThrow(`Use --project ${project}`);
    await expect(run({ confirmation: `plan:${project}`, allowEmulator: true, inheritedEnv: { ...env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' } })).rejects.toThrow('demo- project');
    await expect(run({ confirmation: `plan:${project}`, backupDir: path.join(checkout, 'backup') })).rejects.toThrow('outside the repository checkout');
    // Run from a subdirectory of the checkout: the backup directory is still inside the repository.
    const scripts = path.join(checkout, 'scripts');
    fs.mkdirSync(scripts);
    await expect(run({ confirmation: `plan:${project}`, cwd: scripts, checkoutRoot: checkout, backupDir: path.join(checkout, 'backup') })).rejects.toThrow('outside the repository checkout');
    await expect(run({ confirmation: `plan:${project}`, cwd: scripts, checkoutRoot: checkout, backupDir: checkout })).rejects.toThrow('outside the repository checkout');
    expect(fs.readdirSync(checkout).sort()).toEqual(['backup', 'scripts']);
    expect(fs.readdirSync(path.join(checkout, 'backup'))).toEqual([]);
    await expect(run({ confirmation: `plan:${project}`, backupDir: 'relative/backup' })).rejects.toThrow('absolute');
    await expect(run({ confirmation: `plan:${project}`, inheritedEnv: { ...env, PLAID_TOKEN_ENCRYPTION_KEY: 'not-a-key' } })).rejects.toThrow('PLAID_TOKEN_ENCRYPTION_KEY must be set');
    await expect(run({ apply: true, verify: true, confirmation: `verify:${project}` })).rejects.toThrow('either --apply or --verify');
    expect(snapshot(db)).toEqual(before);
    expect(fs.readdirSync(backup)).toEqual([path.basename(plan.planFile)]);
  });
  it('verify fails while any token remains and passes after the migration, without needing the key', async () => {
    seedLegacyRecords();
    const { checkout, backup } = workspace();
    const run = runner(checkout, backup);
    const verifyEnv = { PLAID_CLIENT_ID: 'new-client', PLAID_ENV: 'production' };
    await expect(run({ verify: true, confirmation: `plan:${project}`, inheritedEnv: verifyEnv })).rejects.toThrow(`Use --confirm verify:${project}`);
    const failing = await run({ verify: true, confirmation: `verify:${project}`, inheritedEnv: verifyEnv });
    expect(failing).toMatchObject({ mode: 'verify', clean: false, writesPerformed: false, totals: { profiles: 3, profilesWithToken: 1, accountsWithToken: 1, profilesWithLegacyItemId: 1, profilesNotMarked: 2 } });
    const report = JSON.parse(fs.readFileSync(failing.reportFile, 'utf8'));
    expect(report.remaining).toEqual({ profiles: [uid], accounts: [{ uid, count: 1 }] });
    expect(sha256(fs.readFileSync(failing.reportFile))).toBe(failing.reportDigest);
    expect(fs.readFileSync(failing.reportFile, 'utf8')).not.toContain('secret');
    const plan = await run({ confirmation: `plan:${project}` });
    await run({ apply: true, confirmation: `apply:${project}:${plan.planDigest}` });
    const passing = await run({ verify: true, confirmation: `verify:${project}`, inheritedEnv: verifyEnv });
    expect(passing).toMatchObject({ clean: true, totals: { profilesWithToken: 0, accountsWithToken: 0, profilesWithLegacyItemId: 0 } });
  });
  it('plans manual review and expected refusals, then continues past a refused profile without exposing it', async () => {
    db.records.set('user_profiles/marked', { plaid_credentials_migrated: true, name: 'Marked' });
    db.records.set('user_profiles/marked/accounts/a', { user_id: 'marked', access_token: 'left-behind' });
    db.records.set('user_profiles/foreign', { plaid_token: 'foreign-secret', plaid_item_id: 'taken-item' });
    db.records.set('plaid_connections/taken-item', { uid: 'someone-else', status: 'relink_required' });
    db.records.set('user_profiles/clean', { name: 'Clean' });
    db.records.set('user_profiles/big', { access_token: 'big-secret' });
    for (let index = 0; index < 401; index++) db.records.set(`user_profiles/big/accounts/acct-${index}`, { user_id: 'big', plaid_token: `s-${index}` });
    const state = await loadPlaidCredentialMigrationState(asDb(db), core);
    const plan = buildPlaidCredentialMigrationPlan({ project, sourceCommit: 'a'.repeat(40), generatedAt: '2026-09-17T00:00:00.000Z', encryptionKeyFingerprint: 'fp', state, core });
    expect(plan.profiles.map(({ uid: id, action, paginated, existingConnection, expectedRefusal }) => [id, action, paginated, existingConnection, expectedRefusal])).toEqual([
      ['big', 'migrate', true, 'none', null],
      ['foreign', 'migrate', false, 'foreign', 'ownership_mismatch'],
      ['marked', 'manual_review', false, 'not_applicable', null],
    ]);
    expect(plan.totals).toEqual({ profiles: 4, toMigrate: 2, profilesWithProfileToken: 2, profilesWithAccountTokens: 2, accountsWithToken: 402, profilesWithItemId: 1, paginated: 1, manualReview: 1, expectedRefusals: 1 });
    expect(JSON.stringify(plan)).not.toMatch(/secret|taken-item|s-1/);

    const { checkout, backup } = workspace();
    const run = runner(checkout, backup);
    const written = await run({ confirmation: `plan:${project}` });
    const result = await run({ apply: true, confirmation: `apply:${project}:${written.planDigest}` });
    expect(result.totals).toEqual({ planned: 2, migrated: 1, alreadyMigrated: 0, tokensMoved: 1, accountTokensCleared: 401, paginated: 1, failed: 1 });
    expect(result.failures).toEqual(['Bank connection ownership mismatch']);
    expect(db.records.get('user_profiles/foreign')!.plaid_token).toBe('foreign-secret');
    expect(db.records.get('plaid_connections/taken-item')).toEqual({ uid: 'someone-else', status: 'relink_required' });
    expect(db.records.get('user_profiles/marked/accounts/a')!.access_token).toBe('left-behind');
    expect(db.records.get('user_profiles/big')).toEqual({ plaid_credentials_migrated: true, bankConnected: false });
    const backupJson = JSON.parse(fs.readFileSync(result.backupFile, 'utf8'));
    expect(backupJson.documents.map((document: { uid: string; accounts: unknown[] }) => [document.uid, document.accounts.length])).toEqual([['big', 401], ['foreign', 0]]);
    expect(JSON.stringify(result)).not.toMatch(/secret|taken-item|foreign|big/);
  });
  it('sends two token-bearing profiles that claim one bank item to manual review instead of letting the first uid win', async () => {
    seedLegacyRecords();
    // Same item as the seeded legacy user, with its own token; without the flag the lexicographically
    // earlier uid would create plaid_connections/old-item and the other would fail at apply.
    db.records.set('user_profiles/copycat', { plaid_token: 'copycat-secret', plaid_item_id: 'old-item' });
    // A profile that only carries the item id (no token) does not claim the connection and still migrates.
    db.records.set('user_profiles/id-only', { plaid_item_id: 'old-item', plaid_transactions_cursor: 'c' });
    const state = await loadPlaidCredentialMigrationState(asDb(db), core);
    const plan = buildPlaidCredentialMigrationPlan({ project, sourceCommit: 'a'.repeat(40), generatedAt: '2026-09-17T00:00:00.000Z', encryptionKeyFingerprint: 'fp', state, core });
    expect(plan.profiles.map(({ uid: id, action, itemIdShared, expectedRefusal }) => [id, action, itemIdShared, expectedRefusal])).toEqual([
      ['copycat', 'manual_review', true, null],
      ['id-only', 'migrate', false, null],
      [uid, 'manual_review', true, null],
    ]);
    expect(plan.totals).toMatchObject({ toMigrate: 1, manualReview: 2, expectedRefusals: 0 });
    expect(JSON.stringify(plan)).not.toMatch(/secret|old-item/);

    const { checkout, backup } = workspace();
    const run = runner(checkout, backup);
    const before = snapshot(db);
    const written = await run({ confirmation: `plan:${project}` });
    const result = await run({ apply: true, confirmation: `apply:${project}:${written.planDigest}` });
    expect(result.totals).toMatchObject({ planned: 1, migrated: 1, failed: 0 });
    expect(db.records.has('plaid_connections/old-item')).toBe(false);
    expect(db.records.get(profilePath)).toEqual(before[profilePath]);
    expect(db.records.get('user_profiles/copycat')).toEqual(before['user_profiles/copycat']);
    expect(db.records.get('user_profiles/id-only')).toMatchObject({ plaid_credentials_migrated: true });
  });
  it('requires the provider identity only when active private connections already exist', async () => {
    seedLegacyRecords();
    db.records.set('plaid_connections/active-item', { uid: 'other', status: 'active', clientId: 'new-client', environment: 'production' });
    const { checkout, backup } = workspace();
    const run = runner(checkout, backup);
    const plan = await run({ confirmation: `plan:${project}` });
    const withoutIdentity = { PLAID_TOKEN_ENCRYPTION_KEY: KEY };
    await expect(run({ apply: true, confirmation: `apply:${project}:${plan.planDigest}`, inheritedEnv: withoutIdentity })).rejects.toThrow('set PLAID_CLIENT_ID and PLAID_ENV');
    expect(db.records.get(profilePath)!.plaid_token).toBe('legacy-secret');
    expect(fs.readdirSync(backup).filter(name => name.includes('-backup-'))).toEqual([]);
    expect((await run({ apply: true, confirmation: `apply:${project}:${plan.planDigest}` })).totals.migrated).toBe(1);
  });
  it('serializes Firestore values so the backup stays restorable', () => {
    const timestamp = { seconds: 1_700_000_000, nanoseconds: 5, toDate: () => new Date(0) };
    expect(serializeFirestoreValue({ when: timestamp, bytes: Buffer.from('ab'), list: [new Date(0), null, 'x'], nested: { n: 1 } })).toEqual({
      when: { __type: 'timestamp', seconds: 1_700_000_000, nanoseconds: 5 },
      bytes: { __type: 'bytes', base64: 'YWI=' },
      list: [{ __type: 'date', iso: '1970-01-01T00:00:00.000Z' }, null, 'x'],
      nested: { n: 1 },
    });
  });
});
