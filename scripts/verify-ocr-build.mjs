import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';

// Run after next build. An optional synthetic image exercises the real native
// worker as well; no app account or receipt storage is accessed.
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
const traineddata = await realpath(path.join(root, 'tessdata/eng.traineddata'));

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
}
console.log('PASS: Built OCR routes load native Tesseract and trace its worker, core, and tessdata files.');

if (process.argv[2]) {
  const image = await readFile(path.resolve(process.argv[2]));
  let ocr;
  const timeout = setTimeout(() => {
    console.error('FAIL: Native OCR timed out.');
    process.exit(1);
  }, 45000);
  try {
    ocr = await require('tesseract.js').createWorker('eng', 1, {
      langPath: path.join(root, 'tessdata'),
      gzip: false,
      cachePath: tmpdir(),
      cacheMethod: 'none',
      errorHandler: () => {},
    });
    const { data } = await ocr.recognize(image);
    assert.ok(data.text.trim(), 'Synthetic receipt should produce recognized text');
    console.log(`PASS: Native OCR recognized ${data.text.trim().length} characters (${data.confidence}% confidence).`);
    console.log(data.text.trim());
  } finally {
    clearTimeout(timeout);
    if (ocr) await ocr.terminate();
  }
}
