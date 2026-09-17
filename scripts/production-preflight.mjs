import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parse } from 'dotenv';

export const PRODUCTION_PROJECT = 'writeoff-23910';
export const PRODUCTION_ORIGIN = 'https://writeoffapp.com';
// Public account identifier verified for this replacement rollout. Changing the
// provider account requires another explicit configuration/migration review.
export const EXPECTED_PRODUCTION_PLAID_CLIENT_ID = '6aab263acbddc2000d721272';
export const RELEASE_MANIFEST = '.writeoff-production-release.json';
export const MIGRATION_REVIEW = '.writeoff-production-migration-review.json';
export const RELEASE_ENV = '.env.production.local';
const buckets = [`${PRODUCTION_PROJECT}.firebasestorage.app`, `${PRODUCTION_PROJECT}.appspot.com`];
const protectedEnvironmentName = name => /^(?:NEXT_PUBLIC_|FIREBASE_|GOOGLE_CLOUD_PROJECT$|GCLOUD_PROJECT$|GCP_PROJECT$|WRITEOFF_ENV$|PLAID_|STRIPE_|ANALYSIS_WORKER_|CLOUD_FUNCTION_|SSN_|OPENAI_|COLUMN_TAX_|ENABLE_TRANSACTION_RESET$)/.test(name);
export const environmentDigest = contents => createHash('sha256').update(contents).digest('hex');

/** An operator review is required in addition to valid secrets and static config. */
export function validateMigrationReview(review, commit) {
  const errors = [];
  if (!review || review.schemaVersion !== 1 || review.project !== PRODUCTION_PROJECT || review.commit !== commit ||
      typeof review.reviewedBy !== 'string' || !review.reviewedBy.trim() ||
      typeof review.reviewedAt !== 'string' || !Number.isFinite(Date.parse(review.reviewedAt))) {
    errors.push('Migration review must identify the reviewer, date, exact release commit and production project');
  }
  for (const name of ['legacyProfileMigration', 'historicalOverlapReconciliation', 'oldClientCompatibility']) {
    if (review?.[name]?.reviewed !== true || typeof review?.[name]?.evidence !== 'string' || !review[name].evidence.trim()) {
      errors.push(`${name} requires an explicit completed review and evidence reference`);
    }
  }
  return errors;
}

/** Static configuration validation. This does not certify provider ownership or execute a deployment. */
export function validateProductionConfiguration(env, { project, hosting, firebaseConfig = {}, serviceAccount = {} } = {}) {
  const errors = [];
  const requireValue = name => { if (!env[name]?.trim()) errors.push(`${name} is required`); };
  for (const name of ['WRITEOFF_ENV', 'NEXT_PUBLIC_APP_ENV']) if (env[name] !== 'production') errors.push(`${name} must select production`);
  if (project !== PRODUCTION_PROJECT) errors.push('Deploy project must be the approved production project');
  const hosts = Array.isArray(hosting) ? hosting : [hosting];
  if (!hosts.length || hosts.some(host => host?.site !== PRODUCTION_PROJECT || host?.target || host?.source !== '.')) errors.push('Hosting must explicitly select the production site and release directory');
  requireValue('NEXT_PUBLIC_FIREBASE_PROJECT_ID');
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    FIREBASE_ADMIN_PROJECT_ID: env.FIREBASE_ADMIN_PROJECT_ID, GCLOUD_PROJECT: env.GCLOUD_PROJECT,
    GOOGLE_CLOUD_PROJECT: env.GOOGLE_CLOUD_PROJECT, GCP_PROJECT: env.GCP_PROJECT,
    'FIREBASE_CONFIG.projectId': firebaseConfig.projectId, 'GOOGLE_APPLICATION_CREDENTIALS.project_id': serviceAccount.project_id,
  })) if (value && value !== PRODUCTION_PROJECT) errors.push(`${name} targets an unapproved project`);
  for (const [name, value] of [['FIREBASE_ADMIN_CLIENT_EMAIL', env.FIREBASE_ADMIN_CLIENT_EMAIL], ['GOOGLE_APPLICATION_CREDENTIALS.client_email', serviceAccount.client_email]]) {
    if (value && !String(value).endsWith(`@${PRODUCTION_PROJECT}.iam.gserviceaccount.com`)) errors.push(`${name} must belong to the production project`);
  }
  if (!buckets.includes(env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)) errors.push('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET must use the production bucket');
  for (const [name, value] of [['FIREBASE_STORAGE_BUCKET', env.FIREBASE_STORAGE_BUCKET], ['FIREBASE_CONFIG.storageBucket', firebaseConfig.storageBucket]]) {
    if (value && !buckets.includes(value)) errors.push(`${name} targets an unapproved bucket`);
  }
  if (env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN !== `${PRODUCTION_PROJECT}.firebaseapp.com`) errors.push('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN must use the production auth domain');
  requireValue('NEXT_PUBLIC_FIREBASE_API_KEY');
  if (!/^1:930596534802:web:[a-f\d]+$/i.test(env.NEXT_PUBLIC_FIREBASE_APP_ID || '')) errors.push('NEXT_PUBLIC_FIREBASE_APP_ID must belong to the production project');
  if (env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID !== '930596534802') errors.push('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID must identify the production project');
  for (const name of ['NEXT_PUBLIC_SITE_URL', 'ANALYSIS_WORKER_ORIGIN']) if (env[name] !== PRODUCTION_ORIGIN) errors.push(`${name} must select the exact production origin`);
  if (env.PLAID_ENV !== 'production') errors.push('PLAID_ENV must explicitly select production');
  for (const name of ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'OPENAI_API_KEY']) requireValue(name);
  if (env.PLAID_CLIENT_ID !== EXPECTED_PRODUCTION_PLAID_CLIENT_ID) errors.push('PLAID_CLIENT_ID must identify the reviewed replacement provider account');
  if (env.PLAID_REDIRECT_URI !== `${PRODUCTION_ORIGIN}/plaid/oauth`) errors.push('PLAID_REDIRECT_URI must select the registered production callback');
  if (env.PLAID_WEBHOOK_URL && env.PLAID_WEBHOOK_URL !== `${PRODUCTION_ORIGIN}/api/plaid/webhook`) errors.push('PLAID_WEBHOOK_URL must select the production webhook');
  for (const name of ['PLAID_TOKEN_ENCRYPTION_KEY', 'SSN_ENCRYPTION_KEY']) {
    if (!/^[a-f\d]{64}$/i.test(env[name] || '')) errors.push(`${name} must be a dedicated 64-character hex key`);
  }
  if (env.PLAID_TOKEN_ENCRYPTION_KEY && env.PLAID_TOKEN_ENCRYPTION_KEY === env.SSN_ENCRYPTION_KEY) errors.push('Plaid tokens and taxpayer identifiers must use separate encryption keys');
  for (const name of ['ANALYSIS_WORKER_SECRET', 'CLOUD_FUNCTION_SECRET']) if ((env[name]?.trim().length || 0) < 32) errors.push(`${name} must contain at least 32 characters`);
  if (!/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || '')) errors.push('STRIPE_SECRET_KEY must be a live credential');
  if (!/^pk_live_/.test(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '')) errors.push('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a live credential');
  if (env.STRIPE_PUBLISHABLE_KEY && env.STRIPE_PUBLISHABLE_KEY !== env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) errors.push('Stripe publishable-key aliases must agree');
  if (!env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) errors.push('STRIPE_WEBHOOK_SECRET is required');
  const groups = {
    premiumMonthly: ['STRIPE_PRICE_ID_MONTHLY', 'NEXT_PUBLIC_STRIPE_PRICE_ID_MONTHLY', 'STRIPE_PRICE_ID', 'NEXT_PUBLIC_STRIPE_PRICE_ID'],
    premiumYearly: ['STRIPE_PRICE_ID_YEARLY', 'NEXT_PUBLIC_STRIPE_PRICE_ID_YEARLY'],
    basicMonthly: ['STRIPE_PRICE_ID_BASIC_MONTHLY', 'NEXT_PUBLIC_STRIPE_PRICE_ID_BASIC_MONTHLY', 'STRIPE_PRICE_ID_BASIC', 'NEXT_PUBLIC_STRIPE_PRICE_ID_BASIC'],
    basicYearly: ['STRIPE_PRICE_ID_BASIC_YEARLY', 'NEXT_PUBLIC_STRIPE_PRICE_ID_BASIC_YEARLY'],
  };
  const priceIds = {};
  for (const [group, names] of Object.entries(groups)) {
    const configured = names.filter(name => Boolean(env[name])).map(name => env[name]);
    if ((group !== 'basicYearly' && !configured.length) || configured.some(value => !/^price_[A-Za-z\d]+$/.test(value))) errors.push(`${group} needs a valid production price identifier`);
    if (new Set(configured).size > 1) errors.push(`${group} price aliases must agree`);
    priceIds[group] = configured[0];
  }
  const configuredPrices = Object.values(priceIds).filter(Boolean);
  if (new Set(configuredPrices).size !== configuredPrices.length) errors.push('Basic and Premium billing periods must use distinct price identifiers');
  for (const [name, value] of Object.entries(env)) {
    if (/^(?:NEXT_PUBLIC_)?STRIPE_/.test(name) && /^(?:sk|rk|pk)_test_/.test(value || '')) errors.push(`${name} contains a test credential`);
    if (/^NEXT_PUBLIC_(?:PLAID_|ANALYSIS_WORKER_|CLOUD_FUNCTION_|SSN_|OPENAI_|COLUMN_TAX_|STRIPE_(?:SECRET|WEBHOOK))/.test(name)) errors.push(`${name} must remain server-only`);
    if ((name.includes('EMULATOR') || name === 'FIREBASE_AUTH_EMULATOR_HOST') && value && value !== 'false') errors.push(`${name} must not enable emulators in production`);
  }
  if (env.COLUMN_TAX_MODE !== 'disabled') errors.push('COLUMN_TAX_MODE must explicitly remain disabled pending the separate filing launch');
  if (env.STRIPE_TEST_MODE_EXPIRE_TODAY === 'true' || env.ENABLE_TRANSACTION_RESET === 'true') errors.push('Test expiry and transaction reset switches must be disabled');
  return { errors: [...new Set(errors)], pending: [
    'Verify the new Plaid account has production Transactions access and registered OAuth callback; old-account tokens require relinking.',
    'Verify Stripe live account ownership, Basic price retention, Premium price amounts/intervals, and live webhook signing configuration.',
    'Verify production Secret Manager bindings match server worker secrets, preserve the existing SSN key, and verify rules/indexes and migration before rollout.',
  ] };
}

function readConfiguration(value, name, cwd) {
  if (!value) return {};
  try { return JSON.parse(value.trim().startsWith('{') ? value : fs.readFileSync(path.resolve(cwd, value), 'utf8')); }
  catch { throw new Error(`${name} configuration is unreadable`); }
}

export function runProductionPreflight({ cwd = process.cwd(), args = process.argv.slice(2), inheritedEnv = process.env } = {}) {
  let configFile = 'firebase.json';
  let project = inheritedEnv.GCLOUD_PROJECT;
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i + 1] || !['--project', '--config'].includes(args[i])) throw new Error('Use --project and --config for production preflight');
    if (args[i] === '--project') project = args[i + 1]; else configFile = args[i + 1];
  }
  const files = fs.readdirSync(cwd).filter(name => name.startsWith('.env') && name !== RELEASE_ENV);
  if (files.length) throw new Error('Use an isolated production release directory without other .env files');
  const envPath = path.join(cwd, RELEASE_ENV);
  if (!fs.existsSync(envPath) || fs.lstatSync(envPath).isSymbolicLink() || (fs.statSync(envPath).mode & 0o077)) throw new Error('The production env file must exist as a private regular file');
  const contents = fs.readFileSync(envPath, 'utf8');
  let manifest, config, migrationReview, migrationContents;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(cwd, RELEASE_MANIFEST), 'utf8'));
    config = JSON.parse(fs.readFileSync(path.resolve(cwd, configFile), 'utf8'));
    migrationContents = fs.readFileSync(path.join(cwd, MIGRATION_REVIEW), 'utf8');
    migrationReview = JSON.parse(migrationContents);
  }
  catch { throw new Error('Prepare an isolated production release before deployment'); }
  if (manifest.project !== PRODUCTION_PROJECT || !/^[a-f\d]{40}$/.test(manifest.commit || '') || manifest.environmentDigest !== environmentDigest(contents)) throw new Error('Production release manifest does not match the prepared configuration');
  if (manifest.migrationReviewDigest !== environmentDigest(migrationContents)) throw new Error('Production migration review does not match the prepared release');
  const env = parse(contents);
  const mismatches = Object.entries(inheritedEnv).filter(([name, value]) => protectedEnvironmentName(name) && env[name] !== undefined && value !== env[name]).map(([name]) => `${name} conflicts with the prepared production env file`);
  Object.assign(env, inheritedEnv);
  const result = validateProductionConfiguration(env, { project, hosting: config.hosting,
    firebaseConfig: readConfiguration(env.FIREBASE_CONFIG, 'FIREBASE_CONFIG', cwd),
    serviceAccount: readConfiguration(env.GOOGLE_APPLICATION_CREDENTIALS, 'GOOGLE_APPLICATION_CREDENTIALS', cwd) });
  result.errors.push(...mismatches);
  result.errors.push(...validateMigrationReview(migrationReview, manifest.commit));
  if (!config.functions?.some(item => item.source === 'functions-analysis' && item.codebase === 'analysis')) result.errors.push('The production analysis Functions codebase must be included');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = runProductionPreflight();
    for (const error of result.errors) console.error(`FAIL: ${error}`);
    for (const pending of result.pending) console.log(`PENDING: ${pending}`);
    if (result.errors.length) process.exitCode = 1;
    else console.log('PASS: prepared production configuration checks; provider and rollout verification still required');
  } catch (error) { console.error(`FAIL: ${error instanceof Error ? error.message : 'Production preflight failed'}`); process.exitCode = 1; }
}
