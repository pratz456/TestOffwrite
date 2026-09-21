/**
 * One-time administrative migration of legacy public Plaid credentials into the
 * private encrypted `plaid_connections` store, run BEFORE the coordinated release.
 *
 * The transaction itself is `migrateLegacyPlaidCredentials` in
 * lib/plaid/legacy-migration.ts, shared with the lazy per-user handshake; this
 * script only adds operator safeguards around it: a reviewed dry-run plan, a
 * verified private backup, pagination for very large account sets, and a
 * post-run verification that no profile still carries a token.
 *
 *   dry run : --project writeoff-23910 --backup /private/dir --confirm plan:writeoff-23910
 *   apply   : ... --apply  --confirm apply:writeoff-23910:<sha256 of the dry-run plan file>
 *   verify  : ... --verify --confirm verify:writeoff-23910
 *
 * Standard output carries aggregate counts, file paths and digests only. Tokens
 * are written solely to the mode-0600 backup file in the private directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRODUCTION_PROJECT } from './production-preflight.mjs';
import { sourceCommit } from './production-migration-inventory.mjs';

export const PLAID_CREDENTIAL_MIGRATION_SCHEMA = 1;
export const ARTIFACT_PREFIX = 'plaid-credential-migration';
const ENCRYPTION_KEY_VARIABLE = 'PLAID_TOKEN_ENCRYPTION_KEY';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digestOf = value => createHash('sha256').update(value).digest('hex');

let coreModule;
/** Load the shared TypeScript migration core through ts-node (CommonJS, transpile only). */
export function loadLegacyMigrationCore(root = repositoryRoot) {
  if (!coreModule) {
    const require = createRequire(pathToFileURL(path.join(root, 'scripts', 'production-plaid-credential-migration.mjs')).href);
    require('ts-node').register({
      transpileOnly: true,
      skipProject: true,
      compilerOptions: { module: 'commonjs', target: 'es2022', moduleResolution: 'node', esModuleInterop: true },
    });
    coreModule = require(path.join(root, 'lib', 'plaid', 'legacy-migration.ts'));
  }
  return coreModule;
}

/** The key is required before the plan so an unconfigured release is caught during the dry run. */
export function encryptionKeyFingerprint(env) {
  const value = env[ENCRYPTION_KEY_VARIABLE];
  if (!value || !/^[a-f\d]{64}$/i.test(value)) {
    throw new Error(`${ENCRYPTION_KEY_VARIABLE} must be set to the 64-character hex key the application will run with; ` +
      'legacy tokens are encrypted with it and cannot be recovered under a different key');
  }
  return digestOf(`plaid-token-encryption-key:${value.toLowerCase()}`).slice(0, 16);
}

/**
 * Absolute, real, existing directory outside every listed root; created private if missing.
 * The checkout that holds this script is always a root, whatever the working directory is,
 * so a run from a subdirectory cannot place a backup of plaintext tokens inside the repository.
 */
export function privateBackupDirectory(directory, roots = [repositoryRoot, process.cwd()]) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('The backup directory must be an absolute path');
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
  const resolved = fs.realpathSync(directory);
  if (!fs.statSync(resolved).isDirectory()) throw new Error('The backup directory must be a directory');
  for (const root of Array.isArray(roots) ? roots : [roots]) {
    const relative = path.relative(fs.realpathSync(root), resolved);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..')) {
      throw new Error('Keep the backup directory outside the repository checkout');
    }
  }
  return resolved;
}

/** New private file; the digest is recomputed from disk so the caller can rely on it. */
export function writePrivateArtifact(filePath, contents) {
  if (fs.existsSync(filePath)) throw new Error(`${path.basename(filePath)} already exists`);
  fs.writeFileSync(filePath, contents, { mode: 0o600, flag: 'wx' });
  const digest = digestOf(fs.readFileSync(filePath));
  if (digest !== digestOf(contents)) throw new Error(`${path.basename(filePath)} did not verify after writing`);
  return digest;
}

const artifactPath = (directory, kind, id) => path.join(directory, `${ARTIFACT_PREFIX}-${kind}-${id}.json`);
const stamp = date => date.toISOString().replace(/[:.]/g, '-');

/** Read just the legacy fields of every profile and account, plus existing private connections. */
export async function loadPlaidCredentialMigrationState(db, core) {
  const profiles = await db.collection('user_profiles').select(...core.LEGACY_PROFILE_FIELDS, 'plaid_credentials_migrated').get();
  const state = [];
  for (const profile of profiles.docs) {
    const accounts = await profile.ref.collection('accounts').select('plaid_token', 'access_token', 'plaid_item_id').get();
    const data = profile.data() || {};
    let existingConnection = 'not_applicable';
    let itemIdError = null;
    if (core.legacyPlaidToken(data)) {
      try {
        const connection = await db.collection('plaid_connections').doc(core.legacyPlaidItemId(profile.id, data)).get();
        existingConnection = !connection.exists ? 'none' : connection.data()?.uid === profile.id ? 'owned' : 'foreign';
      } catch (error) {
        itemIdError = error instanceof Error ? error.message : 'Invalid bank identifier';
      }
    }
    state.push({
      uid: profile.id, ref: profile.ref, data, existingConnection, itemIdError,
      accounts: accounts.docs.map(account => ({ id: account.id, ref: account.ref, data: account.data() || {} })),
    });
  }
  const active = await db.collection('plaid_connections').where('status', '==', 'active').select('uid').limit(1).get();
  return { profiles: state, activeConnectionsExist: !active.empty };
}

/** Per-profile intentions, mirroring exactly which profiles the shared core would change. */
export function buildPlaidCredentialMigrationPlan({ project, sourceCommit: commit, generatedAt, encryptionKeyFingerprint: fingerprint, state, core }) {
  const entries = [];
  const totals = {
    profiles: state.profiles.length, toMigrate: 0, profilesWithProfileToken: 0, profilesWithAccountTokens: 0, accountsWithToken: 0,
    profilesWithItemId: 0, paginated: 0, manualReview: 0, expectedRefusals: 0,
  };
  // Two token-bearing profiles naming the same bank item would race for one private connection:
  // the first uid would claim it and the second would fail at apply time. Neither is migrated
  // automatically; the operator resolves the ownership first.
  const claimedItemId = profile => {
    if (!core.hasLegacyPlaidToken(profile.data) || profile.itemIdError) return null;
    try { return core.legacyPlaidItemId(profile.uid, profile.data); } catch { return null; }
  };
  const itemIdOwners = new Map();
  for (const profile of state.profiles) {
    const itemId = claimedItemId(profile);
    if (itemId) itemIdOwners.set(itemId, (itemIdOwners.get(itemId) ?? 0) + 1);
  }
  for (const profile of state.profiles) {
    const data = profile.data;
    const profileTokenPresent = core.hasLegacyPlaidToken(data);
    const accountTokenCount = profile.accounts.filter(account => core.hasLegacyPlaidToken(account.data)).length;
    const itemIdPresent = 'plaid_item_id' in data;
    const cursorPresent = 'plaid_transactions_cursor' in data;
    const alreadyMarked = data.plaid_credentials_migrated === true;
    // The core returns early only for a marked profile whose token keys are gone.
    const coreWouldRun = !(alreadyMarked && !profileTokenPresent);
    const legacy = profileTokenPresent || itemIdPresent || cursorPresent || accountTokenCount > 0;
    if (!legacy) continue;
    const itemIdShared = (itemIdOwners.get(claimedItemId(profile)) ?? 0) > 1;
    const action = !coreWouldRun ? (accountTokenCount > 0 ? 'manual_review' : 'skip') : itemIdShared ? 'manual_review' : 'migrate';
    const expectedRefusal = action !== 'migrate' ? null
      : profile.itemIdError ? 'invalid_item_id' : profile.existingConnection === 'foreign' ? 'ownership_mismatch' : null;
    const entry = {
      uid: profile.uid, action, profileTokenPresent, accountTokenCount, itemIdPresent, itemIdShared, accountCount: profile.accounts.length,
      paginated: profile.accounts.length > core.LEGACY_ACCOUNT_TRANSACTION_LIMIT, alreadyMarked,
      existingConnection: profile.existingConnection, expectedRefusal,
    };
    entries.push(entry);
    if (action === 'migrate') totals.toMigrate++;
    if (action === 'manual_review') totals.manualReview++;
    if (profileTokenPresent) totals.profilesWithProfileToken++;
    if (accountTokenCount) { totals.profilesWithAccountTokens++; totals.accountsWithToken += accountTokenCount; }
    if (itemIdPresent) totals.profilesWithItemId++;
    if (entry.paginated && action === 'migrate') totals.paginated++;
    if (expectedRefusal) totals.expectedRefusals++;
  }
  entries.sort((a, b) => a.uid.localeCompare(b.uid));
  return {
    schemaVersion: PLAID_CREDENTIAL_MIGRATION_SCHEMA, kind: 'plan', project, sourceCommit: commit, generatedAt,
    encryptionKeyFingerprint: fingerprint, mode: 'dry_run', writesPerformed: false,
    guarantees: { deletesTransactions: false, deletesAccounts: false, deletesConfirmations: false, deletesPrivateConnections: false },
    totals, profiles: entries,
  };
}

/** JSON-safe copy of a Firestore document that keeps typed values restorable. */
export function serializeFirestoreValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { __type: 'bytes', base64: Buffer.from(value).toString('base64') };
  if (value instanceof Date) return { __type: 'date', iso: value.toISOString() };
  if (typeof value.toDate === 'function' && typeof value.seconds === 'number' && typeof value.nanoseconds === 'number') {
    return { __type: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (typeof value.latitude === 'number' && typeof value.longitude === 'number' && typeof value.isEqual === 'function') {
    return { __type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  }
  if (typeof value.path === 'string' && value.firestore && typeof value.get === 'function') return { __type: 'reference', path: value.path };
  if (Array.isArray(value)) return value.map(serializeFirestoreValue);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeFirestoreValue(item)]));
}

function findPlanByDigest(directory, digest) {
  for (const name of fs.readdirSync(directory)) {
    if (!name.startsWith(`${ARTIFACT_PREFIX}-plan-`) || !name.endsWith('.json')) continue;
    const filePath = path.join(directory, name);
    if (fs.lstatSync(filePath).isSymbolicLink()) continue;
    const contents = fs.readFileSync(filePath);
    if (digestOf(contents) === digest) return { filePath, plan: JSON.parse(contents.toString('utf8')) };
  }
  throw new Error('No dry-run plan with that digest exists in the backup directory; run the dry run first and review its plan');
}

async function defaultConnect({ project, allowEmulator }) {
  const [{ initializeApp, applicationDefault, deleteApp }, { getFirestore, FieldValue }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
  ]);
  const app = initializeApp({ ...(allowEmulator ? {} : { credential: applicationDefault() }), projectId: project },
    `plaid-credential-migration-${Date.now()}`);
  return { db: getFirestore(app), FieldValue, close: () => deleteApp(app) };
}

export async function runPlaidCredentialMigration({
  project, backupDir, confirmation, apply = false, verify = false, allowEmulator = false,
  cwd = process.cwd(), checkoutRoot = repositoryRoot, inheritedEnv = process.env, now = () => new Date(),
  sourceCommit: commit, connect = defaultConnect, core: providedCore,
}) {
  if (apply && verify) throw new Error('Choose either --apply or --verify');
  const mode = apply ? 'apply' : verify ? 'verify' : 'dry_run';
  if (allowEmulator) {
    if (!inheritedEnv.FIRESTORE_EMULATOR_HOST || !/^demo-[a-z0-9-]+$/.test(project || '')) {
      throw new Error('--allow-emulator is for local tests only: it requires FIRESTORE_EMULATOR_HOST and a demo- project');
    }
  } else {
    if (project !== PRODUCTION_PROJECT) throw new Error(`Use --project ${PRODUCTION_PROJECT}`);
    if (inheritedEnv.FIRESTORE_EMULATOR_HOST) throw new Error('Production credential migration refuses a Firestore emulator');
  }
  const expected = mode === 'dry_run' ? `plan:${project}` : mode === 'verify' ? `verify:${project}` : null;
  if (expected && confirmation !== expected) throw new Error(`Use --confirm ${expected}`);
  const planDigest = mode === 'apply' ? String(confirmation || '').match(new RegExp(`^apply:${project}:([a-f\\d]{64})$`))?.[1] : null;
  if (mode === 'apply' && !planDigest) throw new Error(`Use --apply --confirm apply:${project}:<sha256 of the reviewed dry-run plan file>`);
  const directory = privateBackupDirectory(backupDir, [checkoutRoot, cwd]);
  const fingerprint = mode === 'verify' ? null : encryptionKeyFingerprint(inheritedEnv);
  const core = providedCore ?? loadLegacyMigrationCore();
  const generatedAt = now().toISOString();
  const reviewedCommit = commit ?? sourceCommit(cwd);
  const connection = await connect({ project, allowEmulator });
  try {
    const { db, FieldValue } = connection;
    const state = await loadPlaidCredentialMigrationState(db, core);

    if (mode === 'verify') {
      const remainingProfiles = state.profiles.filter(profile => core.hasLegacyPlaidToken(profile.data)).map(profile => profile.uid);
      const remainingAccounts = state.profiles
        .map(profile => ({ uid: profile.uid, count: profile.accounts.filter(account => core.hasLegacyPlaidToken(account.data)).length }))
        .filter(entry => entry.count > 0);
      const totals = {
        profiles: state.profiles.length,
        profilesWithToken: remainingProfiles.length,
        accountsWithToken: remainingAccounts.reduce((sum, entry) => sum + entry.count, 0),
        profilesWithLegacyItemId: state.profiles.filter(profile => 'plaid_item_id' in profile.data).length,
        profilesNotMarked: state.profiles.filter(profile => profile.data.plaid_credentials_migrated !== true).length,
      };
      const clean = totals.profilesWithToken === 0 && totals.accountsWithToken === 0;
      const report = { schemaVersion: PLAID_CREDENTIAL_MIGRATION_SCHEMA, kind: 'verify', project, sourceCommit: reviewedCommit, generatedAt,
        writesPerformed: false, clean, totals, remaining: { profiles: remainingProfiles, accounts: remainingAccounts } };
      const reportFile = artifactPath(directory, 'verify', stamp(new Date(generatedAt)));
      const reportDigest = writePrivateArtifact(reportFile, `${JSON.stringify(report, null, 2)}\n`);
      return { mode, project, reportFile, reportDigest, totals, clean, writesPerformed: false };
    }

    const plan = buildPlaidCredentialMigrationPlan({ project, sourceCommit: reviewedCommit, generatedAt, encryptionKeyFingerprint: fingerprint, state, core });
    if (mode === 'dry_run') {
      const planFile = artifactPath(directory, 'plan', stamp(new Date(generatedAt)));
      const digest = writePrivateArtifact(planFile, `${JSON.stringify(plan, null, 2)}\n`);
      return { mode, project, planFile, planDigest: digest, totals: plan.totals, writesPerformed: false,
        nextStep: `Review the plan file, then rerun with --apply --confirm apply:${project}:<sha256 of that plan file>` };
    }

    const { filePath: planFile, plan: reviewed } = findPlanByDigest(directory, planDigest);
    if (reviewed.schemaVersion !== PLAID_CREDENTIAL_MIGRATION_SCHEMA || reviewed.kind !== 'plan' || reviewed.project !== project) {
      throw new Error('The reviewed plan does not belong to this project or script version');
    }
    if (reviewed.encryptionKeyFingerprint !== fingerprint) {
      throw new Error(`${ENCRYPTION_KEY_VARIABLE} differs from the key present during the dry run; rerun the dry run with the release key`);
    }
    const backupFile = artifactPath(directory, 'backup', planDigest.slice(0, 16));
    const resultFile = artifactPath(directory, 'apply', planDigest.slice(0, 16));
    if (fs.existsSync(backupFile) || fs.existsSync(resultFile)) {
      throw new Error('The backup directory already contains a backup for this plan; rerun the dry run and review a fresh plan before applying again');
    }
    if (JSON.stringify(reviewed.profiles) !== JSON.stringify(plan.profiles)) {
      throw new Error('Production changed since the reviewed plan was written; rerun the dry run and review the new plan');
    }
    const targets = plan.profiles.filter(entry => entry.action === 'migrate');
    const totals = { planned: targets.length, migrated: 0, alreadyMigrated: 0, tokensMoved: 0, accountTokensCleared: 0, paginated: 0, failed: 0 };
    if (!targets.length) {
      return { mode, project, planFile, planDigest, totals, writesPerformed: false, message: 'No legacy credentials remain; nothing was changed' };
    }
    if (state.activeConnectionsExist && !(inheritedEnv.PLAID_CLIENT_ID && inheritedEnv.PLAID_ENV)) {
      throw new Error('Active private connections exist; set PLAID_CLIENT_ID and PLAID_ENV so bankConnected projections match the release');
    }
    const byUid = new Map(state.profiles.map(profile => [profile.uid, profile]));
    const documents = [];
    for (const target of targets) {
      const profile = byUid.get(target.uid);
      const snapshot = await profile.ref.get();
      const accounts = [];
      for (const account of profile.accounts.filter(entry => core.hasLegacyPlaidToken(entry.data))) {
        const accountSnapshot = await account.ref.get();
        accounts.push({ path: `user_profiles/${target.uid}/accounts/${account.id}`, exists: accountSnapshot.exists, data: serializeFirestoreValue(accountSnapshot.data() ?? null) });
      }
      documents.push({ uid: target.uid, path: `user_profiles/${target.uid}`, exists: snapshot.exists, data: serializeFirestoreValue(snapshot.data() ?? null), accounts });
    }
    const backup = { schemaVersion: PLAID_CREDENTIAL_MIGRATION_SCHEMA, kind: 'backup', project, sourceCommit: reviewedCommit, generatedAt,
      planDigest, encryptionKeyFingerprint: fingerprint, sensitivity: 'contains legacy provider credentials; keep private', documents };
    const backupDigest = writePrivateArtifact(backupFile, `${JSON.stringify(backup, null, 2)}\n`);
    const restored = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    if (restored.planDigest !== planDigest || restored.documents.length !== targets.length) throw new Error('The backup did not verify; nothing was changed');

    const outcomes = [];
    for (const target of targets) {
      try {
        const result = await core.migrateLegacyPlaidCredentials(db, FieldValue, target.uid, { paginateAccounts: true });
        outcomes.push({ uid: target.uid, ...result });
        if (result.outcome === 'migrated') totals.migrated++;
        if (result.outcome === 'already_migrated') totals.alreadyMigrated++;
        if (result.tokenMoved) totals.tokensMoved++;
        if (result.paginated) totals.paginated++;
        totals.accountTokensCleared += result.accountTokensCleared;
      } catch (error) {
        totals.failed++;
        outcomes.push({ uid: target.uid, outcome: 'failed', error: error instanceof Error ? error.message : 'Migration failed' });
      }
    }
    const result = { schemaVersion: PLAID_CREDENTIAL_MIGRATION_SCHEMA, kind: 'apply', project, sourceCommit: reviewedCommit, generatedAt,
      planDigest, backupDigest, totals, outcomes };
    const resultDigest = writePrivateArtifact(resultFile, `${JSON.stringify(result, null, 2)}\n`);
    const failures = [...new Set(outcomes.filter(entry => entry.outcome === 'failed').map(entry => entry.error))];
    return { mode, project, planFile, planDigest, backupFile, backupDigest, resultFile, resultDigest, totals, failures, writesPerformed: true };
  } finally {
    await connection.close?.();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const values = {};
    const flags = { '--apply': false, '--verify': false, '--allow-emulator': false };
    for (let i = 2; i < process.argv.length; i++) {
      const argument = process.argv[i];
      if (argument in flags) { flags[argument] = true; continue; }
      if (!['--project', '--backup', '--confirm'].includes(argument) || !process.argv[i + 1]) {
        throw new Error('Use --project, --backup and --confirm, optionally with --apply or --verify');
      }
      values[argument] = process.argv[++i];
    }
    const result = await runPlaidCredentialMigration({
      project: values['--project'], backupDir: values['--backup'], confirmation: values['--confirm'],
      apply: flags['--apply'], verify: flags['--verify'], allowEmulator: flags['--allow-emulator'],
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.mode === 'verify') {
      console.log(result.clean ? 'PASS: no profile or account carries a legacy Plaid token.' : 'FAIL: legacy Plaid tokens remain; see the private verify report.');
      if (!result.clean) process.exitCode = 1;
    } else if (result.mode === 'apply' && result.totals.failed) {
      console.error(`FAIL: ${result.totals.failed} profile(s) were not migrated; see the private apply result.`);
      process.exitCode = 1;
    } else if (result.mode === 'dry_run') {
      console.log('No records were changed. Review the private plan before applying.');
    }
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : 'Plaid credential migration failed'}`);
    process.exitCode = 1;
  }
}
