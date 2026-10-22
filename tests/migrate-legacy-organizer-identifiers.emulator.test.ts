/**
 * Local Firestore emulator run for organizer record maintenance.
 * Requires a demo- project id and FIRESTORE_EMULATOR_HOST. It never selects
 * any other project. Disabled during ordinary tests. Run locally with:
 * WRITEOFF_RULES_EMULATOR_TESTS=1 npx vitest run tests/migrate-legacy-organizer-identifiers.emulator.test.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { decryptSensitive, encryptSensitive } from '../lib/security/utils';
import { ORGANIZER_IDENTIFIER_BACKUP_COLLECTION } from '../lib/tax-organizer/identifiers';
import {
  ORGANIZER_COLLECTION, connectEmulatorMigrationFirestore, formatMigrationReport, runMigration,
  type MigrationDb, type MigrationDocRef, type MigrationReport,
} from '../scripts/migrate-legacy-organizer-identifiers';

const enabled = process.env.WRITEOFF_RULES_EMULATOR_TESTS === '1';
const PROJECT = 'demo-organizer-maintenance';
const HOST = '127.0.0.1';
const PORT = 8877;
const KEY = 'cd'.repeat(32);
const APPLY_AT = new Date('2026-03-01T00:00:00.000Z');
const RERUN_AT = new Date('2026-03-10T00:00:00.000Z');
const PURGE_AT = new Date('2026-03-16T00:00:00.000Z');
const SAVED_VALUE = '900-00-0011';

let emulator: ChildProcess | undefined;
let closeApp: (() => Promise<void>) | undefined;
let raw: Firestore;

function wrapDb(source: Firestore, control: { armed: boolean }): MigrationDb {
  function wrapRef(refPath: string, id: string, ref: { set: MigrationDocRef['set']; get: MigrationDocRef['get']; delete: MigrationDocRef['delete'] }): MigrationDocRef {
    return { id, path: refPath, set: ref.set.bind(ref), get: ref.get.bind(ref), delete: ref.delete.bind(ref) };
  }
  return {
    collection(name: string) {
      const rows = source.collection(name);
      let limitCount = 100;
      let after: unknown;
      const query = {
        orderBy() { return query; },
        limit(count: number) { limitCount = count; return query; },
        startAfter(cursor: unknown) { after = cursor; return query; },
        async get() {
          let built = rows.orderBy(FieldPath.documentId()).limit(limitCount);
          if (after !== undefined && after !== '') built = built.startAfter(after);
          const snap = await built.get();
          const armed = control.armed && name === ORGANIZER_COLLECTION;
          const docs = snap.docs.map(doc => ({
            id: doc.id,
            updateTime: armed && doc.id === 'open' ? undefined : doc.updateTime,
            ref: wrapRef(doc.ref.path, doc.id, doc.ref),
            data: () => doc.data(),
          }));
          if (armed) {
            control.armed = false;
            await rows.doc('legacy').update({ taxpayerSSN: SAVED_VALUE });
          }
          return { empty: docs.length === 0, size: docs.length, docs };
        },
        doc: (id: string) => wrapRef(`${name}/${id}`, id, rows.doc(id)),
      };
      return query;
    },
    async runTransaction(work) {
      return source.runTransaction(async transaction => work({
        async get(ref) {
          const snap = await transaction.get(source.doc(ref.path));
          return { exists: snap.exists, updateTime: snap.updateTime, data: () => snap.data() };
        },
        set(ref, data, options) { transaction.set(source.doc(ref.path), data, options); },
      }));
    },
  };
}

async function waitForEmulator(child: ChildProcess): Promise<void> {
  let logs = '';
  child.stdout?.on('data', chunk => { logs += String(chunk); });
  child.stderr?.on('data', chunk => { logs += String(chunk); });
  const started = Date.now();
  while (!logs.includes('All emulators ready')) {
    if (child.exitCode !== null) throw new Error(`Emulator exited early: ${logs.slice(-2000)}`);
    if (Date.now() - started > 90_000) throw new Error(`Emulator did not start: ${logs.slice(-2000)}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

(enabled ? describe : describe.skip)('organizer maintenance on the local emulator', () => {
  const control = { armed: false };
  const quiet = { rateLimitMs: 0, sleep: async () => undefined, env: process.env };
  let db: MigrationDb;

  const previousHost = process.env.FIRESTORE_EMULATOR_HOST;
  const previousKey = process.env.SSN_ENCRYPTION_KEY;

  beforeAll(async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'organizer-emulator-'));
    const configPath = path.join(directory, 'firebase.json');
    writeFileSync(configPath, JSON.stringify({
      emulators: {
        firestore: { host: HOST, port: PORT },
        ui: { enabled: false },
        hub: { host: HOST, port: 4409 },
        logging: { host: HOST, port: 4509 },
      },
    }));
    emulator = spawn('npx', ['--no-install', 'firebase', 'emulators:start', '--only', 'firestore', '--project', PROJECT, '--config', configPath], {
      cwd: process.cwd(),
      detached: true,
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForEmulator(emulator);
    process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:${PORT}`;
    process.env.SSN_ENCRYPTION_KEY = KEY;
    const opened = await connectEmulatorMigrationFirestore(PROJECT, process.env);
    closeApp = opened.close;
    raw = opened.db as unknown as Firestore;
    const done = encryptSensitive('900-00-0002');
    const rows: Record<string, Record<string, unknown>> = {
      account: { userId: 'owner-account', bankAccount: '000111222333', bankRouting: '110000015', ipPin: '135790' },
      done: { userId: 'owner-done', taxpayerSSN: done, identifiersEncryptedAt: new Date('2026-01-01T00:00:00.000Z') },
      ein: { userId: 'owner-ein', ein: '12-3456789' },
      legacy: { userId: 'owner-legacy', taxpayerSSN: '900-00-0001' },
      notes: { userId: 'owner-notes', filingStatus: 'single', notes: '900-00-0003' },
      open: { userId: 'owner-open', taxpayerSSN: '900-00-0006' },
    };
    for (const [id, data] of Object.entries(rows)) await raw.collection(ORGANIZER_COLLECTION).doc(id).set(data);
    db = wrapDb(raw, control);
  }, 120_000);

  afterAll(async () => {
    await closeApp?.();
    if (emulator?.pid) {
      try { process.kill(-emulator.pid, 'SIGTERM'); } catch { emulator.kill('SIGTERM'); }
    }
    if (previousHost === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = previousHost;
    if (previousKey === undefined) delete process.env.SSN_ENCRYPTION_KEY;
    else process.env.SSN_ENCRYPTION_KEY = previousKey;
  });

  it('reads, updates, verifies, and purges only the local emulator', async () => {
    const printed: string[] = [];
    const keep = (label: string, report: MigrationReport) => {
      const text = formatMigrationReport(report);
      printed.push(`${label}\n${text}`);
      console.log(`EMULATOR_REPORT_BEGIN ${label}\n${text}\nEMULATOR_REPORT_END ${label}`);
      for (const value of ['900-00-0001', '900-00-0002', '900-00-0003', '900-00-0006', SAVED_VALUE, '000111222333', '110000015', '135790', '12-3456789', 'owner-legacy', KEY]) {
        expect(text).not.toContain(value);
      }
      return report;
    };

    const dry = keep('dry-run', await runMigration({ projectId: PROJECT, db, ...quiet, now: () => APPLY_AT }));
    expect(dry).toMatchObject({
      mode: 'dry_run', docsScanned: 6, docsNeedingUpdate: 4, notesFieldsMatched: 1,
      fieldsByType: { bankAccount: 1, bankRouting: 1, ein: 1, ipPin: 1, ssn: 2 },
      docsUpdated: 0, skippedChanged: 0, skippedAlreadyDone: 0, writesPerformed: false,
    });

    control.armed = true;
    const applied = keep('apply', await runMigration({ projectId: PROJECT, apply: true, confirm: PROJECT, db, ...quiet, now: () => APPLY_AT }));
    expect(applied).toMatchObject({ mode: 'apply', docsUpdated: 2, skippedChanged: 2, skippedAlreadyDone: 0, writesPerformed: true });
    expect((await raw.collection(ORGANIZER_COLLECTION).doc('legacy').get()).data()!.taxpayerSSN).toBe(SAVED_VALUE);
    expect((await raw.collection(ORGANIZER_COLLECTION).doc('open').get()).data()!.taxpayerSSN).toBe('900-00-0006');
    expect((await raw.collection(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION).doc('legacy').get()).exists).toBe(false);
    expect((await raw.collection(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION).doc('open').get()).exists).toBe(false);

    const rerun = keep('rerun', await runMigration({ projectId: PROJECT, apply: true, confirm: PROJECT, db, ...quiet, now: () => RERUN_AT }));
    expect(rerun).toMatchObject({ mode: 'apply', docsUpdated: 2, skippedChanged: 0, skippedAlreadyDone: 0, writesPerformed: true });
    expect(decryptSensitive(String((await raw.collection(ORGANIZER_COLLECTION).doc('legacy').get()).data()!.taxpayerSSN))).toBe(SAVED_VALUE);
    expect(decryptSensitive(String((await raw.collection(ORGANIZER_COLLECTION).doc('open').get()).data()!.taxpayerSSN))).toBe('900-00-0006');

    const firstMark = keep('mark-verified-first', await runMigration({
      projectId: PROJECT, markVerified: applied.runId, confirm: PROJECT, db, ...quiet,
    }));
    const secondMark = keep('mark-verified-second', await runMigration({
      projectId: PROJECT, markVerified: rerun.runId, confirm: PROJECT, db, ...quiet,
    }));
    expect(firstMark).toMatchObject({ mode: 'mark_verified', backupsChecked: 2, backupsVerified: 2, backupsFailed: 0, writesPerformed: true });
    expect(secondMark).toMatchObject({ mode: 'mark_verified', backupsChecked: 2, backupsVerified: 2, backupsFailed: 0, writesPerformed: true });

    const purged = keep('purge', await runMigration({
      projectId: PROJECT, purgeBackups: true, confirm: PROJECT, db, ...quiet, now: () => PURGE_AT,
    }));
    expect(purged).toMatchObject({
      mode: 'purge', retentionDays: 14, backupsScanned: 4, backupsEligible: 2, backupsDeleted: 2, writesPerformed: true,
    });
    expect((await raw.collection(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION).doc('account').get()).exists).toBe(false);
    expect((await raw.collection(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION).doc('ein').get()).exists).toBe(false);
    const young = await raw.collection(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION).doc('legacy').get();
    expect(young.exists).toBe(true);
    expect(young.data()!.backedUpAt.toDate().toISOString()).toBe(RERUN_AT.toISOString());
    expect((await raw.collection(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION).doc('open').get()).exists).toBe(true);
    expect(printed).toHaveLength(6);
  }, 60_000);
});
