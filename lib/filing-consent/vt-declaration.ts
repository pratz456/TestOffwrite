import { adminDb } from '@/lib/firebase/admin';
import {
  FILING_HANDOFF_REFUSAL_LOG_COLLECTION,
  FILING_VT_DECLARATION_COLLECTION,
  PARTNER_RECIPIENT_LEGAL_NAMES,
} from './config';
import { filingConsentNow } from './clock';
import { refusal, type ConsentRefusal } from './record';

export interface VtDeclarationRecord {
  uid: string;
  taxYear: number;
  returnCode: 'VT';
  partnerLegalName: string;
  declaredAt: string;
  datedCopyReference: string;
}

export interface RecordVtDeclarationInput {
  uid: string;
  taxYear: number;
  returnCode: string;
  partnerLegalName: string;
  datedCopyReference: string;
}

const BLOCKED = 'The Vermont return is blocked and is not ready to transmit until the partner declaration for that return is on record.';

function blank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

export function vtDeclarationDocId(uid: string, taxYear: number, returnCode: string): string {
  return `${encodeURIComponent(uid)}__${taxYear}__${returnCode}`;
}

export function vtDeclarationCounts(
  data: Record<string, unknown> | undefined,
  expected: { uid: string; taxYear: number; returnCode: string; partnerLegalName: string },
): boolean {
  if (!data) return false;
  if (data.uid !== expected.uid) return false;
  if (data.taxYear !== expected.taxYear) return false;
  if (data.returnCode !== expected.returnCode || expected.returnCode !== 'VT') return false;
  if (data.partnerLegalName !== expected.partnerLegalName) return false;
  if (!PARTNER_RECIPIENT_LEGAL_NAMES.includes(expected.partnerLegalName)) return false;
  if (blank(data.declaredAt) || Number.isNaN(Date.parse(String(data.declaredAt)))) return false;
  if (blank(data.datedCopyReference)) return false;
  return true;
}

export async function recordPartnerVtDeclaration(
  input: RecordVtDeclarationInput,
): Promise<{ ok: true; id: string; declaredAt: string } | ConsentRefusal> {
  if (input.returnCode !== 'VT') {
    return refusal('vt_declaration_missing', 'The partner declaration is recorded for the Vermont return only.');
  }
  if (blank(input.uid) || typeof input.taxYear !== 'number' || !Number.isInteger(input.taxYear)) {
    return refusal('missing_field', 'The Vermont declaration needs an account and a tax year.');
  }
  if (!PARTNER_RECIPIENT_LEGAL_NAMES.includes(input.partnerLegalName)) {
    return refusal('recipient_not_legal_name', 'The declaration partner must be a legal name from the partner list.');
  }
  if (blank(input.datedCopyReference)) {
    return refusal('vt_declaration_missing', 'The partner declaration needs the reference to its dated copy.');
  }
  const id = vtDeclarationDocId(input.uid, input.taxYear, 'VT');
  const ref = adminDb.collection(FILING_VT_DECLARATION_COLLECTION).doc(id);
  const existing = await ref.get();
  if (existing.exists) {
    const data = existing.data() as Record<string, unknown> | undefined;
    if (!vtDeclarationCounts(data, {
      uid: input.uid,
      taxYear: input.taxYear,
      returnCode: 'VT',
      partnerLegalName: input.partnerLegalName,
    }) || !data) {
      return refusal('vt_declaration_missing', BLOCKED);
    }
    return { ok: true, id, declaredAt: String(data.declaredAt) };
  }
  const declaredAt = filingConsentNow().toISOString();
  const record: VtDeclarationRecord = {
    uid: input.uid,
    taxYear: input.taxYear,
    returnCode: 'VT',
    partnerLegalName: input.partnerLegalName,
    declaredAt,
    datedCopyReference: input.datedCopyReference,
  };
  await ref.create(record);
  return { ok: true, id, declaredAt };
}

async function logVtRefusal(entry: { uid: string; taxYear: number; returnCode: string; reason: string }): Promise<void> {
  await adminDb.collection(FILING_HANDOFF_REFUSAL_LOG_COLLECTION).doc().create({
    uid: entry.uid,
    taxYear: entry.taxYear,
    returnCode: entry.returnCode,
    reason: entry.reason,
  });
}

/**
 * Blocks a Vermont user's Vermont return until that return has a partner
 * declaration. Other returns are not blocked. The refusal log stores the
 * account, tax year, return code, and reason only.
 */
export async function vtHandOffRefusal(input: {
  residentState?: string;
  uid: string;
  partnerLegalName: string;
  returns: Array<{ code: string; taxYear: number }>;
}): Promise<ConsentRefusal | null> {
  if (input.residentState !== 'VT') return null;
  for (const item of input.returns) {
    if (item.code !== 'VT') continue;
    const snap = await adminDb.collection(FILING_VT_DECLARATION_COLLECTION).doc(
      vtDeclarationDocId(input.uid, item.taxYear, 'VT'),
    ).get();
    const data = snap.exists ? snap.data() as Record<string, unknown> | undefined : undefined;
    if (!vtDeclarationCounts(data, {
      uid: input.uid,
      taxYear: item.taxYear,
      returnCode: 'VT',
      partnerLegalName: input.partnerLegalName,
    })) {
      await logVtRefusal({
        uid: input.uid,
        taxYear: item.taxYear,
        returnCode: 'VT',
        reason: 'vt_declaration_missing',
      });
      return refusal('vt_declaration_missing', BLOCKED);
    }
  }
  return null;
}
