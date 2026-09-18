import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { analysisWorkerEnvFile, localDemoAIEnvironment } from '../scripts/local-demo-ai.mjs';
import { ANALYSIS_FANOUT_DEFAULTS } from '../scripts/production-preflight.mjs';

// The functions emulator's own param resolver and dotenv loader (firebase-tools internals).
const firebaseTools = createRequire(import.meta.url);
const functionParams = firebaseTools('firebase-tools/lib/deploy/functions/params.js') as {
  resolveParams(params: unknown[], config: unknown, userEnvs: unknown, nonInteractive: boolean, isEmulator?: boolean): Promise<Record<string, { toSDK(): string }>>;
};
const functionBuild = firebaseTools('firebase-tools/lib/deploy/functions/build.js') as { envWithTypes(params: unknown[], envs: Record<string, string>): unknown };
const functionsEnv = firebaseTools('firebase-tools/lib/functions/env.js') as {
  loadUserEnvs(opts: { functionsSource: string; projectId: string; isEmulator?: boolean }): Record<string, string>;
};

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
async function fixture(contents: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'writeoff-demo-ai-test-'));
  directories.push(dir);
  await fs.writeFile(path.join(dir, 'server.env'), contents, { mode: 0o600 });
  return dir;
}

describe('local demo explicit server-only AI connection', () => {
  it('does not connect any provider by default', async () => {
    expect(await localDemoAIEnvironment([])).toEqual({});
  });
  it('copies only OpenAI settings and leaves the per-task production model defaults in place', async () => {
    const dir = await fixture('OPENAI_API_KEY=synthetic-test-key\nFIREBASE_PROJECT_ID=forbidden\nPLAID_SECRET=forbidden\nSTRIPE_SECRET_KEY=forbidden\nNEXT_PUBLIC_OPENAI_API_KEY=forbidden');
    expect(await localDemoAIEnvironment(['--ai-env-file', 'server.env'], dir)).toEqual({
      OPENAI_API_KEY: 'synthetic-test-key', AI_ANALYSIS_ENABLED: 'true',
    });
  });
  it('preserves an explicit operator pause and selected model', async () => {
    const dir = await fixture('OPENAI_API_KEY=synthetic-test-key\nOPENAI_MODEL=selected-model\nAI_ANALYSIS_ENABLED=false');
    expect(await localDemoAIEnvironment(['--ai-env-file', 'server.env'], dir)).toMatchObject({ OPENAI_MODEL: 'selected-model', AI_ANALYSIS_ENABLED: 'false' });
  });
  it.each([['--ai-env-file'], ['--unknown', 'server.env'], ['--ai-env-file', '--help'], ['--ai-env-file', 'server.env', 'extra']])('rejects ambiguous arguments %j', async (...args) => {
    await expect(localDemoAIEnvironment(args)).rejects.toThrow('Usage:');
  });
  it('fails without a key instead of falling back to inherited secrets', async () => {
    const dir = await fixture('OPENAI_API_KEY="  "\n');
    await expect(localDemoAIEnvironment(['--ai-env-file', 'server.env'], dir)).rejects.toThrow('no OpenAI API key');
  });
});

describe('analysis Functions emulator env file', () => {
  const project = 'demo-writeoff-security';
  // Every non-secret param functions-analysis/src/index.ts declares; the emulator prompts for any of them missing from the dotenv files.
  const declaredParams = [
    { name: 'ANALYSIS_WORKER_ORIGIN', type: 'string', default: '' },
    ...Object.entries(ANALYSIS_FANOUT_DEFAULTS).map(([name, value]) => ({ name, type: 'int', default: value })),
  ];
  const firebaseConfig = { projectId: project, storageBucket: `${project}.appspot.com`, databaseURL: '' };
  // With nonInteractive a would-be prompt becomes an error, so a resolved result proves the emulator has nothing to ask.
  const resolveAsEmulator = (userEnvs: Record<string, string>) =>
    functionParams.resolveParams(declaredParams, firebaseConfig, functionBuild.envWithTypes(declaredParams, userEnvs), true, true);
  async function emulatorEnvs(contents: string) {
    const functionsSource = await fs.mkdtemp(path.join(os.tmpdir(), 'writeoff-demo-functions-'));
    directories.push(functionsSource);
    await fs.writeFile(path.join(functionsSource, '.env.local'), contents, { mode: 0o600 });
    return functionsEnv.loadUserEnvs({ functionsSource, projectId: project, isEmulator: true });
  }

  it('writes the worker origin and the compiled fan-out defaults', () => {
    expect(analysisWorkerEnvFile('http://127.0.0.1:3000')).toBe('ANALYSIS_WORKER_ORIGIN=http://127.0.0.1:3000\nANALYSIS_MAX_INSTANCES=2\nANALYSIS_CONCURRENCY=2\n');
  });

  it('gives the emulator a value for every declared param, which the origin-only file did not', async () => {
    await expect(resolveAsEmulator(await emulatorEnvs('ANALYSIS_WORKER_ORIGIN=http://127.0.0.1:3000\n')))
      .rejects.toThrow(/no value for the following environment variables: ANALYSIS_MAX_INSTANCES, ANALYSIS_CONCURRENCY/);
    const resolved = await resolveAsEmulator(await emulatorEnvs(analysisWorkerEnvFile('http://127.0.0.1:3000')));
    expect(resolved.ANALYSIS_WORKER_ORIGIN.toSDK()).toBe('http://127.0.0.1:3000');
    expect(resolved.ANALYSIS_MAX_INSTANCES.toSDK()).toBe('2');
    expect(resolved.ANALYSIS_CONCURRENCY.toSDK()).toBe('2');
  });
});
