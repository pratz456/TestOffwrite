#!/usr/bin/env ts-node
/**
 * One-time, owner-run maintenance for tax organizer records.
 *
 * Dry run is the default and only reads. It prints counts: documents scanned,
 * documents selected for an update, and fields per type. It does not print
 * field values, document contents, or user ids.
 *
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node","esModuleInterop":true}' -r ./scripts/register-ts-paths.cjs scripts/migrate-legacy-organizer-identifiers.ts --project <firebase-project-id>
 *
 * Apply also requires `--confirm` equal to that same project id. Before each
 * organizer write, the current field values are saved in
 * `tax_organizer_identifier_backups` with the existing helpers. The organizer
 * update merges the fields from `legacyIdentifierPatch` and `identifiersEncryptedAt`.
 *
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node","esModuleInterop":true}' -r ./scripts/register-ts-paths.cjs scripts/migrate-legacy-organizer-identifiers.ts --project <firebase-project-id> --apply --confirm <firebase-project-id>
 *
 * Needs the owner's explicit approval before either command is run.
 * The project id is required. There is no default. Paging is by document id,
 * so a rerun skips records that are already updated.
 */
import { createHash } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import {
  ORGANIZER_IDENTIFIER_BACKUP_COLLECTION, legacyIdentifierPatch, organizerIdentifierKind, readOrganizerIdentifiers,
  type OrganizerIdentifierRead,
} from '../lib/tax-organizer/identifiers';
import { decryptSensitive, encryptSensitive, isEncrypted } from '../lib/security/utils';

export const ORGANIZER_COLLECTION = 'tax_organizers';
export const DEFAULT_PAGE_SIZE = 100;
export const DEFAULT_RATE_LIMIT_MS = 100;

const USAGE = 'Use --project <firebase-project-id> [--apply --confirm <firebase-project-id>] [--resume-after <document-id>] [--page-size <1-500>] [--rate-limit-ms <0-60000>]';

export interface MigrationDocRef {
  id: string;
  path: string;
  set(data: Record<string, unknown>, options: { merge: boolean }): Promise<unknown>;
}

export interface MigrationDoc {
  id: string;
  ref: MigrationDocRef;
  data(): Record<string, unknown> | undefined;
}

export interface MigrationQuery {
  orderBy(field: unknown, direction?: unknown): MigrationQuery;
  limit(count: number): MigrationQuery;
  startAfter(cursor: unknown): MigrationQuery;
  get(): Promise<{ empty: boolean; docs: MigrationDoc[]; size?: number }>;
}

export interface MigrationDb {
  collection(name: string): MigrationQuery & { doc(id: string): MigrationDocRef };
}

export interface MigrationReport {
  mode: 'dry_run' | 'apply';
  projectId: string;
  docsScanned: number;
  docsNeedingUpdate: number;
  fieldsByType: Record<string, number>;
  docsUpdated: number;
  docsUnreadable: number;
  writesPerformed: boolean;
}

export interface MigrationRunOptions {
  projectId: string;
  apply?: boolean;
  confirm?: string;
  pageSize?: number;
  rateLimitMs?: number;
  resumeAfter?: string;
  db?: MigrationDb;
  connect?: (projectId: string) => Promise<{ db: MigrationDb; close?: () => Promise<void> }>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
}

interface ParsedArgs {
  projectId: string;
  apply: boolean;
  confirm?: string;
  pageSize?: number;
  rateLimitMs?: number;
  resumeAfter?: string;
}

/** Counts-only text. Hashed document refs are included only when a write stops the run. */
export function formatMigrationReport(report: MigrationReport): string {
  const fieldsByType = Object.fromEntries(Object.entries(report.fieldsByType).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({
    mode: report.mode,
    projectId: report.projectId,
    docsScanned: report.docsScanned,
    docsNeedingUpdate: report.docsNeedingUpdate,
    fieldsByType,
    docsUpdated: report.docsUpdated,
    docsUnreadable: report.docsUnreadable,
    writesPerformed: report.writesPerformed,
  }, null, 2);
}

export function hashDocRef(path: string): string {
  return createHash('sha256').update(path).digest('hex');
}

export function parseMigrationArgs(argv: string[]): ParsedArgs {
  const values: Record<string, string> = {};
  const positional: string[] = [];
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === '--apply') { apply = true; continue; }
    if (argument === '--project' || argument === '--confirm' || argument === '--resume-after' || argument === '--page-size' || argument === '--rate-limit-ms') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      values[argument] = value;
      i += 1;
      continue;
    }
    if (argument.startsWith('--')) throw new Error(USAGE);
    positional.push(argument);
  }
  const projectId = values['--project'] ?? (positional.length === 1 ? positional[0] : '');
  if (!projectId || (values['--project'] && positional.length > 0) || positional.length > 1) throw new Error(`A Firebase project id is required. ${USAGE}`);
  const pageSize = values['--page-size'] === undefined ? undefined : Number(values['--page-size']);
  const rateLimitMs = values['--rate-limit-ms'] === undefined ? undefined : Number(values['--rate-limit-ms']);
  if (values['--page-size'] !== undefined && !Number.isInteger(pageSize)) throw new Error(USAGE);
  if (values['--rate-limit-ms'] !== undefined && !Number.isInteger(rateLimitMs)) throw new Error(USAGE);
  return { projectId, apply, confirm: values['--confirm'], resumeAfter: values['--resume-after'], pageSize, rateLimitMs };
}

function boundedInt(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return resolved;
}

/** Uses the existing application key. This script does not define another one. */
function assertEncryptionKeyConfigured(env: NodeJS.ProcessEnv): void {
  const key = env.SSN_ENCRYPTION_KEY;
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error('The application key must be the existing 64-character hex value');
  }
}

function fieldType(field: string): string {
  return organizerIdentifierKind(field) ?? 'redactedText';
}

function legacyFields(read: OrganizerIdentifierRead): string[] {
  return [...read.legacyPlaintextFields, ...read.redactedTextFields];
}

/** Copies the selected field values through the existing helpers before a write. */
function encryptOriginals(data: Record<string, unknown>, fields: string[]): Record<string, string> {
  const encrypted: Record<string, string> = {};
  for (const field of fields) {
    const original = data[field];
    if (typeof original !== 'string' || !original) throw new Error('Backup encryption failed');
    const ciphertext = encryptSensitive(original);
    if (ciphertext === original || !isEncrypted(ciphertext) || decryptSensitive(ciphertext) !== original) {
      throw new Error('Backup encryption failed');
    }
    encrypted[field] = ciphertext;
  }
  return encrypted;
}

function backupOwner(data: Record<string, unknown>): { userId?: string } {
  const userId = typeof data.userId === 'string' && data.userId ? data.userId : undefined;
  const legacyOwner = typeof data.user_id === 'string' && data.user_id ? data.user_id : undefined;
  if (userId && legacyOwner && userId !== legacyOwner) throw new Error('Backup refused a document with conflicting owner fields');
  const owner = userId ?? legacyOwner;
  return owner ? { userId: owner } : {};
}

function organizerPatch(read: OrganizerIdentifierRead, at: Date): Record<string, unknown> {
  const fields = legacyIdentifierPatch(read);
  if (Object.keys(fields).length === 0) throw new Error('Refusing to write an empty identifier patch');
  const patch: Record<string, unknown> = { ...fields, identifiersEncryptedAt: at };
  const allowed = new Set<string>([...read.legacyPlaintextFields, ...read.redactedTextFields, 'identifiersEncryptedAt']);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) throw new Error('Refusing to write an unexpected organizer field');
  }
  return patch;
}

export async function connectMigrationFirestore(projectId: string, env: NodeJS.ProcessEnv = process.env): Promise<{ db: MigrationDb; close: () => Promise<void> }> {
  if (!projectId.trim()) throw new Error('A Firebase project id is required');
  if (env.FIRESTORE_EMULATOR_HOST) throw new Error('Refusing to start while FIRESTORE_EMULATOR_HOST is set');
  const [{ initializeApp, applicationDefault, deleteApp }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
  ]);
  const app = initializeApp(
    { credential: applicationDefault(), projectId },
    `migrate-legacy-organizer-identifiers-${Date.now()}`,
  );
  return { db: getFirestore(app) as unknown as MigrationDb, close: () => deleteApp(app) };
}

export async function runMigration(options: MigrationRunOptions): Promise<MigrationReport> {
  const projectId = options.projectId?.trim() ?? '';
  if (!projectId) throw new Error(`A Firebase project id is required. ${USAGE}`);
  const apply = options.apply === true;
  if (apply && options.confirm !== projectId) throw new Error('--apply requires --confirm to match the project id');
  const env = options.env ?? process.env;
  assertEncryptionKeyConfigured(env);
  const pageSize = boundedInt(options.pageSize, DEFAULT_PAGE_SIZE, 1, 500, '--page-size');
  const rateLimitMs = boundedInt(options.rateLimitMs, DEFAULT_RATE_LIMIT_MS, 0, 60_000, '--rate-limit-ms');
  const resumeAfter = options.resumeAfter?.trim() || undefined;
  if (options.resumeAfter !== undefined && !resumeAfter) throw new Error('--resume-after needs a document id');
  const sleep = options.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? (() => new Date());
  const fieldsByType: Record<string, number> = {};
  let docsScanned = 0;
  let docsNeedingUpdate = 0;
  let docsUpdated = 0;
  let docsUnreadable = 0;
  let cursor = resumeAfter;
  const opened = options.db
    ? { db: options.db, close: undefined }
    : await (options.connect ?? ((id: string) => connectMigrationFirestore(id, env)))(projectId);
  try {
    for (;;) {
      let query = opened.db.collection(ORGANIZER_COLLECTION).orderBy(FieldPath.documentId()).limit(pageSize);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      for (const doc of snapshot.docs) {
        docsScanned += 1;
        cursor = doc.id;
        const data = doc.data() ?? {};
        let read: OrganizerIdentifierRead;
        try {
          read = readOrganizerIdentifiers(data);
        } catch {
          docsUnreadable += 1;
          continue;
        }
        const fields = legacyFields(read);
        if (!fields.length) continue;
        docsNeedingUpdate += 1;
        for (const field of fields) fieldsByType[fieldType(field)] = (fieldsByType[fieldType(field)] ?? 0) + 1;
        if (!apply) continue;
        if (rateLimitMs > 0) await sleep(rateLimitMs);
        let owner: { userId?: string };
        let encryptedFields: Record<string, string>;
        try {
          owner = backupOwner(data);
          encryptedFields = encryptOriginals(data, fields);
        } catch (error) {
          if (error instanceof Error && error.message === 'Backup refused a document with conflicting owner fields') {
            docsUnreadable += 1;
            continue;
          }
          throw new Error(`Migration stopped (${hashDocRef(doc.ref?.path || `${ORGANIZER_COLLECTION}/${doc.id}`)}): Backup encryption failed. Rerun the same command; documents already migrated are skipped.`);
        }
        try {
          await opened.db.collection(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION).doc(doc.id).set({
            encryptedFields, ...owner, backedUpAt: now(),
          }, { merge: true });
          await doc.ref.set(organizerPatch(read, now()), { merge: true });
          docsUpdated += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          const safe = message.startsWith('Refusing to write') ? message : 'write failed';
          throw new Error(`Migration stopped (${hashDocRef(doc.ref?.path || `${ORGANIZER_COLLECTION}/${doc.id}`)}): ${safe}. Rerun the same command; documents already migrated are skipped.`);
        }
      }
      if (snapshot.docs.length < pageSize) break;
      if (rateLimitMs > 0) await sleep(rateLimitMs);
    }
  } finally {
    await opened.close?.();
  }
  return {
    mode: apply ? 'apply' : 'dry_run',
    projectId,
    docsScanned,
    docsNeedingUpdate,
    fieldsByType,
    docsUpdated,
    docsUnreadable,
    writesPerformed: docsUpdated > 0,
  };
}

export async function runMigrationCli(argv: string[], hooks: Omit<MigrationRunOptions, 'projectId' | 'apply' | 'confirm' | 'pageSize' | 'rateLimitMs' | 'resumeAfter'> & {
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
} = {}): Promise<number> {
  const stdout = hooks.stdout ?? ((line: string) => console.log(line));
  const stderr = hooks.stderr ?? ((line: string) => console.error(line));
  try {
    const args = parseMigrationArgs(argv);
    const report = await runMigration({ ...hooks, ...args });
    stdout(formatMigrationReport(report));
    stdout(report.mode === 'dry_run'
      ? 'Dry run only. No documents were written. Running this script needs the owner\'s explicit approval.'
      : 'Apply finished. Organizer documents changed only where legacy identifier fields were still present.');
    return 0;
  } catch (error) {
    stderr(`FAIL: ${error instanceof Error ? error.message : 'Migration failed'}`);
    return 1;
  }
}

function isCliEntry(): boolean {
  const file = process.argv[1]?.split(/[/\\]/).pop() ?? '';
  return file === 'migrate-legacy-organizer-identifiers.ts' || file === 'migrate-legacy-organizer-identifiers.js';
}

if (isCliEntry()) {
  runMigrationCli(process.argv.slice(2)).then(code => { process.exitCode = code; });
}
