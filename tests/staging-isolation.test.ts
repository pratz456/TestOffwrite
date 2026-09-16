import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertStagingFirebaseEnvironment, STAGING_FIREBASE_PROJECT as project } from '../lib/firebase/staging-isolation';
import { getPlaidConfig } from '../lib/plaid/config';
import { runStagingPreflight, validateStagingConfiguration } from '../scripts/staging-preflight.mjs';

const bucket = `${project}.firebasestorage.app`;
const safeEnv = {
  WRITEOFF_ENV: 'staging', NEXT_PUBLIC_APP_ENV: 'staging',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: project, NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: bucket,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${project}.firebaseapp.com`, NEXT_PUBLIC_SITE_URL: `https://${project}.web.app`,
  PLAID_ENV: 'sandbox', SSN_ENCRYPTION_KEY: '1'.repeat(64),
};
const deploy = { project, hosting: { site: project } };
let temp: string;
beforeEach(() => { temp = mkdtempSync(path.join(tmpdir(), 'writeoff-isolation-test-')); });
afterEach(() => { rmSync(temp, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe('staging Firebase target isolation', () => {
  it('pins project and bucket for staging Admin initialization', () => {
    expect(assertStagingFirebaseEnvironment(safeEnv)).toEqual({ projectId: project, storageBucket: bucket });
  });
  it('preserves non-staging initialization behavior', () => {
    expect(assertStagingFirebaseEnvironment({ WRITEOFF_ENV: 'production', GCLOUD_PROJECT: 'production-fixture' })).toBeUndefined();
  });
  it.each(['FIREBASE_ADMIN_PROJECT_ID', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT'])('rejects an unexpected %s before client creation', name => {
    expect(() => assertStagingFirebaseEnvironment({ ...safeEnv, [name]: 'production-fixture' })).toThrow('unapproved project');
  });
  it.each(['FIREBASE_STORAGE_BUCKET', 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'])('rejects an unexpected %s', name => {
    expect(() => assertStagingFirebaseEnvironment({ ...safeEnv, [name]: 'production-fixture.appspot.com' })).toThrow('unapproved bucket');
  });
  it('rejects production targets from Firebase JSON config and existing Admin apps', () => {
    expect(() => assertStagingFirebaseEnvironment({ ...safeEnv, FIREBASE_CONFIG: JSON.stringify({ projectId: 'production-fixture' }) })).toThrow('unapproved project');
    expect(() => assertStagingFirebaseEnvironment({ ...safeEnv, FIREBASE_CONFIG: JSON.stringify({ storageBucket: 'production-fixture.appspot.com' }) })).toThrow('unapproved bucket');
    expect(() => assertStagingFirebaseEnvironment(safeEnv, { projectId: 'production-fixture' })).toThrow('Admin app projectId');
    expect(() => assertStagingFirebaseEnvironment(safeEnv, {})).toThrow('Admin app projectId');
    expect(() => assertStagingFirebaseEnvironment(safeEnv, { projectId: project, storageBucket: 'production-fixture.appspot.com' })).toThrow('unapproved bucket');
    expect(() => assertStagingFirebaseEnvironment(safeEnv, { projectId: project, credential: { projectId: 'production-fixture' } })).toThrow('unapproved project');
  });
  it('checks file-based Firebase and service-account configuration without exposing values', () => {
    const config = path.join(temp, 'config.json');
    writeFileSync(config, JSON.stringify({ projectId: project, storageBucket: bucket }));
    expect(assertStagingFirebaseEnvironment({ WRITEOFF_ENV: 'staging', FIREBASE_CONFIG: config })).toEqual({ projectId: project, storageBucket: bucket });
    const credential = path.join(temp, 'credential.json');
    writeFileSync(credential, JSON.stringify({ project_id: 'production-fixture', client_email: 'private-fixture@example.invalid' }));
    expect(() => assertStagingFirebaseEnvironment({ ...safeEnv, GOOGLE_APPLICATION_CREDENTIALS: credential })).toThrow('unapproved project');
  });
  it('rejects missing or malformed targets rather than using implicit defaults', () => {
    expect(() => assertStagingFirebaseEnvironment({ WRITEOFF_ENV: 'staging' })).toThrow('explicit staging Firebase project');
    expect(() => assertStagingFirebaseEnvironment({ WRITEOFF_ENV: 'staging', GCLOUD_PROJECT: project })).toThrow('explicit staging Storage bucket');
    expect(() => assertStagingFirebaseEnvironment({ ...safeEnv, FIREBASE_CONFIG: '{not-json' })).toThrow('valid configuration');
    expect(() => assertStagingFirebaseEnvironment({ ...safeEnv, FIREBASE_ADMIN_CLIENT_EMAIL: 'service@production-fixture.iam.gserviceaccount.com' })).toThrow('must belong');
  });
});

describe('staging Plaid configuration', () => {
  it('uses only explicit sandbox credentials and never reads legacy production config', () => {
    const legacy = vi.fn(() => ({ client_id: 'legacy-id', secret: 'legacy-secret', env: 'production' }));
    expect(getPlaidConfig({ WRITEOFF_ENV: 'staging', PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'sandbox-id', PLAID_SECRET: 'sandbox-secret' }, legacy)).toEqual({
      plaidClientId: 'sandbox-id', plaidSecret: 'sandbox-secret', plaidEnv: 'sandbox',
    });
    expect(legacy).not.toHaveBeenCalled();
  });
  it('does not recover missing sandbox credentials from legacy config', () => {
    const legacy = vi.fn(() => ({ secret: 'legacy-secret', env: 'production' }));
    expect(getPlaidConfig({ WRITEOFF_ENV: 'staging' }, legacy)).toEqual({ plaidClientId: undefined, plaidSecret: undefined, plaidEnv: 'sandbox' });
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each(['production', 'development', 'unexpected'])('rejects staging Plaid environment %s', env => {
    expect(() => getPlaidConfig({ WRITEOFF_ENV: 'staging', PLAID_ENV: env }, vi.fn())).toThrow('PLAID_ENV must be sandbox');
  });
  it('preserves both existing production precedence strategies', () => {
    const env = { PLAID_CLIENT_ID: 'explicit-id', PLAID_SECRET: 'explicit-secret', PLAID_ENV: 'sandbox' };
    const legacy = vi.fn(() => ({ client_id: 'legacy-id', secret: 'legacy-secret', env: 'production' }));
    expect(getPlaidConfig(env, legacy)).toEqual({ plaidClientId: 'legacy-id', plaidSecret: 'legacy-secret', plaidEnv: 'production' });
    legacy.mockClear();
    expect(getPlaidConfig(env, legacy, true)).toEqual({ plaidClientId: 'explicit-id', plaidSecret: 'explicit-secret', plaidEnv: 'sandbox' });
    expect(legacy).not.toHaveBeenCalled();
  });
});

describe('staging deployment preflight', () => {
  it('allows pending test providers while explicitly marking unavailable journeys', () => {
    const result = validateStagingConfiguration(safeEnv, deploy);
    expect(result.errors).toEqual([]);
    expect(result.pending).toEqual(expect.arrayContaining([
      expect.stringContaining('Stripe test credentials'), expect.stringContaining('Plaid sandbox'), expect.stringContaining('AI provider'),
    ]));
  });
  it.each(['sk_live_', 'rk_live_', 'pk_live_'])('rejects live Stripe credential prefix %s without printing its value', prefix => {
    const secret = `${prefix}synthetic_value_must_not_appear`;
    const result = validateStagingConfiguration({ ...safeEnv, STRIPE_EXTRA_KEY: secret }, deploy);
    expect(result.errors).toContain('STRIPE_EXTRA_KEY contains a live Stripe credential');
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it('checks all supplied Firebase targets rather than trusting only the selected deploy project', () => {
    expect(validateStagingConfiguration({ ...safeEnv, GCLOUD_PROJECT: 'production-fixture' }, deploy).errors).toContain('GCLOUD_PROJECT targets an unapproved project');
    expect(validateStagingConfiguration(safeEnv, { ...deploy, project: 'production-fixture' }).errors.length).toBeGreaterThan(0);
    expect(validateStagingConfiguration(safeEnv, { ...deploy, hosting: { site: 'production-fixture' } }).errors.length).toBeGreaterThan(0);
    expect(validateStagingConfiguration({ ...safeEnv, NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'production-fixture.appspot.com' }, deploy).errors).toContain('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET targets an unapproved bucket');
  });
  it('rejects production Plaid and production Admin credentials', () => {
    expect(validateStagingConfiguration({ ...safeEnv, PLAID_ENV: 'production' }, deploy).errors).toContain('PLAID_ENV must explicitly select sandbox');
    expect(validateStagingConfiguration({ ...safeEnv, FIREBASE_ADMIN_PROJECT_ID: 'production-fixture' }, deploy).errors).toContain('FIREBASE_ADMIN_PROJECT_ID targets an unapproved project');
    expect(validateStagingConfiguration(safeEnv, { ...deploy, serviceAccount: { client_email: 'service@production-fixture.iam.gserviceaccount.com' } }).errors.length).toBeGreaterThan(0);
  });
  it('accepts test credentials but requires provider verification of price and webhook ownership', () => {
    const result = validateStagingConfiguration({ ...safeEnv, STRIPE_SECRET_KEY: 'sk_test_synthetic', NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_synthetic',
      STRIPE_PRICE_ID_MONTHLY: 'price_monthly', STRIPE_PRICE_ID_YEARLY: 'price_yearly', STRIPE_WEBHOOK_SECRET: 'whsec_synthetic',
      PLAID_CLIENT_ID: 'synthetic', PLAID_SECRET: 'synthetic', OPENAI_API_KEY: 'synthetic' }, deploy);
    expect(result.errors).toEqual([]);
    expect(result.pending).toEqual(['Stripe price and webhook test-mode ownership still requires provider verification', 'In-app tax filing remains disabled pending provider onboarding']);
  });
  it('rejects live filing and any browser-exposed filing configuration', () => {
    const result = validateStagingConfiguration({ ...safeEnv, COLUMN_TAX_MODE: 'production', NEXT_PUBLIC_COLUMN_TAX_CLIENT_SECRET: 'must-not-print' }, deploy);
    expect(result.errors).toContain('COLUMN_TAX_MODE must be disabled or sandbox in staging');
    expect(result.errors).toContain('Column Tax configuration must remain server-only');
    expect(JSON.stringify(result)).not.toContain('must-not-print');
  });
  it.each(['2027', '2026junk', ''])('rejects an unsupported or malformed provider-confirmed season: %s', year => {
    const result = validateStagingConfiguration({ ...safeEnv, COLUMN_TAX_MODE: 'sandbox', COLUMN_TAX_SANDBOX_APPROVED: 'true', COLUMN_TAX_CLIENT_ID: 'synthetic', COLUMN_TAX_CLIENT_SECRET: 'synthetic', COLUMN_TAX_FILING_YEAR: year }, deploy);
    expect(result.errors).toContain('Column sandbox requires explicit approval, credentials and a provider-confirmed filing year');
  });
  it('uses the actual Firebase hook project and Next production env precedence', () => {
    writeFileSync(path.join(temp, 'firebase.staging.json'), JSON.stringify({ hosting: deploy.hosting }));
    writeFileSync(path.join(temp, '.env.local'), Object.entries(safeEnv).map(([k, v]) => `${k}=${v}`).join('\n'));
    expect(runStagingPreflight({ cwd: temp, args: [], inheritedEnv: { GCLOUD_PROJECT: project } }).errors).toEqual([]);
    expect(runStagingPreflight({ cwd: temp, args: [], inheritedEnv: { GCLOUD_PROJECT: 'production-fixture' } }).errors.length).toBeGreaterThan(0);
    expect(runStagingPreflight({ cwd: temp, args: ['--project', project], inheritedEnv: { STRIPE_SECRET_KEY: 'sk_live_synthetic' } }).errors.length).toBeGreaterThan(0);
  });
});
