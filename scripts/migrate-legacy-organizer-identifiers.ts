#!/usr/bin/env ts-node
/**
 * One-time, owner-run maintenance for tax organizer records.
 *
 * Dry run is the default and only reads. It prints counts: documents scanned,
 * documents selected for an update, fields per type, and a count of notes
 * fields that match an identifier shape. It does not print field values,
 * document contents, or user ids.
 *
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node","esModuleInterop":true}' -r ./scripts/register-ts-paths.cjs scripts/migrate-legacy-organizer-identifiers.ts --project <firebase-project-id>
 *
 * Apply also requires `--confirm` equal to that same project id. Before each
 * organizer write, the current field values are saved in
 * `tax_organizer_identifier_backups` with the existing helpers. The organizer
 * update merges the fields from `legacyIdentifierPatch` and `identifiersEncryptedAt`.
 * The report and each backup document store a short fingerprint of the
 * application key. The key itself is not printed or stored.
 *
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node","esModuleInterop":true}' -r ./scripts/register-ts-paths.cjs scripts/migrate-legacy-organizer-identifiers.ts --project <firebase-project-id> --apply --confirm <firebase-project-id>
 *
 * After a post-run read check, mark that run verified with `--mark-verified`.
 * Backup documents are kept for 14 days by default. `--purge-backups` prints
 * counts unless `--confirm` matches the project id, in which case it removes
 * verified backup documents older than the retention window.
 *
 * Needs the owner's explicit approval before any of these commands is run.
 * The project id is required. There is no default. Paging is by document id,
 * so a rerun skips records that are already updated.
 */
import { createHash, randomUUID } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { containsIdentifierShapedDigits } from '../lib/security/identifier-redaction';
import {
  ORGANIZER_IDENTIFIER_BACKUP_COLLECTION, ORGANIZER_REDACTED_TEXT_FIELDS, legacyIdentifierPatch, organizerIdentifierKind, readOrganizerIdentifiers,
  type OrganizerIdentifierRead,
} from '../lib/tax-organizer/identifiers';
import { decryptSensitive, encryptSensitive, isEncrypted } from '../lib/security/utils';

export const ORGANIZER_COLLECTION = 'tax_organizers';
export const DEFAULT_PAGE_SIZE = 100;
export const DEFAULT_RATE_LIMIT_MS = 100;
export const DEFAULT_RETENTION_DAYS = 14;
const DAY_MS = 86_400_000;
const KEY_FINGERPRINT_PREFIX = 'organizer-identifier-key:';

const USAGE = 'Use --project <firebase-project-id> [--apply --confirm <firebase-project-id>] [--purge-backups [--confirm <firebase-project-id>] [--retention-days <1-3650>]] [--mark-verified <run-id> --confirm <firebase-project-id>] [--resume-after <document-id>] [--page-size <1-500>] [--rate-limit-ms <0-60000>]';

export interface MigrationDocSnapshot {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface MigrationDocRef {
  id: string;
  path: string;
  set(data: Record<string, unknown>, options: { merge: boolean }): Promise<unknown>;
  get(): Promise<MigrationDocSnapshot>;
  delete(): Promise<unknown>;
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

export type MigrationMode = 'dry_run' | 'apply' | 'purge_dry_run' | 'purge' | 'mark_verified';

export interface MigrationReport {
  mode: MigrationMode;
  projectId: string;
  docsScanned: number;
  docsNeedingUpdate: number;
  fieldsByType: Record<string, number>;
  notesFieldsMatched: number;
  docsUpdated: number;
  docsUnreadable: number;
  writesPerformed: boolean;
  encryptionKeyFingerprint: string;
  runId?: string;
  retentionDays?: number;
  backupsScanned?: number;
  backupsEligible?: number;
  backupsDeleted?: number;
  backupsChecked?: number;
  backupsVerified?: number;
  backupsFailed?: number;
}

export interface MigrationRunOptions {
  projectId: string;
  apply?: boolean;
  purgeBackups?: boolean;
  confirm?: string;
  pageSize?: number;
  rateLimitMs?: number;
  resumeAfter?: string;
  retentionDays?: number;
  markVerified?: string;
  db?: MigrationDb;
  connect?: (projectId: string) => Promise<{ db: MigrationDb; close?: () => Promise<void> }>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
}

interface ParsedArgs {
  projectId: string;
  apply: boolean;
  purgeBackups: boolean;
  confirm?: string;
  pageSize?: number;
  rateLimitMs?: number;
  resumeAfter?: string;
  retentionDays?: number;
  markVerified?: string;
}

/** Counts-only text. Hashed document refs are included only when a write stops the run. */
export function formatMigrationReport(report: MigrationReport): string {
  if (report.mode === 'purge_dry_run' || report.mode === 'purge') {
    return JSON.stringify({
      mode: report.mode,
      projectId: report.projectId,
      retentionDays: report.retentionDays,
      backupsScanned: report.backupsScanned ?? 0,
      backupsEligible: report.backupsEligible ?? 0,
      backupsDeleted: report.backupsDeleted ?? 0,
      writesPerformed: report.writesPerformed,
      encryptionKeyFingerprint: report.encryptionKeyFingerprint,
    }, null, 2);
  }
  if (report.mode === 'mark_verified') {
    return JSON.stringify({
      mode: report.mode,
      projectId: report.projectId,
      backupsChecked: report.backupsChecked ?? 0,
      backupsVerified: report.backupsVerified ?? 0,
      backupsFailed: report.backupsFailed ?? 0,
      writesPerformed: report.writesPerformed,
      encryptionKeyFingerprint: report.encryptionKeyFingerprint,
    }, null, 2);
  }
  const fieldsByType = Object.fromEntries(Object.entries(report.fieldsByType).sort(([a], [b]) => a.localeCompare(b)));
  const body: Record<string, unknown> = {
    mode: report.mode,
    projectId: report.projectId,
    docsScanned: report.docsScanned,
    docsNeedingUpdate: report.docsNeedingUpdate,
    fieldsByType,
    notesFieldsMatched: report.notesFieldsMatched,
    docsUpdated: report.docsUpdated,
    docsUnreadable: report.docsUnreadable,
    writesPerformed: report.writesPerformed,
    encryptionKeyFingerprint: report.encryptionKeyFingerprint,
  };
  if (report.runId) body.runId = report.runId;
  return JSON.stringify(body, null, 2);
}

export function hashDocRef(path: string): string {
  return createHash('sha256').update(path).digest('hex');
}

export function parseMigrationArgs(argv: string[]): ParsedArgs {
  const values: Record<string, string> = {};
  const positional: string[] = [];
  let apply = false;
  let purgeBackups = false;
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === '--apply') { apply = true; continue; }
    if (argument === '--purge-backups') { purgeBackups = true; continue; }
    if (argument === '--project' || argument === '--confirm' || argument === '--resume-after' || argument === '--page-size' || argument === '--rate-limit-ms' || argument === '--retention-days' || argument === '--mark-verified') {
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
  const retentionDays = values['--retention-days'] === undefined ? undefined : Number(values['--retention-days']);
  if (values['--page-size'] !== undefined && !Number.isInteger(pageSize)) throw new Error(USAGE);
  if (values['--rate-limit-ms'] !== undefined && !Number.isInteger(rateLimitMs)) throw new Error(USAGE);
  if (values['--retention-days'] !== undefined && !Number.isInteger(retentionDays)) throw new Error(USAGE);
  return {
    projectId, apply, purgeBackups, confirm: values['--confirm'], resumeAfter: values['--resume-after'],
    pageSize, rateLimitMs, retentionDays, markVerified: values['--mark-verified'],
  };
}

function boundedInt(value: number | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return resolved;
}

/**
 * Same 64-character hex check as scripts/production-preflight.mjs, and the same
 * fingerprint shape as scripts/production-plaid-credential-migration.mjs.
 * A missing or short value would select the built-in key in lib/security/utils.ts.
 * This script never does that.
 */
export function releaseKeyFingerprint(env: NodeJS.ProcessEnv): string {
  const value = env.SSN_ENCRYPTION_KEY;
  if (!value) throw new Error('The application key is not configured');
  if (!/^[a-f\d]{64}$/i.test(value)) throw new Error('The application key must be a 64-character hex value');
  const normalized = value.toLowerCase();
  const builtIn = Buffer.from('dev_key_not_for_production_use__'.repeat(1).padEnd(32, '0').slice(0, 32)).toString('hex');
  if (normalized === builtIn || normalized === '1'.repeat(64)) throw new Error('The application key must be the configured release key');
  const providerKey = env.PLAID_TOKEN_ENCRYPTION_KEY;
  if (providerKey && providerKey === value) throw new Error('The organizer key must be separate from the provider token key');
  return createHash('sha256').update(`${KEY_FINGERPRINT_PREFIX}${normalized}`).digest('hex').slice(0, 16);
}

function fieldType(field: string): string {
  return organizerIdentifierKind(field) ?? 'redactedText';
}

function legacyFields(read: OrganizerIdentifierRead): string[] {
  return [...read.legacyPlaintextFields, ...read.redactedTextFields];
}

const NOTES_FIELD = /notes$/i;
const LABELED_PIN = /(?:\bIP\s*PIN\b|\bidentity protection pin\b)\s*[:#-]?\s*\d{6}\b/i;

function countMatchingNotes(data: Record<string, unknown>): number {
  let count = 0;
  for (const [field, value] of Object.entries(data)) {
    if (!NOTES_FIELD.test(field) || typeof value !== 'string' || !value) continue;
    if (containsIdentifierShapedDigits(value) || LABELED_PIN.test(value)) count += 1;
  }
  return count;
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

function backupInstant(value: unknown): number | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => unknown }).toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date.getTime();
  }
  return null;
}

function storedFieldMatches(field: string, original: string, stored: Record<string, unknown>): boolean {
  const value = stored[field];
  if (typeof value !== 'string' || !value) return false;
  if (organizerIdentifierKind(field)) {
    try {
      return isEncrypted(value) && decryptSensitive(value) === original;
    } catch {
      return false;
    }
  }
  if ((ORGANIZER_REDACTED_TEXT_FIELDS as readonly string[]).includes(field)) {
    return value === readOrganizerIdentifiers({ [field]: original }).organizer[field];
  }
  return false;
}

function emptyReport(mode: MigrationMode, projectId: string, encryptionKeyFingerprint: string): MigrationReport {
  return {
    mode, projectId, docsScanned: 0, docsNeedingUpdate: 0, fieldsByType: {}, notesFieldsMatched: 0,
    docsUpdated: 0, docsUnreadable: 0, writesPerformed: false, encryptionKeyFingerprint,
  };
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

async function openDb(options: MigrationRunOptions, projectId: string, env: NodeJS.ProcessEnv): Promise<{ db: MigrationDb; close?: () => Promise<void> }> {
  if (options.db) return { db: options.db };
  return (options.connect ?? ((id: string) => connectMigrationFirestore(id, env)))(projectId);
}

async function forEachDocument(
  db: MigrationDb, name: string, pageSize: number, resumeAfter: string | undefined,
  visit: (doc: MigrationDoc) => Promise<void>,
): Promise<void> {
  let cursor = resumeAfter;
  for (;;) {
    let query = db.collection(name).orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    for (const doc of snapshot.docs) {
      cursor = doc.id;
      await visit(doc);
    }
    if (snapshot.docs.length < pageSize) break;
  }
}

function prepareRun(options: MigrationRunOptions): {
  projectId: string; apply: boolean; purge: boolean; markVerified?: string; confirm?: string;
  env: NodeJS.ProcessEnv; pageSize: number; rateLimitMs: number; resumeAfter?: string;
  retentionDays?: number; encryptionKeyFingerprint: string; sleep: (ms: number) => Promise<void>; now: () => Date;
} {
  const projectId = options.projectId?.trim() ?? '';
  if (!projectId) throw new Error(`A Firebase project id is required. ${USAGE}`);
  const apply = options.apply === true;
  const purge = options.purgeBackups === true;
  const markVerified = options.markVerified?.trim() || undefined;
  if (options.markVerified !== undefined && !markVerified) throw new Error('--mark-verified needs a run id');
  const selected = [apply, purge, Boolean(markVerified)].filter(Boolean).length;
  if (selected > 1) throw new Error('Choose only one of --apply, --purge-backups, or --mark-verified');
  if (apply && options.confirm !== projectId) throw new Error('--apply requires --confirm to match the project id');
  if (purge && options.confirm !== undefined && options.confirm !== projectId) throw new Error('--purge-backups requires --confirm to match the project id');
  if (markVerified && options.confirm !== projectId) throw new Error('--mark-verified requires --confirm to match the project id');
  const pageSize = boundedInt(options.pageSize, DEFAULT_PAGE_SIZE, 1, 500, '--page-size');
  const rateLimitMs = boundedInt(options.rateLimitMs, DEFAULT_RATE_LIMIT_MS, 0, 60_000, '--rate-limit-ms');
  const retentionDays = purge || options.retentionDays !== undefined
    ? boundedInt(options.retentionDays, DEFAULT_RETENTION_DAYS, 1, 3650, '--retention-days')
    : undefined;
  const resumeAfter = options.resumeAfter?.trim() || undefined;
  if (options.resumeAfter !== undefined && !resumeAfter) throw new Error('--resume-after needs a document id');
  const env = options.env ?? process.env;
  const encryptionKeyFingerprint = releaseKeyFingerprint(env);
  const sleep = options.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? (() => new Date());
  return { projectId, apply, purge, markVerified, confirm: options.confirm, env, pageSize, rateLimitMs, resumeAfter, retentionDays, encryptionKeyFingerprint, sleep, now };
}

async function runPurge(options: MigrationRunOptions, prepared: ReturnType<typeof prepareRun>): Promise<MigrationReport> {
  const deleting = prepared.confirm === prepared.projectId;
  const report = emptyReport(deleting ? 'purge' : 'purge_dry_run', prepared.projectId, prepared.encryptionKeyFingerprint);
  report.retentionDays = prepared.retentionDays;
  report.backupsScanned = 0;
  report.backupsEligible = 0;
  report.backupsDeleted = 0;
  const cutoff = prepared.retentionDays! * DAY_MS;
  const opened = await openDb(options, prepared.projectId, prepared.env);
  try {
    await forEachDocument(opened.db, ORGANIZER_IDENTIFIER_BACKUP_COLLECTION, prepared.pageSize, prepared.resumeAfter, async doc => {
      report.backupsScanned = (report.backupsScanned ?? 0) + 1;
      const data = doc.data() ?? {};
      const instant = backupInstant(data.backedUpAt);
      const eligible = data.verified === true && instant !== null && prepared.now().getTime() - instant >= cutoff;
      if (!eligible) return;
      report.backupsEligible = (report.backupsEligible ?? 0) + 1;
      if (!deleting) return;
      if (prepared.rateLimitMs > 0) await prepared.sleep(prepared.rateLimitMs);
      await doc.ref.delete();
      report.backupsDeleted = (report.backupsDeleted ?? 0) + 1;
    });
  } finally {
    await opened.close?.();
  }
  report.writesPerformed = (report.backupsDeleted ?? 0) > 0;
  return report;
}

function backupFields(data: Record<string, unknown>): Record<string, string> | null {
  const fields = data.encryptedFields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const entries = Object.entries(fields as Record<string, unknown>);
  if (!entries.length || entries.some(([, value]) => typeof value !== 'string' || !value)) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

function backupMatches(data: Record<string, unknown>, organizer: Record<string, unknown>, fingerprint: string): boolean {
  if (typeof data.encryptionKeyFingerprint === 'string' && data.encryptionKeyFingerprint !== fingerprint) return false;
  const fields = backupFields(data);
  if (!fields) return false;
  for (const [field, ciphertext] of Object.entries(fields)) {
    let original: string;
    try {
      original = decryptSensitive(ciphertext);
    } catch {
      return false;
    }
    if (!storedFieldMatches(field, original, organizer)) return false;
  }
  return true;
}

async function runMarkVerified(options: MigrationRunOptions, prepared: ReturnType<typeof prepareRun>): Promise<MigrationReport> {
  const report = emptyReport('mark_verified', prepared.projectId, prepared.encryptionKeyFingerprint);
  report.backupsChecked = 0;
  report.backupsVerified = 0;
  report.backupsFailed = 0;
  const runId = prepared.markVerified!;
  const opened = await openDb(options, prepared.projectId, prepared.env);
  try {
    const matched: MigrationDoc[] = [];
    await forEachDocument(opened.db, ORGANIZER_IDENTIFIER_BACKUP_COLLECTION, prepared.pageSize, prepared.resumeAfter, async doc => {
      const data = doc.data() ?? {};
      if (data.runId === runId) matched.push(doc);
    });
    if (!matched.length) throw new Error('No backup run matched that id');
    const passing: MigrationDocRef[] = [];
    for (const doc of matched) {
      report.backupsChecked = (report.backupsChecked ?? 0) + 1;
      const data = doc.data() ?? {};
      const snapshot = await opened.db.collection(ORGANIZER_COLLECTION).doc(doc.id).get();
      const organizer = snapshot.exists ? snapshot.data() : undefined;
      if (organizer && backupMatches(data, organizer, prepared.encryptionKeyFingerprint)) passing.push(doc.ref);
      else report.backupsFailed = (report.backupsFailed ?? 0) + 1;
    }
    if ((report.backupsFailed ?? 0) > 0) return report;
    for (const ref of passing) {
      if (prepared.rateLimitMs > 0) await prepared.sleep(prepared.rateLimitMs);
      await ref.set({ verified: true }, { merge: true });
      report.backupsVerified = (report.backupsVerified ?? 0) + 1;
    }
  } finally {
    await opened.close?.();
  }
  report.writesPerformed = (report.backupsVerified ?? 0) > 0;
  return report;
}

export async function runMigration(options: MigrationRunOptions): Promise<MigrationReport> {
  const prepared = prepareRun(options);
  if (prepared.purge) return runPurge(options, prepared);
  if (prepared.markVerified) return runMarkVerified(options, prepared);
  const { projectId, apply, pageSize, rateLimitMs, resumeAfter, encryptionKeyFingerprint, sleep, now } = prepared;
  const report = emptyReport(apply ? 'apply' : 'dry_run', projectId, encryptionKeyFingerprint);
  let cursor = resumeAfter;
  let runId: string | undefined;
  const opened = await openDb(options, projectId, prepared.env);
  try {
    for (;;) {
      let query = opened.db.collection(ORGANIZER_COLLECTION).orderBy(FieldPath.documentId()).limit(pageSize);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      for (const doc of snapshot.docs) {
        report.docsScanned += 1;
        cursor = doc.id;
        const data = doc.data() ?? {};
        report.notesFieldsMatched += countMatchingNotes(data);
        let read: OrganizerIdentifierRead;
        try {
          read = readOrganizerIdentifiers(data);
        } catch {
          report.docsUnreadable += 1;
          continue;
        }
        const fields = legacyFields(read);
        if (!fields.length) continue;
        report.docsNeedingUpdate += 1;
        for (const field of fields) report.fieldsByType[fieldType(field)] = (report.fieldsByType[fieldType(field)] ?? 0) + 1;
        if (!apply) continue;
        if (rateLimitMs > 0) await sleep(rateLimitMs);
        let owner: { userId?: string };
        let encryptedFields: Record<string, string>;
        try {
          owner = backupOwner(data);
          encryptedFields = encryptOriginals(data, fields);
        } catch (error) {
          if (error instanceof Error && error.message === 'Backup refused a document with conflicting owner fields') {
            report.docsUnreadable += 1;
            continue;
          }
          throw new Error(`Migration stopped (${hashDocRef(doc.ref?.path || `${ORGANIZER_COLLECTION}/${doc.id}`)}): Backup encryption failed. Rerun the same command; documents already migrated are skipped.`);
        }
        try {
          runId ??= randomUUID();
          await opened.db.collection(ORGANIZER_IDENTIFIER_BACKUP_COLLECTION).doc(doc.id).set({
            encryptedFields, ...owner, backedUpAt: now(), runId, verified: false, encryptionKeyFingerprint,
          }, { merge: true });
          await doc.ref.set(organizerPatch(read, now()), { merge: true });
          report.docsUpdated += 1;
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
  report.writesPerformed = report.docsUpdated > 0;
  if (runId) report.runId = runId;
  return report;
}

function finishedLine(report: MigrationReport): string {
  switch (report.mode) {
    case 'dry_run':
      return 'Dry run only. No documents were written. Running this script needs the owner\'s explicit approval.';
    case 'apply':
      return 'Apply finished. Organizer documents changed only where legacy identifier fields were still present.';
    case 'purge_dry_run':
      return 'Purge dry run only. No documents were written. Running this script needs the owner\'s explicit approval.';
    case 'purge':
      return 'Purge finished. Verified backup documents older than the retention window were removed.';
    case 'mark_verified':
      return 'Verification finished. Backup documents for the run were marked verified.';
  }
}

export async function runMigrationCli(argv: string[], hooks: Omit<MigrationRunOptions, 'projectId' | 'apply' | 'purgeBackups' | 'confirm' | 'pageSize' | 'rateLimitMs' | 'resumeAfter' | 'retentionDays' | 'markVerified'> & {
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
} = {}): Promise<number> {
  const stdout = hooks.stdout ?? ((line: string) => console.log(line));
  const stderr = hooks.stderr ?? ((line: string) => console.error(line));
  try {
    const args = parseMigrationArgs(argv);
    const report = await runMigration({ ...hooks, ...args });
    stdout(formatMigrationReport(report));
    if ((report.backupsFailed ?? 0) > 0) {
      stderr('FAIL: Verification did not pass');
      return 1;
    }
    stdout(finishedLine(report));
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
