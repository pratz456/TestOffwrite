import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { ANALYSIS_FANOUT_DEFAULTS, ANALYSIS_FANOUT_LIMITS, COORDINATED_DEPLOY_VARIABLE, environmentDigest, EXPECTED_PRODUCTION_PLAID_CLIENT_ID, gitBlobDigest, RELEASE_ENV, RELEASE_MANIFEST, MIGRATION_REVIEW, REQUIRED_RELEASE_REVIEWS, runProductionPreflight, validateMigrationReview, validateProductionConfiguration } from '../scripts/production-preflight.mjs';
import { prepareProductionRelease } from '../scripts/prepare-production-release.mjs';

// The deploy tool that consumes the generated dotenv files; its param resolver is the contract under test.
const firebaseTools = createRequire(import.meta.url);
const functionParams = firebaseTools('firebase-tools/lib/deploy/functions/params.js') as {
  resolveParams(params: unknown[], config: unknown, userEnvs: unknown, nonInteractive: boolean, isEmulator?: boolean): Promise<Record<string, { toSDK(): string }>>;
};
const functionBuild = firebaseTools('firebase-tools/lib/deploy/functions/build.js') as { envWithTypes(params: unknown[], envs: Record<string, string>): unknown };
const functionsEnv = firebaseTools('firebase-tools/lib/functions/env.js') as { loadUserEnvs(opts: { functionsSource: string; projectId: string }): Record<string, string> };

const project = 'writeoff-23910';
const config = { hosting: { source: '.', site: project }, functions: [
  { source: 'functions', codebase: 'default' },
  { source: 'functions-analysis', codebase: 'analysis' },
] };
const target = { project, hosting: config.hosting };
const env = {
  WRITEOFF_ENV: 'production', NEXT_PUBLIC_APP_ENV: 'production', NEXT_PUBLIC_FIREBASE_PROJECT_ID: project,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${project}.firebasestorage.app`, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${project}.firebaseapp.com`,
  NEXT_PUBLIC_FIREBASE_API_KEY: 'synthetic-firebase-value', NEXT_PUBLIC_FIREBASE_APP_ID: '1:930596534802:web:abcdef',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '930596534802', NEXT_PUBLIC_SITE_URL: 'https://writeoffapp.com',
  ANALYSIS_WORKER_ORIGIN: 'https://writeoffapp.com', PLAID_ENV: 'production', PLAID_CLIENT_ID: EXPECTED_PRODUCTION_PLAID_CLIENT_ID,
  PLAID_SECRET: 'synthetic-plaid-private-value', PLAID_REDIRECT_URI: 'https://writeoffapp.com/plaid/oauth',
  PLAID_TOKEN_ENCRYPTION_KEY: '1'.repeat(64), SSN_ENCRYPTION_KEY: '2'.repeat(64),
  ANALYSIS_WORKER_SECRET: 'synthetic-analysis-worker-secret-never-live', CLOUD_FUNCTION_SECRET: 'synthetic-scheduler-secret-never-live',
  RATE_LIMIT_HASH_SECRET: 'synthetic-rate-limit-hash-secret-never-live',
  OPENAI_API_KEY: 'synthetic-openai-private-value', RESEND_API_KEY: 'synthetic-resend-private-value',
  STRIPE_SECRET_KEY: 'sk_live_syntheticvalue',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_syntheticvalue', STRIPE_WEBHOOK_SECRET: 'whsec_syntheticvalue',
  STRIPE_PRICE_ID_MONTHLY: 'price_premiummonthly', STRIPE_PRICE_ID_YEARLY: 'price_premiumyearly',
  STRIPE_PRICE_ID_BASIC_MONTHLY: 'price_basicmonthly', COLUMN_TAX_MODE: 'disabled',
};
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
function directory() { const value = fs.mkdtempSync(path.join(os.tmpdir(), 'writeoff-production-config-test-')); directories.push(value); return value; }
function environmentText(value: Record<string, string> = env) { return Object.entries(value).map(([name, value]) => `${name}=${value}`).join('\n') + '\n'; }
function review(commit = 'a'.repeat(40)) {
  return {
    schemaVersion: 1,
    project,
    commit,
    reviewedBy: 'Synthetic reviewer',
    reviewedAt: '2026-09-16T00:00:00Z',
    ...Object.fromEntries(REQUIRED_RELEASE_REVIEWS.map(name => [
      name,
      { reviewed: true, evidence: `synthetic-fixture: ${name} checked` },
    ])),
  };
}
function prepared() {
  const cwd = directory(); const contents = environmentText();
  const migrationContents = JSON.stringify(review());
  fs.writeFileSync(path.join(cwd, RELEASE_ENV), contents, { mode: 0o600 });
  fs.writeFileSync(path.join(cwd, MIGRATION_REVIEW), migrationContents);
  fs.writeFileSync(path.join(cwd, 'firebase.json'), JSON.stringify(config));
  fs.mkdirSync(path.join(cwd, 'lib'));
  fs.writeFileSync(path.join(cwd, 'lib', 'reviewed.ts'), 'export const reviewed = true;\n');
  const sourceTree = { 'firebase.json': gitBlobDigest(path.join(cwd, 'firebase.json')), 'lib/reviewed.ts': gitBlobDigest(path.join(cwd, 'lib', 'reviewed.ts')) };
  fs.writeFileSync(path.join(cwd, RELEASE_MANIFEST), JSON.stringify({ project, commit: 'a'.repeat(40), environmentDigest: environmentDigest(contents), migrationReviewDigest: environmentDigest(migrationContents), sourceTree }));
  return cwd;
}

describe('production deployment configuration', () => {
  it('accepts explicitly separated production configuration while leaving provider checks pending', () => {
    const result = validateProductionConfiguration(env, target);
    expect(result.errors).toEqual([]);
    expect(result.pending).toHaveLength(3);
    expect(result.pending.join(' ')).toContain('Basic price retention');
  });
  it('accepts an explicit analysis fan-out ceiling within the reviewable bounds', () => {
    expect(validateProductionConfiguration({ ...env, ANALYSIS_MAX_INSTANCES: '4', ANALYSIS_CONCURRENCY: '4' }, target).errors).toEqual([]);
    expect(validateProductionConfiguration({ ...env, ANALYSIS_MAX_INSTANCES: '20', ANALYSIS_CONCURRENCY: '10' }, target).errors).toEqual([]);
  });
  it('rejects a different Plaid account even when its client identifier has the valid provider format', () => {
    const result = validateProductionConfiguration({ ...env, PLAID_CLIENT_ID: 'b'.repeat(24) }, target);
    expect(result.errors).toContain('PLAID_CLIENT_ID must identify the reviewed replacement provider account');
    expect(JSON.stringify(result)).not.toContain(EXPECTED_PRODUCTION_PLAID_CLIENT_ID);
    expect(JSON.stringify(result)).not.toContain('b'.repeat(24));
  });
  it.each([
    { WRITEOFF_ENV: 'staging' }, { NEXT_PUBLIC_APP_ENV: 'staging' }, { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'writeoff-production-testing' },
    { FIREBASE_ADMIN_PROJECT_ID: 'writeoff-production-testing' }, { FIREBASE_ADMIN_CLIENT_EMAIL: 'wrong@other-project.iam.gserviceaccount.com' },
    { NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'writeoff-production-testing.firebasestorage.app' },
    { NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'writeoff-production-testing.firebaseapp.com' },
    { NEXT_PUBLIC_FIREBASE_APP_ID: '1:111:web:abcdef' }, { NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '111' },
    { NEXT_PUBLIC_SITE_URL: 'https://writeoff-production-testing.web.app' }, { ANALYSIS_WORKER_ORIGIN: 'https://writeoff-production-testing.web.app' },
    { PLAID_ENV: 'sandbox' }, { PLAID_CLIENT_ID: '' }, { PLAID_SECRET: '' },
    { PLAID_REDIRECT_URI: 'https://writeoff-production-testing.web.app/plaid/oauth' }, { PLAID_WEBHOOK_URL: 'https://attacker.example/webhook' },
    { PLAID_TOKEN_ENCRYPTION_KEY: '' }, { SSN_ENCRYPTION_KEY: '' }, { SSN_ENCRYPTION_KEY: env.PLAID_TOKEN_ENCRYPTION_KEY },
    { ANALYSIS_WORKER_SECRET: 'short' }, { CLOUD_FUNCTION_SECRET: 'short' }, { RATE_LIMIT_HASH_SECRET: 'short' },
    { OPENAI_API_KEY: '' }, { RESEND_API_KEY: '' },
    { STRIPE_SECRET_KEY: 'sk_test_synthetic' }, { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_synthetic' },
    { STRIPE_PUBLISHABLE_KEY: 'pk_live_other' }, { STRIPE_WEBHOOK_SECRET: '' }, { STRIPE_PRICE_ID_BASIC_MONTHLY: '' },
    { STRIPE_PRICE_ID: 'price_wronggeneric' }, { NEXT_PUBLIC_STRIPE_PRICE_ID_MONTHLY: 'price_wrongpublicalias' },
    { STRIPE_PRICE_ID_BASIC_MONTHLY: env.STRIPE_PRICE_ID_MONTHLY }, { STRIPE_PRICE_ID_YEARLY: env.STRIPE_PRICE_ID_MONTHLY },
    { NEXT_PUBLIC_PLAID_SECRET: 'must-never-be-public' }, { FIRESTORE_EMULATOR_HOST: 'localhost:8180' },
    { COLUMN_TAX_MODE: 'sandbox' }, { COLUMN_TAX_CLIENT_ID: 'must-not-ship' },
    { ENABLE_TRANSACTION_RESET: 'true' }, { STRIPE_TEST_MODE_EXPIRE_TODAY: 'true' },
    { ANALYSIS_MAX_INSTANCES: '0' }, { ANALYSIS_MAX_INSTANCES: '21' }, { ANALYSIS_MAX_INSTANCES: 'two' }, { ANALYSIS_CONCURRENCY: '11' }, { ANALYSIS_CONCURRENCY: '1.5' },
  ])('rejects unsafe production configuration without exposing values: %j', override => {
    const result = validateProductionConfiguration({ ...env, ...override }, target);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(env.PLAID_SECRET);
    expect(JSON.stringify(result)).not.toContain(env.STRIPE_SECRET_KEY);
  });
  it.each([
    { project: 'writeoff-production-testing' }, { hosting: { source: '.' } },
    { hosting: { site: project, source: '.', target: 'other' } },
    { firebaseConfig: { projectId: 'other-project' } }, { serviceAccount: { project_id: 'other-project' } },
  ])('rejects mismatched deployment metadata %j', override => {
    expect(validateProductionConfiguration(env, { ...target, ...override }).errors.length).toBeGreaterThan(0);
  });
});

describe('isolated production release preflight', () => {
  it('accepts the prepared env and rejects changes to that configuration', () => {
    const cwd = prepared();
    expect(runProductionPreflight({ cwd, inheritedEnv: {}, args: ['--project', project] }).errors).toEqual([]);
    fs.appendFileSync(path.join(cwd, RELEASE_ENV), 'UNREVIEWED_CHANGE=true\n');
    expect(() => runProductionPreflight({ cwd, inheritedEnv: {}, args: ['--project', project] })).toThrow('manifest does not match');
  });
  it('rejects source edits made after preparation, including deleted reviewed files', () => {
    const cwd = prepared();
    fs.appendFileSync(path.join(cwd, 'lib', 'reviewed.ts'), '// unreviewed change\n');
    expect(() => runProductionPreflight({ cwd, inheritedEnv: {}, args: ['--project', project] })).toThrow('differ from the released commit');
    fs.unlinkSync(path.join(cwd, 'lib', 'reviewed.ts'));
    expect(() => runProductionPreflight({ cwd, inheritedEnv: {}, args: ['--project', project] })).toThrow('differ from the released commit');
    const legacy = prepared();
    const manifest = JSON.parse(fs.readFileSync(path.join(legacy, RELEASE_MANIFEST), 'utf8'));
    delete manifest.sourceTree;
    fs.writeFileSync(path.join(legacy, RELEASE_MANIFEST), JSON.stringify(manifest));
    expect(() => runProductionPreflight({ cwd: legacy, inheritedEnv: {}, args: ['--project', project] })).toThrow('missing the reviewed source tree');
  });
  it('allows build outputs but requires the coordinated deploy token inside Firebase predeploy hooks', () => {
    const cwd = prepared();
    fs.mkdirSync(path.join(cwd, '.next')); fs.writeFileSync(path.join(cwd, '.next', 'BUILD_ID'), 'built');
    const predeploy = { PROJECT_DIR: cwd, RESOURCE_DIR: cwd, GCLOUD_PROJECT: project };
    expect(() => runProductionPreflight({ cwd, inheritedEnv: predeploy, args: ['--project', project] })).toThrow('together through npm run production:deploy');
    expect(runProductionPreflight({ cwd, inheritedEnv: { ...predeploy, [COORDINATED_DEPLOY_VARIABLE]: 'a'.repeat(40) }, args: ['--project', project] }).errors).toEqual([]);
    expect(() => runProductionPreflight({ cwd, inheritedEnv: { ...predeploy, [COORDINATED_DEPLOY_VARIABLE]: 'b'.repeat(40) }, args: ['--project', project] })).toThrow('together through');
    expect(runProductionPreflight({ cwd, inheritedEnv: {}, args: ['--project', project] }).errors).toEqual([]);
  });
  it('rejects inherited staging values even when the prepared file is production', () => {
    const result = runProductionPreflight({ cwd: prepared(), inheritedEnv: { PLAID_ENV: 'sandbox' }, args: ['--project', project] });
    expect(result.errors).toContain('PLAID_ENV conflicts with the prepared production env file');
  });
  it('rejects the mutable staging checkout and non-private env files', () => {
    const cwd = prepared();
    fs.writeFileSync(path.join(cwd, '.env.local'), 'PLAID_ENV=sandbox\n');
    expect(() => runProductionPreflight({ cwd, inheritedEnv: {}, args: ['--project', project] })).toThrow('without other .env files');
    fs.unlinkSync(path.join(cwd, '.env.local'));
    fs.chmodSync(path.join(cwd, RELEASE_ENV), 0o644);
    expect(() => runProductionPreflight({ cwd, inheritedEnv: {}, args: ['--project', project] })).toThrow('private regular file');
  });
  it('rejects missing production Functions codebase configuration', () => {
    const cwd = prepared(); fs.writeFileSync(path.join(cwd, 'firebase.json'), JSON.stringify({ hosting: config.hosting }));
    // Re-prepare the manifest so this test exercises the codebase rule, not source tampering.
    const manifest = JSON.parse(fs.readFileSync(path.join(cwd, RELEASE_MANIFEST), 'utf8'));
    manifest.sourceTree['firebase.json'] = gitBlobDigest(path.join(cwd, 'firebase.json'));
    fs.writeFileSync(path.join(cwd, RELEASE_MANIFEST), JSON.stringify(manifest));
    expect(runProductionPreflight({ cwd, inheritedEnv: {}, args: ['--project', project] }).errors).toContain('The production scheduled-sync Functions codebase must be included');
    expect(runProductionPreflight({ cwd, inheritedEnv: {}, args: ['--project', project] }).errors).toContain('The production analysis Functions codebase must be included');
  });
  it('rejects absent or changed migration review even with otherwise valid production configuration', () => {
    const cwd = prepared(); fs.writeFileSync(path.join(cwd, MIGRATION_REVIEW), JSON.stringify({ ...review(), historicalOverlapReconciliation: { reviewed: false } }));
    expect(() => runProductionPreflight({ cwd, inheritedEnv: {}, args: ['--project', project] })).toThrow('migration review does not match');
    fs.unlinkSync(path.join(cwd, MIGRATION_REVIEW));
    expect(() => runProductionPreflight({ cwd, inheritedEnv: {}, args: ['--project', project] })).toThrow('Prepare an isolated production release');
  });
  it.each([
    undefined, {}, { ...review(), commit: 'b'.repeat(40) }, { ...review(), project: 'writeoff-production-testing' },
    { ...review(), reviewedBy: '' }, { ...review(), reviewedAt: 'invalid' },
    ...REQUIRED_RELEASE_REVIEWS.flatMap(name => [
      { ...review(), [name]: { reviewed: false, evidence: 'not done' } },
      { ...review(), [name]: { reviewed: true, evidence: '' } },
      { ...review(), [name]: { reviewed: true, evidence: 'REPLACE with the verify output plaid-credential-migration-verify-<timestamp>.json' } },
    ]),
  ])('requires a complete exact-commit migration review: %j', value => {
    expect(validateMigrationReview(value, 'a'.repeat(40)).length).toBeGreaterThan(0);
  });
});

describe('production release preparation', () => {
  it('exports only a clean committed snapshot and private production env without mutating source or deploying', () => {
    const cwd = directory(); const source = path.join(cwd, 'source'); const output = path.join(cwd, 'release');
    fs.mkdirSync(source); fs.mkdirSync(path.join(source, 'functions')); fs.mkdirSync(path.join(source, 'functions-analysis'));
    fs.writeFileSync(path.join(source, 'firebase.json'), JSON.stringify(config));
    fs.writeFileSync(path.join(source, '.gitignore'), '.env*\n');
    for (const name of ['functions', 'functions-analysis']) fs.writeFileSync(path.join(source, name, 'package.json'), '{}');
    execFileSync('git', ['init', '-q'], { cwd: source });
    execFileSync('git', ['add', '.'], { cwd: source });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-qm', 'fixture'], { cwd: source });
    fs.writeFileSync(path.join(source, '.env.local'), 'PLAID_ENV=sandbox\n');
    const envFile = path.join(cwd, 'production-env'); fs.writeFileSync(envFile, environmentText(), { mode: 0o600 });
    const migrationReviewFile = path.join(cwd, 'migration-review.json');
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
    expect(() => prepareProductionRelease({ source, output, envFile, migrationReviewFile })).toThrow('separate completed production migration review');
    fs.writeFileSync(migrationReviewFile, JSON.stringify(review(commit)));
    const result = prepareProductionRelease({ source, output, envFile, migrationReviewFile });
    expect(result.commit).toMatch(/^[a-f\d]{40}$/);
    expect(fs.readFileSync(path.join(source, '.env.local'), 'utf8')).toBe('PLAID_ENV=sandbox\n');
    expect(fs.existsSync(path.join(output, '.env.local'))).toBe(false);
    expect(fs.statSync(path.join(output, RELEASE_ENV)).mode & 0o077).toBe(0);
    // Without an explicit ceiling the compiled defaults are still written: firebase-tools
    // prompts for every declared param that is absent from the dotenv file, and a
    // --non-interactive deploy aborts instead of prompting (see the contract test below).
    expect(fs.readFileSync(path.join(output, 'functions-analysis', `.env.${project}`), 'utf8')).toBe('ANALYSIS_WORKER_ORIGIN=https://writeoffapp.com\nANALYSIS_MAX_INSTANCES=2\nANALYSIS_CONCURRENCY=2\n');
    expect(fs.readFileSync(path.join(output, 'functions', `.env.${project}`), 'utf8')).not.toContain(env.PLAID_SECRET);
    expect(runProductionPreflight({ cwd: output, inheritedEnv: {}, args: ['--project', project] }).errors).toEqual([]);
    expect(() => prepareProductionRelease({ source, output, envFile, migrationReviewFile })).toThrow('new production release directory');
    // An explicit fan-out ceiling travels only to the analysis functions' non-secret param file.
    const tunedEnvFile = path.join(cwd, 'production-env-tuned');
    fs.writeFileSync(tunedEnvFile, environmentText({ ...env, ANALYSIS_MAX_INSTANCES: '4', ANALYSIS_CONCURRENCY: ' 3 ' }), { mode: 0o600 });
    const tuned = path.join(cwd, 'release-tuned');
    prepareProductionRelease({ source, output: tuned, envFile: tunedEnvFile, migrationReviewFile });
    expect(fs.readFileSync(path.join(tuned, 'functions-analysis', `.env.${project}`), 'utf8')).toBe('ANALYSIS_WORKER_ORIGIN=https://writeoffapp.com\nANALYSIS_MAX_INSTANCES=4\nANALYSIS_CONCURRENCY=3\n');
    expect(fs.readFileSync(path.join(tuned, 'functions', `.env.${project}`), 'utf8')).not.toContain('ANALYSIS_');
    fs.writeFileSync(path.join(source, 'unreviewed.txt'), 'changed');
    expect(() => prepareProductionRelease({ source, output: path.join(cwd, 'release2'), envFile, migrationReviewFile })).toThrow('Commit the reviewed changes');
  });
});

describe('analysis fan-out params survive a non-interactive deploy', () => {
  // What firebase-tools discovers from functions-analysis/src/index.ts: an int param with a compiled default.
  const declaredParams = Object.entries(ANALYSIS_FANOUT_DEFAULTS).map(([name, value]) => ({ name, type: 'int', default: value }));
  const firebaseConfig = { projectId: project, storageBucket: `${project}.firebasestorage.app`, databaseURL: '' };
  const resolve = (userEnvs: Record<string, string>) =>
    functionParams.resolveParams(declaredParams, firebaseConfig, functionBuild.envWithTypes(declaredParams, userEnvs), true, false);

  it('keeps the release defaults equal to the compiled defineInt defaults and inside the preflight bounds', () => {
    const source = fs.readFileSync(new URL('../functions-analysis/src/index.ts', import.meta.url), 'utf8');
    expect(Object.keys(ANALYSIS_FANOUT_DEFAULTS)).toEqual(Object.keys(ANALYSIS_FANOUT_LIMITS));
    for (const [name, value] of Object.entries(ANALYSIS_FANOUT_DEFAULTS)) {
      expect(source).toMatch(new RegExp(`defineInt\\('${name}',\\s*\\{\\s*default:\\s*${value}\\s*\\}\\)`));
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(ANALYSIS_FANOUT_LIMITS[name as keyof typeof ANALYSIS_FANOUT_LIMITS]);
    }
  });

  it('is refused by firebase-tools when the dotenv file omits a defaulted param, and resolved from the generated file', async () => {
    // The compiled default alone does not satisfy the resolver: this is why the release file always writes both values.
    await expect(resolve({})).rejects.toThrow(/non-interactive mode but have no value for the following environment variables: ANALYSIS_MAX_INSTANCES, ANALYSIS_CONCURRENCY/);
    const functionsSource = directory();
    fs.writeFileSync(path.join(functionsSource, `.env.${project}`), 'ANALYSIS_WORKER_ORIGIN=https://writeoffapp.com\nANALYSIS_MAX_INSTANCES=2\nANALYSIS_CONCURRENCY=2\n');
    const resolved = await resolve(functionsEnv.loadUserEnvs({ functionsSource, projectId: project }));
    expect(resolved.ANALYSIS_MAX_INSTANCES.toSDK()).toBe('2');
    expect(resolved.ANALYSIS_CONCURRENCY.toSDK()).toBe('2');
  });
});
