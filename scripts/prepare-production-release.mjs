import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parse } from 'dotenv';
import { PRODUCTION_PROJECT, RELEASE_ENV, RELEASE_MANIFEST, MIGRATION_REVIEW, environmentDigest, validateMigrationReview, validateProductionConfiguration } from './production-preflight.mjs';

/** Export a clean committed snapshot. This does not install, build, call providers, or deploy. */
export function prepareProductionRelease({ source, output, envFile, migrationReviewFile }) {
  source = fs.realpathSync(source);
  output = path.resolve(output);
  const relative = path.relative(source, output);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('The production release must be outside the working checkout');
  if (fs.existsSync(output)) throw new Error('Choose a new production release directory');
  if (!fs.statSync(envFile).isFile()) throw new Error('A separate production env file is required');
  if (execFileSync('git', ['status', '--porcelain'], { cwd: source, encoding: 'utf8' }).trim()) throw new Error('Commit the reviewed changes before preparing a production release');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  let migrationContents, migrationReview;
  try { migrationContents = fs.readFileSync(migrationReviewFile, 'utf8'); migrationReview = JSON.parse(migrationContents); }
  catch { throw new Error('A separate completed production migration review is required'); }
  const migrationErrors = validateMigrationReview(migrationReview, commit);
  if (migrationErrors.length) throw new Error(`Production migration review rejected: ${migrationErrors.join('; ')}`);
  const contents = fs.readFileSync(envFile, 'utf8');
  const env = parse(contents);
  const config = JSON.parse(execFileSync('git', ['show', `${commit}:firebase.json`], { cwd: source, encoding: 'utf8' }));
  const result = validateProductionConfiguration(env, { project: PRODUCTION_PROJECT, hosting: config.hosting });
  if (result.errors.length) throw new Error(`Production configuration rejected: ${result.errors.join('; ')}`);
  fs.mkdirSync(output, { recursive: false, mode: 0o700 });
  try {
    const archive = execFileSync('git', ['archive', '--format=tar', commit], { cwd: source, maxBuffer: 128 * 1024 * 1024 });
    execFileSync('tar', ['-xf', '-', '-C', output], { input: archive });
    if (fs.readdirSync(output).some(name => name.startsWith('.env'))) throw new Error('Committed env files must not be included in a release');
    fs.writeFileSync(path.join(output, RELEASE_ENV), contents, { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(path.join(output, MIGRATION_REVIEW), migrationContents, { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(path.join(output, RELEASE_MANIFEST), JSON.stringify({ project: PRODUCTION_PROJECT, commit,
      environmentDigest: environmentDigest(contents), migrationReviewDigest: environmentDigest(migrationContents) }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    // Only non-secret routing parameters go into Functions env files. Both
    // Functions secrets must be separately provisioned in production Secret Manager.
    fs.writeFileSync(path.join(output, 'functions-analysis', `.env.${PRODUCTION_PROJECT}`), `ANALYSIS_WORKER_ORIGIN=${env.ANALYSIS_WORKER_ORIGIN}\n`, { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(path.join(output, 'functions', `.env.${PRODUCTION_PROJECT}`), `SITE_URL=${env.NEXT_PUBLIC_SITE_URL}\nPLAID_ENV=production\nPLAID_CLIENT_ID=${env.PLAID_CLIENT_ID}\n`, { mode: 0o600, flag: 'wx' });
    return { output, commit, pending: result.pending };
  } catch (error) {
    // Remove the private env on incomplete preparation; leave the code snapshot
    // for inspection instead of recursively deleting a user-supplied path.
    fs.rmSync(path.join(output, RELEASE_ENV), { force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const values = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const name = process.argv[i];
      if (!['--source', '--output', '--env-file', '--migration-review'].includes(name) || !process.argv[i + 1]) throw new Error('Use --source, --output, --env-file and --migration-review');
      values[name] = process.argv[i + 1];
    }
    if (!values['--source'] || !values['--output'] || !values['--env-file'] || !values['--migration-review']) throw new Error('Use --source, --output, --env-file and --migration-review');
    const result = prepareProductionRelease({ source: values['--source'], output: values['--output'], envFile: values['--env-file'], migrationReviewFile: values['--migration-review'] });
    console.log(`Prepared private production release from commit ${result.commit}. No deployment was performed.`);
    for (const pending of result.pending) console.log(`PENDING: ${pending}`);
  } catch (error) { console.error(`FAIL: ${error instanceof Error ? error.message : 'Production preparation failed'}`); process.exitCode = 1; }
}
