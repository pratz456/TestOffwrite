import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeFirestore, type FakeFirestore } from './fixtures/fake-firestore';
import {
  applyConfirmation, assertPrivateOutputPath, assertReconciliationTarget, overlapDecisionId, parseArguments, parseOverlapDecisionsFile,
  RECONCILIATION_WRITE_LIMIT, runOverlapReconciliation,
} from '../scripts/production-overlap-reconciliation.mjs';
import { PRODUCTION_PROJECT } from '../scripts/production-preflight.mjs';

const uid = 'legacy-user';
const OLD = 'old-account';
const NEW = 'relinked-account';
const recordPath = (account: string, id: string) => `user_profiles/${uid}/accounts/${account}/transactions/${id}`;
const CANONICAL = recordPath(OLD, 'old-coffee');
const CANDIDATE = recordPath(NEW, 'new-coffee');
const now = new Date('2026-09-17T12:00:00.000Z');
const inventoryDigest = 'b'.repeat(64);

function purchase(overrides: Record<string, unknown> = {}) {
  return {
    userId: uid, date: '2026-03-10', amount: 42.5, merchant_name: 'Sensitive Merchant', iso_currency_code: 'USD', pending: false,
    category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', is_deductible: true, review_status: 'confirmed', notes: 'owner note', ...overrides,
  };
}
type Decision = { group?: string; canonical: string; candidate: string; decision: 'duplicate' | 'distinct' | 'defer'; note?: string };
function decisionsFile(decisions: Decision[], overrides: Record<string, unknown> = {}) {
  return { schemaVersion: 1, project: PRODUCTION_PROJECT, inventoryDigest, reviewedBy: 'operator@example.test', reviewedAt: '2026-09-17T11:00:00.000Z', decisions, ...overrides };
}
const duplicate = (overrides: Partial<Decision> = {}): Decision => ({ group: 'abc123', canonical: CANONICAL, candidate: CANDIDATE, decision: 'duplicate', note: 'Same purchase re-imported', ...overrides });

let db: FakeFirestore;
let root: string;
let checkout: string;
let backupDirectory: string;
let evidenceCount = 0;
const evidencePath = () => path.join(root, `evidence-${++evidenceCount}.json`);
const snapshot = () => JSON.stringify([...db.records].sort(([a], [b]) => a.localeCompare(b)));
const run = (options: Partial<Parameters<typeof runOverlapReconciliation>[0]>) =>
  runOverlapReconciliation({ db, project: PRODUCTION_PROJECT, now, cwd: checkout, decisionsFile: decisionsFile([duplicate()]), ...options });
const dryThenApply = async (options: Partial<Parameters<typeof runOverlapReconciliation>[0]> = {}) => {
  const dry = await run(options);
  return run({ ...options, apply: true, confirmation: dry.confirmation, backupDirectory, evidencePath: evidencePath() });
};

beforeEach(() => {
  db = createFakeFirestore();
  db.records.set(`user_profiles/${uid}/accounts/${OLD}`, { name: 'Checking (old Item)' });
  db.records.set(`user_profiles/${uid}/accounts/${NEW}`, { name: 'Checking (relinked)' });
  db.records.set(CANONICAL, purchase({ trans_id: 'old-plaid-id' }));
  // The relinked copy has no owner review yet: no review_status, no notes.
  const unreviewed = purchase({ trans_id: 'new-plaid-id', is_deductible: null });
  delete unreviewed.review_status;
  delete unreviewed.notes;
  db.records.set(CANDIDATE, unreviewed);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'writeoff-overlap-test-'));
  checkout = path.join(root, 'checkout');
  fs.mkdirSync(checkout);
  backupDirectory = path.join(root, 'backups');
  evidenceCount = 0;
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('dry run', () => {
  it('validates the plan, prints counts and the confirmation digest, and writes nothing', async () => {
    const before = snapshot();
    const result = await run({});
    expect(result).toMatchObject({ mode: 'dry_run', writesPerformed: false, project: PRODUCTION_PROJECT, inventoryDigest,
      counts: { decisions: 1, supersede: 1, markReviewed: 0, defer: 0, alreadyApplied: 0, writes: 1, transactions: 1 } });
    expect(result.planDigest).toMatch(/^[a-f\d]{64}$/);
    expect(result.confirmation).toBe(applyConfirmation(PRODUCTION_PROJECT, result.planDigest));
    expect(snapshot()).toBe(before);
    expect(fs.readdirSync(root)).toEqual(['checkout']);
    expect(JSON.stringify(result)).not.toMatch(/Sensitive Merchant|42\.5|owner note/);
  });

  it('refuses a decision whose candidate changed since the inventory without touching any record', async () => {
    db.records.set(CANDIDATE, { ...db.records.get(CANDIDATE), amount: 42.51 });
    const before = snapshot();
    await expect(run({})).rejects.toThrow(/Decision 1 \([a-f\d]{24}\) refused: key_mismatch/);
    await expect(run({})).rejects.not.toThrow(/42\.5|Sensitive/);
    expect(snapshot()).toBe(before);
    expect(fs.readdirSync(root)).toEqual(['checkout']);
  });

  it('refuses when the referenced inventory file does not match the reviewed digest', async () => {
    const inventoryPath = path.join(root, 'inventory.json');
    fs.writeFileSync(inventoryPath, '{"schemaVersion":1}\n');
    await expect(run({ inventoryPath })).rejects.toThrow(/different inventory/);
    const digest = createHash('sha256').update(fs.readFileSync(inventoryPath)).digest('hex');
    await expect(run({ inventoryPath, decisionsFile: decisionsFile([duplicate()], { inventoryDigest: digest }) })).resolves.toMatchObject({ mode: 'dry_run' });
  });
});

describe('apply', () => {
  it('writes the 0600 backup before the first transaction, then marks only the candidate with server-only fields', async () => {
    const canonicalBefore = { ...db.records.get(CANONICAL) };
    const candidateBefore = { ...db.records.get(CANDIDATE) };
    let backupsWhenWriting: string[] = [];
    const original = db.runTransaction;
    db.runTransaction = async work => { backupsWhenWriting = fs.readdirSync(backupDirectory); return original(work); };
    const result = await dryThenApply();

    expect(backupsWhenWriting).toHaveLength(1);
    const backupFile = path.join(backupDirectory, backupsWhenWriting[0]);
    expect(fs.statSync(backupFile).mode & 0o077).toBe(0);
    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    expect(backup).toMatchObject({ kind: 'historical_overlap_backup', project: PRODUCTION_PROJECT, planDigest: result.planDigest, records: [{ path: CANDIDATE, data: candidateBefore }] });

    expect(db.records.get(CANONICAL)).toEqual(canonicalBefore);
    const decisionId = overlapDecisionId({ inventoryDigest }, duplicate());
    expect(db.records.get(CANDIDATE)).toEqual({
      ...candidateBefore, superseded_by: CANONICAL, superseded_at: now.toISOString(), superseded_reason: 'historical_overlap', superseded_decision_id: decisionId,
    });
    expect(result).toMatchObject({ mode: 'apply', writesPerformed: true, counts: { writes: 1, written: 1, transactions: 1, skippedInTransaction: 0 },
      backup: { path: backupFile, records: 1 }, evidence: { path: path.join(root, 'evidence-1.json') } });
    expect(JSON.stringify(result)).not.toMatch(/Sensitive Merchant|42\.5|owner note/);

    const evidenceFile = result.evidence!.path;
    expect(fs.statSync(evidenceFile).mode & 0o077).toBe(0);
    const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
    expect(evidence).toMatchObject({
      kind: 'historical_overlap_reconciliation', outcome: 'applied', project: PRODUCTION_PROJECT, inventoryDigest, planDigest: result.planDigest,
      reviewedBy: 'operator@example.test', appliedAt: now.toISOString(), guarantees: { recordsDeleted: 0, recordsMerged: 0, confirmationsChanged: 0 },
      applied: [{ decisionId, decision: 'duplicate', action: 'supersede', candidate: CANDIDATE, canonical: CANONICAL }], alreadyApplied: [], deferred: [],
    });
    expect(JSON.stringify(evidence)).not.toMatch(/Sensitive Merchant|42\.5|owner note|Same purchase/);
    expect(createHash('sha256').update(fs.readFileSync(evidenceFile)).digest('hex')).toBe(result.evidence!.digest);
  });

  it('is a no-op on rerun: same confirmation accepted, no transaction, no new backup, records unchanged', async () => {
    const first = await dryThenApply();
    const after = snapshot();
    let transactions = 0;
    const original = db.runTransaction;
    db.runTransaction = async work => { transactions += 1; return original(work); };
    const dry = await run({});
    const confirmation = applyConfirmation(PRODUCTION_PROJECT, first.planDigest);
    expect(dry).toMatchObject({ confirmation, planDigest: first.planDigest, counts: { alreadyApplied: 1, writes: 0, transactions: 0 } });
    const rerun = await run({ apply: true, confirmation, backupDirectory, evidencePath: evidencePath() });
    expect(rerun).toMatchObject({ mode: 'apply', writesPerformed: false, backup: null, counts: { written: 0, transactions: 0 } });
    expect(transactions).toBe(0);
    expect(snapshot()).toBe(after);
    expect(fs.readdirSync(backupDirectory)).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(rerun.evidence!.path, 'utf8'))).toMatchObject({ outcome: 'applied', applied: [], alreadyApplied: [{ candidate: CANDIDATE }] });
  });

  it('records distinct decisions on the candidate only and never writes for deferrals', async () => {
    const other = recordPath(NEW, 'new-other');
    db.records.set(other, purchase({ trans_id: 'other-plaid-id', merchant_name: 'Other Shop' }));
    const result = await dryThenApply({ decisionsFile: decisionsFile([duplicate({ decision: 'distinct' }), duplicate({ candidate: other, decision: 'defer' })]) });
    expect(result.counts).toMatchObject({ decisions: 2, markReviewed: 1, defer: 1, written: 1 });
    expect(db.records.get(CANDIDATE)).toMatchObject({ overlap_reviewed: true, overlap_reviewed_at: now.toISOString() });
    expect(db.records.get(CANDIDATE)).not.toHaveProperty('superseded_by');
    expect(db.records.get(other)).not.toHaveProperty('overlap_reviewed');
    expect(db.records.get(CANONICAL)).not.toHaveProperty('overlap_reviewed');
  });

  it('re-validates inside the transaction and aborts with evidence when a candidate changed after the dry run', async () => {
    const dry = await run({});
    const original = db.runTransaction;
    let afterConcurrentChange = '';
    // The bank (or another operator) changes the candidate after the dry run and backup, just before the transaction reads it.
    db.runTransaction = async work => { db.records.set(CANDIDATE, { ...db.records.get(CANDIDATE), amount: 99 }); afterConcurrentChange = snapshot(); return original(work); };
    const evidence = evidencePath();
    await expect(run({ apply: true, confirmation: dry.confirmation, backupDirectory, evidencePath: evidence })).rejects.toThrow(/refused: key_mismatch/);
    expect(snapshot()).toBe(afterConcurrentChange);
    expect(db.records.get(CANDIDATE)).not.toHaveProperty('superseded_by');
    expect(JSON.parse(fs.readFileSync(evidence, 'utf8'))).toMatchObject({ outcome: 'aborted', error: expect.stringContaining('key_mismatch'), applied: [], counts: { transactionsCommitted: 0 } });
  });

  it(`chunks more than ${RECONCILIATION_WRITE_LIMIT} decisions into transactions of at most ${RECONCILIATION_WRITE_LIMIT} writes`, async () => {
    const decisions: Decision[] = [];
    for (let index = 0; index < RECONCILIATION_WRITE_LIMIT + 1; index += 1) {
      const canonical = recordPath(OLD, `old-${index}`);
      const candidate = recordPath(NEW, `new-${index}`);
      db.records.set(canonical, purchase({ trans_id: `old-${index}`, amount: index + 1 }));
      db.records.set(candidate, purchase({ trans_id: `new-${index}`, amount: index + 1, review_status: undefined, is_deductible: null }));
      decisions.push({ canonical, candidate, decision: 'duplicate' });
    }
    const writesPerTransaction: number[] = [];
    const original = db.runTransaction;
    db.runTransaction = async work => original(async tx => {
      let writes = 0;
      const result = await work({ ...tx, update: (target: unknown, data: Record<string, unknown>) => { writes += 1; return tx.update(target, data); } });
      writesPerTransaction.push(writes);
      return result;
    });
    const result = await dryThenApply({ decisionsFile: decisionsFile(decisions) });
    expect(result.counts).toMatchObject({ decisions: RECONCILIATION_WRITE_LIMIT + 1, written: RECONCILIATION_WRITE_LIMIT + 1, transactions: 2 });
    expect(writesPerTransaction).toEqual([RECONCILIATION_WRITE_LIMIT, 1]);
    expect(decisions.every(decision => db.records.get(decision.candidate)?.superseded_by === decision.canonical)).toBe(true);
    expect(JSON.parse(fs.readFileSync(result.backup!.path, 'utf8')).records).toHaveLength(RECONCILIATION_WRITE_LIMIT + 1);
    expect(JSON.parse(fs.readFileSync(result.evidence!.path, 'utf8')).applied).toHaveLength(RECONCILIATION_WRITE_LIMIT + 1);
  });

  it('refuses to apply without the current confirmation, a backup directory and an evidence path, before touching anything', async () => {
    const dry = await run({});
    const before = snapshot();
    await expect(run({ apply: true, confirmation: `apply:${PRODUCTION_PROJECT}:${'0'.repeat(64)}`, backupDirectory, evidencePath: evidencePath() })).rejects.toThrow(/Apply requires --confirm apply:writeoff-23910:[a-f\d]{64}/);
    await expect(run({ apply: true, confirmation: dry.confirmation })).rejects.toThrow(/--backup .* --evidence/);
    await expect(run({ apply: true, confirmation: dry.confirmation, backupDirectory, evidencePath: path.join(checkout, 'evidence.json') })).rejects.toThrow(/outside the repository checkout/);
    await expect(run({ apply: true, confirmation: dry.confirmation, backupDirectory: path.join(checkout, 'backups'), evidencePath: evidencePath() })).rejects.toThrow(/outside the repository checkout/);
    await expect(run({ apply: true, confirmation: dry.confirmation, backupDirectory, evidencePath: 'relative/evidence.json' })).rejects.toThrow(/absolute/);
    expect(snapshot()).toBe(before);
    expect(fs.existsSync(backupDirectory)).toBe(false);
  });
});

describe('inputs and targets', () => {
  it('validates the reviewed decisions file before reading any record', () => {
    const valid = parseOverlapDecisionsFile(JSON.stringify(decisionsFile([duplicate()])));
    expect(valid.decisions).toEqual([duplicate()]);
    expect(() => parseOverlapDecisionsFile(decisionsFile([duplicate()], { schemaVersion: 2 }))).toThrow(/schemaVersion 1/);
    expect(() => parseOverlapDecisionsFile(decisionsFile([duplicate()], { project: 'demo-writeoff' }))).toThrow(/not writeoff-23910/);
    expect(() => parseOverlapDecisionsFile(decisionsFile([duplicate()], { inventoryDigest: 'abc' }))).toThrow(/inventoryDigest/);
    expect(() => parseOverlapDecisionsFile(decisionsFile([duplicate()], { reviewedBy: ' ' }))).toThrow(/reviewedBy/);
    expect(() => parseOverlapDecisionsFile(decisionsFile([duplicate()], { reviewedAt: 'yesterday' }))).toThrow(/reviewedAt/);
    expect(() => parseOverlapDecisionsFile(decisionsFile([]))).toThrow(/at least one decision/);
    expect(() => parseOverlapDecisionsFile(decisionsFile([{ ...duplicate(), decision: 'merge' as never }]))).toThrow(/Decision 1 needs/);
    expect(() => parseOverlapDecisionsFile(decisionsFile([duplicate(), duplicate({ canonical: recordPath(OLD, 'other') })]))).toThrow(/exactly one canonical/);
    expect(() => parseOverlapDecisionsFile(decisionsFile([duplicate(), duplicate({ decision: 'distinct' })]))).toThrow(/cannot also be recorded as distinct/);
    expect(() => parseOverlapDecisionsFile('[]')).toThrow(/JSON object/);
  });

  it('derives the same decision id for the same reviewed decision and different ids otherwise', () => {
    const id = overlapDecisionId({ inventoryDigest }, duplicate());
    expect(id).toMatch(/^[a-f\d]{24}$/);
    expect(overlapDecisionId({ inventoryDigest }, duplicate({ note: 'different note', group: 'other' }))).toBe(id);
    expect(overlapDecisionId({ inventoryDigest }, duplicate({ decision: 'distinct' }))).not.toBe(id);
    expect(overlapDecisionId({ inventoryDigest: 'c'.repeat(64) }, duplicate())).not.toBe(id);
  });

  it('refuses emulators unless explicitly allowed, and never lets --allow-emulator reach a real project', () => {
    expect(() => assertReconciliationTarget({ project: PRODUCTION_PROJECT, inheritedEnv: {} })).not.toThrow();
    expect(() => assertReconciliationTarget({ project: 'demo-writeoff', inheritedEnv: {} })).toThrow(/--project writeoff-23910/);
    expect(() => assertReconciliationTarget({ project: PRODUCTION_PROJECT, inheritedEnv: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' } })).toThrow(/refuses a Firestore emulator/);
    expect(() => assertReconciliationTarget({ project: 'demo-writeoff', allowEmulator: true, inheritedEnv: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' } })).not.toThrow();
    expect(() => assertReconciliationTarget({ project: PRODUCTION_PROJECT, allowEmulator: true, inheritedEnv: {} })).toThrow(/requires FIRESTORE_EMULATOR_HOST/);
  });

  it('keeps private outputs absolute, new and outside the checkout, following symlinked parents', () => {
    expect(assertPrivateOutputPath(path.join(root, 'new.json'), checkout)).toBe(path.join(fs.realpathSync(root), 'new.json'));
    expect(() => assertPrivateOutputPath('relative.json', checkout)).toThrow(/absolute/);
    expect(() => assertPrivateOutputPath(path.join(root, 'missing-dir', 'new.json'), checkout)).toThrow(/Create the output directory/);
    fs.writeFileSync(path.join(root, 'existing.json'), '{}');
    expect(() => assertPrivateOutputPath(path.join(root, 'existing.json'), checkout)).toThrow(/Refusing to overwrite/);
    expect(() => assertPrivateOutputPath(path.join(checkout, 'inside.json'), checkout)).toThrow(/outside the repository checkout/);
    const linked = path.join(root, 'linked-checkout');
    fs.symlinkSync(checkout, linked, 'dir');
    expect(() => assertPrivateOutputPath(path.join(linked, 'inside.json'), checkout)).toThrow(/outside the repository checkout/);
    // Run from a subdirectory of the checkout: the output is outside cwd yet still inside the repository.
    const scripts = path.join(checkout, 'scripts');
    fs.mkdirSync(scripts);
    expect(() => assertPrivateOutputPath(path.join(checkout, 'inside.json'), scripts, checkout)).toThrow(/outside the repository checkout/);
    expect(assertPrivateOutputPath(path.join(root, 'new.json'), scripts, checkout)).toBe(path.join(fs.realpathSync(root), 'new.json'));
  });

  it('refuses a backup or evidence path inside the checkout even when run from a subdirectory of it', async () => {
    const dry = await run({});
    const scripts = path.join(checkout, 'scripts');
    fs.mkdirSync(scripts);
    const before = snapshot();
    const inside = { cwd: scripts, checkoutRoot: checkout, apply: true, confirmation: dry.confirmation };
    await expect(run({ ...inside, backupDirectory, evidencePath: path.join(checkout, 'evidence.json') })).rejects.toThrow(/outside the repository checkout/);
    await expect(run({ ...inside, backupDirectory: path.join(checkout, 'backups'), evidencePath: evidencePath() })).rejects.toThrow(/outside the repository checkout/);
    expect(snapshot()).toBe(before);
    expect(fs.existsSync(path.join(checkout, 'evidence.json'))).toBe(false);
    expect(fs.readdirSync(path.join(checkout, 'backups'))).toEqual([]);
  });

  it('parses the command line and requires the apply trio together', () => {
    expect(parseArguments(['--decisions', '/private/decisions.json'])).toEqual({ project: PRODUCTION_PROJECT, apply: false, allowEmulator: false, decisionsPath: '/private/decisions.json' });
    expect(parseArguments(['--decisions', '/p/d.json', '--inventory', '/p/i.json', '--apply', '--confirm', 'apply:writeoff-23910:abc', '--backup', '/p/backups', '--evidence', '/p/e.json', '--allow-emulator']))
      .toEqual({ project: PRODUCTION_PROJECT, apply: true, allowEmulator: true, decisionsPath: '/p/d.json', inventoryPath: '/p/i.json', confirmation: 'apply:writeoff-23910:abc', backupDirectory: '/p/backups', evidencePath: '/p/e.json' });
    for (const argv of [[], ['--decisions'], ['--decisions', '/p/d.json', '--apply'], ['--decisions', '/p/d.json', '--apply', '--confirm', 'x', '--backup', '/b'], ['--unknown', 'x', '--decisions', '/p/d.json'], ['--decisions', '--apply']]) {
      expect(() => parseArguments(argv)).toThrow(/Use --decisions/);
    }
  });
});
