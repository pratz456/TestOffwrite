// Server transport only: importing a Node built-in also prevents a client bundle.
import { Buffer } from 'node:buffer';

export interface ColumnClientConfig {
  environment: 'sandbox' | 'production';
  clientId: string;
  clientSecret: string;
  /** Local season guard only. Column initialize has no tax_year parameter. */
  taxYear?: number;
  timeoutMs?: number;
}

export interface ColumnUserMetadata {
  password_changed_date: string | null;
  account_locked_date: string | null;
  passed_mfa_at_this_login: boolean;
  failed_login_attempts: number;
  cell_phone_changed_date: string | null;
  email_changed_date: string | null;
}

export interface ColumnInitializeInput {
  userIdentifier: string;
  email: string;
  metadata: ColumnUserMetadata;
}

export type ColumnUserStatus = 'not_started' | 'started' | 'submitted' | 'unknown';
export type ColumnSubmissionStatus = 'not_submitted' | 'submitted' | 'accepted' | 'retryable' | 'rejected' | 'unknown';
export interface ColumnTaxReturn {
  taxYear: number;
  status: ColumnUserStatus;
  jurisdictions: Array<{ jurisdiction: string; submissionStatus: ColumnSubmissionStatus }>;
}

export type ColumnClientErrorCode =
  | 'COLUMN_SERVER_ONLY' | 'COLUMN_CONFIGURATION_INVALID' | 'COLUMN_METADATA_REQUIRED'
  | 'COLUMN_INPUT_INVALID' | 'COLUMN_TIMEOUT' | 'COLUMN_PROVIDER_UNAVAILABLE'
  | 'COLUMN_PROVIDER_REJECTED' | 'COLUMN_RESPONSE_INVALID' | 'COLUMN_DATA_REJECTED';

const ERROR_MESSAGES: Record<ColumnClientErrorCode, string> = {
  COLUMN_SERVER_ONLY: 'Filing provider requests must run on the server.',
  COLUMN_CONFIGURATION_INVALID: 'Filing provider configuration is incomplete or invalid.',
  COLUMN_METADATA_REQUIRED: 'Verified security information for this sign-in is required before filing can start.',
  COLUMN_INPUT_INVALID: 'Filing account information or the requested tax year is invalid.',
  COLUMN_TIMEOUT: 'The filing provider did not respond in time. Please try again.',
  COLUMN_PROVIDER_UNAVAILABLE: 'The filing provider is temporarily unavailable. Please try again.',
  COLUMN_PROVIDER_REJECTED: 'The filing provider could not complete this request. Please contact support.',
  COLUMN_RESPONSE_INVALID: 'The filing provider returned an unexpected response. Please contact support.',
  COLUMN_DATA_REJECTED: 'The filing provider did not accept all account information. Please contact support before continuing.',
};

/** Never attaches provider bodies, URLs, credentials, metadata, or the original error. */
export class ColumnClientError extends Error {
  constructor(public readonly code: ColumnClientErrorCode, public readonly providerStatus?: number) {
    super(ERROR_MESSAGES[code]);
    this.name = 'ColumnClientError';
  }
}

const BASE_URLS = { sandbox: 'https://sandbox.columnapi.com', production: 'https://prod.columnapi.com' } as const;
const MODULE_HOSTS = { sandbox: 'app-sandbox.columnapi.com', production: 'app.columnapi.com' } as const;
const DATE_FIELDS = ['password_changed_date', 'account_locked_date', 'cell_phone_changed_date', 'email_changed_date'] as const;
const METADATA_FIELDS = [...DATE_FIELDS, 'passed_mfa_at_this_login', 'failed_login_attempts'];
const USER_STATUSES = new Set(['not_started', 'started', 'submitted']);
const SUBMISSION_STATUSES = new Set(['not_submitted', 'submitted', 'accepted', 'retryable', 'rejected']);
const MAX_RESPONSE_BYTES = 1024 * 1024;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validYear = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1900 && Number(value) <= 2100;

function validDate(value: unknown): value is string | null {
  // null means a verified "never changed/locked", not missing historical data.
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Shape validation cannot establish truth: callers must source these facts server-side. */
export function validateColumnMetadata(value: unknown): ColumnUserMetadata {
  if (!isRecord(value) || Object.keys(value).length !== METADATA_FIELDS.length
    || !METADATA_FIELDS.every(key => Object.prototype.hasOwnProperty.call(value, key))
    || !DATE_FIELDS.every(key => validDate(value[key]))
    || typeof value.passed_mfa_at_this_login !== 'boolean'
    || !Number.isSafeInteger(value.failed_login_attempts) || Number(value.failed_login_attempts) < 0) {
    throw new ColumnClientError('COLUMN_METADATA_REQUIRED');
  }
  return {
    password_changed_date: value.password_changed_date as string | null,
    account_locked_date: value.account_locked_date as string | null,
    passed_mfa_at_this_login: value.passed_mfa_at_this_login,
    failed_login_attempts: value.failed_login_attempts as number,
    cell_phone_changed_date: value.cell_phone_changed_date as string | null,
    email_changed_date: value.email_changed_date as string | null,
  };
}

function validateIdentifier(value: unknown): asserts value is string {
  // Opaque app identifiers only; never email, SSN, path, URL, or traversal input.
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new ColumnClientError('COLUMN_INPUT_INVALID');
}

function validateConfig(config: ColumnClientConfig): void {
  if (typeof window !== 'undefined') throw new ColumnClientError('COLUMN_SERVER_ONLY');
  if (!config || !Object.prototype.hasOwnProperty.call(BASE_URLS, config.environment)
    || typeof config.clientId !== 'string' || !config.clientId || config.clientId.length > 2048 || /[:\s]/.test(config.clientId)
    || typeof config.clientSecret !== 'string' || !config.clientSecret || config.clientSecret.length > 4096 || /[\r\n]/.test(config.clientSecret)
    || (config.taxYear !== undefined && !validYear(config.taxYear))
    || (config.timeoutMs !== undefined && (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 30000))) {
    throw new ColumnClientError('COLUMN_CONFIGURATION_INVALID');
  }
}

async function request(config: ColumnClientConfig, path: string, method: 'GET' | 'POST', body: unknown, fetchImpl: typeof fetch): Promise<unknown> {
  validateConfig(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 10000);
  try {
    const response = await fetchImpl(`${BASE_URLS[config.environment]}${path}`, {
      method,
      headers: { Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`, Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      redirect: 'error', cache: 'no-store', credentials: 'omit', signal: controller.signal,
    });
    // Reject redirects even if an injected transport failed to obey redirect:error.
    if (response.redirected || (response.status >= 300 && response.status < 400)) throw new ColumnClientError('COLUMN_RESPONSE_INVALID');
    if (!response.ok) throw new ColumnClientError(response.status === 429 || response.status >= 500 ? 'COLUMN_PROVIDER_UNAVAILABLE' : 'COLUMN_PROVIDER_REJECTED', response.status);
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
      || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new ColumnClientError('COLUMN_RESPONSE_INVALID');
    const content = await response.text();
    if (Buffer.byteLength(content, 'utf8') > MAX_RESPONSE_BYTES) throw new ColumnClientError('COLUMN_RESPONSE_INVALID');
    try { return JSON.parse(content); } catch { throw new ColumnClientError('COLUMN_RESPONSE_INVALID'); }
  } catch (error) {
    if (error instanceof ColumnClientError) throw error;
    throw new ColumnClientError(controller.signal.aborted ? 'COLUMN_TIMEOUT' : 'COLUMN_PROVIDER_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

/** Minimal account/session handoff only; deliberately excludes one-time tax/ledger prefill. */
export async function initializeColumnFiling(config: ColumnClientConfig, input: ColumnInitializeInput, fetchImpl: typeof fetch = fetch): Promise<{ userUrl: string }> {
  validateConfig(config);
  validateIdentifier(input?.userIdentifier);
  if (typeof input.email !== 'string' || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new ColumnClientError('COLUMN_INPUT_INVALID');
  const metadata = validateColumnMetadata(input.metadata);
  const data = await request(config, '/v1/exp/initialize_tax_filing', 'POST', {
    user_identifier: input.userIdentifier, user: { email: input.email }, user_metadata: metadata,
  }, fetchImpl);
  if (!isRecord(data) || data.user_identifier !== input.userIdentifier || !Array.isArray(data.data_errors) || !data.data_errors.every(value => typeof value === 'string')) throw new ColumnClientError('COLUMN_RESPONSE_INVALID');
  // Even HTTP 200 can mean Column silently discarded fields. Never open that session.
  if (data.data_errors.length) throw new ColumnClientError('COLUMN_DATA_REJECTED');
  if (typeof data.user_url !== 'string' || data.user_url.length > 16384 || /[\s\\]/.test(data.user_url)) throw new ColumnClientError('COLUMN_RESPONSE_INVALID');
  let url: URL;
  try { url = new URL(data.user_url); } catch { throw new ColumnClientError('COLUMN_RESPONSE_INVALID'); }
  if (url.protocol !== 'https:' || url.hostname !== MODULE_HOSTS[config.environment] || url.port || url.username || url.password) throw new ColumnClientError('COLUMN_RESPONSE_INVALID');
  return { userUrl: data.user_url };
}

function status(value: unknown, known: Set<string>): string {
  if (typeof value !== 'string' || !/^[a-z_]{1,80}$/.test(value)) throw new ColumnClientError('COLUMN_RESPONSE_INVALID');
  return known.has(value) ? value : 'unknown';
}

/** Only status is exposed: financial amounts, bank details, and consent payloads stay out. */
export async function getColumnTaxReturn(config: ColumnClientConfig, userIdentifier: string, taxYear: number, fetchImpl: typeof fetch = fetch): Promise<ColumnTaxReturn | null> {
  validateConfig(config);
  validateIdentifier(userIdentifier);
  if (!validYear(taxYear) || (config.taxYear !== undefined && config.taxYear !== taxYear)) throw new ColumnClientError('COLUMN_INPUT_INVALID');
  const data = await request(config, `/v1/users/${encodeURIComponent(userIdentifier)}/tax_returns`, 'GET', undefined, fetchImpl);
  if (!isRecord(data) || !Array.isArray(data.tax_returns) || data.tax_returns.length > 100
    || !data.tax_returns.every(row => isRecord(row) && validYear(row.tax_year))) throw new ColumnClientError('COLUMN_RESPONSE_INVALID');
  const matches = data.tax_returns.filter(row => row.tax_year === taxYear);
  if (matches.length === 0) return null;
  if (matches.length !== 1) throw new ColumnClientError('COLUMN_RESPONSE_INVALID');
  const row = matches[0];
  if (!Array.isArray(row.jurisdictions) || row.jurisdictions.length > 100) throw new ColumnClientError('COLUMN_RESPONSE_INVALID');
  const seen = new Set<string>();
  const jurisdictions = row.jurisdictions.map((item: unknown) => {
    if (!isRecord(item) || typeof item.code !== 'string' || !/^[A-Z]{2}$/.test(item.code) || seen.has(item.code)) throw new ColumnClientError('COLUMN_RESPONSE_INVALID');
    seen.add(item.code);
    return { jurisdiction: item.code, submissionStatus: status(item.submission_status, SUBMISSION_STATUSES) as ColumnSubmissionStatus };
  });
  return { taxYear, status: status(row.status, USER_STATUSES) as ColumnUserStatus, jurisdictions };
}
