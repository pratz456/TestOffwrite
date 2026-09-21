import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'dotenv';

export const STAGING_PROJECT = 'writeoff-production-testing';
const buckets = [`${STAGING_PROJECT}.firebasestorage.app`, `${STAGING_PROJECT}.appspot.com`];

/** The output intentionally contains names and availability only, never configuration values. */
export function validateStagingConfiguration(env, { project, hosting, firebaseConfig = {}, serviceAccount = {} } = {}) {
  const errors = [];
  const pending = [];
  if (env.WRITEOFF_ENV !== 'staging') errors.push('WRITEOFF_ENV must select staging');
  if (env.NEXT_PUBLIC_APP_ENV !== 'staging') errors.push('NEXT_PUBLIC_APP_ENV must select staging');
  if (project !== STAGING_PROJECT) errors.push('Deploy project must be the approved staging project');
  const hosts = Array.isArray(hosting) ? hosting : [hosting];
  if (!hosts.length || hosts.some(host => host?.site !== STAGING_PROJECT || host?.target)) errors.push('Hosting site must explicitly select the approved staging site');
  if (!env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) errors.push('NEXT_PUBLIC_FIREBASE_PROJECT_ID is required');
  for (const [name, value] of [
    ['NEXT_PUBLIC_FIREBASE_PROJECT_ID', env.NEXT_PUBLIC_FIREBASE_PROJECT_ID],
    ['FIREBASE_ADMIN_PROJECT_ID', env.FIREBASE_ADMIN_PROJECT_ID],
    ['GCLOUD_PROJECT', env.GCLOUD_PROJECT], ['GOOGLE_CLOUD_PROJECT', env.GOOGLE_CLOUD_PROJECT], ['GCP_PROJECT', env.GCP_PROJECT],
    ['FIREBASE_CONFIG.projectId', firebaseConfig.projectId], ['GOOGLE_APPLICATION_CREDENTIALS.project_id', serviceAccount.project_id],
  ]) if (value && value !== STAGING_PROJECT) errors.push(`${name} targets an unapproved project`);
  for (const [name, value] of [
    ['FIREBASE_ADMIN_CLIENT_EMAIL', env.FIREBASE_ADMIN_CLIENT_EMAIL],
    ['GOOGLE_APPLICATION_CREDENTIALS.client_email', serviceAccount.client_email],
  ]) if (value && (typeof value !== 'string' || !value.endsWith(`@${STAGING_PROJECT}.iam.gserviceaccount.com`))) errors.push(`${name} must belong to the staging project`);
  const configuredBuckets = [
    ['FIREBASE_STORAGE_BUCKET', env.FIREBASE_STORAGE_BUCKET],
    ['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET],
    ['FIREBASE_CONFIG.storageBucket', firebaseConfig.storageBucket],
  ];
  if (!configuredBuckets.some(([, value]) => buckets.includes(value))) errors.push('An explicit staging Storage bucket is required');
  for (const [name, value] of configuredBuckets) if (value && !buckets.includes(value)) errors.push(`${name} targets an unapproved bucket`);
  if (env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN !== `${STAGING_PROJECT}.firebaseapp.com`) errors.push('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN must use the staging auth domain');
  try {
    const origin = new URL(env.NEXT_PUBLIC_SITE_URL);
    if (origin.protocol !== 'https:' || ![`${STAGING_PROJECT}.web.app`, `${STAGING_PROJECT}.firebaseapp.com`].includes(origin.hostname)) throw new Error();
  } catch { errors.push('NEXT_PUBLIC_SITE_URL must use an HTTPS staging site'); }
  if (env.PLAID_ENV !== 'sandbox') errors.push('PLAID_ENV must explicitly select sandbox');
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) pending.push('Plaid sandbox client ID/secret pending; bank journeys are unavailable');
  else if (!/^[a-fA-F0-9]{64}$/.test(env.PLAID_TOKEN_ENCRYPTION_KEY || '')) errors.push('PLAID_TOKEN_ENCRYPTION_KEY must be configured before bank connections are enabled');
  for (const [name, value] of Object.entries(env)) {
    if (/^(?:NEXT_PUBLIC_)?STRIPE_/.test(name) && /^(?:sk|rk|pk)_live_/.test(value || '')) errors.push(`${name} contains a live Stripe credential`);
  }
  if (env.STRIPE_SECRET_KEY && !/^(?:sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)) errors.push('STRIPE_SECRET_KEY must be a Stripe test credential');
  for (const name of ['STRIPE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY']) {
    if (env[name] && !/^pk_test_/.test(env[name])) errors.push(`${name} must be a Stripe test credential`);
  }
  const monthly = env.STRIPE_PRICE_ID_MONTHLY || env.NEXT_PUBLIC_STRIPE_PRICE_ID_MONTHLY || env.STRIPE_PRICE_ID || env.NEXT_PUBLIC_STRIPE_PRICE_ID;
  const yearly = env.STRIPE_PRICE_ID_YEARLY || env.NEXT_PUBLIC_STRIPE_PRICE_ID_YEARLY;
  for (const [name, value] of [['monthly price', monthly], ['yearly price', yearly]]) if (value && !value.startsWith('price_')) errors.push(`Stripe ${name} has an invalid identifier format`);
  if (env.STRIPE_WEBHOOK_SECRET && !env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) errors.push('STRIPE_WEBHOOK_SECRET has an invalid signing-secret format');
  if (!env.STRIPE_SECRET_KEY || !(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || env.STRIPE_PUBLISHABLE_KEY) || !monthly || !yearly || !env.STRIPE_WEBHOOK_SECRET) {
    pending.push('Stripe test credentials/prices/webhook configuration pending; billing journeys are unavailable');
  } else pending.push('Stripe price and webhook test-mode ownership still requires provider verification');
  if (env.COLUMN_TAX_MODE && !['disabled', 'sandbox'].includes(env.COLUMN_TAX_MODE)) errors.push('COLUMN_TAX_MODE must be disabled or sandbox in staging');
  if (Object.keys(env).some(name => /^NEXT_PUBLIC_COLUMN_TAX_/.test(name))) errors.push('Column Tax configuration must remain server-only');
  if (env.COLUMN_TAX_MODE === 'sandbox') {
    if (env.COLUMN_TAX_SANDBOX_APPROVED !== 'true' || !env.COLUMN_TAX_CLIENT_ID || !env.COLUMN_TAX_CLIENT_SECRET || !['2024', '2025', '2026'].includes(env.COLUMN_TAX_FILING_YEAR || '')) errors.push('Column sandbox requires explicit approval, credentials and a provider-confirmed filing year');
    pending.push('Column sandbox enrollment and provider QA must be verified before live filing can be enabled');
  } else pending.push('In-app tax filing remains disabled pending provider onboarding');
  if (!env.OPENAI_API_KEY) pending.push('AI provider key pending; AI journeys are unavailable');
  if (!/^[a-fA-F0-9]{64}$/.test(env.SSN_ENCRYPTION_KEY || '')) errors.push('SSN_ENCRYPTION_KEY must be configured for staging encryption');
  return { errors: [...new Set(errors)], pending };
}

function readJsonConfiguration(value, variable, cwd) {
  if (!value) return {};
  try {
    const result = JSON.parse(value.trim().startsWith('{') ? value : fs.readFileSync(path.resolve(cwd, value), 'utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new Error(`${variable} configuration is unreadable`); }
}

export function runStagingPreflight({ cwd = process.cwd(), args = process.argv.slice(2), inheritedEnv = process.env } = {}) {
  let configFile = 'firebase.staging.json';
  let project = inheritedEnv.GCLOUD_PROJECT;
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i + 1] || !['--project', '--config'].includes(args[i])) throw new Error('Use --project and --config for staging preflight');
    if (args[i] === '--project') project = args[i + 1];
    else configFile = args[i + 1];
  }
  const env = {};
  // Match Next production precedence; the shell wins. Do not log parsed values.
  for (const name of ['.env', '.env.production', '.env.local', '.env.production.local']) {
    const file = path.join(cwd, name);
    if (fs.existsSync(file)) Object.assign(env, parse(fs.readFileSync(file)));
  }
  Object.assign(env, inheritedEnv);
  let config;
  try { config = JSON.parse(fs.readFileSync(path.resolve(cwd, configFile), 'utf8')); }
  catch { throw new Error('The staging Firebase configuration is unreadable'); }
  return validateStagingConfiguration(env, {
    project, hosting: config.hosting,
    firebaseConfig: readJsonConfiguration(env.FIREBASE_CONFIG, 'FIREBASE_CONFIG', cwd),
    serviceAccount: readJsonConfiguration(env.GOOGLE_APPLICATION_CREDENTIALS, 'GOOGLE_APPLICATION_CREDENTIALS', cwd),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = runStagingPreflight();
    for (const error of result.errors) console.error(`FAIL: ${error}`);
    for (const pending of result.pending) console.log(`PENDING: ${pending}`);
    if (result.errors.length) process.exitCode = 1;
    else console.log('PASS: staging project, site, bucket and provider isolation checks');
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : 'Staging preflight could not run'}`);
    process.exitCode = 1;
  }
}
