#!/usr/bin/env node
/**
 * Production rollback plan — the `rollbackCompatibility` evidence generator.
 *
 * Given the commit that is live (`--from`) and the release commit (`--to`),
 * classify `git diff --name-only` into deploy surfaces, state whether the app
 * can be rolled back on its own, and print the exact coordinated sequence.
 *
 *   node scripts/production-rollback-plan.mjs --from <deployed-sha> --to <release-sha> [--repo <path>] [--json]
 *
 * Read-only: it runs `git` against the local repository and nothing else.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PRODUCTION_PROJECT = 'writeoff-23910';
export const SSR_FUNCTION = 'ssrwriteoff23910';
export const REGION = 'us-central1';

/** Deploy surfaces of `firebase deploy --only hosting,firestore,storage,functions` plus the pipeline itself. */
export const SURFACES = Object.freeze({
  'hosting/app': 'Next.js app and its SSR function (Firebase Hosting + Cloud Run)',
  'firestore.rules': 'Firestore security rules',
  'firestore.indexes.json': 'Firestore composite / collection-group indexes',
  'storage.rules': 'Cloud Storage security rules',
  functions: 'Cloud Functions codebase `default` (syncAllUsersTransactions)',
  'functions-analysis': 'Cloud Functions codebase `analysis` (queue/process analysis, Eventarc)',
  'deploy-config': 'firebase.json / .firebaserc (hosting headers, frameworksBackend, codebases)',
  'release-pipeline': 'prepare/preflight/deploy scripts, deploy workflow, pinned Node version',
  'not-deployed': 'docs, tests, tooling, staging configs, mobile — no production surface',
});

/** Files that must exist at a commit for the GitHub workflow to be able to release (or roll back to) it. */
export const PIPELINE_FILES = Object.freeze([
  '.github/workflows/deploy.yml',
  'scripts/prepare-production-release.mjs',
  'scripts/production-preflight.mjs',
  'scripts/deploy-production-release.mjs',
]);

const RELEASE_PIPELINE_PATHS = new Set([
  ...PIPELINE_FILES,
  'scripts/production-migration-inventory.mjs',
  '.nvmrc',
]);
const NOT_DEPLOYED_PREFIXES = ['docs/', 'tests/', 'mobile/', 'tools/', '.github/', 'scripts/'];
const NOT_DEPLOYED_FILES = new Set([
  'LICENSE', 'README.md', '.editorconfig', '.gitignore', '.gcloudignore', '.nextignore',
  'eslint.config.mjs', 'vitest.config.mjs', 'components.json',
  'firebase.staging.json', 'firebase.staging-auth.json',
]);

/** Map one repository path to a deploy surface. Unknown shipped paths default to hosting/app on purpose. */
export function classifyPath(relativePath) {
  const p = String(relativePath).replace(/\\/g, '/').replace(/^\.\//, '');
  if (p === 'firestore.rules') return 'firestore.rules';
  if (p === 'firestore.indexes.json') return 'firestore.indexes.json';
  if (p === 'storage.rules') return 'storage.rules';
  if (p === 'firebase.json' || p === '.firebaserc') return 'deploy-config';
  if (RELEASE_PIPELINE_PATHS.has(p)) return 'release-pipeline';
  if (p.startsWith('functions/')) return 'functions';
  if (p.startsWith('functions-analysis/')) return 'functions-analysis';
  if (NOT_DEPLOYED_FILES.has(p)) return 'not-deployed';
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /(^|\/)__tests__\//.test(p)) return 'not-deployed';
  if (/\.md$/i.test(p) && !p.startsWith('content/')) return 'not-deployed';
  if (NOT_DEPLOYED_PREFIXES.some(prefix => p.startsWith(prefix))) return 'not-deployed';
  return 'hosting/app';
}

/** Group a diff listing by surface and derive the flags the plan reasons about. */
export function classifyDiff(files) {
  const bySurface = Object.fromEntries(Object.keys(SURFACES).map(key => [key, []]));
  for (const file of [...new Set(files.map(String).filter(Boolean))].sort()) bySurface[classifyPath(file)].push(file);
  const changed = surface => bySurface[surface].length > 0;
  const rulesChanged = changed('firestore.rules') || changed('storage.rules');
  const indexesChanged = changed('firestore.indexes.json');
  const functionsChanged = changed('functions') || changed('functions-analysis');
  const configChanged = changed('deploy-config');
  const appChanged = changed('hosting/app') || configChanged;
  return {
    bySurface,
    flags: { appChanged, rulesChanged, indexesChanged, functionsChanged, configChanged, pipelineChanged: changed('release-pipeline') },
    // The app may only be rolled back alone when nothing that the app depends on moved with it.
    appOnlyRollbackSafe: !rulesChanged && !indexesChanged && !functionsChanged && !configChanged,
  };
}

const git = (repo, args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

export function resolveCommit(repo, ref) {
  const sha = git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim();
  if (!/^[a-f\d]{40}$/.test(sha)) throw new Error(`${ref} is not a commit in ${repo}`);
  return sha;
}

export function diffFiles(repo, from, to) {
  return git(repo, ['diff', '--name-only', '--no-renames', from, to]).split('\n').map(line => line.trim()).filter(Boolean);
}

export function commitHasPipeline(repo, sha) {
  return PIPELINE_FILES.every(file => {
    try { execFileSync('git', ['cat-file', '-e', `${sha}:${file}`], { cwd: repo, stdio: 'ignore' }); return true; } catch { return false; }
  });
}

/** Pure plan builder; `files` is the from→to diff listing. */
export function buildRollbackPlan({ from, to, files, fromHasPipeline = true, toHasPipeline = true, generatedAt = new Date().toISOString() }) {
  const classified = classifyDiff(files);
  const { flags, appOnlyRollbackSafe } = classified;
  const short = sha => sha.slice(0, 12);

  const rule = flags.rulesChanged
    ? `UNSAFE to roll back the app alone: firestore.rules/storage.rules changed between ${short(from)} and ${short(to)}. The rules that will be live after the release were written for the ${short(to)} app (they deny the legacy plaintext bank-token fields and lock the server-only collections); the ${short(from)} app reads and writes shapes those rules reject, and rolling rules back while the new app stays up leaves plaid_connections, analysis tasks and webhook receipts unprotected. Rules and app move together, in one coordinated deploy, both directions.`
    : `Rules did not change between ${short(from)} and ${short(to)}; the ${short(from)} app is compatible with the rules that stay live.`;

  const sequence = [];
  sequence.push(`0. Decide. Roll back only on a trigger from docs/PRODUCTION_GO_LIVE_RUNBOOK_2026-09-17.md ("Rollback trigger criteria"); a forward fix is preferred whenever the data migration (below) has started.`);
  sequence.push(`1. Freeze writes you cannot undo: pause the Cloud Scheduler job for syncAllUsersTransactions (gcloud scheduler jobs pause firebase-schedule-syncAllUsersTransactions-${REGION} --location ${REGION} --project ${PRODUCTION_PROJECT}) so the old and new sync never interleave during the switch.`);
  sequence.push(`2. Snapshot before touching anything: gcloud firestore export gs://${PRODUCTION_PROJECT}-firestore-backups --database '(default)' --project ${PRODUCTION_PROJECT} (or gcloud scheduler jobs run writeoff-firestore-weekly-export). Record the output folder in the incident note; PITR also lets you read any minute of the last 7 days.`);
  if (fromHasPipeline) {
    sequence.push(`3. Re-review for the rollback commit: a migration review JSON with "commit": "${from}" is mandatory (validateMigrationReview pins the exact commit). Update the GitHub production environment secret PRODUCTION_MIGRATION_REVIEW_JSON with it; PRODUCTION_ENV_FILE stays unless the ${short(from)} preflight requires different variables (check scripts/production-preflight.mjs at ${short(from)}).`);
    sequence.push(`4. Dispatch the same workflow: GitHub → Actions → "Deploy prepared production release" → Run workflow on the branch that carries .github/workflows/deploy.yml, inputs release_commit=${from}, confirmation=deploy:${PRODUCTION_PROJECT}:${from}. The run checks out ${short(from)}, prepares the release (prepare-production-release from that commit) and runs production:deploy, which redeploys hosting, firestore (rules + indexes), storage and BOTH functions codebases together.`);
    sequence.push(`5. Locally that is the same as: node scripts/prepare-production-release.mjs --source <checkout at ${short(from)}> --output <new private dir> --env-file <env> --migration-review <review for ${short(from)}> && cd <output> && npm run production:deploy -- --confirm deploy:${PRODUCTION_PROJECT}:${from} — only from a workflow_dispatch run in CI; the script refuses other GitHub events.`);
  } else {
    sequence.push(`3. ${short(from)} predates the release pipeline (missing one of: ${PIPELINE_FILES.join(', ')}), so the workflow cannot rebuild it. Roll back surface by surface, still together and in this order:`);
    sequence.push(`   a. Rules first only if the rollback app needs them (it does when rules changed): Firebase console → Firestore → Rules → history → restore the pre-release ruleset; same for Storage → Rules. Or from a checkout of ${short(from)}: firebase deploy --only firestore:rules,storage --project ${PRODUCTION_PROJECT} --non-interactive.`);
    sequence.push(`   b. Hosting: Firebase console → Hosting → site ${PRODUCTION_PROJECT} → Release history → Rollback to the previous version. The old version's rewrites still point at the tagged Cloud Run revision of ${SSR_FUNCTION} (tag fh-<version>), so the old server code serves again without a build.`);
    sequence.push(`   c. Functions: redeploy syncAllUsersTransactions from the ${short(from)} checkout (firebase deploy --only functions:default). The analysis functions did not exist before this release; either leave them (they will 404 against the old app and retry for up to 24 h — noisy but harmless) or remove them: gcloud functions delete queueBankTransactionAnalysis --gen2 --region ${REGION} --project ${PRODUCTION_PROJECT} and the same for processBankTransactionAnalysis.`);
    sequence.push(`   d. Indexes: do not delete. The non-interactive deploy never drops indexes, and the ${short(to)} index set is a superset the old queries tolerate.`);
  }
  sequence.push(`${fromHasPipeline ? 6 : 4}. Verify with the same smoke list as a forward release: https://writeoffapp.com/auth/login (200), an authenticated dashboard load, /api/subscriptions/check-access, one Plaid link-token request. Compare the live ruleset (Firebase console → Firestore → Rules, latest release) with \`git show ${short(from)}:firestore.rules\`, and confirm gcloud functions describe <fn> --gen2 --region ${REGION} reports a new revision for each redeployed function.`);
  sequence.push(`${fromHasPipeline ? 7 : 5}. Resume: gcloud scheduler jobs resume firebase-schedule-syncAllUsersTransactions-${REGION} --location ${REGION} --project ${PRODUCTION_PROJECT}; keep the SSR 5xx, p95 and uptime alerts open for 30 minutes.`);

  const irreversible = [
    `Plaid credential migration (lib/plaid/connections.ts migrateLegacyPlaidConnection). On the first authenticated read after the ${short(to)} app is live, each legacy profile's plaintext plaid_token/access_token/plaid_item_id/plaid_transactions_cursor fields are DELETED from user_profiles/{uid} (and accounts/*), re-encrypted with PLAID_TOKEN_ENCRYPTION_KEY into plaid_connections/{itemId} with status relink_required, and plaid_credentials_migrated=true is set. The ${short(from)} app and its scheduler cannot see those tokens again; rolling the code back shows every migrated user as disconnected. Recovery of the pre-migration shape exists only in the pre-deploy artifacts: the managed daily backup / weekly export in gs://${PRODUCTION_PROJECT}-firestore-backups, PITR reads at a timestamp before the release, and the private read-only inventory (npm run production:migration-inventory → mode-0600 JSON + printed digest). Restoring them wholesale also discards every write users made after the release — prefer a forward fix.`,
    `Historical overlap decisions. potentialHistoricalOverlaps in that inventory are labelled human_review_required; the operator's reconciliation (which record is canonical, which confirmations survive) is a human write outside the codebase. Rollback does not undo it. Artifacts: the inventory JSON, its digest, and the separate decision evidence referenced in the release review (historicalOverlapReconciliation.evidence).`,
    `Provider-side state. New Plaid Items created under the reviewed client id (${'6aab263acbddc2000d721272'}) are unusable by the old client; Stripe live customers/subscriptions, Firebase Auth password resets, account-deletion gates (account_deletions) and legacy connections in revocation_required stay as they are.`,
    `Indexes. firestore.indexes.json is additive under --non-interactive; indexes created by the release remain and cost nothing to keep.`,
  ];

  const summary = {
    schemaVersion: 1,
    generatedAt,
    project: PRODUCTION_PROJECT,
    from, to,
    fromHasPipeline, toHasPipeline,
    changedSurfaces: Object.fromEntries(Object.entries(classified.bySurface).filter(([, list]) => list.length).map(([surface, list]) => [surface, list.length])),
    flags,
    appOnlyRollbackSafe,
    rollbackPath: fromHasPipeline ? 'workflow_dispatch release_commit=<from>' : 'console rollback (pre-pipeline baseline)',
  };
  return { ...classified, from, to, fromHasPipeline, toHasPipeline, rule, sequence, irreversible, summary };
}

export function renderPlan(plan) {
  const lines = [];
  lines.push(`# Production rollback plan — ${PRODUCTION_PROJECT}`);
  lines.push(`# live (from): ${plan.from}`);
  lines.push(`# release (to): ${plan.to}`);
  lines.push(`# rollback path: ${plan.summary.rollbackPath}`);
  lines.push('');
  lines.push('## Surfaces changed (git diff --name-only from..to)');
  for (const [surface, files] of Object.entries(plan.bySurface)) {
    if (!files.length) continue;
    lines.push(`- ${surface} (${files.length}) — ${SURFACES[surface]}`);
    for (const file of files.slice(0, 12)) lines.push(`    ${file}`);
    if (files.length > 12) lines.push(`    … ${files.length - 12} more`);
  }
  if (!Object.values(plan.bySurface).some(list => list.length)) lines.push('- (no differences)');
  lines.push('');
  lines.push('## Rules / indexes');
  lines.push(`- firestore.rules or storage.rules changed: ${plan.flags.rulesChanged ? 'YES' : 'no'}`);
  lines.push(`- firestore.indexes.json changed: ${plan.flags.indexesChanged ? 'YES' : 'no'}`);
  lines.push(`- functions changed: ${plan.flags.functionsChanged ? 'YES' : 'no'}; firebase.json/.firebaserc changed: ${plan.flags.configChanged ? 'YES' : 'no'}`);
  lines.push(`- app-only rollback safe: ${plan.appOnlyRollbackSafe ? 'yes' : 'NO'}`);
  lines.push(`- ${plan.rule}`);
  lines.push('');
  lines.push('## Rollback sequence (same coordinated pipeline)');
  lines.push(...plan.sequence);
  lines.push('');
  lines.push('## Cannot be rolled back by redeploying code');
  for (const item of plan.irreversible) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## rollbackCompatibility evidence (paste into the migration review)');
  lines.push(JSON.stringify(plan.summary));
  return lines.join('\n');
}

export function runRollbackPlan({ args = process.argv.slice(2), cwd = process.cwd() } = {}) {
  const values = { '--repo': cwd, '--json': false };
  for (let i = 0; i < args.length; i += 1) {
    const name = args[i];
    if (name === '--json') { values['--json'] = true; continue; }
    if (!['--from', '--to', '--repo'].includes(name) || !args[i + 1]) throw new Error('Use --from <deployed-sha> --to <release-sha> [--repo <path>] [--json]');
    values[name] = args[i + 1]; i += 1;
  }
  if (!values['--from'] || !values['--to']) throw new Error('Use --from <deployed-sha> --to <release-sha> [--repo <path>] [--json]');
  const repo = path.resolve(values['--repo']);
  const from = resolveCommit(repo, values['--from']);
  const to = resolveCommit(repo, values['--to']);
  const plan = buildRollbackPlan({ from, to, files: diffFiles(repo, from, to), fromHasPipeline: commitHasPipeline(repo, from), toHasPipeline: commitHasPipeline(repo, to) });
  return values['--json'] ? JSON.stringify({ ...plan.summary, rule: plan.rule, sequence: plan.sequence, irreversible: plan.irreversible, files: plan.bySurface }, null, 2) : renderPlan(plan);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(runRollbackPlan()); }
  catch (error) { console.error(`FAIL: ${error instanceof Error ? error.message : 'Rollback plan failed'}`); process.exitCode = 1; }
}
