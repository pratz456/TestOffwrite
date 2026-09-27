import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertDeployNodeVersion,
  assertProductionFunctionInventory,
  deployProductionRelease,
  planProductionDeployment,
  productionDeployConfirmation,
  PRODUCTION_DEPLOY_TARGETS,
  PRODUCTION_FUNCTION_IDS,
} from '../scripts/deploy-production-release.mjs';
import {
  COORDINATED_DEPLOY_VARIABLE,
  environmentDigest,
  EXPECTED_PRODUCTION_PLAID_CLIENT_ID,
  gitBlobDigest,
  MIGRATION_REVIEW,
  RELEASE_ENV,
  RELEASE_MANIFEST,
  REQUIRED_RELEASE_REVIEWS,
} from '../scripts/production-preflight.mjs';

const project = 'writeoff-23910';
const commit = 'a'.repeat(40);
const existingFunctions = [
  { id: 'ssrwriteoff23910', project, region: 'us-central1', platform: 'gcfv2', codebase: 'firebase-frameworks-writeoff-23910' },
  { id: 'syncAllUsersTransactions', project, region: 'us-central1', platform: 'gcfv2', codebase: 'default' },
];
const inventory = (result = existingFunctions) => JSON.stringify({ status: 'success', result });
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function preparedRelease() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'writeoff-production-deploy-test-'));
  directories.push(cwd);
  fs.mkdirSync(path.join(cwd, 'functions'));
  fs.mkdirSync(path.join(cwd, 'functions-analysis'));
  for (const directory of ['functions', 'functions-analysis']) {
    fs.mkdirSync(path.join(cwd, directory, 'lib'));
    const names = directory === 'functions' ? ['syncAllUsersTransactions'] : [
      'queueBankTransactionAnalysis', 'processBankTransactionAnalysis', 'queueProfileAnalysisRefresh',
      'processProfileAnalysisRefresh', 'cleanupExpiredPreparerHandoffs',
    ];
    fs.writeFileSync(path.join(cwd, directory, 'lib/index.js'), names.map(name =>
      `exports.${name} = (0, trigger_1.onSchedule)({});`).join('\n'));
  }
  // A prepared release is a git archive of the commit, so package.json (with engines.node) is always present.
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'writeoff-release-fixture', engines: { node: '22' } }));
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
    RATE_LIMIT_HASH_SECRET: 'synthetic-rate-limit-hash-secret-never-live',
    OPENAI_API_KEY: 'synthetic-openai-private-value',
    RESEND_API_KEY: 'synthetic-resend-private-value',
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
  fs.writeFileSync(path.join(cwd, 'firebase.json'), JSON.stringify({
    hosting: { source: '.', site: project, frameworksBackend: { region: 'us-central1' } },
    functions: [
      { source: 'functions', codebase: 'default' },
      { source: 'functions-analysis', codebase: 'analysis' },
    ],
  }));
  fs.writeFileSync(path.join(cwd, RELEASE_MANIFEST), JSON.stringify({
    project,
    commit,
    environmentDigest: environmentDigest(environmentContents),
    migrationReviewDigest: environmentDigest(reviewContents),
    sourceTree: { 'firebase.json': gitBlobDigest(path.join(cwd, 'firebase.json')) },
  }), { mode: 0o600 });
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

  it('builds every package and acknowledges retry policies only after checking live functions', () => {
    const cwd = preparedRelease();
    const execute = vi.fn().mockReturnValue(inventory());
    const serviceAccount = path.join(cwd, '..', `writeoff-sa-${path.basename(cwd)}.json`);
    fs.writeFileSync(serviceAccount, JSON.stringify({ project_id: project, client_email: `deploy@${project}.iam.gserviceaccount.com` }), { mode: 0o600 });
    directories.push(serviceAccount);
    const inheritedEnv = { PATH: '/usr/bin', GOOGLE_APPLICATION_CREDENTIALS: serviceAccount, STRIPE_SECRET_KEY: 'sk_live_syntheticvalue', PLAID_SECRET: 'synthetic-plaid-private-value' };
    deployProductionRelease({
      cwd,
      confirmation: productionDeployConfirmation(commit),
      inheritedEnv,
      execute,
      nodeVersion: 'v22.23.2',
    });
    for (const [, , options] of execute.mock.calls.slice(0, 6)) {
      expect(options.env).toEqual({ PATH: '/usr/bin' });
    }
    const deployOptions = execute.mock.calls.at(-1)![2];
    expect(deployOptions.env).toMatchObject({ ...inheritedEnv, [COORDINATED_DEPLOY_VARIABLE]: commit });
    expect(execute.mock.calls.slice(0, 6).map(([file, args, options]) => [
      file,
      args,
      path.relative(fs.realpathSync(cwd), fs.realpathSync(options.cwd)) || '.',
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
    expect(args).toContain('--force');
    const [inventoryBinary, inventoryArgs, inventoryOptions] = execute.mock.calls.at(-2)!;
    expect(inventoryBinary).toBe(binary);
    expect(inventoryArgs).toEqual([
      '--no-install', 'firebase-tools', 'functions:list', '--project', project,
      '--config', 'firebase.json', '--non-interactive', '--json',
    ]);
    expect(inventoryOptions.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    expect(inventoryOptions.env).toEqual(deployOptions.env);
  });

  it.each(['unknown function', 'inventory error', 'unreadable inventory'])('never deploys on %s', kind => {
    const execute = vi.fn((_file, args) => {
      if (!args.includes('functions:list')) return;
      if (kind === 'inventory error') throw new Error('sensitive CLI response');
      return kind === 'unreadable inventory' ? 'sensitive CLI response' : inventory([
        ...existingFunctions, { ...existingFunctions[1], id: 'unreviewedFunction' },
      ]);
    });
    expect(() => deployProductionRelease({ cwd: preparedRelease(), confirmation: productionDeployConfirmation(commit),
      inheritedEnv: {}, execute, nodeVersion: 'v22.23.2',
    })).toThrow(/refusing forced deployment|review deletions/);
    expect(execute.mock.calls.some(([, args]) => args.includes('deploy'))).toBe(false);
  });

  it('refuses force if a reviewed function was omitted from the build', () => {
    const cwd = preparedRelease();
    fs.writeFileSync(path.join(cwd, 'functions/lib/index.js'), 'exports.syncAllUsersTransactions = void 0;');
    const execute = vi.fn();
    expect(() => deployProductionRelease({ cwd, confirmation: productionDeployConfirmation(commit),
      inheritedEnv: {}, execute, nodeVersion: 'v22.23.2',
    })).toThrow('reviewed production function export is missing');
    expect(execute.mock.calls.some(([, args]) => args.includes('deploy'))).toBe(false);
  });
});

describe('production function inventory guard', () => {
  it('accepts initial and fully deployed inventories', () => {
    expect(() => assertProductionFunctionInventory(inventory())).not.toThrow();
    const fullyDeployed = PRODUCTION_FUNCTION_IDS.map(id => ({
      id, project, region: 'us-central1', platform: 'gcfv2',
      codebase: id === 'ssrwriteoff23910' ? 'firebase-frameworks-writeoff-23910' : id === 'syncAllUsersTransactions' ? 'default' : 'analysis',
    }));
    expect(() => assertProductionFunctionInventory(inventory(fullyDeployed))).not.toThrow();
  });
  it.each([
    { id: 'unexpected' }, { project: 'another-project' }, { region: 'us-east1' },
    { codebase: 'unreviewed-codebase' }, { platform: 'run' },
  ])('rejects a deletion or identity change: %j', override => {
    expect(() => assertProductionFunctionInventory(inventory([{ ...existingFunctions[1], ...override }]))).toThrow('review deletions');
  });
  it.each(['{}', 'null', '{"status":"error","result":[]}', '{"status":"success","result":{}}', 'not json'])('fails closed on invalid inventory %s', contents => {
    expect(() => assertProductionFunctionInventory(contents)).toThrow(/refusing forced deployment/);
  });
  it('rejects duplicate identities', () => {
    expect(() => assertProductionFunctionInventory(inventory([existingFunctions[1], existingFunctions[1]]))).toThrow('review deletions');
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

  it('refuses to deploy from a Node major other than package.json engines, before any install or build', () => {
    const cwd = preparedRelease();
    const execute = vi.fn();
    const serviceAccount = path.join(cwd, '..', `writeoff-sa-node-${path.basename(cwd)}.json`);
    fs.writeFileSync(serviceAccount, JSON.stringify({ project_id: project, client_email: `deploy@${project}.iam.gserviceaccount.com` }), { mode: 0o600 });
    directories.push(serviceAccount);
    const inheritedEnv = { PATH: '/usr/bin', GOOGLE_APPLICATION_CREDENTIALS: serviceAccount, STRIPE_SECRET_KEY: 'sk_live_syntheticvalue', PLAID_SECRET: 'synthetic-plaid-private-value' };
    expect(() => deployProductionRelease({ cwd, confirmation: productionDeployConfirmation(commit), inheritedEnv, execute, nodeVersion: 'v20.20.2' }))
      .toThrow(/requires Node 22/);
    expect(execute).not.toHaveBeenCalled();
    expect(() => assertDeployNodeVersion(cwd, 'v22.23.2')).not.toThrow();
    expect(() => assertDeployNodeVersion(cwd, 'v24.1.0')).toThrow(/requires Node 22/);
  });
  it('the release scripts load and run in a fresh release directory with no node_modules (the workflow runs them before npm ci)', () => {
    const cwd = preparedRelease();
    const scripts = path.join(cwd, 'scripts');
    fs.mkdirSync(scripts);
    for (const name of ['production-preflight.mjs', 'deploy-production-release.mjs']) {
      fs.copyFileSync(path.join(process.cwd(), 'scripts', name), path.join(scripts, name));
    }
    expect(fs.existsSync(path.join(cwd, 'node_modules'))).toBe(false);
    // NODE_PATH is cleared so nothing resolves from the checkout; a third-party import fails here.
    const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NODE_PATH: '' };
    const preflight = spawnSync(process.execPath, ['scripts/production-preflight.mjs', '--project', project, '--config', 'firebase.json'], { cwd, env, encoding: 'utf8' });
    expect(preflight.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package/);
    expect(preflight.stdout + preflight.stderr).toMatch(/PASS|PENDING|FAIL/);
    const load = spawnSync(process.execPath, ['--input-type=module', '-e', "import('./scripts/deploy-production-release.mjs').then(m => console.log(typeof m.deployProductionRelease))"], { cwd, env, encoding: 'utf8' });
    expect(load.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package/);
    expect(load.stdout.trim()).toBe('function');
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
