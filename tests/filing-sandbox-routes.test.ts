import { createHash } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { filingSandboxConfig, isFilingSandboxIdentity } from '../lib/tax-filing/config';

const state = vi.hoisted(() => ({
  user: null as null | { uid: string; email: string | null; authTime?: number; secondFactorVerified?: boolean },
  authError: null as null | string,
  denied: false,
  records: {} as Record<string, Record<string, unknown>>,
  reads: [] as string[], writes: [] as Array<{ path: string; data: Record<string, unknown>; options: unknown }>,
  query: [] as unknown[][], legacyExists: true, databaseError: false,
  initialize: vi.fn(), returns: vi.fn(), feature: vi.fn(),
}));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: state.user, error: state.authError }) }));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async (...args: unknown[]) => {
  state.feature(...args);
  return state.denied ? NextResponse.json({ code: 'PREMIUM_REQUIRED' }, { status: 403 }) : null;
} }));
vi.mock('@/lib/tax-filing/column-client', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/tax-filing/column-client')>(),
  initializeColumnFiling: (...args: unknown[]) => state.initialize(...args),
  getColumnTaxReturn: (...args: unknown[]) => state.returns(...args),
}));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: {
  doc: (path: string) => ({
    get: async () => { state.reads.push(path); if (state.databaseError) throw new Error('private database failure'); return { exists: path in state.records, data: () => state.records[path] }; },
    set: async (data: Record<string, unknown>, options: unknown) => { state.writes.push({ path, data, options }); },
  }),
  collection: (name: string) => {
    state.query.push(['collection', name]);
    return {
      doc: (id: string) => ({ get: async () => { const path = `${name}/${id}`; state.reads.push(path); if (state.databaseError) throw new Error('private database failure'); return { exists: path in state.records, data: () => state.records[path] }; } }),
      where(...args: unknown[]) { state.query.push(['where', ...args]); return this; }, limit(count: number) { state.query.push(['limit', count]); return this; }, get: async () => { if (state.databaseError) throw new Error('private database failure'); return { empty: !state.legacyExists, docs: [{ data: () => ({ pin: '12345', consent: true, status: 'signed', totalTax: 999 }) }] }; },
    };
  },
} }));
import { GET, POST } from '../app/api/tax/filing/route';
import { GET as legacyGet, POST as legacyPost } from '../app/api/tax/form-8879/route';
import { GET as yearLockGet, POST as yearLockPost } from '../app/api/tax/year-lock/route';

const uid = 'staging-filing-01234567-89ab-cdef-0123-456789abcdef';
const metadata = { password_changed_date: null, account_locked_date: null, passed_mfa_at_this_login: false, failed_login_attempts: 0, cell_phone_changed_date: null, email_changed_date: null };
const approvedEnv = {
  COLUMN_TAX_MODE: 'sandbox', COLUMN_TAX_SANDBOX_APPROVED: 'true', WRITEOFF_ENV: 'staging', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'writeoff-production-testing',
  COLUMN_TAX_FILING_YEAR: '2025', COLUMN_TAX_CLIENT_ID: 'synthetic-client', COLUMN_TAX_CLIENT_SECRET: 'synthetic-secret',
};
const securityPath = `filing_security_metadata/${uid}`;
const connectionPath = `tax_filing_connections/${uid}`;
const expectedIdentifier = createHash('sha256').update(`writeoff-production-testing:column:sandbox:${uid}`).digest('hex');
const getRequest = (year: unknown = 2025) => new NextRequest(`https://writeoff-production-testing.web.app/api/tax/filing?year=${year}`);
const postRequest = (body: unknown = { taxYear: 2025, consent: true }) => new NextRequest('https://writeoff-production-testing.web.app/api/tax/filing', { method: 'POST', body: JSON.stringify(body) });
const noProviderCalls = () => { expect(state.initialize).not.toHaveBeenCalled(); expect(state.returns).not.toHaveBeenCalled(); expect(state.writes).toEqual([]); };
const linked = () => { state.records[connectionPath] = { provider: 'column', environment: 'sandbox', userIdentifier: expectedIdentifier, taxYear: 2025, consentVersion: 'sandbox-identity-v1', consentedAt: '2026-09-16T18:00:00Z' }; };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-16T18:00:00Z'));
  for (const [key, value] of Object.entries(approvedEnv)) vi.stubEnv(key, value);
  state.user = { uid, email: `${uid}@example.com`, authTime: 1789578000, secondFactorVerified: false };
  state.authError = null; state.denied = false; state.databaseError = false; state.legacyExists = true;
  state.records = { [securityPath]: { source: 'controlled-sandbox-fixture', authTime: state.user.authTime, checkedAt: new Date().toISOString(), metadata: { ...metadata } } };
  state.reads = []; state.writes = []; state.query = []; state.feature.mockReset();
  state.initialize.mockReset().mockResolvedValue({ userUrl: 'https://app-sandbox.columnapi.com/start?token=private-session' });
  state.returns.mockReset().mockResolvedValue({ taxYear: 2025, status: 'submitted', jurisdictions: [{ jurisdiction: 'US', submissionStatus: 'accepted' }, { jurisdiction: 'CA', submissionStatus: 'retryable' }] });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('filing sandbox environment configuration', () => {
  it('is disabled without every deliberate sandbox approval setting', () => {
    expect(filingSandboxConfig({})).toBeNull();
    expect(filingSandboxConfig(approvedEnv)).toEqual({ environment: 'sandbox', taxYear: 2025, clientId: 'synthetic-client', clientSecret: 'synthetic-secret' });
  });
  it.each([
    { COLUMN_TAX_MODE: 'production' }, { COLUMN_TAX_MODE: '' }, { COLUMN_TAX_SANDBOX_APPROVED: 'false' },
    { WRITEOFF_ENV: 'production' }, { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'writeoff-production' },
    { COLUMN_TAX_FILING_YEAR: '2027' }, { COLUMN_TAX_FILING_YEAR: '2025junk' }, { COLUMN_TAX_CLIENT_ID: '' }, { COLUMN_TAX_CLIENT_SECRET: ' ' },
  ])('does not enable provider transport for %j', changes => { expect(filingSandboxConfig({ ...approvedEnv, ...changes })).toBeNull(); });
  it.each([
    { uid: 'ordinary-user', email: 'ordinary@example.com' }, { uid, email: 'real-user@gmail.com' }, { uid, email: null }, { uid, email: `${uid}@example.com.evil.invalid` },
  ])('rejects nonfixture identities %j', user => { expect(isFilingSandboxIdentity(user)).toBe(false); });
});

describe('filing route gates and provider handoff', () => {
  it.each(['get', 'post'])('requires verified server auth before %s reads or provider calls', async method => {
    state.user = null;
    const result = method === 'get' ? await GET(getRequest()) : await POST(postRequest());
    expect(result.status).toBe(401); expect(state.reads).toEqual([]); expect(state.feature).not.toHaveBeenCalled(); noProviderCalls();
  });
  it('rejects auth helper errors even if a user is present', async () => {
    state.authError = 'private verification failure';
    expect((await POST(postRequest())).status).toBe(401); noProviderCalls();
  });
  it.each(['get', 'post'])('checks export entitlement before provider %s', async method => {
    state.denied = true;
    const result = method === 'get' ? await GET(getRequest()) : await POST(postRequest());
    expect(result.status).toBe(403); expect(state.feature).toHaveBeenCalledWith(uid, 'exports'); expect(state.reads).toEqual([]); noProviderCalls();
  });
  it.each([{}, { taxYear: 2025 }, { taxYear: 2025, consent: false }, { taxYear: 2025, consent: 'true' }, { taxYear: 2027, consent: true }, { taxYear: 2025, consent: true, userId: 'victim' }, { taxYear: 2025, consent: true, metadata }, []])('rejects unconsented, unsupported, or client-controlled fields %j', async body => {
    const result = await POST(postRequest(body));
    expect(result.status).toBe(400); expect((await result.json()).code).toBe('FILING_CONSENT_REQUIRED'); noProviderCalls();
  });
  it('rejects invalid JSON and selected-year mismatch without initialization', async () => {
    const invalid = new NextRequest('https://writeoff-production-testing.web.app/api/tax/filing', { method: 'POST', body: '{' });
    expect((await POST(invalid)).status).toBe(400);
    const result = await POST(postRequest({ taxYear: 2026, consent: true }));
    expect(result.status).toBe(409); expect((await result.json()).code).toBe('FILING_YEAR_UNAVAILABLE'); noProviderCalls();
  });
  it.each([{ COLUMN_TAX_MODE: 'production' }, { WRITEOFF_ENV: 'production' }, { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'writeoff-production' }])('does not call provider from a nonapproved environment %j', async changes => {
    for (const [key, value] of Object.entries(changes)) vi.stubEnv(key, value);
    expect((await POST(postRequest())).status).toBe(503);
    expect(await (await GET(getRequest())).json()).toMatchObject({ available: false, status: 'unavailable' }); noProviderCalls();
  });
  it('does not send a real-account email even with sandbox keys and consent', async () => {
    state.user!.email = 'real-person@gmail.com';
    expect((await POST(postRequest())).status).toBe(503);
    expect(await (await GET(getRequest())).json()).toMatchObject({ available: false }); noProviderCalls();
  });
  it.each([
    { source: 'client-provided' }, { authTime: 1789577999 }, { checkedAt: '2026-09-16T17:54:59Z' }, { checkedAt: '2026-09-16T18:00:01Z' }, { checkedAt: 'not-a-date' },
    { metadata: { ...metadata, passed_mfa_at_this_login: true } },
  ])('requires source, freshness, exact login binding and actual MFA match: %j', async changes => {
    Object.assign(state.records[securityPath], changes);
    const result = await POST(postRequest());
    expect(result.status).toBe(409); expect((await result.json()).code).toBe('FILING_SECURITY_REVIEW_REQUIRED'); noProviderCalls();
  });
  it('requires security record and known verified auth time, never inferring metadata', async () => {
    delete state.records[securityPath];
    expect((await POST(postRequest())).status).toBe(409);
    state.user!.authTime = undefined;
    expect((await POST(postRequest())).status).toBe(409); noProviderCalls();
  });
  it('rejects incomplete metadata and database failure without leaking provider or database details', async () => {
    state.records[securityPath].metadata = {};
    expect((await POST(postRequest())).status).toBe(503); noProviderCalls();
    state.databaseError = true;
    const result = await GET(getRequest());
    expect(result.status).toBe(503); expect(JSON.stringify(await result.json())).not.toContain('private'); noProviderCalls();
  });
  it('initializes only server-owned synthetic identity/facts and persists consent linkage without authenticated URL or PII payload', async () => {
    const result = await POST(postRequest());
    expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect(await result.json()).toEqual({ environment: 'sandbox', taxYear: 2025, status: 'submitted', userUrl: 'https://app-sandbox.columnapi.com/start?token=private-session' });
    expect(state.initialize).toHaveBeenCalledWith(expect.objectContaining({ environment: 'sandbox', taxYear: 2025 }), { userIdentifier: expectedIdentifier, email: `${uid}@example.com`, metadata });
    expect(state.returns).toHaveBeenCalledWith(expect.any(Object), expectedIdentifier, 2025);
    expect(state.writes).toEqual([{ path: connectionPath, data: { provider: 'column', environment: 'sandbox', userIdentifier: expectedIdentifier, taxYear: 2025, consentVersion: 'sandbox-identity-v1', consentedAt: '2026-09-16T18:00:00.000Z' }, options: { merge: true } }]);
    expect(JSON.stringify(state.writes)).not.toMatch(/private-session|userUrl|email|passed_mfa/);
  });
  it('does not expose a launch URL or persist a connection if initialized provider season is absent', async () => {
    state.returns.mockResolvedValue(null);
    const result = await POST(postRequest());
    expect(result.status).toBe(409); expect(await result.json()).toMatchObject({ code: 'FILING_YEAR_UNAVAILABLE' });
    expect(state.writes).toEqual([]);
  });
  it('returns a safe provider error and does not persist a failed initialization', async () => {
    state.initialize.mockRejectedValue(new Error('private-token and client-secret'));
    const result = await POST(postRequest());
    expect(result.status).toBe(503); expect(JSON.stringify(await result.json())).not.toMatch(/private-token|client-secret/);
    expect(state.returns).not.toHaveBeenCalled(); expect(state.writes).toEqual([]);
  });
  it('reports linked status per jurisdiction and does not initialize or synthesize accepted/payment status on GET', async () => {
    linked();
    const result = await GET(getRequest());
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ available: true, status: 'submitted', jurisdictions: [{ jurisdiction: 'US', submissionStatus: 'accepted' }, { jurisdiction: 'CA', submissionStatus: 'retryable' }] });
    expect(state.initialize).not.toHaveBeenCalled(); expect(state.writes).toEqual([]);
  });
  it('missing provider year after linking is unknown rather than an invented not-started/accepted status', async () => {
    linked(); state.returns.mockResolvedValue(null);
    const data = await (await GET(getRequest())).json();
    expect(data).toMatchObject({ status: 'unknown', jurisdictions: [] }); expect(data).not.toHaveProperty('refund');
  });
  it.each([{ consentVersion: 'old-version' }, { taxYear: 2024 }, { environment: 'production' }, { userIdentifier: 'another-owner' }])('does not query a provider connection with invalid binding: %j', async changes => {
    linked(); Object.assign(state.records[connectionPath], changes);
    expect(await (await GET(getRequest())).json()).toMatchObject({ available: true, status: 'not_started' }); noProviderCalls();
  });
});

describe('legacy Form 8879 no longer represents return authorization', () => {
  it('rejects new PIN/consent submissions without reading or storing the payload', async () => {
    const result = await legacyPost(postRequest({ taxpayerPin: '12345', spousePin: '54321', consent: true, totalTax: 1234 }));
    expect(result.status).toBe(409); expect((await result.json()).code).toBe('FILING_PROVIDER_REQUIRED');
    expect(state.query).toEqual([]); expect(state.reads).toEqual([]); noProviderCalls();
  });
  it('historical read is owner/year scoped, omits PIN/tax/signature contents, and cannot imply filed', async () => {
    const result = await legacyGet(getRequest()); const data = await result.json();
    expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect(data).toMatchObject({ taxYear: 2025, authorization: null, legacyRecordExists: true, filingAvailable: false });
    expect(data).not.toHaveProperty('pin'); expect(data).not.toHaveProperty('consent'); expect(data).not.toHaveProperty('totalTax'); expect(data).not.toHaveProperty('status');
    expect(state.query).toEqual([['collection', 'form_8879'], ['where', 'userId', '==', uid], ['where', 'taxYear', '==', 2025], ['limit', 1]]);
  });
  it('does not expose historical data without auth or for unsupported years', async () => {
    state.user = null; expect((await legacyGet(getRequest())).status).toBe(401); expect((await legacyPost(postRequest())).status).toBe(401);
    state.user = { uid, email: `${uid}@example.com` }; expect((await legacyGet(getRequest(2027))).status).toBe(400);
    expect(state.query).toEqual([]);
  });
  it('failed historical reads are errors, never fabricated empty/signed records', async () => {
    state.databaseError = true;
    const result = await legacyGet(getRequest()); expect(result.status).toBe(503);
    const data = await result.json(); expect(data).not.toHaveProperty('legacyRecordExists'); expect(JSON.stringify(data)).not.toContain('private database');
  });
});

describe('legacy year locks cannot fabricate provider acknowledgments', () => {
  it('blocks client-assigned accepted/submitted status without reading JSON or writing any record', async () => {
    const request = postRequest({ year: 2025, status: 'accepted', confirmationNumber: 'fabricated-confirmation' });
    const bodyRead = vi.spyOn(request, 'json');
    const result = await yearLockPost(request);
    expect(result.status).toBe(409); expect((await result.json()).code).toBe('PROVIDER_STATUS_REQUIRED');
    expect(bodyRead).not.toHaveBeenCalled(); expect(state.query).toEqual([]); expect(state.reads).toEqual([]); noProviderCalls();
  });
  it.each(['submitted', 'accepted', 'filed', 'draft'])('preserves conservative %s lock behavior but exposes no filing proof or confirmation number', async status => {
    state.records[`tax_year_locks/${uid}_2025`] = { userId: uid, taxYear: 2025, status, confirmationNumber: 'fabricated-confirmation', signedPin: '12345' };
    const result = await yearLockGet(getRequest()); expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ lock: null, status: 'unverified', taxYear: 2025, isLocked: status !== 'draft', legacyRecordExists: true, verifiedFilingStatus: null, message: 'Local records do not verify filing or IRS acceptance. Confirm status with your filing provider.' });
    expect(state.reads).toEqual([`tax_year_locks/${uid}_2025`]); noProviderCalls();
  });
  it('missing historical lock is open with no verified filing status', async () => {
    expect(await (await yearLockGet(getRequest())).json()).toMatchObject({ status: 'open', isLocked: false, legacyRecordExists: false, verifiedFilingStatus: null });
  });
  it.each([{ userId: 'other-owner', taxYear: 2025 }, { userId: uid, taxYear: 2024 }])('rejects a mismatched stored owner/year rather than returning its state: %j', async record => {
    state.records[`tax_year_locks/${uid}_2025`] = { ...record, status: 'accepted' };
    const result = await yearLockGet(getRequest()); expect(result.status).toBe(503); expect(await result.json()).not.toHaveProperty('isLocked');
  });
  it('requires auth, rejects future years before reading and fails honestly when the database is unavailable', async () => {
    state.user = null; expect((await yearLockGet(getRequest())).status).toBe(401); expect((await yearLockPost(postRequest())).status).toBe(401);
    state.user = { uid, email: `${uid}@example.com` }; expect((await yearLockGet(getRequest(2027))).status).toBe(400); expect(state.reads).toEqual([]);
    state.databaseError = true; const result = await yearLockGet(getRequest()); expect(result.status).toBe(503); expect(JSON.stringify(await result.json())).not.toContain('private database');
  });
});
