import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'dotenv';

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
