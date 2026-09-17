import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  PRODUCTION_PROJECT,
  RELEASE_MANIFEST,
  runProductionPreflight,
} from './production-preflight.mjs';

export const PRODUCTION_DEPLOY_TARGETS = Object.freeze([
  'hosting',
  'firestore',
  'storage',
  'functions',
]);

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
export function deployProductionRelease({
  cwd = process.cwd(),
  confirmation,
  inheritedEnv = process.env,
  execute = execFileSync,
} = {}) {
  const plan = planProductionDeployment({ cwd, confirmation, inheritedEnv });
  const options = { cwd: plan.cwd, env: inheritedEnv, stdio: 'inherit' };
  const run = (file, args, workingDirectory = plan.cwd) =>
    execute(file, args, { ...options, cwd: workingDirectory });

  run('npm', ['ci', '--include=dev']);
  run('npm', ['run', 'build']);
  for (const directory of ['functions', 'functions-analysis']) {
    const workingDirectory = path.join(plan.cwd, directory);
    run('npm', ['ci', '--include=dev'], workingDirectory);
    run('npm', ['run', 'build'], workingDirectory);
  }

  // Recheck digests and configuration immediately before the irreversible call.
  assertPreflight(plan.cwd, inheritedEnv);
  run(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
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
  ]);
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
