import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Firebase Functions intercepts /robots.txt before Next handles the request.
// Production serves public/robots.txt. This hook replaces that copied file in
// the staging Hosting output so the testing site stays disallowed.
const configIndex = process.argv.indexOf('--config');
assert.ok(configIndex >= 0 && process.argv[configIndex + 1], 'Pass the staging Firebase config');
const configPath = path.resolve(process.argv[configIndex + 1]);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const site = config.hosting?.site;
assert.equal(site, 'writeoff-production-testing', 'This metadata hook only supports the isolated staging site');
const hostingDirectory = path.join(path.dirname(configPath), '.firebase', site, 'hosting');
assert.ok((await stat(hostingDirectory)).isDirectory(), 'Run the Firebase framework build before this hook');
await writeFile(path.join(hostingDirectory, 'robots.txt'), 'User-agent: *\nDisallow: /\n', 'utf8');
console.log('Prepared staging robots.txt in generated Firebase Hosting output.');
