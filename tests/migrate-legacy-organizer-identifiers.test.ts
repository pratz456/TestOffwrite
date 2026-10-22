import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORGANIZER_IDENTIFIER_BACKUP_COLLECTION } from '../lib/tax-organizer/identifiers';
import { REDACTED_ID } from '../lib/security/identifier-redaction';
import { decryptSensitive, encryptSensitive, isEncrypted } from '../lib/security/utils';
import { assertVendoredLiveReader, decryptSensitive as liveDecrypt, maskOrganizerIdentifier as liveMask, type OrganizerIdentifierKind } from './fixtures/live-organizer-reader';
import {
  DEFAULT_RETENTION_DAYS, ORGANIZER_COLLECTION, connectMigrationFirestore, formatMigrationReport, hashDocRef, parseMigrationArgs, runMigration, runMigrationCli,
  type MigrationDb, type MigrationDocRef,
} from '../scripts/migrate-legacy-organizer-identifiers';

const FIXTURE_ID = '123-45-6789';
const PROJECT = 'demo-organizer';
const KEY = 'ab'.repeat(32);
const keyFingerprint = (key: string) => createHash('sha256').update(`organizer-identifier-key:${key.toLowerCase()}`).digest('hex').slice(0, 16);
const at = () => new Date('2026-03-01T00:00:00.000Z');

interface Write { collection: string; id: string; data: Record<string, unknown>; merge: boolean }

function fakeDb(
  organizers: Record<string, Record<string, unknown>>,
  failOrganizerIds = new Set<string>(),
  backups: Record<string, Record<string, unknown>> = {},
  hooks: { afterOrganizerPage?: () => void } = {},
) {
  const collections = new Map<string, Map<string, Record<string, unknown>>>([
    [ORGANIZER_COLLECTION, new Map(Object.entries(organizers).map(([id, data]) => [id, { ...data }]))],
    [ORGANIZER_IDENTIFIER_BACKUP_COLLECTION, new Map(Object.entries(backups).map(([id, data]) => [id, { ...data }]))],
  ]);
  const updateTimes = new Map<string, Map<string, Date>>([
    [ORGANIZER_COLLECTION, new Map()],
    [ORGANIZER_IDENTIFIER_BACKUP_COLLECTION, new Map()],
  ]);
  let tick = Date.parse('2024-01-01T00:00:00.000Z');
  function bump(name: string, id: string): Date {
    tick += 1;
    const next = new Date(tick);
    updateTimes.get(name)!.set(id, next);
    return next;
  }
  for (const [name, rows] of collections) for (const id of rows.keys()) bump(name, id);
  const writes: Write[] = [];
  const reads: string[] = [];
  let sawOrganizerPage = false;
  function snapshotCollections() {
    return new Map([...collections].map(([name, rows]) => [name, new Map([...rows].map(([id, data]) => [id, { ...data }]))]));
  }
  function snapshotTimes() {
    return new Map([...updateTimes].map(([name, rows]) => [name, new Map(rows)]));
  }
  function docRef(name: string, id: string): MigrationDocRef {
    return {
      id,
      path: `${name}/${id}`,
      async set(data, setOptions) {
        if (!setOptions?.merge) throw new Error('merge required');
        if (name === ORGANIZER_COLLECTION && failOrganizerIds.has(id)) throw new Error(`${FIXTURE_ID} should stay out of a write error`);
        writes.push({ collection: name, id, data, merge: setOptions.merge });
        const store = collections.get(name)!;
        store.set(id, { ...(store.get(id) ?? {}), ...data });
        bump(name, id);
      },
      async get() {
        const stored = collections.get(name)!.get(id);
        return {
          exists: stored !== undefined,
          updateTime: updateTimes.get(name)?.get(id),
          data: () => (stored === undefined ? undefined : { ...stored }),
        };
      },
      async delete() {
        writes.push({ collection: name, id, data: {}, merge: false });
        collections.get(name)!.delete(id);
        updateTimes.get(name)!.delete(id);
      },
    };
  }
  const db: MigrationDb = {
    collection(name: string) {
      reads.push(name);
      if (!collections.has(name)) throw new Error(`unexpected collection ${name}`);
      let limitCount = Number.POSITIVE_INFINITY;
      let afterId: string | undefined;
      const query = {
        orderBy() { return query; },
        limit(count: number) { limitCount = count; return query; },
        startAfter(cursor: unknown) {
          afterId = typeof cursor === 'string' ? cursor : String((cursor as { id?: string }).id ?? '');
          return query;
        },
        async get() {
          const ids = [...collections.get(name)!.keys()].filter(id => afterId === undefined || id > afterId).sort();
          const page = ids.slice(0, limitCount);
          const docs = page.map(id => {
            const frozen = { ...collections.get(name)!.get(id)! };
            const updateTime = updateTimes.get(name)!.get(id);
            return { id, updateTime, ref: docRef(name, id), data: () => ({ ...frozen }) };
          });
          if (name === ORGANIZER_COLLECTION && !sawOrganizerPage && docs.length > 0) {
            sawOrganizerPage = true;
            hooks.afterOrganizerPage?.();
          }
          return { empty: docs.length === 0, size: docs.length, docs };
        },
        doc: (id: string) => docRef(name, id),
      };
      return query;
    },
    async runTransaction(work) {
      const ops: { ref: MigrationDocRef; data: Record<string, unknown>; merge: boolean }[] = [];
      const result = await work({
        get: ref => ref.get(),
        set(ref, data, setOptions) { ops.push({ ref, data, merge: setOptions.merge }); },
      });
      const savedWrites = writes.length;
      const savedRows = snapshotCollections();
      const savedTimes = snapshotTimes();
      try {
        for (const op of ops) await op.ref.set(op.data, { merge: op.merge });
      } catch (error) {
        writes.splice(savedWrites);
        collections.clear();
        for (const [name, rows] of savedRows) collections.set(name, rows);
        updateTimes.clear();
        for (const [name, rows] of savedTimes) updateTimes.set(name, rows);
        throw error;
      }
      return result;
    },
  };
  function revise(name: string, id: string, fields: Record<string, unknown>) {
    const store = collections.get(name)!;
    store.set(id, { ...(store.get(id) ?? {}), ...fields });
    bump(name, id);
  }
  return { db, writes, collections, reads, revise };
}

function legacyOrganizer() {
  const spouseSSN = encryptSensitive('900000002');
  const bankRouting = encryptSensitive('071000013');
  return {
    spouseSSN, bankRouting,
    data: {
      userId: 'owner-a', user_id: 'owner-a', taxYear: 2026, filingStatus: 'single', taxpayerSeniorSSN: 'yes', notes: FIXTURE_ID,
      taxpayerSSN: FIXTURE_ID, spouseSSN, dependent2SSN: '900000003', ein: '12-3456789', bankAccount: '', bankRouting,
      dependentDetails: `Emma Shah, ${FIXTURE_ID}, Daughter`,
    },
  };
}

function cleanOrganizer() {
  const taxpayerSSN = encryptSensitive('900000001');
  const data = {
    userId: 'owner-b', filingStatus: 'married', taxpayerSSN, dependentDetails: 'Emma Shah, Daughter',
    identifiersEncryptedAt: new Date('2020-01-01T00:00:00.000Z'),
  };
  return { taxpayerSSN, data: { ...data } };
}

const quiet = { rateLimitMs: 0, sleep: async () => undefined, now: at, env: process.env };

beforeEach(() => { vi.stubEnv('SSN_ENCRYPTION_KEY', KEY); vi.stubEnv('NODE_ENV', 'test'); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('organizer record maintenance', () => {
  it('requires a project id and does not default to the environment', () => {
    vi.stubEnv('GCLOUD_PROJECT', 'writeoff-23910');
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'writeoff-23910');
    vi.stubEnv('FIREBASE_ADMIN_PROJECT_ID', 'writeoff-23910');
    expect(() => parseMigrationArgs([])).toThrow(/project id/);
    expect(parseMigrationArgs(['--project', PROJECT])).toMatchObject({ projectId: PROJECT, apply: false });
    expect(parseMigrationArgs([PROJECT, '--apply', '--confirm', PROJECT])).toMatchObject({ projectId: PROJECT, apply: true, confirm: PROJECT });
    expect(() => parseMigrationArgs(['--project', PROJECT, 'extra'])).toThrow(/project id/);
  });

  it('dry run makes zero writes and prints counts only', async () => {
    const legacy = legacyOrganizer();
    const clean = cleanOrganizer();
    const { db, writes, collections } = fakeDb({ legacy: legacy.data, clean: clean.data });
    const before = structuredClone(collections.get(ORGANIZER_COLLECTION)!.get('legacy'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const report = await runMigration({ projectId: PROJECT, db, ...quiet });
    expect(report).toEqual({
      mode: 'dry_run', projectId: PROJECT, docsScanned: 2, docsNeedingUpdate: 1,
      fieldsByType: { ssn: 2, ein: 1, redactedText: 1 }, notesFieldsMatched: 1,
      docsUpdated: 0, skippedChanged: 0, docsUnreadable: 0, writesPerformed: false, encryptionKeyFingerprint: keyFingerprint(KEY),
    });
    expect(writes).toEqual([]);
    expect(collections.get(ORGANIZER_COLLECTION)!.get('legacy')).toEqual(before);
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    const lines: string[] = [];
    expect(await runMigrationCli(['--project', PROJECT], { db, ...quiet, stdout: line => lines.push(line), stderr: line => lines.push(line) })).toBe(0);
    expect(lines.join('\n')).toBe(`${formatMigrationReport(report)}\nDry run only. No documents were written. Running this script needs the owner's explicit approval.`);
    expect(lines.join('\n')).not.toContain(FIXTURE_ID);
    expect(lines.join('\n')).not.toContain('owner-a');
  });

  it('apply without a matching confirm refuses before any read or write', async () => {
    const legacy = legacyOrganizer();
    const { db, writes, reads } = fakeDb({ legacy: legacy.data });
    const touch = new Proxy(db, { get() { throw new Error('db touched'); } });
    await expect(runMigration({ projectId: PROJECT, apply: true, db: touch, ...quiet })).rejects.toThrow(/--confirm/);
    await expect(runMigration({ projectId: PROJECT, apply: true, confirm: 'other-project', db: touch, ...quiet })).rejects.toThrow(/--confirm/);
    await expect(runMigration({ projectId: PROJECT, apply: true, confirm: `${PROJECT} `, db: touch, ...quiet })).rejects.toThrow(/--confirm/);
    expect(writes).toEqual([]);
    expect(reads).toEqual([]);
    const lines: string[] = [];
    expect(await runMigrationCli(['--project', PROJECT, '--apply', '--confirm', 'other-project'], {
      db, ...quiet, stdout: line => lines.push(line), stderr: line => lines.push(line),
    })).toBe(1);
    expect(lines.join('\n')).toMatch(/FAIL: --apply requires --confirm/);
    expect(lines.join('\n')).not.toContain(FIXTURE_ID);
    expect(writes).toEqual([]);
  });

  it('apply encrypts only legacy fields, then a second run makes zero writes', async () => {
    const legacy = legacyOrganizer();
    const clean = cleanOrganizer();
    const cleanBefore = { ...clean.data, identifiersEncryptedAt: new Date('2020-01-01T00:00:00.000Z') };
    const { db, writes, collections } = fakeDb({ legacy: legacy.data, clean: cleanBefore });
    const report = await runMigration({ projectId: PROJECT, apply: true, confirm: PROJECT, db, ...quiet });
    expect(report).toMatchObject({ mode: 'apply', docsScanned: 2, docsNeedingUpdate: 1, docsUpdated: 1, writesPerformed: true, fieldsByType: { ssn: 2, ein: 1, redactedText: 1 } });
    const organizerWrites = writes.filter(write => write.collection === ORGANIZER_COLLECTION);
    const backupWrites = writes.filter(write => write.collection === ORGANIZER_IDENTIFIER_BACKUP_COLLECTION);
    expect(organizerWrites.map(write => write.id)).toEqual(['legacy']);
    expect(backupWrites.map(write => write.id)).toEqual(['legacy']);
    expect(writes.findIndex(write => write.collection === ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)).toBeLessThan(writes.findIndex(write => write.collection === ORGANIZER_COLLECTION));
    expect(organizerWrites[0].merge).toBe(true);
    expect(Object.keys(organizerWrites[0].data).sort()).toEqual(['dependent2SSN', 'dependentDetails', 'ein', 'identifiersEncryptedAt', 'taxpayerSSN']);
    const saved = collections.get(ORGANIZER_COLLECTION)!.get('legacy')!;
    expect(isEncrypted(String(saved.taxpayerSSN))).toBe(true);
    expect(decryptSensitive(String(saved.taxpayerSSN))).toBe(FIXTURE_ID);
    expect(decryptSensitive(String(saved.dependent2SSN))).toBe('900000003');
    expect(decryptSensitive(String(saved.ein))).toBe('12-3456789');
    expect(saved.spouseSSN).toBe(legacy.spouseSSN);
    expect(saved.bankRouting).toBe(legacy.bankRouting);
    expect(saved.dependentDetails).toBe(`Emma Shah, ${REDACTED_ID}, Daughter`);
    expect(saved.notes).toBe(FIXTURE_ID);
    expect(saved.filingStatus).toBe('single');
    expect(saved.taxpayerSeniorSSN).toBe('yes');
    expect(saved.bankAccount).toBe('');
    expect(saved.userId).toBe('owner-a');
    expect(saved.identifiersEncryptedAt).toEqual(at());
    const backup = collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.get('legacy')!;
    expect(decryptSensitive(String((backup.encryptedFields as Record<string, string>).taxpayerSSN))).toBe(FIXTURE_ID);
    expect(decryptSensitive(String((backup.encryptedFields as Record<string, string>).dependentDetails))).toBe(`Emma Shah, ${FIXTURE_ID}, Daughter`);
    expect(backup.userId).toBe('owner-a');
    expect(JSON.stringify(backup)).not.toContain(FIXTURE_ID);
    expect(JSON.stringify(organizerWrites[0].data)).not.toContain(FIXTURE_ID);
    expect(collections.get(ORGANIZER_COLLECTION)!.get('clean')).toEqual(cleanBefore);

    const writesAfterFirst = writes.length;
    const second = await runMigration({ projectId: PROJECT, apply: true, confirm: PROJECT, db, ...quiet });
    expect(second).toMatchObject({ docsScanned: 2, docsNeedingUpdate: 0, docsUpdated: 0, writesPerformed: false, fieldsByType: {} });
    expect(writes).toHaveLength(writesAfterFirst);
    expect(formatMigrationReport(second)).not.toContain(FIXTURE_ID);
    expect(formatMigrationReport(second)).not.toContain('owner-a');
  });

  it('leaves an already-encrypted document untouched', async () => {
    const clean = cleanOrganizer();
    const { db, writes, collections } = fakeDb({ clean: clean.data });
    const before = { ...collections.get(ORGANIZER_COLLECTION)!.get('clean') };
    const report = await runMigration({ projectId: PROJECT, apply: true, confirm: PROJECT, db, ...quiet });
    expect(report).toMatchObject({ docsScanned: 1, docsNeedingUpdate: 0, docsUpdated: 0, writesPerformed: false });
    expect(writes).toEqual([]);
    expect(collections.get(ORGANIZER_COLLECTION)!.get('clean')).toEqual(before);
  });

  it('does not include fixture values in output when a write fails, and a rerun finishes the document', async () => {
    const legacy = legacyOrganizer();
    const failing = new Set(['legacy']);
    const { db, writes, collections } = fakeDb({ legacy: legacy.data }, failing);
    const lines: string[] = [];
    expect(await runMigrationCli(['--project', PROJECT, '--apply', '--confirm', PROJECT], {
      db, ...quiet, stdout: line => lines.push(line), stderr: line => lines.push(line),
    })).toBe(1);
    expect(lines.join('\n')).toMatch(/write failed/);
    expect(lines.join('\n')).not.toContain(FIXTURE_ID);
    expect(lines.join('\n')).not.toContain('owner-a');
    expect(lines.join('\n')).toContain(hashDocRef(`${ORGANIZER_COLLECTION}/legacy`));
    expect(collections.get(ORGANIZER_COLLECTION)!.get('legacy')!.taxpayerSSN).toBe(FIXTURE_ID);
    expect(collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.has('legacy')).toBe(false);
    failing.clear();
    const report = await runMigration({ projectId: PROJECT, apply: true, confirm: PROJECT, db, ...quiet });
    expect(report.docsUpdated).toBe(1);
    expect(writes).toHaveLength(2);
    expect(decryptSensitive(String(collections.get(ORGANIZER_COLLECTION)!.get('legacy')!.taxpayerSSN))).toBe(FIXTURE_ID);
    expect(formatMigrationReport(report)).not.toContain(FIXTURE_ID);
  });

  it('pages by document id, resumes after a document id, and rate limits apply writes', async () => {
    const rows = { a: { ipPin: '123456' }, b: { ein: '123456789' }, c: { filingStatus: 'single', taxpayerSSN: encryptSensitive('900000001') } };
    const paged = fakeDb(rows);
    const scanned = await runMigration({ projectId: PROJECT, db: paged.db, ...quiet, pageSize: 1 });
    expect(scanned).toMatchObject({ docsScanned: 3, docsNeedingUpdate: 2, fieldsByType: { ipPin: 1, ein: 1 }, writesPerformed: false });
    expect(paged.writes).toEqual([]);

    const resumed = fakeDb(rows);
    const partial = await runMigration({ projectId: PROJECT, apply: true, confirm: PROJECT, db: resumed.db, ...quiet, resumeAfter: 'a' });
    expect(partial.docsScanned).toBe(2);
    expect(resumed.collections.get(ORGANIZER_COLLECTION)!.get('a')!.ipPin).toBe('123456');
    expect(isEncrypted(String(resumed.collections.get(ORGANIZER_COLLECTION)!.get('b')!.ein))).toBe(true);
    expect(resumed.writes.filter(write => write.collection === ORGANIZER_COLLECTION).map(write => write.id)).toEqual(['b']);

    const sleeps: number[] = [];
    const paced = fakeDb({ a: { ipPin: '123456' }, b: { ein: '123456789' } });
    await runMigration({
      projectId: PROJECT, apply: true, confirm: PROJECT, db: paced.db, now: at, env: process.env, pageSize: 10, rateLimitMs: 15,
      sleep: async ms => { sleeps.push(ms); },
    });
    expect(sleeps).toEqual([15, 15]);
    expect(paced.writes.filter(write => write.collection === ORGANIZER_COLLECTION)).toHaveLength(2);
  });

  it('counts a document it cannot decrypt and does not write it', async () => {
    const { db, writes } = fakeDb({ broken: { taxpayerSSN: 'aaaa:bbbb:cccc', dependentDetails: `child ${FIXTURE_ID}`, userId: 'owner-a' } });
    const lines: string[] = [];
    expect(await runMigrationCli(['--project', PROJECT], { db, ...quiet, stdout: line => lines.push(line), stderr: line => lines.push(line) })).toBe(0);
    expect(writes).toEqual([]);
    expect(lines.join('\n')).toContain('"docsUnreadable": 1');
    expect(lines.join('\n')).not.toContain(FIXTURE_ID);
    expect(lines.join('\n')).not.toContain('aaaa:bbbb:cccc');
    expect(lines.join('\n')).not.toContain('owner-a');
  });

  it('refuses to open Firestore while the emulator host is set', async () => {
    await expect(connectMigrationFirestore(PROJECT, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).rejects.toThrow(/FIRESTORE_EMULATOR_HOST/);
    await expect(runMigration({ projectId: '', db: fakeDb({}).db, ...quiet })).rejects.toThrow(/project id/);
  });

  it('reads and masks every written field with the recorded production helpers', async () => {
    assertVendoredLiveReader();
    const samples: { field: string; kind: OrganizerIdentifierKind; value: string; masked: string }[] = [
      { field: 'taxpayerSSN', kind: 'ssn', value: '900-00-0001', masked: '***-**-0001' },
      { field: 'spouseSSN', kind: 'ssn', value: '900000002', masked: '***-**-0002' },
      { field: 'dependentSSN', kind: 'ssn', value: '900-00-0003', masked: '***-**-0003' },
      { field: 'dependent2ITIN', kind: 'ssn', value: '912700004', masked: '***-**-0004' },
      { field: 'bankAccount', kind: 'bankAccount', value: '000123456789', masked: '****6789' },
      { field: 'bankRouting', kind: 'bankRouting', value: '071000013', masked: '*****0013' },
      { field: 'ipPin', kind: 'ipPin', value: '123456', masked: 'Provided to preparer separately' },
      { field: 'ein', kind: 'ein', value: '12-3456789', masked: '**-***6789' },
    ];
    const data = Object.fromEntries(samples.map(sample => [sample.field, sample.value]));
    const { db, collections } = fakeDb({ all: { userId: 'owner-c', ...data } });
    const report = await runMigration({ projectId: PROJECT, apply: true, confirm: PROJECT, db, ...quiet });
    expect(report.docsUpdated).toBe(1);
    const saved = collections.get(ORGANIZER_COLLECTION)!.get('all')!;
    const rendered = formatMigrationReport(report);
    for (const sample of samples) {
      const stored = String(saved[sample.field]);
      expect(liveDecrypt(stored)).toBe(sample.value);
      expect(liveMask(sample.kind, liveDecrypt(stored))).toBe(sample.masked);
      expect(rendered).not.toContain(sample.value);
    }
  });

  it('apply converts bank account, routing number, and ip pin and reads them back', async () => {
    const bankAccount = '000123456789';
    const bankRouting = '071000013';
    const ipPin = '123456';
    const { db, collections } = fakeDb({ acct: { userId: 'owner-c', bankAccount, bankRouting, ipPin } });
    const report = await runMigration({ projectId: PROJECT, apply: true, confirm: PROJECT, db, ...quiet });
    expect(report).toMatchObject({ docsUpdated: 1, fieldsByType: { bankAccount: 1, bankRouting: 1, ipPin: 1 }, writesPerformed: true });
    const saved = collections.get(ORGANIZER_COLLECTION)!.get('acct')!;
    expect(decryptSensitive(String(saved.bankAccount))).toBe(bankAccount);
    expect(decryptSensitive(String(saved.bankRouting))).toBe(bankRouting);
    expect(decryptSensitive(String(saved.ipPin))).toBe(ipPin);
    expect(formatMigrationReport(report)).not.toContain(bankAccount);
    expect(formatMigrationReport(report)).not.toContain(bankRouting);
    expect(formatMigrationReport(report)).not.toContain(ipPin);
  });

  it('counts notes fields that match an identifier shape and omits their contents', async () => {
    const dashed = '900-00-0001';
    const routing = '071000013';
    const labeled = 'IP PIN: 123456';
    const unlabeled = '123456';
    const amount = '$123,456,789';
    const { db, writes } = fakeDb({
      notes: {
        filingStatus: 'single',
        notes: dashed,
        preparerNotes: routing,
        clientNotes: labeled,
        officeNotes: unlabeled,
        amountNotes: amount,
        dependentDetails: dashed,
      },
      broken: { taxpayerSSN: 'aaaa:bbbb:cccc', notes: dashed },
    });
    const lines: string[] = [];
    expect(await runMigrationCli(['--project', PROJECT], { db, ...quiet, stdout: line => lines.push(line), stderr: line => lines.push(line) })).toBe(0);
    expect(writes).toEqual([]);
    const text = lines.join('\n');
    expect(text).toContain('"notesFieldsMatched": 4');
    expect(text).toContain('"docsUnreadable": 1');
    for (const value of [dashed, routing, labeled, unlabeled, amount, 'aaaa:bbbb:cccc']) {
      expect(text).not.toContain(value);
      expect(text).not.toContain(createHash('sha256').update(value).digest('hex'));
    }
  });

  it('refuses a missing, malformed, or built-in key before any read or write', async () => {
    const legacy = legacyOrganizer();
    const cases: { env: Record<string, string | undefined>; message: RegExp; hidden: string }[] = [
      { env: { SSN_ENCRYPTION_KEY: '' }, message: /not configured/, hidden: KEY },
      { env: { SSN_ENCRYPTION_KEY: 'zz'.repeat(32) }, message: /64-character hex/, hidden: 'zz'.repeat(32) },
      { env: { SSN_ENCRYPTION_KEY: 'abc' }, message: /64-character hex/, hidden: 'abc' },
      { env: { SSN_ENCRYPTION_KEY: '1'.repeat(64) }, message: /configured release key/, hidden: '1'.repeat(64) },
      {
        env: { SSN_ENCRYPTION_KEY: Buffer.from('dev_key_not_for_production_use__'.repeat(1).padEnd(32, '0').slice(0, 32)).toString('hex') },
        message: /configured release key/,
        hidden: Buffer.from('dev_key_not_for_production_use__'.repeat(1).padEnd(32, '0').slice(0, 32)).toString('hex'),
      },
    ];
    for (const entry of cases) {
      vi.stubEnv('SSN_ENCRYPTION_KEY', entry.env.SSN_ENCRYPTION_KEY ?? '');
      const { db, writes, reads } = fakeDb({ legacy: legacy.data });
      const touch = new Proxy(db, { get() { throw new Error('db touched'); } });
      await expect(runMigration({ projectId: PROJECT, db: touch, ...quiet })).rejects.toThrow(entry.message);
      await expect(runMigration({ projectId: PROJECT, apply: true, confirm: PROJECT, db: touch, ...quiet })).rejects.toThrow(entry.message);
      const lines: string[] = [];
      expect(await runMigrationCli(['--project', PROJECT], { db, ...quiet, stdout: line => lines.push(line), stderr: line => lines.push(line) })).toBe(1);
      expect(lines.join('\n')).toMatch(entry.message);
      expect(lines.join('\n')).not.toContain(entry.hidden);
      expect(writes).toEqual([]);
      expect(reads).toEqual([]);
    }
  });

  it('records a key fingerprint and does not record the key', async () => {
    const legacy = legacyOrganizer();
    const { db, collections } = fakeDb({ legacy: legacy.data });
    const report = await runMigration({ projectId: PROJECT, apply: true, confirm: PROJECT, db, ...quiet });
    const fingerprint = keyFingerprint(KEY);
    expect(fingerprint).toHaveLength(16);
    expect(fingerprint).not.toBe(KEY);
    expect(report.encryptionKeyFingerprint).toBe(fingerprint);
    const backup = collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.get('legacy')!;
    expect(backup.encryptionKeyFingerprint).toBe(fingerprint);
    expect(backup.verified).toBe(false);
    expect(backup.runId).toBe(report.runId);
    const rendered = `${formatMigrationReport(report)}\n${JSON.stringify(backup)}`;
    expect(rendered).not.toContain(KEY);
    expect(rendered).not.toContain(FIXTURE_ID);
  });

  it('purges only verified backups older than the retention window, and a rerun changes nothing', async () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(14);
    const now = new Date('2026-03-10T00:00:00.000Z');
    const old = new Date('2026-01-01T00:00:00.000Z');
    const recent = new Date('2026-03-01T00:00:00.000Z');
    const seeded = () => ({
      oldVerified: { verified: true, backedUpAt: old, runId: 'run-old' },
      oldStamp: { verified: true, backedUpAt: { toDate: () => old }, runId: 'run-stamp' },
      recentVerified: { verified: true, backedUpAt: recent, runId: 'run-recent' },
      oldUnverified: { verified: false, backedUpAt: old, runId: 'run-open' },
    });
    const dry = fakeDb({}, new Set(), seeded());
    const preview = await runMigration({ projectId: PROJECT, purgeBackups: true, db: dry.db, ...quiet, now: () => now });
    expect(preview).toMatchObject({
      mode: 'purge_dry_run', retentionDays: 14, backupsScanned: 4, backupsEligible: 2, backupsDeleted: 0, writesPerformed: false,
      encryptionKeyFingerprint: keyFingerprint(KEY),
    });
    expect(dry.writes).toEqual([]);
    expect([...dry.collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.keys()].sort()).toEqual(['oldStamp', 'oldUnverified', 'oldVerified', 'recentVerified']);
    const narrowed = fakeDb({}, new Set(), seeded());
    const shorter = await runMigration({ projectId: PROJECT, purgeBackups: true, retentionDays: 1, db: narrowed.db, ...quiet, now: () => now });
    expect(shorter).toMatchObject({ backupsEligible: 3, backupsDeleted: 0, writesPerformed: false });
    expect(narrowed.collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.has('oldUnverified')).toBe(true);

    const applied = fakeDb({}, new Set(), seeded());
    const lines: string[] = [];
    const removed = await runMigration({ projectId: PROJECT, purgeBackups: true, confirm: PROJECT, db: applied.db, ...quiet, now: () => now });
    expect(removed).toMatchObject({ mode: 'purge', backupsEligible: 2, backupsDeleted: 2, writesPerformed: true });
    expect([...applied.collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.keys()].sort()).toEqual(['oldUnverified', 'recentVerified']);
    const again = await runMigration({ projectId: PROJECT, purgeBackups: true, confirm: PROJECT, db: applied.db, ...quiet, now: () => now });
    expect(again).toMatchObject({ backupsScanned: 2, backupsEligible: 0, backupsDeleted: 0, writesPerformed: false });
    expect(await runMigrationCli(['--project', PROJECT, '--purge-backups'], {
      db: fakeDb({}, new Set(), seeded()).db, ...quiet, now: () => now, stdout: line => lines.push(line), stderr: line => lines.push(line),
    })).toBe(0);
    const text = `${lines.join('\n')}\n${formatMigrationReport(removed)}`;
    expect(text).toContain('"backupsDeleted": 0');
    expect(text).not.toContain('run-old');
    expect(text).not.toContain('run-recent');
    expect(text).not.toContain(KEY);
    const blocked = fakeDb({}, new Set(), seeded());
    await expect(runMigration({ projectId: PROJECT, purgeBackups: true, confirm: 'other-project', db: new Proxy(blocked.db, { get() { throw new Error('db touched'); } }), ...quiet })).rejects.toThrow(/--purge-backups requires --confirm/);
    expect([...blocked.collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.keys()]).toHaveLength(4);
  });

  it('marks a run verified only after every backup reads back, then a later purge can remove it', async () => {
    const legacy = legacyOrganizer();
    const second = { ...legacy.data, taxpayerSSN: '900-00-0008', dependent2SSN: '900000009' };
    const { db, collections, writes } = fakeDb({ legacy: legacy.data, other: second });
    const applied = await runMigration({ projectId: PROJECT, apply: true, confirm: PROJECT, db, ...quiet });
    const runId = applied.runId!;
    const marked = await runMigration({ projectId: PROJECT, markVerified: runId, confirm: PROJECT, db, ...quiet });
    expect(marked).toMatchObject({ mode: 'mark_verified', backupsChecked: 2, backupsVerified: 2, backupsFailed: 0, writesPerformed: true });
    expect(collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.get('legacy')!.verified).toBe(true);
    expect(collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.get('other')!.verified).toBe(true);

    const failed = fakeDb({ legacy: legacy.data });
    const first = await runMigration({ projectId: PROJECT, apply: true, confirm: PROJECT, db: failed.db, ...quiet });
    failed.collections.get(ORGANIZER_COLLECTION)!.get('legacy')!.taxpayerSSN = 'replaced';
    const before = failed.writes.length;
    const rejected = await runMigration({ projectId: PROJECT, markVerified: first.runId, confirm: PROJECT, db: failed.db, ...quiet });
    expect(rejected).toMatchObject({ backupsChecked: 1, backupsVerified: 0, backupsFailed: 1, writesPerformed: false });
    expect(failed.collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.get('legacy')!.verified).toBe(false);
    expect(failed.writes).toHaveLength(before);
    const lines: string[] = [];
    expect(await runMigrationCli(['--project', PROJECT, '--mark-verified', first.runId!, '--confirm', PROJECT], {
      db: failed.db, ...quiet, stdout: line => lines.push(line), stderr: line => lines.push(line),
    })).toBe(1);
    expect(lines.join('\n')).toMatch(/Verification did not pass/);
    expect(lines.join('\n')).not.toContain(FIXTURE_ID);
    expect(lines.join('\n')).not.toContain(first.runId!);
    await expect(runMigration({ projectId: PROJECT, markVerified: 'missing-run-id', confirm: PROJECT, db: failed.db, ...quiet })).rejects.toThrow(/No backup run matched that id/);
    const missing: string[] = [];
    expect(await runMigrationCli(['--project', PROJECT, '--mark-verified', 'missing-run-id', '--confirm', PROJECT], {
      db: failed.db, ...quiet, stdout: line => missing.push(line), stderr: line => missing.push(line),
    })).toBe(1);
    expect(missing.join('\n')).toMatch(/No backup run matched that id/);
    expect(missing.join('\n')).not.toContain('missing-run-id');

    collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.get('legacy')!.backedUpAt = new Date('2026-01-01T00:00:00.000Z');
    collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.get('other')!.backedUpAt = new Date('2026-03-09T00:00:00.000Z');
    const purged = await runMigration({
      projectId: PROJECT, purgeBackups: true, confirm: PROJECT, db, ...quiet, now: () => new Date('2026-03-20T00:00:00.000Z'),
    });
    expect(purged).toMatchObject({ backupsEligible: 1, backupsDeleted: 1 });
    expect(collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.has('legacy')).toBe(false);
    expect(collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.has('other')).toBe(true);
    expect(writes.filter(write => write.collection === ORGANIZER_COLLECTION).map(write => write.id).sort()).toEqual(['legacy', 'other']);
  });

  it('leaves a live save in place when the record changes before the write', async () => {
    const original = '900-00-0001';
    const saved = '900-00-0099';
    const store = fakeDb({ row: { userId: 'owner-live', taxpayerSSN: original } }, new Set(), {}, {
      afterOrganizerPage: () => store.revise(ORGANIZER_COLLECTION, 'row', { taxpayerSSN: saved }),
    });
    const report = await runMigration({ projectId: PROJECT, apply: true, confirm: PROJECT, db: store.db, ...quiet });
    const row = store.collections.get(ORGANIZER_COLLECTION)!.get('row')!;
    expect(row.taxpayerSSN).toBe(saved);
    expect(store.collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.has('row')).toBe(false);
    expect(report.skippedChanged).toBe(1);
    expect(report.docsUpdated).toBe(0);
    expect(formatMigrationReport(report)).not.toContain(saved);
    expect(formatMigrationReport(report)).not.toContain(original);
    const again = await runMigration({ projectId: PROJECT, apply: true, confirm: PROJECT, db: store.db, ...quiet });
    expect(again.docsUpdated).toBe(1);
    expect(again.skippedChanged).toBe(0);
    const converted = store.collections.get(ORGANIZER_COLLECTION)!.get('row')!;
    const backup = store.collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.get('row')!;
    expect(decryptSensitive(String(converted.taxpayerSSN))).toBe(saved);
    expect(decryptSensitive(String((backup.encryptedFields as Record<string, string>).taxpayerSSN))).toBe(saved);
    expect(backup.encryptionKeyFingerprint).toBe(again.encryptionKeyFingerprint);
  });

  it('fails verification when a backup has no fingerprint or a different one', async () => {
    const original = '900-00-0007';
    const stored = encryptSensitive(original);
    const backedUp = encryptSensitive(original);
    const missing = fakeDb(
      { row: { taxpayerSSN: stored } },
      new Set(),
      { row: { runId: 'run-missing', verified: false, encryptedFields: { taxpayerSSN: backedUp } } },
    );
    const missingReport = await runMigration({ projectId: PROJECT, markVerified: 'run-missing', confirm: PROJECT, db: missing.db, ...quiet });
    expect(missingReport).toMatchObject({ backupsChecked: 1, backupsVerified: 0, backupsFailed: 1, writesPerformed: false });
    expect(missing.collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.get('row')!.verified).toBe(false);
    const other = encryptSensitive(original);
    const different = fakeDb(
      { row: { taxpayerSSN: stored } },
      new Set(),
      { row: { runId: 'run-other', verified: false, encryptionKeyFingerprint: 'ffffffffffffffff', encryptedFields: { taxpayerSSN: other } } },
    );
    const differentReport = await runMigration({ projectId: PROJECT, markVerified: 'run-other', confirm: PROJECT, db: different.db, ...quiet });
    expect(differentReport).toMatchObject({ backupsChecked: 1, backupsVerified: 0, backupsFailed: 1, writesPerformed: false });
    expect(different.collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.get('row')!.verified).toBe(false);
    expect(formatMigrationReport(missingReport)).not.toContain(original);
    expect(formatMigrationReport(differentReport)).not.toContain(original);
  });
});
