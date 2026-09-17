import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PRODUCTION_PROJECT, RELEASE_MANIFEST } from './production-preflight.mjs';

export const PRODUCTION_MIGRATION_INVENTORY_SCHEMA = 1;
const ACCOUNT_MIGRATION_LIMIT = 400;

const hasValue = value => typeof value === 'string' && value.trim().length > 0;
const accountReference = (uid, accountId) => `user_profiles/${uid}/accounts/${accountId}`;
const transactionReference = (uid, accountId, transactionId) =>
  `${accountReference(uid, accountId)}/transactions/${transactionId}`;

function normalizedDate(value) {
  const text = typeof value === 'string' ? value.slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizedCents(value) {
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function normalizedMerchant(data) {
  const value = data.merchant_name || data.name || data.description;
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
    : '';
}

function overlapKey(data) {
  if (data.pending === true || data.bank_removed === true) return null;
  const date = normalizedDate(data.date);
  const cents = normalizedCents(data.amount);
  const merchant = normalizedMerchant(data);
  if (!date || cents === null || !merchant) return null;
  const currency = String(data.iso_currency_code || data.unofficial_currency_code || 'unknown').toUpperCase();
  return JSON.stringify([date, cents, merchant, currency]);
}

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Build a private, read-only migration inventory. Potential overlaps are exact
 * candidate matches for human review; this function never chooses, merges, or
 * changes a customer record.
 */
export function buildProductionMigrationInventory({
  profiles,
  connections = [],
  sourceCommit,
  generatedAt = new Date().toISOString(),
}) {
  const connectionsByUser = new Map();
  for (const connection of connections) {
    const uid = connection.uid;
    if (typeof uid !== 'string' || !uid) continue;
    const list = connectionsByUser.get(uid) || [];
    list.push(connection);
    connectionsByUser.set(uid, list);
  }

  const profileReports = [];
  let accountDocuments = 0;
  let transactionDocuments = 0;
  let confirmedTransactions = 0;
  let savedTaxDecisions = 0;
  let potentialOverlapGroups = 0;

  for (const profile of profiles) {
    const uid = profile.uid;
    const profileData = profile.data || {};
    const accounts = profile.accounts || [];
    accountDocuments += accounts.length;
    const candidateGroups = new Map();
    let profileTransactions = 0;
    let profileConfirmed = 0;
    let profileTaxDecisions = 0;
    let accountLegacyCredentials = false;
    const accountReports = [];

    for (const account of accounts) {
      const accountData = account.data || {};
      const legacyCredentialPresent = hasValue(accountData.plaid_token) || hasValue(accountData.access_token);
      if (legacyCredentialPresent) {
        accountLegacyCredentials = true;
      }
      const isBankAccount = accountData.source === 'plaid' || hasValue(accountData.plaid_item_id);
      let accountConfirmed = 0;
      let accountTaxDecisions = 0;
      for (const transaction of account.transactions || []) {
        profileTransactions++;
        transactionDocuments++;
        if (transaction.data?.review_status === 'confirmed') {
          accountConfirmed++;
          profileConfirmed++;
          confirmedTransactions++;
        }
        if (typeof transaction.data?.is_deductible === 'boolean') {
          accountTaxDecisions++;
          profileTaxDecisions++;
          savedTaxDecisions++;
        }
        if (!isBankAccount) continue;
        const key = overlapKey(transaction.data || {});
        if (!key) continue;
        const matches = candidateGroups.get(key) || [];
        matches.push({
          accountId: account.id,
          reference: transactionReference(uid, account.id, transaction.id),
          confirmed: transaction.data?.review_status === 'confirmed',
          savedTaxDecision: typeof transaction.data?.is_deductible === 'boolean',
        });
        candidateGroups.set(key, matches);
      }
      accountReports.push({
        reference: accountReference(uid, account.id),
        bankAccount: isBankAccount,
        legacyCredentialPresent,
        legacyItemPresent: hasValue(accountData.plaid_item_id),
        transactionCount: (account.transactions || []).length,
        confirmedTransactionCount: accountConfirmed,
        savedTaxDecisionCount: accountTaxDecisions,
      });
    }

    const overlaps = [...candidateGroups.entries()]
      .filter(([, records]) => new Set(records.map(record => record.accountId)).size > 1)
      .map(([key, records]) => ({
        fingerprint: fingerprint(key),
        records: records.map(({ accountId: _accountId, ...record }) => record),
        resolution: 'human_review_required',
      }));
    potentialOverlapGroups += overlaps.length;
    const privateConnections = connectionsByUser.get(uid) || [];
    profileReports.push({
      uid,
      legacyProfileCredentialPresent: hasValue(profileData.plaid_token) || hasValue(profileData.access_token),
      legacyProfileItemPresent: hasValue(profileData.plaid_item_id),
      accountLegacyCredentialPresent: accountLegacyCredentials,
      credentialMigrationMarked: profileData.plaid_credentials_migrated === true,
      accountCount: accounts.length,
      requiresPaginatedMigration: accounts.length > ACCOUNT_MIGRATION_LIMIT,
      transactionCount: profileTransactions,
      confirmedTransactionCount: profileConfirmed,
      savedTaxDecisionCount: profileTaxDecisions,
      privateConnectionCount: privateConnections.length,
      privateConnectionStates: [...new Set(privateConnections.map(connection => connection.status || 'unknown'))].sort(),
      accounts: accountReports,
      potentialHistoricalOverlaps: overlaps,
    });
  }

  const legacyProfiles = profileReports.filter(profile =>
    profile.legacyProfileCredentialPresent || profile.accountLegacyCredentialPresent).length;
  return {
    schemaVersion: PRODUCTION_MIGRATION_INVENTORY_SCHEMA,
    project: PRODUCTION_PROJECT,
    sourceCommit,
    generatedAt,
    mode: 'read_only',
    guarantees: {
      writesPerformed: false,
      automatedReconciliationDecisions: 0,
      customerConfirmationsChanged: 0,
    },
    totals: {
      profiles: profileReports.length,
      legacyProfiles,
      profilesWithLegacyItemIds: profileReports.filter(profile => profile.legacyProfileItemPresent).length,
      profilesRequiringPaginatedMigration: profileReports.filter(profile => profile.requiresPaginatedMigration).length,
      accountDocuments,
      transactionDocuments,
      confirmedTransactions,
      savedTaxDecisions,
      privateConnections: connections.length,
      potentialHistoricalOverlapGroups: potentialOverlapGroups,
    },
    profiles: profileReports,
  };
}

export function writePrivateMigrationInventory(output, report, cwd = process.cwd()) {
  if (!path.isAbsolute(output)) throw new Error('The private inventory output path must be absolute');
  const relative = path.relative(path.resolve(cwd), output);
  if (!relative.startsWith(`..${path.sep}`) && relative !== '..') {
    throw new Error('Write the private inventory outside the repository checkout');
  }
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return fingerprint(fs.readFileSync(output));
}

async function mapWithConcurrency(values, limit, work) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await work(values[index], index);
    }
  }));
  return results;
}

export async function loadProductionMigrationRecords(db) {
  const profileSnapshot = await db.collection('user_profiles')
    .select('plaid_token', 'access_token', 'plaid_item_id', 'plaid_credentials_migrated')
    .get();
  const connectionSnapshot = await db.collection('plaid_connections')
    .select('uid', 'status')
    .get();
  const profiles = await mapWithConcurrency(profileSnapshot.docs, 5, async profileDoc => {
    const accountsSnapshot = await profileDoc.ref.collection('accounts')
      .select('source', 'plaid_item_id', 'plaid_token', 'access_token')
      .get();
    const accounts = await mapWithConcurrency(accountsSnapshot.docs, 5, async accountDoc => {
      const transactions = await accountDoc.ref.collection('transactions')
        .select(
          'date',
          'amount',
          'merchant_name',
          'name',
          'description',
          'iso_currency_code',
          'unofficial_currency_code',
          'pending',
          'bank_removed',
          'review_status',
          'is_deductible',
        )
        .get();
      return {
        id: accountDoc.id,
        data: accountDoc.data(),
        transactions: transactions.docs.map(doc => ({ id: doc.id, data: doc.data() })),
      };
    });
    return { uid: profileDoc.id, data: profileDoc.data(), accounts };
  });
  return {
    profiles,
    connections: connectionSnapshot.docs.map(doc => doc.data()),
  };
}

function sourceCommit(cwd) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(cwd, RELEASE_MANIFEST), 'utf8'));
    if (/^[a-f\d]{40}$/.test(manifest.commit || '')) return manifest.commit;
  } catch {
    // A reviewed checkout has Git metadata; a prepared release has the manifest.
  }
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  if (!/^[a-f\d]{40}$/.test(commit)) throw new Error('Could not identify the reviewed source commit');
  return commit;
}

export async function inspectProductionMigration({
  project,
  output,
  confirmation,
  cwd = process.cwd(),
  inheritedEnv = process.env,
}) {
  if (project !== PRODUCTION_PROJECT || confirmation !== `read-only:${PRODUCTION_PROJECT}`) {
    throw new Error(`Use --project ${PRODUCTION_PROJECT} and --confirm read-only:${PRODUCTION_PROJECT}`);
  }
  if (inheritedEnv.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Production inventory refuses a Firestore emulator');
  }
  const [{ initializeApp, applicationDefault }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
  ]);
  const app = initializeApp({
    credential: applicationDefault(),
    projectId: PRODUCTION_PROJECT,
  }, `production-migration-inventory-${Date.now()}`);
  const records = await loadProductionMigrationRecords(getFirestore(app));
  const report = buildProductionMigrationInventory({
    ...records,
    sourceCommit: sourceCommit(cwd),
  });
  const digest = writePrivateMigrationInventory(output, report, cwd);
  return { output, digest, totals: report.totals };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const values = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      if (!['--project', '--output', '--confirm'].includes(process.argv[i]) || !process.argv[i + 1]) {
        throw new Error('Use --project, --output and --confirm');
      }
      values[process.argv[i]] = process.argv[i + 1];
    }
    const result = await inspectProductionMigration({
      project: values['--project'],
      output: values['--output'],
      confirmation: values['--confirm'],
    });
    console.log(JSON.stringify(result, null, 2));
    console.log('No records were changed. Potential overlaps still require human review.');
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : 'Production migration inventory failed'}`);
    process.exitCode = 1;
  }
}
