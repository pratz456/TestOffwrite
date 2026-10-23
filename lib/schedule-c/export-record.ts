/**
 * Admin SDK writes for Schedule C year confirmation and export snapshots.
 * Both collections are server only. Do not deploy these writes until the owner agrees.
 */

import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getFederalTaxRules } from '@/lib/tax-rules/federal-year-rules';
import {
  currentScheduleCRules,
  currentCalendarYear,
  scheduleCNow,
  shouldHoldYear,
  type ScheduleCExportSnapshot,
} from './filed-year';

export const TAX_YEAR_CONFIRMATIONS = 'user_tax_year_confirmations';
export const EXPORT_RECORDS = 'user_export_records';
/** Per user and year counter. Admin SDK only, same as the export records. */
export const EXPORT_SEQUENCES = 'user_export_sequences';
/** One document per export id until that export's record commits. Admin SDK only. */
export const EXPORT_PENDING = 'user_export_pending';
export const EXPORT_RECORD_WRITE_TIMEOUT_MS = 4000;

/**
 * Only schedule-c-pdf and schedule-c-csv are written. Those are the only
 * kinds read back as a held year's old total. A data export and a planning
 * PDF are not written, and they are not logged under their own kinds.
 * A record with a missing or unknown kind is ignored.
 */
export type ExportRecordKind = 'schedule-c-pdf' | 'schedule-c-csv';

export interface ExportRecordDocument extends ScheduleCExportSnapshot {
  uid: string;
  kind: ExportRecordKind;
  taxYear: number | null;
  exportedAt: string;
  sha256: string;
  /**
   * Monotonic per user and tax year. Assigned when the record is written.
   * Absent on records saved before sequences existed.
   */
  exportSequence: number;
}

export interface TaxYearConfirmation {
  uid: string;
  year: number;
  rulesVersion: string;
  confirmedAt: string;
}

const headers = { 'Cache-Control': 'private, no-store' };

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function plainDocument(record: ExportRecordDocument): ExportRecordDocument {
  return {
    uid: record.uid,
    kind: record.kind,
    taxYear: record.taxYear,
    rulesVersion: record.rulesVersion,
    exportedAt: record.exportedAt,
    lineTotals: record.lineTotals.map(row => ({ line: row.line, amount: row.amount })),
    totalDeductible: record.totalDeductible,
    charges: record.charges.map(charge => ({ id: charge.id, line: charge.line, amount: charge.amount })),
    sha256: record.sha256,
    exportSequence: record.exportSequence,
  };
}

function sequenceDocId(uid: string, year: number | null): string {
  return createHash('sha256').update(`${uid}\0${year ?? ''}`).digest('hex');
}

function assignedSequence(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function parseExportSnapshot(data: Record<string, unknown> | undefined): (ScheduleCExportSnapshot & { exportedAt: string }) | null {
  if (!data || typeof data.rulesVersion !== 'string' || typeof data.exportedAt !== 'string') return null;
  if (typeof data.totalDeductible !== 'number' || !Array.isArray(data.lineTotals) || !Array.isArray(data.charges)) return null;
  const lineTotals = data.lineTotals.flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const line = (row as { line?: unknown }).line;
    const amount = (row as { amount?: unknown }).amount;
    return typeof line === 'string' && typeof amount === 'number' ? [{ line, amount }] : [];
  });
  const charges = data.charges.flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const id = (row as { id?: unknown }).id;
    const line = (row as { line?: unknown }).line;
    const amount = (row as { amount?: unknown }).amount;
    return typeof id === 'string' && typeof line === 'string' && typeof amount === 'number' ? [{ id, line, amount }] : [];
  });
  if (lineTotals.length !== data.lineTotals.length || charges.length !== data.charges.length) return null;
  return { rulesVersion: data.rulesVersion, exportedAt: data.exportedAt, lineTotals, totalDeductible: data.totalDeductible, charges };
}

/** Milliseconds for a server Date or a Firestore Timestamp. Missing values stay unknown. */
function markerCreatedAtMillis(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const millis = (value as { toMillis: () => number }).toMillis();
    return typeof millis === 'number' && Number.isFinite(millis) ? millis : null;
  }
  return null;
}

/**
 * Writes the pending marker for this export id before the file is served.
 * createdAt is the server clock at that write. A marker write error is logged
 * and does not block the download.
 */
export async function beginPendingExport(uid: string, taxYear: number): Promise<string> {
  const exportId = randomUUID();
  try {
    await adminDb.collection(EXPORT_PENDING).doc(exportId).set({
      uid, taxYear, exportId, createdAt: new Date(),
    });
  } catch (error) {
    console.error('Pending export marker was not written', exportId, error);
  }
  return exportId;
}

/**
 * Assigns the next exportSequence for this user and year and writes the record.
 * The same transaction deletes this export's pending marker and every marker
 * for that user and year whose createdAt is earlier than or equal to this
 * export's marker. A marker created later stays, so a newer export still in
 * flight keeps its marker. The counter read and the pending query both finish
 * before any write. A late commit still clears the markers it owns, and
 * overlapping exports cannot share a sequence.
 */
async function writeExportRecord(record: Omit<ExportRecordDocument, 'exportSequence'>, exportId: string): Promise<void> {
  const counterRef = adminDb.collection(EXPORT_SEQUENCES).doc(sequenceDocId(record.uid, record.taxYear));
  const recordRef = adminDb.collection(EXPORT_RECORDS).doc();
  const pendingRef = adminDb.collection(EXPORT_PENDING).doc(exportId);
  const pendingQuery = adminDb.collection(EXPORT_PENDING).where('uid', '==', record.uid).where('taxYear', '==', record.taxYear);
  await adminDb.runTransaction(async tx => {
    const counter = await tx.get(counterRef);
    const pending = await tx.get(pendingQuery);
    const current = counter.exists ? assignedSequence(counter.data()?.next) ?? 0 : 0;
    const exportSequence = current + 1;
    const own = pending.docs.find(doc => doc.id === exportId);
    const ownCreatedAt = markerCreatedAtMillis(own?.data()?.createdAt);
    const clearing = new Set<string>();
    for (const doc of pending.docs) {
      if (doc.id === exportId) {
        clearing.add(doc.ref.path);
        continue;
      }
      if (ownCreatedAt === null) continue;
      const createdAt = markerCreatedAtMillis(doc.data()?.createdAt);
      if (createdAt !== null && createdAt <= ownCreatedAt) clearing.add(doc.ref.path);
    }
    tx.set(counterRef, { uid: record.uid, taxYear: record.taxYear, next: exportSequence });
    tx.set(recordRef, plainDocument({ ...record, exportSequence }));
    for (const doc of pending.docs) {
      if (clearing.has(doc.ref.path)) tx.delete(doc.ref);
    }
    if (!clearing.has(pendingRef.path)) tx.delete(pendingRef);
  });
}

/**
 * Waits up to 4 seconds for the record transaction. The download continues
 * either way. A timeout means the commit is unconfirmed: it may still land
 * and clear the pending marker. A rejected transaction is logged as failed.
 */
export async function safeWriteExportRecord(record: Omit<ExportRecordDocument, 'exportSequence'>, exportId: string): Promise<void> {
  let timedOut = false;
  const write = writeExportRecord(record, exportId).then(
    () => {
      if (timedOut) console.error('Export record committed after the write timed out and was unconfirmed', exportId);
    },
    (error: unknown) => {
      if (!timedOut) throw error;
    },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new Error('Export record write timed out'));
      }, EXPORT_RECORD_WRITE_TIMEOUT_MS);
      write.then(
        () => { clearTimeout(timer); resolve(); },
        (error: unknown) => { clearTimeout(timer); reject(error); },
      );
    });
  } catch (error) {
    if (timedOut) console.error('Export record write timed out and is unconfirmed', exportId);
    else console.error('Export record write failed', error);
  }
}

export async function readTaxYearConfirmation(uid: string, year: number): Promise<TaxYearConfirmation | null> {
  const doc = await adminDb.collection(TAX_YEAR_CONFIRMATIONS).doc(`${uid}_${year}`).get();
  if (!doc.exists) return null;
  const data = doc.data() ?? {};
  if (data.uid !== uid || data.year !== year || typeof data.rulesVersion !== 'string') return null;
  return { uid, year, rulesVersion: data.rulesVersion, confirmedAt: typeof data.confirmedAt === 'string' ? data.confirmedAt : '' };
}

/** Kinds that may serve as the held year's old total. */
const SCHEDULE_C_EXPORT_KINDS = new Set<ExportRecordKind>(['schedule-c-pdf', 'schedule-c-csv']);

interface RankedExport {
  snapshot: ScheduleCExportSnapshot;
  exportedAt: string;
  id: string;
  exportSequence: number | null;
}

/**
 * A sequenced record outranks one without a sequence. The higher sequence wins.
 * An equal sequence keeps the greater document id.
 * Records with no sequence are ordered by exportedAt. When two of those share
 * an export time, the record with the higher document id wins. That order is
 * fixed but not chronological, because Firestore document ids are random.
 */
function preferExport(candidate: RankedExport, current: RankedExport): boolean {
  const left = candidate.exportSequence;
  const right = current.exportSequence;
  if (left !== null || right !== null) {
    if (left === null) return false;
    if (right === null) return true;
    if (left !== right) return left > right;
    return candidate.id > current.id;
  }
  if (candidate.exportedAt !== current.exportedAt) return candidate.exportedAt > current.exportedAt;
  return candidate.id > current.id;
}

async function rankLatestExport(uid: string, year: number): Promise<RankedExport | null> {
  const snap = await adminDb.collection(EXPORT_RECORDS).where('uid', '==', uid).where('taxYear', '==', year).get();
  let latest: RankedExport | null = null;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (typeof data.kind !== 'string' || !SCHEDULE_C_EXPORT_KINDS.has(data.kind as ExportRecordKind)) continue;
    const parsed = parseExportSnapshot(data);
    if (!parsed) continue;
    const candidate: RankedExport = {
      snapshot: { rulesVersion: parsed.rulesVersion, lineTotals: parsed.lineTotals, totalDeductible: parsed.totalDeductible, charges: parsed.charges },
      exportedAt: parsed.exportedAt,
      id: typeof doc.id === 'string' ? doc.id : '',
      exportSequence: assignedSequence(data.exportSequence),
    };
    if (!latest || preferExport(candidate, latest)) latest = candidate;
  }
  return latest;
}

export async function readLatestExportRecord(uid: string, year: number): Promise<ScheduleCExportSnapshot | null> {
  return (await rankLatestExport(uid, year))?.snapshot ?? null;
}

/**
 * A pending marker blocks a held year only when it is newer than the latest
 * confirmed export for that user and year. A marker whose createdAt is older
 * than that record's exportedAt is ignored, and a marker with no createdAt
 * counts as older than any record written after it. While a newer marker
 * remains, callers must not compare the year with an older export.
 */
export async function readHeldYearExport(uid: string, year: number): Promise<{ prior: ScheduleCExportSnapshot | null; latestExportUnrecorded: boolean }> {
  const pending = await adminDb.collection(EXPORT_PENDING).where('uid', '==', uid).where('taxYear', '==', year).get();
  const latest = await rankLatestExport(uid, year);
  const latestExportedAt = latest ? Date.parse(latest.exportedAt) : Number.NaN;
  const blocking = pending.docs.some(doc => {
    if (!latest || !Number.isFinite(latestExportedAt)) return true;
    const createdAt = markerCreatedAtMillis(doc.data()?.createdAt);
    if (createdAt === null) return false;
    return createdAt > latestExportedAt;
  });
  if (blocking) return { prior: null, latestExportUnrecorded: true };
  return { prior: latest?.snapshot ?? null, latestExportUnrecorded: false };
}

export async function loadFiledYearState(uid: string, year: number): Promise<{ prior: ScheduleCExportSnapshot | null; confirmedRulesVersion: string | null; latestExportUnrecorded: boolean }> {
  if (year >= currentCalendarYear()) return { prior: null, confirmedRulesVersion: null, latestExportUnrecorded: false };
  const confirmation = await readTaxYearConfirmation(uid, year);
  const confirmedRulesVersion = confirmation?.rulesVersion ?? null;
  const held = shouldHoldYear(uid, year) && confirmedRulesVersion !== currentScheduleCRules().version;
  if (!held) return { prior: null, confirmedRulesVersion, latestExportUnrecorded: false };
  const recorded = await readHeldYearExport(uid, year);
  return { prior: recorded.prior, confirmedRulesVersion, latestExportUnrecorded: recorded.latestExportUnrecorded };
}

export async function confirmTaxYear(request: NextRequest): Promise<NextResponse> {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers }); }
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const requested = record.uid ?? record.userId;
  if (requested !== undefined && requested !== user.uid) {
    return NextResponse.json({ error: 'You can confirm only your own tax year.' }, { status: 403, headers });
  }
  const year = typeof record.year === 'number' || (typeof record.year === 'string' && /^\d{4}$/.test(record.year)) ? Number(record.year) : NaN;
  try { getFederalTaxRules(year); } catch { return NextResponse.json({ error: 'Choose a supported tax year.' }, { status: 400, headers }); }
  const rulesVersion = currentScheduleCRules().version;
  const confirmedAt = scheduleCNow().toISOString();
  const confirmation: TaxYearConfirmation = { uid: user.uid, year, rulesVersion, confirmedAt };
  await adminDb.collection(TAX_YEAR_CONFIRMATIONS).doc(`${user.uid}_${year}`).set(confirmation);
  return NextResponse.json(confirmation, { headers });
}
