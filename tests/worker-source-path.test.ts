import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const workerSource = 'functions-analysis/src/itemization-status.ts';

function resolvedWorkerImports(relativeFile: string): string[] {
  const source = readFileSync(new URL(`../${relativeFile}`, import.meta.url), 'utf8');
  return [...source.matchAll(/from ['"]([^'"]+)['"]/g)]
    .map(match => match[1])
    .filter(specifier => specifier.includes('itemization-status'))
    .map(specifier => specifier.startsWith('@/')
      ? `${specifier.slice(2)}.ts`
      : path.posix.join(path.posix.dirname(relativeFile), `${specifier}.ts`));
}

describe('worker deduction choice source', () => {
  it('keeps the imported worker file in place and exports the normalizer', async () => {
    const resolved = [
      ...resolvedWorkerImports('lib/profile/itemization-status.ts'),
      ...resolvedWorkerImports('functions-analysis/src/profile-fields.ts'),
    ];
    expect(resolved).toEqual([workerSource, workerSource, workerSource]);
    const absolute = path.resolve(workerSource);
    expect(existsSync(absolute)).toBe(true);
    const loaded = await import(pathToFileURL(absolute).href);
    expect(typeof loaded.normalizeItemizationStatus).toBe('function');
  });
});
