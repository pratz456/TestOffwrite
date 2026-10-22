import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORGANIZER_IDENTIFIER_BACKUP_COLLECTION } from '../lib/tax-organizer/identifiers';
import { REDACTED_ID } from '../lib/security/identifier-redaction';
import { decryptSensitive, encryptSensitive, isEncrypted } from '../lib/security/utils';
import {
  ORGANIZER_COLLECTION, connectMigrationFirestore, formatMigrationReport, hashDocRef, parseMigrationArgs, runMigration, runMigrationCli,
  type MigrationDb, type MigrationDocRef,
} from '../scripts/migrate-legacy-organizer-identifiers';

const SSN = '123-45-6789';
const PROJECT = 'demo-organizer';
const KEY = 'ab'.repeat(32);
const at = () => new Date('2026-03-01T00:00:00.000Z');

interface Write { collection: string; id: string; data: Record<string, unknown>; merge: boolean }

function fakeDb(organizers: Record<string, Record<string, unknown>>, failOrganizerIds = new Set<string>()) {
  const collections = new Map<string, Map<string, Record<string, unknown>>>([
    [ORGANIZER_COLLECTION, new Map(Object.entries(organizers).map(([id, data]) => [id, { ...data }]))],
    [ORGANIZER_IDENTIFIER_BACKUP_COLLECTION, new Map()],
  ]);
  const writes: Write[] = [];
  const reads: string[] = [];
  function docRef(name: string, id: string): MigrationDocRef {
    return {
      id,
      path: `${name}/${id}`,
      async set(data, setOptions) {
        if (!setOptions?.merge) throw new Error('merge required');
        if (name === ORGANIZER_COLLECTION && failOrganizerIds.has(id)) throw new Error(`${SSN} should not leak from a write error`);
        writes.push({ collection: name, id, data, merge: setOptions.merge });
        const store = collections.get(name)!;
        store.set(id, { ...(store.get(id) ?? {}), ...data });
      },
    };
  }
  const db: MigrationDb = { collection(name: string) {
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
        return {
          empty: page.length === 0,
          size: page.length,
          docs: page.map(id => ({ id, ref: docRef(name, id), data: () => ({ ...collections.get(name)!.get(id)! }) })),
        };
      },
      doc: (id: string) => docRef(name, id),
    };
    return query;
  } };
  return { db, writes, collections, reads };
}

function legacyOrganizer() {
  const spouseSSN = encryptSensitive('900000002');
  const bankRouting = encryptSensitive('071000013');
  return {
    spouseSSN, bankRouting,
    data: {
      userId: 'owner-a', user_id: 'owner-a', taxYear: 2026, filingStatus: 'single', taxpayerSeniorSSN: 'yes', notes: SSN,
      taxpayerSSN: SSN, spouseSSN, dependent2SSN: '900000003', ein: '12-3456789', bankAccount: '', bankRouting,
      dependentDetails: `Emma Shah, ${SSN}, Daughter`,
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
      fieldsByType: { ssn: 2, ein: 1, redactedText: 1 }, docsUpdated: 0, docsUnreadable: 0, writesPerformed: false,
    });
    expect(writes).toEqual([]);
    expect(collections.get(ORGANIZER_COLLECTION)!.get('legacy')).toEqual(before);
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    const lines: string[] = [];
    expect(await runMigrationCli(['--project', PROJECT], { db, ...quiet, stdout: line => lines.push(line), stderr: line => lines.push(line) })).toBe(0);
    expect(lines.join('\n')).toBe(`${formatMigrationReport(report)}\nDry run only. No documents were written. Running this script needs the owner's explicit approval.`);
    expect(lines.join('\n')).not.toContain(SSN);
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
    expect(lines.join('\n')).not.toContain(SSN);
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
    expect(decryptSensitive(String(saved.taxpayerSSN))).toBe(SSN);
    expect(decryptSensitive(String(saved.dependent2SSN))).toBe('900000003');
    expect(decryptSensitive(String(saved.ein))).toBe('12-3456789');
    expect(saved.spouseSSN).toBe(legacy.spouseSSN);
    expect(saved.bankRouting).toBe(legacy.bankRouting);
    expect(saved.dependentDetails).toBe(`Emma Shah, ${REDACTED_ID}, Daughter`);
    expect(saved.notes).toBe(SSN);
    expect(saved.filingStatus).toBe('single');
    expect(saved.taxpayerSeniorSSN).toBe('yes');
    expect(saved.bankAccount).toBe('');
    expect(saved.userId).toBe('owner-a');
    expect(saved.identifiersEncryptedAt).toEqual(at());
    const backup = collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.get('legacy')!;
    expect(decryptSensitive(String((backup.encryptedFields as Record<string, string>).taxpayerSSN))).toBe(SSN);
    expect(decryptSensitive(String((backup.encryptedFields as Record<string, string>).dependentDetails))).toBe(`Emma Shah, ${SSN}, Daughter`);
    expect(backup.userId).toBe('owner-a');
    expect(JSON.stringify(backup)).not.toContain(SSN);
    expect(JSON.stringify(organizerWrites[0].data)).not.toContain(SSN);
    expect(collections.get(ORGANIZER_COLLECTION)!.get('clean')).toEqual(cleanBefore);

    const writesAfterFirst = writes.length;
    const second = await runMigration({ projectId: PROJECT, apply: true, confirm: PROJECT, db, ...quiet });
    expect(second).toMatchObject({ docsScanned: 2, docsNeedingUpdate: 0, docsUpdated: 0, writesPerformed: false, fieldsByType: {} });
    expect(writes).toHaveLength(writesAfterFirst);
    expect(formatMigrationReport(second)).not.toContain(SSN);
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
    expect(lines.join('\n')).not.toContain(SSN);
    expect(lines.join('\n')).not.toContain('owner-a');
    expect(lines.join('\n')).toContain(hashDocRef(`${ORGANIZER_COLLECTION}/legacy`));
    expect(collections.get(ORGANIZER_COLLECTION)!.get('legacy')!.taxpayerSSN).toBe(SSN);
    expect(JSON.stringify(collections.get(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION)!.get('legacy'))).not.toContain(SSN);
    failing.clear();
    const before = writes.length;
    const report = await runMigration({ projectId: PROJECT, apply: true, confirm: PROJECT, db, ...quiet });
    expect(report.docsUpdated).toBe(1);
    expect(writes.length).toBe(before + 2);
    expect(decryptSensitive(String(collections.get(ORGANIZER_COLLECTION)!.get('legacy')!.taxpayerSSN))).toBe(SSN);
    expect(formatMigrationReport(report)).not.toContain(SSN);
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
    const { db, writes } = fakeDb({ broken: { taxpayerSSN: 'aaaa:bbbb:cccc', dependentDetails: `child ${SSN}`, userId: 'owner-a' } });
    const lines: string[] = [];
    expect(await runMigrationCli(['--project', PROJECT], { db, ...quiet, stdout: line => lines.push(line), stderr: line => lines.push(line) })).toBe(0);
    expect(writes).toEqual([]);
    expect(lines.join('\n')).toContain('"docsUnreadable": 1');
    expect(lines.join('\n')).not.toContain(SSN);
    expect(lines.join('\n')).not.toContain('aaaa:bbbb:cccc');
    expect(lines.join('\n')).not.toContain('owner-a');
  });

  it('refuses to open Firestore while the emulator host is set', async () => {
    await expect(connectMigrationFirestore(PROJECT, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).rejects.toThrow(/FIRESTORE_EMULATOR_HOST/);
    await expect(runMigration({ projectId: '', db: fakeDb({}).db, ...quiet })).rejects.toThrow(/project id/);
  });
});
