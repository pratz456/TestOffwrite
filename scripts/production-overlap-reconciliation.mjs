#!/usr/bin/env node
/**
 * Apply reviewed historical-overlap decisions to production transaction records.
 *
 * Input is a decisions file a human produced from the read-only inventory's
 * potentialHistoricalOverlaps groups (scripts/production-migration-inventory.mjs):
 *   { schemaVersion: 1, project: 'writeoff-23910', inventoryDigest, reviewedBy, reviewedAt,
 *     decisions: [{ group, canonical, candidate, decision: 'duplicate' | 'distinct' | 'defer', note }] }
 *
 * Default is a dry run: every decision is validated against the records as
 * they exist now and the plan digest is printed; nothing is written. Applying
 * requires --apply --confirm apply:<project>:<plan digest>, a 0600 JSON backup
 * of every record the run will touch (written first, outside the checkout)
 * and a 0600 evidence file listing the decision ids applied and the record
 * paths they changed. Writes happen in Firestore transactions of at most 400
 * records that re-read and re-validate each pair, so a record that changed
 * since the dry run is refused instead of overwritten. Nothing is deleted or
 * merged, and no record's is_deductible or review_status is ever changed.
 * Output contains counts and digests only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PRODUCTION_PROJECT } from './production-preflight.mjs';
import { writePrivateMigrationInventory as writePrivateJson } from './production-migration-inventory.mjs';
// Node 22.18+ strips the types; the model has no runtime imports of its own.
import {
  assertConsistentHistoricalOverlapDecisions,
  isHistoricalOverlapDecision,
  planHistoricalOverlapDecision,
} from '../lib/transactions/historical-overlap.ts';

export const OVERLAP_DECISIONS_SCHEMA = 1;
export const OVERLAP_EVIDENCE_SCHEMA = 1;
/** Records written per Firestore transaction; each transaction also re-reads both records of every pair. */
export const RECONCILIATION_WRITE_LIMIT = 400;

const USAGE = 'Use --decisions <absolute file> [--project writeoff-23910] [--inventory <absolute file>] '
  + '[--apply --confirm apply:<project>:<plan digest> --backup <absolute dir> --evidence <absolute file>] [--allow-emulator]';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const isoTimestamp = value => typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
const chunked = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const isRefusal = error => error?.name === 'HistoricalOverlapError';

// ── Decisions file ──────────────────────────────────────────────────────────

/** Validate the reviewed decisions file; refuses contradictory decision sets before any record is read. */
export function parseOverlapDecisionsFile(input, { project = PRODUCTION_PROJECT } = {}) {
  const file = typeof input === 'string' ? JSON.parse(input) : input;
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('The decisions file must be a JSON object');
  if (file.schemaVersion !== OVERLAP_DECISIONS_SCHEMA) throw new Error(`The decisions file must declare schemaVersion ${OVERLAP_DECISIONS_SCHEMA}`);
  if (file.project !== project) throw new Error(`The decisions file is for project ${String(file.project)}, not ${project}`);
  if (!/^[a-f\d]{64}$/.test(file.inventoryDigest || '')) throw new Error('The decisions file must carry the SHA-256 inventoryDigest printed by the inventory command');
  if (typeof file.reviewedBy !== 'string' || !file.reviewedBy.trim()) throw new Error('The decisions file must name its reviewer (reviewedBy)');
  if (!isoTimestamp(file.reviewedAt)) throw new Error('The decisions file must record when it was reviewed (reviewedAt, ISO 8601)');
  if (!Array.isArray(file.decisions) || file.decisions.length === 0) throw new Error('The decisions file must list at least one decision');
  file.decisions.forEach((decision, index) => {
    if (!isHistoricalOverlapDecision(decision)) {
      throw new Error(`Decision ${index + 1} needs canonical and candidate record paths and a decision of duplicate, distinct or defer`);
    }
  });
  assertConsistentHistoricalOverlapDecisions(file.decisions);
  return {
    schemaVersion: OVERLAP_DECISIONS_SCHEMA,
    project: file.project,
    inventoryDigest: file.inventoryDigest,
    reviewedBy: file.reviewedBy,
    reviewedAt: file.reviewedAt,
    decisions: file.decisions.map(decision => ({
      ...(decision.group === undefined ? {} : { group: decision.group }),
      canonical: decision.canonical,
      candidate: decision.candidate,
      decision: decision.decision,
      ...(decision.note === undefined ? {} : { note: decision.note }),
    })),
  };
}

/** Stable per-decision id: the same reviewed decision gets the same id on every run, so evidence and record stamps agree. */
export function overlapDecisionId(file, decision) {
  return sha256(JSON.stringify([OVERLAP_DECISIONS_SCHEMA, file.inventoryDigest, decision.canonical, decision.candidate, decision.decision])).slice(0, 24);
}

export function referencedRecordPaths(decisions) {
  const paths = new Set();
  for (const decision of decisions) {
    if (decision.decision === 'defer') continue;
    paths.add(decision.canonical);
    paths.add(decision.candidate);
  }
  return [...paths];
}

// ── Records and plan ────────────────────────────────────────────────────────

/** Read every referenced record through `read(path)`; missing documents map to null so the planner can refuse them. */
export async function readOverlapRecords(read, paths, concurrency = 50) {
  const records = new Map();
  for (const chunk of chunked(paths, concurrency)) {
    const snapshots = await Promise.all(chunk.map(recordPath => read(recordPath)));
    chunk.forEach((recordPath, index) => {
      const snapshot = snapshots[index];
      records.set(recordPath, snapshot && snapshot.exists ? { path: recordPath, data: snapshot.data() || {} } : null);
    });
  }
  return records;
}

function planDecision(decision, records, { position, decisionId, now }) {
  try {
    const plan = planHistoricalOverlapDecision(decision, {
      canonical: records.get(decision.canonical) ?? null,
      candidate: records.get(decision.candidate) ?? null,
    }, { decisionId, now });
    return { ...plan, position };
  } catch (error) {
    // Refusals name the decision and the reason only; record contents never reach the console or logs.
    if (isRefusal(error)) throw new Error(`Decision ${position} (${decisionId}) refused: ${error.code}. ${error.message}`);
    throw error;
  }
}

export function summarizeOverlapPlans(plans) {
  return {
    decisions: plans.length,
    supersede: plans.filter(plan => plan.action === 'supersede').length,
    markReviewed: plans.filter(plan => plan.action === 'mark_reviewed').length,
    defer: plans.filter(plan => plan.action === 'none').length,
    alreadyApplied: plans.filter(plan => plan.alreadyApplied).length,
    writes: plans.filter(plan => plan.update !== null).length,
  };
}

/**
 * Validate every decision against the records read now. The digest covers the
 * reviewed decisions and the write each one produces, not timestamps or which
 * ones already carry their decision, so the confirmation printed by a dry run
 * stays valid for a rerun that completes an interrupted apply.
 */
export function planOverlapReconciliation(file, records, { now = new Date() } = {}) {
  const plans = file.decisions.map((decision, index) => planDecision(decision, records, { position: index + 1, decisionId: overlapDecisionId(file, decision), now }));
  const digest = sha256(JSON.stringify({
    schemaVersion: OVERLAP_DECISIONS_SCHEMA,
    project: file.project,
    inventoryDigest: file.inventoryDigest,
    plans: plans.map(plan => [plan.decisionId, plan.decision, plan.action, plan.canonical, plan.candidate]),
  }));
  return { plans, digest, counts: summarizeOverlapPlans(plans) };
}

export const applyConfirmation = (project, digest) => `apply:${project}:${digest}`;

// ── Apply ───────────────────────────────────────────────────────────────────

/**
 * Write the planned server-only fields in transactions of at most
 * RECONCILIATION_WRITE_LIMIT records. Each transaction re-reads both records
 * of every pair and re-plans the decision, so a pair that changed since the
 * dry run aborts its transaction and a decision applied meanwhile is skipped.
 */
export async function applyOverlapReconciliation(db, plans, { now = new Date(), onTransaction } = {}) {
  const pending = plans.filter(plan => plan.update !== null);
  const applied = [];
  const skipped = [];
  let transactions = 0;
  for (const chunk of chunked(pending, RECONCILIATION_WRITE_LIMIT)) {
    const outcome = await db.runTransaction(async tx => {
      const paths = referencedRecordPaths(chunk);
      const fresh = await readOverlapRecords(recordPath => tx.get(db.doc(recordPath)), paths, paths.length || 1);
      const written = [];
      const unchanged = [];
      for (const plan of chunk) {
        const decision = { canonical: plan.canonical, candidate: plan.candidate, decision: plan.decision };
        const current = planDecision(decision, fresh, { position: plan.position, decisionId: plan.decisionId, now });
        if (current.update === null) { unchanged.push(plan); continue; }
        tx.update(db.doc(plan.candidate), current.update);
        written.push(plan);
      }
      return { written, unchanged };
    });
    transactions += 1;
    applied.push(...outcome.written);
    skipped.push(...outcome.unchanged);
    onTransaction?.({ transaction: transactions, written: outcome.written, unchanged: outcome.unchanged });
  }
  return { applied, skipped, transactions };
}

// ── Private outputs ─────────────────────────────────────────────────────────

const stamp = now => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/** The same checks writePrivateJson applies, run before any record is written so a bad path cannot strand an apply. */
export function assertPrivateOutputPath(output, cwd = process.cwd()) {
  if (typeof output !== 'string' || !path.isAbsolute(output)) throw new Error('Private output paths must be absolute');
  if (!fs.existsSync(path.dirname(output))) throw new Error(`Create the output directory first: ${path.dirname(output)}`);
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite ${output}`);
  const resolved = path.join(fs.realpathSync(path.dirname(output)), path.basename(output));
  const relative = path.relative(fs.realpathSync(cwd), resolved);
  if (!relative.startsWith(`..${path.sep}`) && relative !== '..') throw new Error('Write private outputs outside the repository checkout');
  return resolved;
}

export function writeOverlapBackup(directory, records, { project, planDigest, now, cwd = process.cwd() }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('--backup must be an absolute directory outside the repository checkout');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const output = path.join(directory, `overlap-reconciliation-backup-${stamp(now)}-${planDigest.slice(0, 12)}.json`);
  assertPrivateOutputPath(output, cwd);
  const digest = writePrivateJson(output, {
    schemaVersion: OVERLAP_EVIDENCE_SCHEMA,
    kind: 'historical_overlap_backup',
    project,
    planDigest,
    createdAt: now.toISOString(),
    records: records.map(record => ({ path: record.path, data: record.data })),
  }, cwd);
  return { path: output, digest, records: records.length };
}

const evidenceEntry = plan => ({ decisionId: plan.decisionId, decision: plan.decision, action: plan.action, candidate: plan.candidate, canonical: plan.canonical });

// ── Command ─────────────────────────────────────────────────────────────────

export function assertReconciliationTarget({ project, allowEmulator = false, inheritedEnv = process.env }) {
  const emulator = inheritedEnv.FIRESTORE_EMULATOR_HOST;
  if (allowEmulator) {
    if (!emulator) throw new Error('--allow-emulator requires FIRESTORE_EMULATOR_HOST so the rehearsal cannot reach production');
    return;
  }
  if (emulator) throw new Error('Production overlap reconciliation refuses a Firestore emulator; pass --allow-emulator for a local rehearsal');
  if (project !== PRODUCTION_PROJECT) throw new Error(`Use --project ${PRODUCTION_PROJECT}`);
}

function readDecisionsFile(decisionsPath) {
  if (typeof decisionsPath !== 'string' || !path.isAbsolute(decisionsPath)) throw new Error('--decisions must be an absolute path to the reviewed decisions file');
  return fs.readFileSync(decisionsPath, 'utf8');
}

function verifyInventoryDigest(inventoryPath, expected) {
  if (!path.isAbsolute(inventoryPath)) throw new Error('--inventory must be an absolute path');
  if (sha256(fs.readFileSync(inventoryPath)) !== expected) throw new Error('The decisions file was reviewed against a different inventory than --inventory');
}

/**
 * Dry run by default. With apply, the backup is written before the first
 * transaction and the evidence file after the last (or after a failure, marked
 * aborted). The returned summary carries counts and digests only.
 */
export async function runOverlapReconciliation({
  db,
  decisionsPath,
  decisionsFile,
  inventoryPath,
  backupDirectory,
  evidencePath,
  apply = false,
  confirmation,
  project = PRODUCTION_PROJECT,
  now = new Date(),
  cwd = process.cwd(),
  onTransaction,
}) {
  const file = parseOverlapDecisionsFile(decisionsFile ?? readDecisionsFile(decisionsPath), { project });
  if (inventoryPath) verifyInventoryDigest(inventoryPath, file.inventoryDigest);
  const records = await readOverlapRecords(recordPath => db.doc(recordPath).get(), referencedRecordPaths(file.decisions));
  const { plans, digest, counts } = planOverlapReconciliation(file, records, { now });
  const expected = applyConfirmation(project, digest);
  const summary = { project, inventoryDigest: file.inventoryDigest, planDigest: digest, counts: { ...counts, transactions: Math.ceil(counts.writes / RECONCILIATION_WRITE_LIMIT) } };
  if (!apply) return { mode: 'dry_run', writesPerformed: false, confirmation: expected, ...summary };

  if (confirmation !== expected) throw new Error(`Apply requires --confirm ${expected}; rerun without --apply to review the current plan`);
  if (!backupDirectory || !evidencePath) throw new Error('Apply requires --backup <absolute dir> and --evidence <absolute file>, both outside the repository checkout');
  assertPrivateOutputPath(evidencePath, cwd);
  const touched = plans.filter(plan => plan.update !== null).map(plan => records.get(plan.candidate));
  const backup = touched.length ? writeOverlapBackup(backupDirectory, touched, { project, planDigest: digest, now, cwd }) : null;

  const evidence = {
    schemaVersion: OVERLAP_EVIDENCE_SCHEMA,
    kind: 'historical_overlap_reconciliation',
    project,
    mode: 'apply',
    inventoryDigest: file.inventoryDigest,
    planDigest: digest,
    reviewedBy: file.reviewedBy,
    reviewedAt: file.reviewedAt,
    appliedAt: now.toISOString(),
    backup: backup && { path: backup.path, digest: backup.digest, records: backup.records },
    guarantees: { recordsDeleted: 0, recordsMerged: 0, confirmationsChanged: 0 },
    outcome: 'aborted',
    counts: { ...summary.counts, transactionsCommitted: 0 },
    applied: [],
    alreadyApplied: plans.filter(plan => plan.alreadyApplied).map(evidenceEntry),
    deferred: plans.filter(plan => plan.action === 'none').map(plan => plan.decisionId),
  };
  // Evidence accumulates per committed transaction, so an aborted run still lists what was written before it stopped.
  const committed = report => {
    evidence.counts.transactionsCommitted = report.transaction;
    evidence.applied.push(...report.written.map(evidenceEntry));
    evidence.alreadyApplied.push(...report.unchanged.map(evidenceEntry));
    onTransaction?.(report);
  };
  let result;
  try {
    result = await applyOverlapReconciliation(db, plans, { now, onTransaction: committed });
    evidence.outcome = 'applied';
    evidence.counts = { ...summary.counts, transactions: result.transactions, written: result.applied.length, skippedInTransaction: result.skipped.length };
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : 'Apply failed';
    writePrivateJson(evidencePath, evidence, cwd);
    throw error;
  }
  const evidenceDigest = writePrivateJson(evidencePath, evidence, cwd);
  return {
    mode: 'apply',
    writesPerformed: result.applied.length > 0,
    ...summary,
    counts: evidence.counts,
    backup: evidence.backup,
    evidence: { path: evidencePath, digest: evidenceDigest },
  };
}

export async function reconcileProductionOverlaps({ project = PRODUCTION_PROJECT, allowEmulator = false, inheritedEnv = process.env, ...options }) {
  assertReconciliationTarget({ project, allowEmulator, inheritedEnv });
  const [{ initializeApp, applicationDefault }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
  ]);
  const app = initializeApp({ credential: applicationDefault(), projectId: project }, `production-overlap-reconciliation-${Date.now()}`);
  return runOverlapReconciliation({ db: getFirestore(app), project, ...options });
}

const VALUE_FLAGS = {
  '--project': 'project', '--decisions': 'decisionsPath', '--inventory': 'inventoryPath',
  '--backup': 'backupDirectory', '--evidence': 'evidencePath', '--confirm': 'confirmation',
};
const BOOLEAN_FLAGS = { '--apply': 'apply', '--allow-emulator': 'allowEmulator' };

export function parseArguments(argv) {
  const options = { project: PRODUCTION_PROJECT, apply: false, allowEmulator: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag in BOOLEAN_FLAGS) { options[BOOLEAN_FLAGS[flag]] = true; continue; }
    if (!(flag in VALUE_FLAGS) || argv[index + 1] === undefined || argv[index + 1].startsWith('--')) throw new Error(USAGE);
    options[VALUE_FLAGS[flag]] = argv[index + 1];
    index += 1;
  }
  if (!options.decisionsPath) throw new Error(USAGE);
  if (options.apply && (!options.confirmation || !options.backupDirectory || !options.evidencePath)) throw new Error(USAGE);
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await reconcileProductionOverlaps(parseArguments(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
    console.log(result.mode === 'dry_run'
      ? `Dry run: no records were changed. To apply this exact plan: --apply --confirm ${result.confirmation} --backup <absolute dir> --evidence <absolute file>`
      : 'Applied. No records were deleted or merged and no confirmation changed; keep the backup and evidence files with the release review.');
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : 'Production overlap reconciliation failed'}`);
    process.exitCode = 1;
  }
}
