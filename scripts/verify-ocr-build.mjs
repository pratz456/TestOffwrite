import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';

// Run after next build. An optional synthetic image exercises the real native
// worker as well; no app account or receipt storage is accessed.
const root = process.cwd();
const route = path.join(root, '.next/server/app/api/receipts/process/route.js');
const trace = JSON.parse(await readFile(`${route}.nft.json`, 'utf8'));
const files = new Set(await Promise.all(trace.files.map(file => realpath(path.resolve(path.dirname(route), file)))));
const require = createRequire(path.join(root, 'package.json'));
const worker = require('tesseract.js/src/worker/node/defaultOptions').workerPath;
assert.ok(files.has(await realpath(worker)), 'Built OCR trace must include the native Tesseract worker');

const coreRoot = path.dirname(require.resolve('tesseract.js-core/package.json'));
for (const name of ['tesseract-core', 'tesseract-core-lstm', 'tesseract-core-simd', 'tesseract-core-simd-lstm']) {
  for (const extension of ['js', 'wasm']) {
    const file = await realpath(path.join(coreRoot, `${name}.${extension}`));
    assert.ok(files.has(file), `Built OCR trace is missing ${name}.${extension}`);
  }
}
const compiledFiles = [route, ...trace.files.filter(file => file.endsWith('.js') && !file.includes('node_modules')).map(file => path.resolve(path.dirname(route), file))];
const compiled = (await Promise.all(compiledFiles.map(file => readFile(file, 'utf8')))).join('\n');
assert.match(compiled, /require\(["']tesseract\.js["']\)/, 'Server build must load native Tesseract without bundling its worker path');
console.log('PASS: Built OCR route loads native Tesseract and traces its worker/core files.');

if (process.argv[2]) {
  const image = await readFile(path.resolve(process.argv[2]));
  let ocr;
  const timeout = setTimeout(() => {
    console.error('FAIL: Native OCR timed out.');
    process.exit(1);
  }, 45000);
  try {
    ocr = await require('tesseract.js').createWorker('eng', 1, {
      cachePath: tmpdir(),
      errorHandler: () => {},
    });
    const { data } = await ocr.recognize(image);
    assert.ok(data.text.trim(), 'Synthetic receipt should produce recognized text');
    console.log(`PASS: Native OCR recognized ${data.text.trim().length} characters (${data.confidence}% confidence).`);
  } finally {
    clearTimeout(timeout);
    if (ocr) await ocr.terminate();
  }
}
