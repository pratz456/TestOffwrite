import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Run after next build. CI invokes this with no arguments. An optional image
// path overrides the bundled synthetic receipt. No app account or receipt
// storage is accessed.
const traineddataSha256 = '5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747';
const isolationIneffective = 86;

if (process.env.VERIFY_OCR_OFFLINE !== '1') {
  const isolated = spawnSync(
    'unshare',
    ['--net', '--user', '--map-root-user', '--', process.execPath, ...process.argv.slice(1)],
    { env: { ...process.env, VERIFY_OCR_OFFLINE: '1' }, encoding: 'utf8' },
  );
  if (isolated.stdout) process.stdout.write(isolated.stdout);
  if (isolated.stderr) process.stderr.write(isolated.stderr);
  const setupError = `${isolated.error?.message ?? ''}\n${isolated.stderr ?? ''}`;
  const unavailable = Boolean(isolated.error)
    || /^unshare:/m.test(isolated.stderr ?? '')
    || /unshare failed|Operation not permitted|CLONE_NEWUSER|Function not implemented/i.test(setupError);
  if (!unavailable && isolated.status === 0) process.exit(0);
  if (!unavailable && isolated.status !== isolationIneffective) process.exit(isolated.status ?? 1);
  const missing = isolated.error?.code === 'ENOENT';
  console.log(missing
    ? 'Network namespace is unavailable. Checking langPath and sha256 directly.'
    : 'Network namespace did not block the CDN. Checking langPath and sha256 directly.');
}

if (process.env.VERIFY_OCR_OFFLINE === '1') {
  let blocked = false;
  try {
    await fetch('https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', {
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    blocked = true;
  }
  if (!blocked) process.exit(isolationIneffective);
  console.log('PASS: cdn.jsdelivr.net is unreachable during OCR.');
}

const root = process.cwd();
const routes = [
  path.join(root, '.next/server/app/api/receipts/process/route.js'),
  path.join(root, '.next/server/app/api/tax/import-document/route.js'),
];
const require = createRequire(path.join(root, 'package.json'));
const worker = await realpath(require('tesseract.js/src/worker/node/defaultOptions').workerPath);
const coreRoot = path.dirname(require.resolve('tesseract.js-core/package.json'));
const coreFiles = [];
for (const name of ['tesseract-core', 'tesseract-core-lstm', 'tesseract-core-simd', 'tesseract-core-simd-lstm']) {
  for (const extension of ['js', 'wasm']) {
    coreFiles.push(await realpath(path.join(coreRoot, `${name}.${extension}`)));
  }
}
const langPath = path.join(root, 'tessdata');
const traineddata = await realpath(path.join(langPath, 'eng.traineddata'));
const sha256 = createHash('sha256').update(await readFile(traineddata)).digest('hex');
assert.equal(sha256, traineddataSha256, 'tessdata/eng.traineddata sha256');
const workerOptions = {
  langPath,
  gzip: false,
  cachePath: tmpdir(),
  cacheMethod: 'none',
  errorHandler: () => {},
};
assert.equal(workerOptions.gzip, false);
assert.equal(workerOptions.cacheMethod, 'none');
assert.equal(await realpath(path.join(workerOptions.langPath, 'eng.traineddata')), traineddata);
console.log(`PASS: langPath resolves to traced tessdata/eng.traineddata sha256 ${sha256}.`);

const workerCall = /createWorker\(["']eng["'],1,\{[^}]{0,400}["']tessdata["'][^}]{0,200}gzip:!1[^}]{0,200}cacheMethod:["']none["']/;
for (const route of routes) {
  const trace = JSON.parse(await readFile(`${route}.nft.json`, 'utf8'));
  const files = new Set(await Promise.all(trace.files.map(file => realpath(path.resolve(path.dirname(route), file)))));
  const label = path.relative(root, route);
  assert.ok(files.has(traineddata), `Built OCR trace must include tessdata/eng.traineddata (${label})`);
  assert.ok(files.has(worker), `Built OCR trace must include the native Tesseract worker (${label})`);
  for (const file of coreFiles) {
    assert.ok(files.has(file), `Built OCR trace is missing ${path.basename(file)} (${label})`);
  }
  const compiledFiles = [route, ...trace.files.filter(file => file.endsWith('.js') && !file.includes('node_modules')).map(file => path.resolve(path.dirname(route), file))];
  const compiled = (await Promise.all(compiledFiles.map(file => readFile(file, 'utf8')))).join('\n');
  assert.match(compiled, /require\(["']tesseract\.js["']\)/, `Server build must load native Tesseract without bundling its worker path (${label})`);
  assert.ok(workerCall.test(compiled), `Built OCR worker must use local tessdata without a CDN fetch (${label})`);
  assert.ok(!compiled.includes('cdn.jsdelivr.net'), `Built OCR route must not reference the language CDN (${label})`);
}
console.log('PASS: Built OCR routes load native Tesseract and trace its worker, core, and tessdata files.');
console.log('PASS: Built workers set langPath tessdata, gzip false, and cacheMethod none.');

const imagePath = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/synthetic-receipt.png'));
const image = await readFile(imagePath);
let ocr;
const timeout = setTimeout(() => {
  console.error('FAIL: Native OCR timed out.');
  process.exit(1);
}, 45000);
try {
  ocr = await require('tesseract.js').createWorker('eng', 1, workerOptions);
  const { data } = await ocr.recognize(image);
  assert.ok(data.text.trim(), 'Synthetic receipt should produce recognized text');
  console.log(`PASS: Native OCR recognized ${data.text.trim().length} characters (${data.confidence}% confidence).`);
  console.log(data.text.trim());
} finally {
  clearTimeout(timeout);
  if (ocr) await ocr.terminate();
}
