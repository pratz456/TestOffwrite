import { adminDb } from '@/lib/firebase/admin';
import { isValidTimeZone } from '@/lib/openai/consent-contract';
import { BANK_CONSENT_REQUIRED_ERROR } from './bank-consent-copy';
import { parseConsentRecord } from './consents';

export class BankConsentRequiredError extends Error {
  readonly status = 403;
  readonly code = 'CONSENT_REQUIRED';
  constructor() {
    super(BANK_CONSENT_REQUIRED_ERROR);
    this.name = 'BankConsentRequiredError';
  }
}

export class BankConsentInputError extends Error {
  readonly status = 400;
  constructor() {
    super('Send a supported consent action.');
    this.name = 'BankConsentInputError';
  }
}

export function isBankConsentRequired(error: unknown): error is BankConsentRequiredError {
  return error instanceof BankConsentRequiredError;
}

export function isBankConsentInput(error: unknown): error is BankConsentInputError {
  return error instanceof BankConsentInputError;
}

export const BANK_CONSENT_REQUIRED_BODY = { code: 'CONSENT_REQUIRED' as const, error: BANK_CONSENT_REQUIRED_ERROR };

export async function hasBankDataConsent(uid: string): Promise<boolean> {
  const snapshot = await adminDb.doc(`user_profiles/${uid}`).get();
  return parseConsentRecord(snapshot.data()?.consents)?.bank_data === true;
}

export async function requireBankDataConsent(uid: string): Promise<void> {
  if (!(await hasBankDataConsent(uid))) throw new BankConsentRequiredError();
}

export async function readBankConsentStatus(uid: string): Promise<{ bank_data: boolean; timeZone: string | null; bank_data_signed_at: string | null }> {
  const snapshot = await adminDb.doc(`user_profiles/${uid}`).get();
  const record = parseConsentRecord(snapshot.data()?.consents);
  return {
    bank_data: record?.bank_data === true,
    timeZone: record?.timeZone ?? null,
    bank_data_signed_at: record?.bank_data_signed_at ?? null,
  };
}

/** Dotted update: bank_data, its own timestamp, and the signing zone. Other consents stay as stored. */
export async function grantBankDataConsent(uid: string, timeZone: string, now = new Date()): Promise<{ bank_data: true; timeZone: string; bank_data_signed_at: string }> {
  const zone = timeZone.trim();
  if (!isValidTimeZone(zone)) throw new BankConsentInputError();
  const ref = adminDb.doc(`user_profiles/${uid}`);
  const snapshot = await ref.get();
  if (!parseConsentRecord(snapshot.data()?.consents)) throw new BankConsentInputError();
  const bank_data_signed_at = now.toISOString();
  await ref.update({
    'consents.bank_data': true,
    'consents.bank_data_signed_at': bank_data_signed_at,
    'consents.timeZone': zone,
  });
  return { bank_data: true, timeZone: zone, bank_data_signed_at };
}

/** Stops new syncs. Does not delete transactions, bank items, or any other consent field. */
export async function withdrawBankDataConsent(uid: string, now = new Date()): Promise<{ bank_data: false; bank_data_withdrawn_at: string }> {
  const ref = adminDb.doc(`user_profiles/${uid}`);
  const snapshot = await ref.get();
  if (!parseConsentRecord(snapshot.data()?.consents)) throw new BankConsentInputError();
  const bank_data_withdrawn_at = now.toISOString();
  await ref.update({
    'consents.bank_data': false,
    'consents.bank_data_withdrawn_at': bank_data_withdrawn_at,
  });
  return { bank_data: false, bank_data_withdrawn_at };
}
