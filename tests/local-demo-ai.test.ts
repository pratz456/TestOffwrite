import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { localDemoAIEnvironment } from '../scripts/local-demo-ai.mjs';

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
  it('copies only OpenAI settings and defaults the model', async () => {
    const dir = await fixture('OPENAI_API_KEY=synthetic-test-key\nFIREBASE_PROJECT_ID=forbidden\nPLAID_SECRET=forbidden\nSTRIPE_SECRET_KEY=forbidden\nNEXT_PUBLIC_OPENAI_API_KEY=forbidden');
    expect(await localDemoAIEnvironment(['--ai-env-file', 'server.env'], dir)).toEqual({
      OPENAI_API_KEY: 'synthetic-test-key', OPENAI_MODEL: 'gpt-4o-mini', AI_ANALYSIS_ENABLED: 'true',
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
