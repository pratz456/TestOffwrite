import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { privacyRuntimeCaching } from '../lib/pwa/cache-policy';

const require = createRequire(import.meta.url);
function imageConfig() {
  const loadedModule = { exports: {} as { default: { images: Record<string, unknown> } } };
  const compiled = ts.transpileModule(fs.readFileSync('next.config.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports,
    process: { env: { NODE_ENV: 'production' } }, require: (name: string) => {
      if (name === '@ducanh2912/next-pwa') return { default: () => (config: unknown) => config };
      if (name === './lib/pwa/cache-policy') return { privacyRuntimeCaching };
      throw new Error(`Unexpected config dependency ${name}`);
    } });
  return loadedModule.exports.default.images;
}

describe('Firebase SSR image dependency isolation', () => {
  it('prevents the installed Firebase generator from injecting its vulnerable image decoder', async () => {
    const source = fs.readFileSync(require.resolve('firebase-tools/lib/frameworks/next/index.js'), 'utf8');
    const start = source.indexOf('    if (await (0, utils_2.isUsingImageOptimization)(sourceDir, distDir)) {');
    const end = source.indexOf('    const dotEnv = {};', start);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'writeoff-image-packaging-'));
    try {
      fs.mkdirSync(path.join(root, '.next'));
      fs.writeFileSync(path.join(root, '.next/export-marker.json'), JSON.stringify({ isNextImageImported: true }));
      const generate = async (images: Record<string, unknown>) => {
        fs.writeFileSync(path.join(root, '.next/images-manifest.json'), JSON.stringify({ images }));
        const packageJson = { dependencies: {} as Record<string, string> };
        // Real installed detector and injection code; no provider or npm calls.
        await vm.runInNewContext(`(async () => { ${source.slice(start, end)} })()`, {
          sourceDir: root, distDir: '.next', packageJson,
          utils_2: require('firebase-tools/lib/frameworks/next/utils.js'),
          constants_1: require('firebase-tools/lib/frameworks/constants.js'),
        });
        return packageJson;
      };
      expect((await generate({ unoptimized: false })).dependencies.sharp).toBeDefined();
      expect((await generate(imageConfig())).dependencies).not.toHaveProperty('sharp');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it.each(['/writeofflogo.png', 'data:image/png;base64,c3ludGhldGlj'])('keeps image source and layout without optimizer URLs: %s', src => {
    const { getImgProps } = require('next/dist/shared/lib/get-img-props');
    const { imageConfigDefault } = require('next/dist/shared/lib/image-config');
    const { default: defaultLoader } = require('next/dist/shared/lib/image-loader');
    const { props } = getImgProps({ src, alt: 'Image', width: 200, height: 140, className: 'rounded-md' },
      { defaultLoader, imgConf: { ...imageConfigDefault, ...imageConfig() } });
    expect(props).toMatchObject({ src, width: 200, height: 140, className: 'rounded-md' });
    expect(props.srcSet).toBeUndefined();
  });
});
