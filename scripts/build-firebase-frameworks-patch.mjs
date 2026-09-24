import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const UPSTREAM_VERSION = '0.11.8';
export const PATCHED_VERSION = '0.11.8-writeoff.1';
export const UPSTREAM_INTEGRITY = 'sha512-6S5APGhQGbGs3zfdh0gqTYE6tycRYS8Gz2vdENIZ+rz7+yPuqGU1d7Ue5IUFR5MKLktfHUdzm/+frlkHT0AZtw==';
export const UPSTREAM_SOURCE_HASH = 'd6669094bc3d3faf067e150bd4f4ff622e3220ed1c98496ca22f747727b25e67';
export const PATCHED_SOURCE_HASH = 'd9c2c2720a540fe74644503e1907269b74ed1fc1fa097cbdaf17e37e70be96de';
export const TARBALL = `firebase-frameworks-${PATCHED_VERSION}.tgz`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function assertSource(contents, version, expectedVersion, expectedHash) {
  if (version !== expectedVersion || createHash('sha256').update(contents).digest('hex') !== expectedHash) {
    throw new Error('Unreviewed firebase-frameworks version or source content');
  }
}

// Deliberate maintenance command, never an install hook. Normal installs use the
// committed tarball, including cloud installs with lifecycle scripts disabled.
export function buildPatchedFrameworks({ upstreamTarball, output = path.join(root, 'vendor', TARBALL) } = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'writeoff-frameworks-patch-'));
  try {
    if (!upstreamTarball) {
      execFileSync('npm', ['pack', `firebase-frameworks@${UPSTREAM_VERSION}`, '--ignore-scripts', '--pack-destination', temporary], { stdio: 'pipe' });
      upstreamTarball = path.join(temporary, `firebase-frameworks-${UPSTREAM_VERSION}.tgz`);
    }
    const bytes = fs.readFileSync(upstreamTarball);
    if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== UPSTREAM_INTEGRITY) throw new Error('Upstream package integrity mismatch');
    execFileSync('tar', ['-xf', path.resolve(upstreamTarball), '-C', temporary]);
    const packageRoot = path.join(temporary, 'package');
    const manifestPath = path.join(packageRoot, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const sourcePath = path.join(packageRoot, 'dist', 'firebase-aware.js');
    assertSource(fs.readFileSync(sourcePath), manifest.version, UPSTREAM_VERSION, UPSTREAM_SOURCE_HASH);
    const patched = fs.readFileSync(path.join(root, 'vendor/firebase-frameworks/firebase-aware.js'));
    assertSource(patched, PATCHED_VERSION, PATCHED_VERSION, PATCHED_SOURCE_HASH);
    fs.writeFileSync(sourcePath, patched);
    manifest.version = PATCHED_VERSION;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    fs.copyFileSync(path.join(root, 'vendor/firebase-frameworks/LICENSE'), path.join(packageRoot, 'LICENSE'));
    const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: packageRoot, encoding: 'utf8' }))[0];
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(path.join(temporary, packed.filename), output);
    return { output, integrity: packed.integrity, version: PATCHED_VERSION };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(buildPatchedFrameworks({ upstreamTarball: process.argv[2] }), null, 2));
}
