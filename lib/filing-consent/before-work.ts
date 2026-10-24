import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/firebase/admin';
import {
  FEE_ESTIMATE_PHRASE,
  FILING_BEFORE_WORK_DISCLOSURE_COLLECTION,
  currentDraftPartnerDisclosureCopy,
  partnerRecipientLegalNames,
} from './config';
import { filingConsentNow } from './clock';
import { refusal, type ConsentRefusal } from './record';

export type BeforeWorkResidentState = 'CT' | 'CA';

/** Partner copy the before work screen shows. The warranty is copied, not rewritten. */
export interface PartnerBeforeWorkCopy {
  partnerFirmLegalName: string;
  signingEaName: string;
  signingEaPtin: string;
  principalBusinessAddress: string;
  primaryBusinessPhone: string;
  feeEstimateOfTotalCharge: string;
  securityWarranty: string;
}

/**
 * Screen model shown before preparation starts. Print and save are flags on
 * the model. This slice does not wire them to a page.
 */
export interface BeforeWorkDisclosureScreen extends PartnerBeforeWorkCopy {
  residentState: BeforeWorkResidentState;
  printOffered: true;
  saveOffered: true;
}

export interface BeforeWorkDisclosureRecord extends BeforeWorkDisclosureScreen {
  uid: string;
  taxYear: number;
  partnerId: string;
  shownAt: string;
}

export interface RecordBeforeWorkDisclosureInput {
  uid: string;
  taxYear: number;
  residentState: string;
  partnerId: string;
}

function configuredCopy(partnerId: string): PartnerBeforeWorkCopy {
  const copy = currentDraftPartnerDisclosureCopy();
  return {
    partnerFirmLegalName: partnerId,
    signingEaName: copy.signingEaName,
    signingEaPtin: copy.signingEaPtin,
    principalBusinessAddress: copy.principalBusinessAddress,
    primaryBusinessPhone: copy.primaryBusinessPhone,
    feeEstimateOfTotalCharge: copy.feeEstimateOfTotalCharge,
    securityWarranty: copy.securityWarranty,
  };
}

function blank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

export function isBeforeWorkResidentState(state: string): state is BeforeWorkResidentState {
  return state === 'CT' || state === 'CA';
}

/**
 * Builds the before work screen from partner copy. Returns null when the state
 * is not Connecticut or California, or when any required partner string is
 * missing. The warranty is the partner string unchanged.
 */
export function assembleBeforeWorkDisclosureScreen(
  residentState: string,
  copy: PartnerBeforeWorkCopy,
): BeforeWorkDisclosureScreen | null {
  if (!isBeforeWorkResidentState(residentState)) return null;
  if (blank(copy.partnerFirmLegalName)) return null;
  if (blank(copy.signingEaName)) return null;
  if (blank(copy.signingEaPtin)) return null;
  if (blank(copy.principalBusinessAddress)) return null;
  if (blank(copy.primaryBusinessPhone)) return null;
  if (blank(copy.feeEstimateOfTotalCharge) || !copy.feeEstimateOfTotalCharge.includes(FEE_ESTIMATE_PHRASE)) return null;
  if (blank(copy.securityWarranty)) return null;
  return {
    residentState,
    partnerFirmLegalName: copy.partnerFirmLegalName,
    signingEaName: copy.signingEaName,
    signingEaPtin: copy.signingEaPtin,
    principalBusinessAddress: copy.principalBusinessAddress,
    primaryBusinessPhone: copy.primaryBusinessPhone,
    feeEstimateOfTotalCharge: copy.feeEstimateOfTotalCharge,
    securityWarranty: copy.securityWarranty,
    printOffered: true,
    saveOffered: true,
  };
}

export function buildBeforeWorkDisclosureScreen(residentState: string, partnerId?: string): BeforeWorkDisclosureScreen | null {
  const id = partnerId ?? partnerRecipientLegalNames()[0] ?? '';
  return assembleBeforeWorkDisclosureScreen(residentState, configuredCopy(id));
}

/**
 * Stable hash of the exact screen fields shown. The partner id is a separate key part.
 * Address, phone, fee, and warranty are screen fields. A change refuses the hand off
 * until this screen is recorded again. The disclosure consent stays in force for the
 * same partner. A change to the consent's stated purpose is not a screen change and
 * requires a new consent.
 */
export function beforeWorkScreenHash(screen: PartnerBeforeWorkCopy & { printOffered: boolean; saveOffered: boolean }): string {
  const canonical = JSON.stringify({
    feeEstimateOfTotalCharge: screen.feeEstimateOfTotalCharge,
    partnerFirmLegalName: screen.partnerFirmLegalName,
    primaryBusinessPhone: screen.primaryBusinessPhone,
    principalBusinessAddress: screen.principalBusinessAddress,
    printOffered: screen.printOffered,
    saveOffered: screen.saveOffered,
    securityWarranty: screen.securityWarranty,
    signingEaName: screen.signingEaName,
    signingEaPtin: screen.signingEaPtin,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function beforeWorkDisclosureDocId(
  uid: string,
  taxYear: number,
  residentState: string,
  partnerId: string,
  screenHash: string,
): string {
  return `${encodeURIComponent(uid)}__${taxYear}__${residentState}__${encodeURIComponent(partnerId)}__${screenHash}`;
}

function mismatch(stored: unknown, expected: string, message: string): string | null {
  if (typeof stored !== 'string' || stored !== expected) return message;
  return null;
}

/**
 * Why a stored screen cannot open the hand off, or null when the stored screen
 * matches the current partner copy. Address, phone, fee estimate wording, and
 * the warranty are each required. The warranty must be the partner string.
 */
export function beforeWorkDisclosureGap(data: Record<string, unknown> | undefined, partnerId?: string): string | null {
  const copy = configuredCopy(partnerId ?? partnerRecipientLegalNames()[0] ?? '');
  if (!assembleBeforeWorkDisclosureScreen('CT', copy)) {
    return 'The partner before work disclosure is missing a required item.';
  }
  if (!data) return 'The before work disclosure screen has not been recorded.';
  if (blank(data.shownAt) || Number.isNaN(Date.parse(String(data.shownAt)))) {
    return 'The before work disclosure screen has not been recorded.';
  }
  return (
    mismatch(data.partnerId, copy.partnerFirmLegalName, 'The before work disclosure is missing the partner firm name.')
    ?? mismatch(data.partnerFirmLegalName, copy.partnerFirmLegalName, 'The before work disclosure is missing the partner firm name.')
    ?? mismatch(data.signingEaName, copy.signingEaName, 'The before work disclosure is missing the signing enrolled agent name.')
    ?? mismatch(data.signingEaPtin, copy.signingEaPtin, 'The before work disclosure is missing the signing enrolled agent PTIN.')
    ?? mismatch(data.principalBusinessAddress, copy.principalBusinessAddress, 'The before work disclosure is missing the principal business address.')
    ?? mismatch(data.primaryBusinessPhone, copy.primaryBusinessPhone, 'The before work disclosure is missing the primary business phone.')
    ?? (typeof data.feeEstimateOfTotalCharge !== 'string' || !data.feeEstimateOfTotalCharge.includes(FEE_ESTIMATE_PHRASE)
      ? 'The before work disclosure fee is not an estimate of the total charge.'
      : null)
    ?? mismatch(data.feeEstimateOfTotalCharge, copy.feeEstimateOfTotalCharge, 'The before work disclosure fee is not an estimate of the total charge.')
    ?? mismatch(data.securityWarranty, copy.securityWarranty, 'The before work disclosure warranty does not match the partner warranty.')
    ?? (data.printOffered === true ? null : 'The before work disclosure does not offer print.')
    ?? (data.saveOffered === true ? null : 'The before work disclosure does not offer save.')
  );
}

export async function recordBeforeWorkDisclosureShown(
  input: RecordBeforeWorkDisclosureInput,
): Promise<{ ok: true; id: string; screen: BeforeWorkDisclosureScreen; shownAt: string } | ConsentRefusal> {
  if (blank(input.partnerId) || !partnerRecipientLegalNames().includes(input.partnerId)) {
    return refusal('recipient_not_legal_name', 'The before work disclosure partner must be a legal name from the partner list.');
  }
  const screen = buildBeforeWorkDisclosureScreen(input.residentState, input.partnerId);
  if (!screen) {
    return refusal('before_work_disclosure_missing', 'The before work disclosure screen is missing a required item.');
  }
  if (blank(input.uid) || typeof input.taxYear !== 'number' || !Number.isInteger(input.taxYear)) {
    return refusal('missing_field', 'The before work disclosure needs an account and a tax year.');
  }
  const id = beforeWorkDisclosureDocId(
    input.uid,
    input.taxYear,
    screen.residentState,
    input.partnerId,
    beforeWorkScreenHash(screen),
  );
  const ref = adminDb.collection(FILING_BEFORE_WORK_DISCLOSURE_COLLECTION).doc(id);
  const existing = await ref.get();
  if (existing.exists) {
    const data = existing.data() as Record<string, unknown> | undefined;
    const gap = beforeWorkDisclosureGap(data, input.partnerId);
    if (gap || !data || data.uid !== input.uid || data.taxYear !== input.taxYear || data.residentState !== screen.residentState) {
      return refusal('before_work_disclosure_missing', gap ?? 'The before work disclosure screen has not been recorded.');
    }
    return {
      ok: true,
      id,
      screen,
      shownAt: String(data.shownAt),
    };
  }
  const shownAt = filingConsentNow().toISOString();
  const record: BeforeWorkDisclosureRecord = {
    uid: input.uid,
    taxYear: input.taxYear,
    partnerId: input.partnerId,
    shownAt,
    ...screen,
  };
  try {
    await ref.create(record);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('Document exists')) throw error;
    const raced = await ref.get();
    const racedData = raced.data() as Record<string, unknown> | undefined;
    if (!racedData || typeof racedData.shownAt !== 'string') {
      return refusal('before_work_disclosure_missing', 'The before work disclosure screen has not been recorded.');
    }
    return { ok: true, id, screen, shownAt: racedData.shownAt };
  }
  return { ok: true, id, screen, shownAt };
}

export async function beforeWorkHandOffRefusal(input: {
  residentState?: string;
  uid: string;
  taxYear: number;
  partnerId: string;
}): Promise<ConsentRefusal | null> {
  if (input.residentState !== 'CT' && input.residentState !== 'CA') return null;
  const screen = buildBeforeWorkDisclosureScreen(input.residentState, input.partnerId);
  if (!screen) {
    return refusal('before_work_disclosure_missing', 'The partner before work disclosure is missing a required item.');
  }
  const ref = adminDb.collection(FILING_BEFORE_WORK_DISCLOSURE_COLLECTION).doc(
    beforeWorkDisclosureDocId(input.uid, input.taxYear, input.residentState, input.partnerId, beforeWorkScreenHash(screen)),
  );
  const snap = await ref.get();
  const data = snap.exists ? snap.data() as Record<string, unknown> | undefined : undefined;
  if (!data || data.uid !== input.uid || data.taxYear !== input.taxYear || data.residentState !== input.residentState || data.partnerId !== input.partnerId) {
    return refusal('before_work_disclosure_missing', 'The before work disclosure screen has not been recorded.');
  }
  const gap = beforeWorkDisclosureGap(data, input.partnerId);
  if (gap) return refusal('before_work_disclosure_missing', gap);
  return null;
}
