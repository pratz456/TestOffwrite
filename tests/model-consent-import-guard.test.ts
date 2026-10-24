import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** The only module allowed to value-import the provider SDK, construct a client, or name the provider host. */
const ALLOWLIST = ['lib/openai/client.ts'];

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.next', 'coverage', 'dist', '.turbo']);
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.json', '.md', '.rules', '.yml', '.yaml']);

const host = ['api', 'openai', 'com'].join('.');
const providerImport = new RegExp(`from\\s+['"]${'openai'}(?:/[^'"]*)?['"]`);
const providerRequire = new RegExp(`require\\(\\s*['"]${'openai'}(?:/[^'"]*)?['"]\\s*\\)`);
const constructorCall = new RegExp(`\\bnew\\s+${'Open'}${'AI'}\\b`);
const mockCall = /vi\.(?:do)?mock\(\s*['"]openai(?:\/[^'"]*)?['"]/g;

function walk(directory: string, root: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(name)) continue;
    // Compiled function output is a nested lib directory. The repo source lib stays in the scan.
    if (name === 'lib' && directory !== root) continue;
    const full = path.join(directory, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      found.push(...walk(full, root));
    } else if (TEXT_EXTENSIONS.has(path.extname(name)) && name !== 'package-lock.json') {
      found.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  return found;
}

function violations(relativePath: string, source: string): string[] {
  if (ALLOWLIST.includes(relativePath)) return [];
  const stripped = source
    .replace(/import\s+type\b[^;]*;?/g, '')
    .replace(mockCall, '');
  const problems: string[] = [];
  if (providerImport.test(stripped)) problems.push('value import');
  if (providerRequire.test(stripped)) problems.push('require');
  if (constructorCall.test(stripped)) problems.push('client construction');
  if (stripped.includes(host)) problems.push('provider host');
  return problems;
}

describe('model provider import guard', () => {
  it('lists the allowlist explicitly and keeps the provider host out of every other file, including CSP config', () => {
    expect(ALLOWLIST).toEqual(['lib/openai/client.ts']);
    const root = path.resolve(__dirname, '..');
    const hits = walk(root, root).flatMap(file => {
      const problems = violations(file, readFileSync(path.join(root, file), 'utf8'));
      return problems.map(problem => `${file}: ${problem}`);
    });
    expect(hits).toEqual([]);
  });
});
