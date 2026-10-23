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
/** Shared wait for every read and write on the export path. */
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
   * Monotonic per user and tax year. Reserved when the file is served.
   * The record write stores this value and does not assign another one.
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
    charges: record.charges.map(charge => ({
      id: charge.id,
      line: charge.line,
      amount: charge.amount,
      ...(typeof charge.date === 'string' ? { date: charge.date } : {}),
      ...(typeof charge.merchant === 'string' ? { merchant: charge.merchant } : {}),
      ...(typeof charge.category === 'string' ? { category: charge.category } : {}),
      ...(typeof charge.contribution === 'number' ? { contribution: charge.contribution } : {}),
    })),
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
    const source = row as { id?: unknown; line?: unknown; amount?: unknown; date?: unknown; merchant?: unknown; category?: unknown; contribution?: unknown };
    if (typeof source.id !== 'string' || typeof source.line !== 'string' || typeof source.amount !== 'number') return [];
    if (source.date !== undefined && typeof source.date !== 'string') return [];
    if (source.merchant !== undefined && typeof source.merchant !== 'string') return [];
    if (source.category !== undefined && typeof source.category !== 'string') return [];
    if (source.contribution !== undefined && typeof source.contribution !== 'number') return [];
    return [{
      id: source.id,
      line: source.line,
      amount: source.amount,
      ...(typeof source.date === 'string' ? { date: source.date } : {}),
      ...(typeof source.merchant === 'string' ? { merchant: source.merchant } : {}),
      ...(typeof source.category === 'string' ? { category: source.category } : {}),
      ...(typeof source.contribution === 'number' ? { contribution: source.contribution } : {}),
    }];
  });
  if (lineTotals.length !== data.lineTotals.length || charges.length !== data.charges.length) return null;
  return { rulesVersion: data.rulesVersion, exportedAt: data.exportedAt, lineTotals, totalDeductible: data.totalDeductible, charges };
}

/**
 * Reserves the next sequence for this user and year. The counter read
 * finishes before the counter write. A commit that lands after the caller
 * has given up only moves the counter. It does not write a marker or a record.
 */
async function reserveExportSequence(uid: string, taxYear: number | null): Promise<number> {
  const counterRef = adminDb.collection(EXPORT_SEQUENCES).doc(sequenceDocId(uid, taxYear));
  return adminDb.runTransaction(async tx => {
    const counter = await tx.get(counterRef);
    const current = counter.exists ? assignedSequence(counter.data()?.next) ?? 0 : 0;
    const exportSequence = current + 1;
    tx.set(counterRef, { uid, taxYear, next: exportSequence });
    return exportSequence;
  });
}

/**
 * Waits up to 4 seconds for the sequence reservation. Failure and timeout
 * log one line and return immediately. Nothing else is written for this
 * download, so it cannot set or change the held total. A reservation that
 * commits after the wait leaves a sequence gap and no record.
 */
async function reserveExportSequenceWithin(uid: string, taxYear: number | null, exportId: string): Promise<number | null> {
  let settled = false;
  const attempt = reserveExportSequence(uid, taxYear);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.error('Export sequence reservation failed or timed out', exportId);
      resolve(null);
    }, EXPORT_RECORD_WRITE_TIMEOUT_MS);
    attempt.then(
      sequence => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(sequence);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.error('Export sequence reservation failed or timed out', exportId);
        resolve(null);
      },
    );
  });
}

/** Bounds one export read or write. The caller stops waiting when the timer fires. */
export function awaitExportStep<T>(work: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Schedule C export step timed out'));
    }, EXPORT_RECORD_WRITE_TIMEOUT_MS);
    work.then(
      value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Writes the pending marker after the file exists and before it is served. */
async function writeMarkerWithin(uid: string, taxYear: number | null, exportId: string, exportSequence: number): Promise<void> {
  let timedOut = false;
  const write = adminDb.collection(EXPORT_PENDING).doc(exportId).set({
    uid, taxYear, exportId, createdAt: new Date(), exportSequence,
  }).then(
    () => undefined,
    (error: unknown) => {
      if (timedOut) console.error('Pending export marker write failed after the write timed out and was unconfirmed', exportId, error);
      else throw error;
    },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new Error('Pending export marker write timed out'));
      }, EXPORT_RECORD_WRITE_TIMEOUT_MS);
      write.then(
        () => { clearTimeout(timer); resolve(); },
        (error: unknown) => { clearTimeout(timer); reject(error); },
      );
    });
  } catch (error) {
    if (timedOut) console.error('Pending export marker write timed out and is unconfirmed', exportId);
    else console.error('Pending export marker was not written', exportId, error);
  }
}

/**
 * Writes the record with the sequence reserved at serve time.
 * Deletes this export's marker and every marker for that user and year
 * whose reserved sequence is earlier than or equal to this one. A marker
 * with a higher sequence stays, so a newer export still in flight keeps
 * its marker. The pending query finishes before any write.
 */
async function writeExportRecord(record: ExportRecordDocument, exportId: string): Promise<void> {
  const recordRef = adminDb.collection(EXPORT_RECORDS).doc();
  const pendingRef = adminDb.collection(EXPORT_PENDING).doc(exportId);
  const pendingQuery = adminDb.collection(EXPORT_PENDING).where('uid', '==', record.uid).where('taxYear', '==', record.taxYear);
  await adminDb.runTransaction(async tx => {
    const pending = await tx.get(pendingQuery);
    const ownSequence = record.exportSequence;
    const clearing = new Set<string>();
    for (const doc of pending.docs) {
      if (doc.id === exportId) {
        clearing.add(doc.ref.path);
        continue;
      }
      const sequence = assignedSequence(doc.data()?.exportSequence);
      if (sequence !== null && sequence <= ownSequence) clearing.add(doc.ref.path);
    }
    tx.set(recordRef, plainDocument(record));
    for (const doc of pending.docs) {
      if (clearing.has(doc.ref.path)) tx.delete(doc.ref);
    }
    if (!clearing.has(pendingRef.path)) tx.delete(pendingRef);
  });
}

/**
 * Waits up to 4 seconds for the record transaction. On timeout the download
 * returns at once: the timeout writes nothing and awaits nothing further.
 * A commit that lands later may still clear the marker. A rejection after
 * that timeout is logged with the export id. A rejection inside the wait
 * is logged as failed.
 */
async function safeWriteExportRecord(record: ExportRecordDocument, exportId: string): Promise<void> {
  let timedOut = false;
  const write = writeExportRecord(record, exportId).then(
    () => {
      if (timedOut) console.error('Export record committed after the write timed out and was unconfirmed', exportId);
    },
    (error: unknown) => {
      if (timedOut) console.error('Export record write failed after the write timed out and was unconfirmed', exportId, error);
      else throw error;
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

/**
 * Reserves the serve time sequence, writes the marker, then writes the record.
 * The file is already built. A reservation failure or timeout logs one line
 * and writes nothing else, so this download cannot set or change the held total.
 * A reservation that commits after the timeout leaves a gap and no record.
 */
export async function recordServedExport(record: Omit<ExportRecordDocument, 'exportSequence'>): Promise<void> {
  const exportId = randomUUID();
  const exportSequence = await reserveExportSequenceWithin(record.uid, record.taxYear, exportId);
  if (exportSequence === null) return;
  await writeMarkerWithin(record.uid, record.taxYear, exportId, exportSequence);
  await safeWriteExportRecord({ ...record, exportSequence }, exportId);
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
    if (!parsed) {
      console.error('Malformed Schedule C export record', doc.id);
      continue;
    }
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
  try {
    return (await awaitExportStep(rankLatestExport(uid, year)))?.snapshot ?? null;
  } catch {
    console.error('Schedule C export record could not be read');
    return null;
  }
}

/**
 * A pending marker blocks a held year only when its reserved sequence is
 * higher than the latest confirmed record. A marker with no sequence counts
 * as older than any record written after it. While a newer marker remains,
 * callers must not compare the year with an older export. The file builder
 * still reads the stored record directly and does not use this null prior.
 */
export async function readHeldYearExport(uid: string, year: number): Promise<{ prior: ScheduleCExportSnapshot | null; latestExportUnrecorded: boolean }> {
  const pending = await adminDb.collection(EXPORT_PENDING).where('uid', '==', uid).where('taxYear', '==', year).get();
  const latest = await rankLatestExport(uid, year);
  const blocking = pending.docs.some(doc => {
    if (!latest) return true;
    const sequence = assignedSequence(doc.data()?.exportSequence);
    if (sequence === null) return false;
    if (latest.exportSequence === null) return true;
    return sequence > latest.exportSequence;
  });
  if (blocking) return { prior: null, latestExportUnrecorded: true };
  return { prior: latest?.snapshot ?? null, latestExportUnrecorded: false };
}

export async function loadFiledYearState(uid: string, year: number): Promise<{ prior: ScheduleCExportSnapshot | null; confirmedRulesVersion: string | null; latestExportUnrecorded: boolean }> {
  if (year >= currentCalendarYear()) return { prior: null, confirmedRulesVersion: null, latestExportUnrecorded: false };
  let failed = false;
  const fallback = <T>(value: T) => () => {
    failed = true;
    return value;
  };
  const [confirmation, recorded] = await Promise.all([
    awaitExportStep(readTaxYearConfirmation(uid, year)).catch(fallback(null)),
    awaitExportStep(readHeldYearExport(uid, year)).catch(fallback({ prior: null, latestExportUnrecorded: false })),
  ]);
  if (failed) console.error('Schedule C filed year state could not be read');
  const confirmedRulesVersion = confirmation?.rulesVersion ?? null;
  const held = shouldHoldYear(uid, year) && confirmedRulesVersion !== currentScheduleCRules().version;
  if (!held) return { prior: null, confirmedRulesVersion, latestExportUnrecorded: false };
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
