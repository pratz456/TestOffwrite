import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deployProductionRelease,
  planProductionDeployment,
  productionDeployConfirmation,
  PRODUCTION_DEPLOY_TARGETS,
} from '../scripts/deploy-production-release.mjs';
import {
  environmentDigest,
  EXPECTED_PRODUCTION_PLAID_CLIENT_ID,
  MIGRATION_REVIEW,
  RELEASE_ENV,
  RELEASE_MANIFEST,
  REQUIRED_RELEASE_REVIEWS,
} from '../scripts/production-preflight.mjs';

const project = 'writeoff-23910';
const commit = 'a'.repeat(40);
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function preparedRelease() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'writeoff-production-deploy-test-'));
  directories.push(cwd);
  fs.mkdirSync(path.join(cwd, 'functions'));
  fs.mkdirSync(path.join(cwd, 'functions-analysis'));
  const env = {
    WRITEOFF_ENV: 'production',
    NEXT_PUBLIC_APP_ENV: 'production',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: project,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${project}.firebasestorage.app`,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${project}.firebaseapp.com`,
    NEXT_PUBLIC_FIREBASE_API_KEY: 'synthetic-firebase-value',
    NEXT_PUBLIC_FIREBASE_APP_ID: '1:930596534802:web:abcdef',
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '930596534802',
    NEXT_PUBLIC_SITE_URL: 'https://writeoffapp.com',
    ANALYSIS_WORKER_ORIGIN: 'https://writeoffapp.com',
    PLAID_ENV: 'production',
    PLAID_CLIENT_ID: EXPECTED_PRODUCTION_PLAID_CLIENT_ID,
    PLAID_SECRET: 'synthetic-plaid-private-value',
    PLAID_REDIRECT_URI: 'https://writeoffapp.com/plaid/oauth',
    PLAID_TOKEN_ENCRYPTION_KEY: '1'.repeat(64),
    SSN_ENCRYPTION_KEY: '2'.repeat(64),
    ANALYSIS_WORKER_SECRET: 'synthetic-analysis-worker-secret-never-live',
    CLOUD_FUNCTION_SECRET: 'synthetic-scheduler-secret-never-live',
    OPENAI_API_KEY: 'synthetic-openai-private-value',
    STRIPE_SECRET_KEY: 'sk_live_syntheticvalue',
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_syntheticvalue',
    STRIPE_WEBHOOK_SECRET: 'whsec_syntheticvalue',
    STRIPE_PRICE_ID_MONTHLY: 'price_premiummonthly',
    STRIPE_PRICE_ID_YEARLY: 'price_premiumyearly',
    STRIPE_PRICE_ID_BASIC_MONTHLY: 'price_basicmonthly',
    COLUMN_TAX_MODE: 'disabled',
  };
  const environmentContents = `${Object.entries(env).map(([name, value]) => `${name}=${value}`).join('\n')}\n`;
  const review = {
    schemaVersion: 1,
    project,
    commit,
    reviewedBy: 'Synthetic reviewer',
    reviewedAt: '2026-09-17T00:00:00Z',
    ...Object.fromEntries(REQUIRED_RELEASE_REVIEWS.map(name => [
      name,
      { reviewed: true, evidence: `synthetic-fixture: ${name} checked` },
    ])),
  };
  const reviewContents = JSON.stringify(review);
  fs.writeFileSync(path.join(cwd, RELEASE_ENV), environmentContents, { mode: 0o600 });
  fs.writeFileSync(path.join(cwd, MIGRATION_REVIEW), reviewContents, { mode: 0o600 });
  fs.writeFileSync(path.join(cwd, RELEASE_MANIFEST), JSON.stringify({
    project,
    commit,
    environmentDigest: environmentDigest(environmentContents),
    migrationReviewDigest: environmentDigest(reviewContents),
  }), { mode: 0o600 });
  fs.writeFileSync(path.join(cwd, 'firebase.json'), JSON.stringify({
    hosting: { source: '.', site: project },
    functions: [
      { source: 'functions', codebase: 'default' },
      { source: 'functions-analysis', codebase: 'analysis' },
    ],
  }));
  return cwd;
}

describe('coordinated production deployment', () => {
  it('requires exact commit confirmation and a manual GitHub dispatch', () => {
    const cwd = preparedRelease();
    expect(() => planProductionDeployment({ cwd, confirmation: 'yes', inheritedEnv: {} })).toThrow('Explicit confirmation');
    expect(() => planProductionDeployment({
      cwd,
      confirmation: productionDeployConfirmation(commit),
      inheritedEnv: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push' },
    })).toThrow('manually dispatched');
    expect(planProductionDeployment({
      cwd,
      confirmation: productionDeployConfirmation(commit),
      inheritedEnv: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch' },
    })).toMatchObject({ commit, targets: PRODUCTION_DEPLOY_TARGETS });
  });

  it('builds every package and deploys every Firebase surface without force', () => {
    const cwd = preparedRelease();
    const execute = vi.fn();
    deployProductionRelease({
      cwd,
      confirmation: productionDeployConfirmation(commit),
      inheritedEnv: {},
      execute,
    });
    expect(execute.mock.calls.slice(0, 6).map(([file, args, options]) => [
      file,
      args,
      path.relative(cwd, options.cwd) || '.',
    ])).toEqual([
      ['npm', ['ci', '--include=dev'], '.'],
      ['npm', ['run', 'build'], '.'],
      ['npm', ['ci', '--include=dev'], 'functions'],
      ['npm', ['run', 'build'], 'functions'],
      ['npm', ['ci', '--include=dev'], 'functions-analysis'],
      ['npm', ['run', 'build'], 'functions-analysis'],
    ]);
    const [binary, args] = execute.mock.calls.at(-1)!;
    expect(binary).toMatch(/^npx(?:\.cmd)?$/);
    expect(args).toContain(PRODUCTION_DEPLOY_TARGETS.join(','));
    expect(args).toContain(project);
    expect(args).not.toContain('--force');
  });
});

describe('production workflow contract', () => {
  it('cannot deploy production from a push and uses private prepared-release inputs', () => {
    const workflow = fs.readFileSync(path.resolve('.github/workflows/deploy.yml'), 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/\bpush:/);
    expect(workflow).toContain('environment:\n      name: production');
    expect(workflow).toContain('PRODUCTION_ENV_FILE');
    expect(workflow).toContain('PRODUCTION_MIGRATION_REVIEW_JSON');
    expect(workflow).toContain('prepare-production-release.mjs');
    expect(workflow).not.toContain('--force');
  });

  it('guards rules and storage even when an operator selects a partial target', () => {
    const config = JSON.parse(fs.readFileSync(path.resolve('firebase.json'), 'utf8'));
    for (const target of ['firestore', 'storage']) {
      expect(config[target].predeploy).toContain('node scripts/production-preflight.mjs --config firebase.json');
    }
  });

  it('routes package deploy commands through the prepared-release orchestrator', () => {
    const root = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    for (const name of ['deploy', 'deploy:firebase', 'firebase:deploy-indexes', 'production:deploy']) {
      expect(root.scripts[name]).toBe('node scripts/deploy-production-release.mjs');
    }
    const functionsPackage = JSON.parse(fs.readFileSync(path.resolve('functions/package.json'), 'utf8'));
    expect(functionsPackage.scripts.deploy).toBeUndefined();
    for (const file of ['deploy-firebase.js', 'deploy-firestore-rules.js', 'deploy-firestore-indexes.js', 'create-firestore-indexes.js']) {
      const script = fs.readFileSync(path.resolve('scripts', file), 'utf8');
      expect(script).not.toMatch(/\bfirebase\s+deploy\b/);
      expect(script).toContain('disabled');
    }
  });
});
