import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ColumnClientError, getColumnTaxReturn, initializeColumnFiling, validateColumnMetadata,
  type ColumnClientConfig, type ColumnUserMetadata,
} from '../lib/tax-filing/column-client';

const config: ColumnClientConfig = { environment: 'sandbox', clientId: 'synthetic-client', clientSecret: 'synthetic-secret', taxYear: 2025 };
const metadata: ColumnUserMetadata = { password_changed_date: null, account_locked_date: null, passed_mfa_at_this_login: false, failed_login_attempts: 0, cell_phone_changed_date: null, email_changed_date: '2025-02-28' };
const input = { userIdentifier: 'staging-filing-opaque-123', email: 'synthetic@example.com', metadata };
const session = { user_identifier: input.userIdentifier, user_url: 'https://app-sandbox.columnapi.com/start?session=synthetic-token', data_errors: [] };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const transport = (body: unknown, status = 200) => vi.fn<typeof fetch>().mockResolvedValue(response(body, status));
const taxReturn = (override = {}) => ({ tax_year: 2025, status: 'submitted', jurisdictions: [{ code: 'US', submission_status: 'accepted' }, { code: 'CA', submission_status: 'retryable' }], ...override });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Column server transport: no real provider requests', () => {
  it('sends exact minimal documented Basic-auth initialization without a tax-year or ledger prefill', async () => {
    const fetchImpl = transport({ ...session, user_token: 'deprecated-secret' });
    expect(await initializeColumnFiling(config, input, fetchImpl)).toEqual({ userUrl: session.user_url });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://sandbox.columnapi.com/v1/exp/initialize_tax_filing');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { Authorization: `Basic ${Buffer.from('synthetic-client:synthetic-secret').toString('base64')}`, 'Content-Type': 'application/json' } });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({ user_identifier: input.userIdentifier, user: { email: input.email }, user_metadata: metadata });
  });

  it('uses only the fixed production base and matching app host when explicitly selected by a server caller', async () => {
    const fetchImpl = transport({ ...session, user_url: 'https://app.columnapi.com/start?session=synthetic' });
    await initializeColumnFiling({ ...config, environment: 'production' }, input, fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://prod.columnapi.com/v1/exp/initialize_tax_filing');
  });

  it.each([
    undefined, {}, { ...metadata, failed_login_attempts: undefined }, { ...metadata, passed_mfa_at_this_login: 'false' },
    { ...metadata, failed_login_attempts: -1 }, { ...metadata, failed_login_attempts: 0.5 },
    { ...metadata, failed_login_attempts: Number.MAX_SAFE_INTEGER + 1 }, { ...metadata, email_changed_date: '2025-02-29' },
    { ...metadata, password_changed_date: 'unknown' }, { ...metadata, email_changed_date: '' }, { ...metadata, invented: true },
  ])('rejects unknown or malformed metadata without defaults or a provider call: %j', async value => {
    const fetchImpl = transport(session);
    expect(() => validateColumnMetadata(value)).toThrowError(expect.objectContaining({ code: 'COLUMN_METADATA_REQUIRED' }));
    await expect(initializeColumnFiling(config, { ...input, metadata: value as ColumnUserMetadata }, fetchImpl)).rejects.toMatchObject({ code: 'COLUMN_METADATA_REQUIRED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('preserves explicit false/zero/null and valid leap-day facts without inferring MFA', () => {
    expect(validateColumnMetadata({ ...metadata, password_changed_date: '2024-02-29' })).toEqual({ ...metadata, password_changed_date: '2024-02-29' });
  });

  it.each(['../other', 'owner@example.com', 'id/other', 'a?token=x', 'a b', ''])('rejects unsafe or nonopaque identifier %s before transport', async userIdentifier => {
    const fetchImpl = transport(session);
    await expect(initializeColumnFiling(config, { ...input, userIdentifier }, fetchImpl)).rejects.toMatchObject({ code: 'COLUMN_INPUT_INVALID' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['', 'email-only', 'name @example.com', 'name@example.com\nInjected'])('rejects invalid email %s before transport', async email => {
    const fetchImpl = transport(session);
    await expect(initializeColumnFiling(config, { ...input, email }, fetchImpl)).rejects.toMatchObject({ code: 'COLUMN_INPUT_INVALID' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([{ environment: 'https://attacker.invalid' }, { clientId: 'id:extra' }, { clientSecret: '' }, { timeoutMs: 0 }, { timeoutMs: 30001 }])('rejects invalid config instead of choosing a fallback: %j', async override => {
    const fetchImpl = transport(session);
    await expect(initializeColumnFiling({ ...config, ...override } as ColumnClientConfig, input, fetchImpl)).rejects.toMatchObject({ code: 'COLUMN_CONFIGURATION_INVALID' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks browser execution before credentials can be sent', async () => {
    vi.stubGlobal('window', {});
    const fetchImpl = transport(session);
    await expect(initializeColumnFiling(config, input, fetchImpl)).rejects.toMatchObject({ code: 'COLUMN_SERVER_ONLY' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    'http://app-sandbox.columnapi.com/start', 'https://app.columnapi.com/start', 'https://app-sandbox.columnapi.com.evil.invalid/start',
    'https://evil.invalid/?next=https://app-sandbox.columnapi.com', 'https://user:password@app-sandbox.columnapi.com/start',
    'https://app-sandbox.columnapi.com:8443/start', 'https://some-unverified.env.bz/start', '//app-sandbox.columnapi.com/start',
    'https://app-sandbox.columnapi.com\\@evil.invalid/start',
  ])('rejects unverified/cross-environment session URL %s', async user_url => {
    await expect(initializeColumnFiling(config, input, transport({ ...session, user_url }))).rejects.toMatchObject({ code: 'COLUMN_RESPONSE_INVALID' });
  });

  it('rejects mismatched identity and missing data_errors; rejects nonempty data_errors without disclosing their contents', async () => {
    await expect(initializeColumnFiling(config, input, transport({ ...session, user_identifier: 'another-user' }))).rejects.toMatchObject({ code: 'COLUMN_RESPONSE_INVALID' });
    await expect(initializeColumnFiling(config, input, transport({ ...session, data_errors: undefined }))).rejects.toMatchObject({ code: 'COLUMN_RESPONSE_INVALID' });
    const error = await initializeColumnFiling(config, input, transport({ ...session, data_errors: ['Sensitive prefill: 123-45-6789'] })).catch(error => error);
    expect(error).toBeInstanceOf(ColumnClientError);
    expect(error.code).toBe('COLUMN_DATA_REJECTED');
    expect(String(error)).not.toContain('123-45-6789');
    expect(JSON.stringify(error)).not.toContain('Sensitive');
  });

  it.each([400, 401, 403, 429, 500, 503])('sanitizes provider HTTP %s and never returns provider body', async code => {
    const error = await initializeColumnFiling(config, input, transport({ error: 'secret credentials and PII' }, code)).catch(error => error);
    expect(error).toMatchObject({ code: code === 429 || code >= 500 ? 'COLUMN_PROVIDER_UNAVAILABLE' : 'COLUMN_PROVIDER_REJECTED', providerStatus: code });
    expect(String(error)).not.toContain('credentials');
    expect(error.cause).toBeUndefined();
  });

  it('rejects redirects, HTML and invalid JSON with sanitized errors', async () => {
    for (const result of [new Response(null, { status: 302, headers: { location: 'https://evil.invalid' } }), new Response('private failure page', { headers: { 'content-type': 'text/html' } }), new Response('invalid private JSON', { headers: { 'content-type': 'application/json' } })]) {
      await expect(initializeColumnFiling(config, input, vi.fn<typeof fetch>().mockResolvedValue(result))).rejects.toMatchObject({ code: 'COLUMN_RESPONSE_INVALID' });
    }
  });

  it('does not attach a thrown transport error that includes an authenticated URL', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('https://private.invalid/?token=private-token'));
    const error = await initializeColumnFiling(config, input, fetchImpl).catch(error => error);
    expect(error).toMatchObject({ code: 'COLUMN_PROVIDER_UNAVAILABLE' });
    expect(error.stack).not.toContain('private-token');
    expect(error.cause).toBeUndefined();
  });

  it('aborts a timed out request without retrying initialization', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('abort'))); }));
    const result = initializeColumnFiling({ ...config, timeoutMs: 50 }, input, fetchImpl).catch(error => error);
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toMatchObject({ code: 'COLUMN_TIMEOUT' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('Column status contract', () => {
  it('selects the exact tax year and preserves federal accepted/state retryable without inferring an overall acceptance', async () => {
    const fetchImpl = transport({ tax_returns: [taxReturn({ tax_year: 2024, status: 'not_started', jurisdictions: [] }), taxReturn()] });
    expect(await getColumnTaxReturn(config, input.userIdentifier, 2025, fetchImpl)).toEqual({ taxYear: 2025, status: 'submitted', jurisdictions: [{ jurisdiction: 'US', submissionStatus: 'accepted' }, { jurisdiction: 'CA', submissionStatus: 'retryable' }] });
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://sandbox.columnapi.com/v1/users/${input.userIdentifier}/tax_returns`);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' });
    expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty('body');
  });

  it.each(['not_submitted', 'submitted', 'accepted', 'retryable', 'rejected'])('preserves jurisdiction status %s exactly', async submission_status => {
    const result = await getColumnTaxReturn(config, input.userIdentifier, 2025, transport({ tax_returns: [taxReturn({ jurisdictions: [{ code: 'US', submission_status }] })] }));
    expect(result?.jurisdictions[0].submissionStatus).toBe(submission_status);
  });

  it.each([{ tax_returns: [] }, { tax_returns: [taxReturn({ tax_year: 2024 })] }])('missing year returns null instead of zero/accepted: %j', async ({ tax_returns }) => {
    expect(await getColumnTaxReturn(config, input.userIdentifier, 2025, transport({ tax_returns }))).toBeNull();
  });

  it('maps future statuses to unknown and strips refund, bank, consent, token and arbitrary provider fields', async () => {
    const payload = { tax_returns: [taxReturn({ status: 'new_status', information_disclosure_consent_status: 'not_consented', user_token: 'private', jurisdictions: [{ code: 'US', submission_status: 'new_agency_status', refund_or_amount_owed_cents: 0, payment: { account: { account_number: '12345678' } } }] })] };
    const result = await getColumnTaxReturn(config, input.userIdentifier, 2025, transport(payload));
    expect(result).toEqual({ taxYear: 2025, status: 'unknown', jurisdictions: [{ jurisdiction: 'US', submissionStatus: 'unknown' }] });
  });

  it.each([
    {}, { tax_returns: 'invalid' }, { tax_returns: [taxReturn({ tax_year: '2025' })] },
    { tax_returns: [taxReturn(), taxReturn()] }, { tax_returns: [taxReturn({ status: null })] },
    { tax_returns: [taxReturn({ jurisdictions: null })] }, { tax_returns: [taxReturn({ jurisdictions: [{ code: 'US', submission_status: null }] })] },
    { tax_returns: [taxReturn({ jurisdictions: [{ code: 'US', submission_status: 'accepted' }, { code: 'US', submission_status: 'rejected' }] })] },
  ])('rejects ambiguous or malformed status payload %j', async payload => {
    await expect(getColumnTaxReturn(config, input.userIdentifier, 2025, transport(payload))).rejects.toMatchObject({ code: 'COLUMN_RESPONSE_INVALID' });
  });

  it.each([2026, '2025', 2025.5, NaN])('rejects configured-season mismatch or invalid year before transport: %s', async year => {
    const fetchImpl = transport({ tax_returns: [] });
    await expect(getColumnTaxReturn(config, input.userIdentifier, year as number, fetchImpl)).rejects.toMatchObject({ code: 'COLUMN_INPUT_INVALID' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
