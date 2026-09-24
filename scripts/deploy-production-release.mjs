import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  COORDINATED_DEPLOY_VARIABLE,
  PRODUCTION_PROJECT,
  RELEASE_MANIFEST,
  runProductionPreflight,
} from './production-preflight.mjs';

const SECRET_ENVIRONMENT_NAME = /^(?:GOOGLE_APPLICATION_CREDENTIALS$|FIREBASE_|PLAID_|STRIPE_|ANALYSIS_WORKER_|CLOUD_FUNCTION_|SSN_|OPENAI_|COLUMN_TAX_|WRITEOFF_)/;

/** Dependency install and build scripts never receive deployment credentials or provider secrets. */
export function buildEnvironment(inheritedEnv) {
  return Object.fromEntries(Object.entries(inheritedEnv).filter(([name]) => !SECRET_ENVIRONMENT_NAME.test(name)));
}

export const PRODUCTION_DEPLOY_TARGETS = Object.freeze([
  'hosting',
  'firestore',
  'storage',
  'functions',
]);

const FUNCTION_EXPORTS = Object.freeze({
  syncAllUsersTransactions: 'functions',
  queueBankTransactionAnalysis: 'functions-analysis',
  processBankTransactionAnalysis: 'functions-analysis',
  queueProfileAnalysisRefresh: 'functions-analysis',
  processProfileAnalysisRefresh: 'functions-analysis',
  cleanupExpiredPreparerHandoffs: 'functions-analysis',
});
export const PRODUCTION_FUNCTION_IDS = Object.freeze([...Object.keys(FUNCTION_EXPORTS), 'ssrwriteoff23910']);

/** --force acknowledges retry policies but also permits deletion: refuse any unreviewed inventory. */
export function assertProductionFunctionInventory(contents) {
  let inventory;
  try { inventory = JSON.parse(String(contents)); }
  catch { throw new Error('Production function inventory is unreadable; refusing forced deployment'); }
  if (inventory?.status !== 'success' || !Array.isArray(inventory.result)) {
    throw new Error('Production function inventory was not verified; refusing forced deployment');
  }
  const seen = new Set();
  for (const endpoint of inventory.result) {
    const directory = FUNCTION_EXPORTS[endpoint?.id];
    if (!endpoint || !PRODUCTION_FUNCTION_IDS.includes(endpoint.id) ||
        endpoint.project !== PRODUCTION_PROJECT || endpoint.region !== 'us-central1' ||
        !['gcfv1', 'gcfv2'].includes(endpoint.platform) || seen.has(endpoint.id) ||
        (directory && endpoint.codebase !== (directory === 'functions' ? 'default' : 'analysis'))) {
      throw new Error('Unexpected production function identity, region or codebase; review deletions before deployment');
    }
    seen.add(endpoint.id);
  }
}

/** Every allowed application function must still exist in the just-built release. */
function assertRetainedFunctionExports(cwd) {
  for (const [name, directory] of Object.entries(FUNCTION_EXPORTS)) {
    let compiled;
    try { compiled = fs.readFileSync(path.join(cwd, directory, 'lib/index.js'), 'utf8'); }
    catch { throw new Error('Production function build is missing; refusing forced deployment'); }
    // Match actual trigger assignments, not TypeScript's initial `exports.name = void 0` declarations.
    if (!new RegExp(`^exports\\.${name} = \\(0, [\\w$]+\\.on(?:Schedule|DocumentWritten)\\)\\(`, 'm').test(compiled)) {
      throw new Error('A reviewed production function export is missing; review deletions before deployment');
    }
  }
  const config = JSON.parse(fs.readFileSync(path.join(cwd, 'firebase.json'), 'utf8'));
  if (config.hosting?.frameworksBackend?.region !== 'us-central1') {
    throw new Error('Production SSR function region changed; review deletions before deployment');
  }
}

export function productionDeployConfirmation(commit) {
  return `deploy:${PRODUCTION_PROJECT}:${commit}`;
}

function readReleaseManifest(cwd) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(cwd, RELEASE_MANIFEST), 'utf8'));
    if (!/^[a-f\d]{40}$/.test(manifest.commit || '')) throw new Error();
    return manifest;
  } catch {
    throw new Error('Run this command only inside an isolated prepared production release');
  }
}

function assertPreflight(cwd, inheritedEnv) {
  const result = runProductionPreflight({
    cwd,
    inheritedEnv,
    args: ['--project', PRODUCTION_PROJECT, '--config', 'firebase.json'],
  });
  if (result.errors.length) {
    throw new Error(`Production preflight rejected deployment: ${result.errors.join('; ')}`);
  }
  return result;
}

/** Validate an exact prepared release without building or deploying it. */
export function planProductionDeployment({
  cwd = process.cwd(),
  confirmation,
  inheritedEnv = process.env,
} = {}) {
  cwd = fs.realpathSync(cwd);
  const manifest = readReleaseManifest(cwd);
  const expected = productionDeployConfirmation(manifest.commit);
  if (confirmation !== expected) {
    throw new Error(`Explicit confirmation is required: --confirm ${expected}`);
  }
  if (inheritedEnv.GITHUB_ACTIONS === 'true' && inheritedEnv.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('Production deployment is permitted only from a manually dispatched GitHub workflow');
  }
  const preflight = assertPreflight(cwd, inheritedEnv);
  return {
    cwd,
    commit: manifest.commit,
    targets: [...PRODUCTION_DEPLOY_TARGETS],
    pending: preflight.pending,
  };
}

/**
 * Build and deploy every production surface from one prepared release.
 * Firebase target releases are coordinated but not transactional; the operator
 * must retain the compatible rollback details required by the release review.
 */
/** The SSR runtime Firebase provisions follows the Node major that runs the deploy; it must match package.json engines. */
export function assertDeployNodeVersion(cwd, nodeVersion = process.version) {
  const engines = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).engines?.node;
  const required = String(engines ?? '').match(/\d+/)?.[0];
  const actual = nodeVersion.replace(/^v/, '').split('.')[0];
  if (!required || actual !== required) {
    throw new Error(`Production deployment requires Node ${required ?? '(engines.node)'} (the SSR runtime follows the deploying Node major); current is ${nodeVersion}`);
  }
}

export function deployProductionRelease({
  cwd = process.cwd(),
  confirmation,
  inheritedEnv = process.env,
  execute = execFileSync,
  nodeVersion = process.version,
} = {}) {
  const plan = planProductionDeployment({ cwd, confirmation, inheritedEnv });
  assertDeployNodeVersion(plan.cwd, nodeVersion);
  const run = (file, args, env, workingDirectory = plan.cwd) =>
    execute(file, args, { cwd: workingDirectory, env, stdio: 'inherit' });
  // Next reads .env.production.local from disk; the shell needs no secrets to build.
  const buildEnv = buildEnvironment(inheritedEnv);

  run('npm', ['ci', '--include=dev'], buildEnv);
  run('npm', ['run', 'build'], buildEnv);
  for (const directory of ['functions', 'functions-analysis']) {
    const workingDirectory = path.join(plan.cwd, directory);
    run('npm', ['ci', '--include=dev'], buildEnv, workingDirectory);
    run('npm', ['run', 'build'], buildEnv, workingDirectory);
  }

  // Recheck digests and configuration immediately before the irreversible call.
  assertPreflight(plan.cwd, inheritedEnv);
  const deployEnv = { ...inheritedEnv, [COORDINATED_DEPLOY_VARIABLE]: plan.commit };
  assertRetainedFunctionExports(plan.cwd);
  const firebase = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  let inventory;
  try {
    inventory = execute(firebase, [
      '--no-install', 'firebase-tools', 'functions:list', '--project', PRODUCTION_PROJECT,
      '--config', 'firebase.json', '--non-interactive', '--json',
    ], { cwd: plan.cwd, env: deployEnv, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch {
    // CLI output can contain function environment values; never echo it in an error.
    throw new Error('Could not verify production function inventory; refusing forced deployment');
  }
  assertProductionFunctionInventory(inventory);
  assertPreflight(plan.cwd, inheritedEnv);
  run(firebase, [
    '--no-install',
    'firebase-tools',
    'deploy',
    '--only',
    plan.targets.join(','),
    '--project',
    PRODUCTION_PROJECT,
    '--config',
    'firebase.json',
    '--non-interactive',
    '--force',
  ], deployEnv);
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    let confirmation;
    for (let i = 2; i < process.argv.length; i += 2) {
      if (process.argv[i] !== '--confirm' || !process.argv[i + 1]) {
        throw new Error('Use --confirm with the exact prepared release confirmation');
      }
      confirmation = process.argv[i + 1];
    }
    const result = deployProductionRelease({ confirmation });
    console.log(`Production deployment command completed for commit ${result.commit}.`);
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : 'Production deployment failed'}`);
    process.exitCode = 1;
  }
}
