import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'dotenv';
import { ANALYSIS_FANOUT_DEFAULTS } from './production-preflight.mjs';

/**
 * Dotenv file for the analysis Functions emulator. The emulator resolves params
 * interactively whatever the CLI flags say (firebase-tools emulator/functionsEmulator.js
 * passes `nonInteractive: false`), and it prompts for every declared non-secret param
 * missing from the dotenv files, compiled default or not. The demo's stdin is closed,
 * so a prompt aborts the codebase load and no analysis function ever starts.
 */
export function analysisWorkerEnvFile(origin) {
  return [`ANALYSIS_WORKER_ORIGIN=${origin}`, ...Object.entries(ANALYSIS_FANOUT_DEFAULTS).map(([name, value]) => `${name}=${value}`)]
    .map(line => `${line}\n`).join('');
}

/** Explicit opt-in. Never inherit Firebase, bank, payment, or other provider credentials. */
export async function localDemoAIEnvironment(args, cwd = process.cwd()) {
  if (args.length === 0) return {};
  if (args.length !== 2 || args[0] !== '--ai-env-file' || !args[1] || args[1].startsWith('--')) {
    throw new Error('Usage: node scripts/local-demo.mjs [--ai-env-file /path/to/server.env]');
  }
  const contents = parse(await fs.readFile(path.resolve(cwd, args[1]), 'utf8'));
  const key = contents.OPENAI_API_KEY?.trim();
  if (!key) throw new Error('The selected server environment file has no OpenAI API key.');
  const model = contents.OPENAI_MODEL?.trim();
  // Without an explicit override the demo runs the per-task production defaults from lib/openai/client.ts.
  return {
    OPENAI_API_KEY: key,
    ...(model ? { OPENAI_MODEL: model } : {}),
    AI_ANALYSIS_ENABLED: contents.AI_ANALYSIS_ENABLED === 'false' ? 'false' : 'true',
  };
}
