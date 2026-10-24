import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** The only module allowed to value-import the provider SDK, construct a client, or name the provider host. */
const ALLOWLIST = ['lib/openai/client.ts'];

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.next', 'coverage', 'dist', '.turbo']);
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.json', '.md', '.rules', '.yml', '.yaml', '.mts', '.cts']);
const COMPILED_LIB_PARENTS = new Set(['functions', 'functions-analysis']);

const provider = String.fromCharCode(111, 112, 101, 110, 97, 105);
const host = String.fromCharCode(97, 112, 105, 46, 111, 112, 101, 110, 97, 105, 46, 99, 111, 109);
const providerImport = new RegExp(String.raw`\bfrom\s+['"]${provider}(?:\/[^'"]*)?['"]`);
const providerRequire = new RegExp(String.raw`\brequire\s*\(\s*['"]${provider}(?:\/[^'"]*)?['"]`);
const dynamicImport = new RegExp(String.raw`\bimport\s*\(\s*['"]${provider}(?:\/[^'"]*)?['"]`);
const constructorCall = new RegExp(`\\bnew\\s+${'Open'}${'AI'}\\b`);
const rawFetch = new RegExp(String.raw`\bfetch\s*\([^;\n]*\b(?:OPENAI_COMPLETIONS_URL|OPENAI_API_BASE_URL)\b`);
const mockCall = /vi\.(?:do)?mock\(\s*['"]openai(?:\/[^'"]*)?['"]/g;

function foldLiterals(source: string): string {
  let current = source;
  const pair = /(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\+\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = current.replace(pair, (_match, quote: string, left: string, _rightQuote: string, right: string) => `${quote}${left}${right}${quote}`);
    if (next === current) break;
    current = next;
  }
  return current.replace(/\[((?:\s*['"][^'"]*['"]\s*,?)*)\]\s*\.\s*join\(\s*(['"])\.\2\s*\)/g, (match, inner: string) => {
    const parts = [...inner.matchAll(/['"]([^'"]*)['"]/g)].map(item => item[1]);
    return parts.length >= 2 ? `'${parts.join('.')}'` : match;
  });
}

function stripTypeImports(source: string): string {
  return source.replace(/import\s+type\b[\s\S]*?from\s+['"][^'"]+['"]\s*;?/g, '');
}

function walk(directory: string, root: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(name)) continue;
    const relativeDir = path.relative(root, directory).split(path.sep).join('/');
    // Compiled function output lives in those two outDir folders. Other nested lib directories are source.
    if (name === 'lib' && COMPILED_LIB_PARENTS.has(relativeDir)) continue;
    const full = path.join(directory, name);
    const stat = statSync(full);
    if (stat.isDirectory()) found.push(...walk(full, root));
    else if (TEXT_EXTENSIONS.has(path.extname(name)) && name !== 'package-lock.json') {
      found.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  return found;
}

function violations(relativePath: string, source: string): string[] {
  if (ALLOWLIST.includes(relativePath)) return [];
  const stripped = foldLiterals(stripTypeImports(source).replace(mockCall, ''));
  const problems: string[] = [];
  if (providerImport.test(stripped)) problems.push('value import');
  if (providerRequire.test(stripped)) problems.push('require');
  if (dynamicImport.test(stripped)) problems.push('dynamic import');
  if (constructorCall.test(stripped)) problems.push('client construction');
  if (stripped.includes(host)) problems.push('provider host');
  if (rawFetch.test(source)) problems.push('provider fetch');
  return problems;
}

function repoHits(): string[] {
  const root = path.resolve(__dirname, '..');
  return walk(root, root).flatMap(file => {
    const problems = violations(file, readFileSync(path.join(root, file), 'utf8'));
    return problems.map(problem => `${file}: ${problem}`);
  });
}

describe('model provider import guard', () => {
  it('lists the allowlist explicitly and keeps the provider host out of every other file, including CSP config', () => {
    expect(ALLOWLIST).toEqual(['lib/openai/client.ts']);
    expect(repoHits()).toEqual([]);
  });

  it('flags a dynamic import of the provider package', () => {
    const sample = `export const load = () => import('${provider}');`;
    expect(violations('app/dynamic.ts', sample)).toContain('dynamic import');
  });

  it('flags source under a nested lib directory such as app/lib', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'consent-guard-'));
    try {
      mkdirSync(path.join(root, 'app', 'lib'), { recursive: true });
      writeFileSync(path.join(root, 'app', 'lib', 'x.ts'), `export const load = () => import('${provider}');`);
      const files = walk(root, root);
      expect(files).toContain('app/lib/x.ts');
      const problems = files.flatMap(file => violations(file, readFileSync(path.join(root, file), 'utf8')));
      expect(problems).toContain('dynamic import');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not let a type import without a semicolon swallow the next value import', () => {
    const sample = [
      `import type { Foo } from '${provider}'`,
      `import { client } from '${provider}'`,
    ].join('\n');
    expect(violations('app/type-then-value.ts', sample)).toContain('value import');
  });

  it('scans mts and cts files', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'consent-guard-ext-'));
    try {
      writeFileSync(path.join(root, 'bypass.mts'), `export const load = () => import('${provider}');`);
      writeFileSync(path.join(root, 'bypass.cts'), `module.exports = require('${provider}');`);
      const files = walk(root, root);
      expect(files).toEqual(expect.arrayContaining(['bypass.mts', 'bypass.cts']));
      const problems = files.flatMap(file => violations(file, readFileSync(path.join(root, file), 'utf8')));
      expect(problems).toEqual(expect.arrayContaining(['dynamic import', 'require']));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags a provider host built by string concatenation', () => {
    const pieces = [host.slice(0, 4), host.slice(4, 11), host.slice(11)];
    const sample = pieces.map(piece => `'${piece}'`).join(' + ');
    expect(sample.includes(host)).toBe(false);
    expect(violations('app/concat.ts', `const endpoint = ${sample};`)).toContain('provider host');
  });

  it('flags a raw fetch of the provider URL constants outside the allowlist', () => {
    const call = (name: string) => ['export const call = () => fetch(', name, ');'].join('');
    expect(violations('app/fetch-completions.ts', call('OPENAI_COMPLETIONS_URL'))).toContain('provider fetch');
    expect(violations('app/fetch-base.ts', call('OPENAI_API_BASE_URL'))).toContain('provider fetch');
    expect(violations('lib/openai/client.ts', call('OPENAI_COMPLETIONS_URL'))).toEqual([]);
  });
});
