/**
 * Admin SDK writes for Schedule C year confirmation and export snapshots.
 * Both collections are server only. Do not deploy these writes until the owner agrees.
 */

import { createHash } from 'node:crypto';
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

/**
 * Assigns the next exportSequence for this user and year, then writes the
 * record. Both happen in one transaction, so overlapping exports cannot
 * take the same number.
 */
async function writeExportRecord(record: Omit<ExportRecordDocument, 'exportSequence'>): Promise<void> {
  const counterRef = adminDb.collection(EXPORT_SEQUENCES).doc(sequenceDocId(record.uid, record.taxYear));
  const recordRef = adminDb.collection(EXPORT_RECORDS).doc();
  await adminDb.runTransaction(async tx => {
    const counter = await tx.get(counterRef);
    const current = counter.exists ? assignedSequence(counter.data()?.next) ?? 0 : 0;
    const exportSequence = current + 1;
    tx.set(counterRef, { uid: record.uid, taxYear: record.taxYear, next: exportSequence });
    tx.set(recordRef, plainDocument({ ...record, exportSequence }));
  });
}

/** Writing the record must never fail the download. */
export async function safeWriteExportRecord(record: Omit<ExportRecordDocument, 'exportSequence'>): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Export record write timed out')), 4000);
      writeExportRecord(record).then(
        () => { clearTimeout(timer); resolve(); },
        (error: unknown) => { clearTimeout(timer); reject(error); },
      );
    });
  } catch (error) {
    console.error('Export record write failed', error);
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

export async function readLatestExportRecord(uid: string, year: number): Promise<ScheduleCExportSnapshot | null> {
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
  return latest?.snapshot ?? null;
}

export async function loadFiledYearState(uid: string, year: number): Promise<{ prior: ScheduleCExportSnapshot | null; confirmedRulesVersion: string | null }> {
  if (year >= currentCalendarYear()) return { prior: null, confirmedRulesVersion: null };
  const confirmation = await readTaxYearConfirmation(uid, year);
  const confirmedRulesVersion = confirmation?.rulesVersion ?? null;
  const held = shouldHoldYear(uid, year) && confirmedRulesVersion !== currentScheduleCRules().version;
  const prior = held ? await readLatestExportRecord(uid, year) : null;
  return { prior, confirmedRulesVersion };
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
