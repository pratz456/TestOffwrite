import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const mock = vi.hoisted(() => ({ auth: true, denied: false, limited: false, gate: vi.fn(), build: vi.fn(), create: vi.fn(), list: vi.fn(), revoke: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: mock.auth ? { uid: 'owner' } : null }) }));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async (uid: string, feature: string) => { mock.gate(uid, feature); return mock.denied ? NextResponse.json({ code: 'SUBSCRIPTION_REQUIRED' }, { status: 403 }) : null; } }));
vi.mock('@/lib/security/rate-limit', () => ({ enforceRateLimit: async () => ({ allowed: !mock.limited }), anonymousRateLimitKey: () => 'hashed-ip', rateLimitResponse: () => NextResponse.json({ code: 'RATE_LIMITED' }, { status: 429 }) }));
vi.mock('@/lib/reports/preparer-package', () => ({ buildPreparerPackage: mock.build, PreparerPackageError: class extends Error { constructor(message: string, public code: string, public status: number) { super(message); } } }));
vi.mock('@/lib/preparer/handoffs', () => ({ createPreparerHandoff: mock.create, listPreparerHandoffs: mock.list, revokePreparerHandoff: mock.revoke, downloadPreparerHandoff: mock.download }));
import { POST as ZIP } from '@/app/api/reports/preparer-package/route';
import { POST as CREATE, GET as LIST } from '@/app/api/preparer-handoffs/route';
import { DELETE as REVOKE } from '@/app/api/preparer-handoffs/[id]/route';
import { POST as DOWNLOAD } from '@/app/api/preparer-handoffs/download/route';
import { GET as LANDING } from '@/app/preparer/[id]/route';
const id = 'd30b6416-5a69-4559-91bb-80e6904f0c75';
const token = 'a'.repeat(43);
function request(path: string, body?: any, extra: Record<string, string> = {}) { return new NextRequest(`http://localhost${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...extra }, ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }); }
beforeEach(() => { vi.clearAllMocks(); mock.auth = true; mock.denied = false; mock.limited = false;
  mock.build.mockResolvedValue({ bytes: Buffer.from('PK synthetic zip'), filename: 'writeoff-preparer-2026-receipt-review-needed.zip', manifest: { receiptIssues: 2, unresolvedQuestions: 3 } });
  mock.create.mockResolvedValue({ id, token, expiresAt: 123456, receiptFiles: 1, receiptIssues: 2, unresolvedQuestions: 3 });
  mock.list.mockResolvedValue([]); mock.revoke.mockResolvedValue(true); mock.download.mockResolvedValue({ bytes: Buffer.from('PK synthetic zip'), filename: 'writeoff-preparer-2026.zip', receiptIssues: 2 });
});
describe('preparer endpoints', () => {
  it('requires authentication and Premium exports before building or sharing records', async () => {
    mock.auth = false;
    expect((await ZIP(request('/api/reports/preparer-package', { year: 2026 }))).status).toBe(401);
    expect((await CREATE(request('/api/preparer-handoffs', { year: 2026, expiresInDays: 3, confirmSharing: true }))).status).toBe(401);
    mock.auth = true; mock.denied = true;
    expect((await ZIP(request('/api/reports/preparer-package', { year: 2026 }))).status).toBe(403);
    expect((await CREATE(request('/api/preparer-handoffs', { year: 2026, expiresInDays: 3, confirmSharing: true }))).status).toBe(403);
    expect(mock.gate).toHaveBeenCalledWith('owner', 'exports'); expect(mock.build).not.toHaveBeenCalled(); expect(mock.create).not.toHaveBeenCalled();
  });
  it('allows listing and revocation after Premium ends without giving new export access', async () => {
    mock.denied = true;
    expect((await LIST(request('/api/preparer-handoffs'))).status).toBe(200);
    expect((await REVOKE(request(`/api/preparer-handoffs/${id}`), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect(mock.gate).not.toHaveBeenCalled(); expect(mock.revoke).toHaveBeenCalledWith('owner', id);
  });
  it.each([{ year: 2026 }, { year: 2026, expiresInDays: 30, confirmSharing: true }, { year: 2026, expiresInDays: 3, confirmSharing: false }, { year: 2026, expiresInDays: 3, confirmSharing: true, userId: 'victim' }])('requires explicit sharing confirmation and strict scope %j', async body => {
    expect((await CREATE(request('/api/preparer-handoffs', body))).status).toBe(400); expect(mock.build).not.toHaveBeenCalled();
  });
  it.each([{ year: '2026junk' }, { year: 1999 }, { year: 2026, userId: 'victim' }, {}])('rejects malformed package requests %j', async body => {
    expect((await ZIP(request('/api/reports/preparer-package', body))).status).toBe(400); expect(mock.build).not.toHaveBeenCalled();
  });
  it('rejects cross-site mutations and excessive requests before any export read', async () => {
    expect((await CREATE(request('/api/preparer-handoffs', { year: 2026 }, { Origin: 'https://attacker.example' }))).status).toBe(403);
    expect((await DOWNLOAD(request('/api/preparer-handoffs/download', { id, token }, { Origin: 'https://attacker.example' }))).status).toBe(403);
    mock.limited = true; expect((await ZIP(request('/api/reports/preparer-package', { year: 2026 }))).status).toBe(429);
    expect(mock.build).not.toHaveBeenCalled(); expect(mock.download).not.toHaveBeenCalled();
  });
  it('returns an attachment and explicit receipt/unresolved counts with sensitive caching blocked', async () => {
    const response = await ZIP(request('/api/reports/preparer-package', { year: 2026 }));
    expect(response.status).toBe(200); expect(response.headers.get('content-disposition')).toContain('attachment;');
    expect(response.headers.get('cache-control')).toContain('no-store'); expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-receipt-issues')).toBe('2'); expect(response.headers.get('x-unresolved-transactions')).toBe('3');
    expect(mock.build).toHaveBeenCalledWith('owner', 2026);
  });
  it('returns the private token only in a relative fragment URL and never an API URL', async () => {
    const response = await CREATE(request('/api/preparer-handoffs', { year: 2026, expiresInDays: 3, confirmSharing: true }));
    expect(response.status).toBe(201); const body = await response.json();
    expect(body.path).toBe(`/preparer/${id}#token=${token}`); expect(body).not.toHaveProperty('tokenHash'); expect(body).not.toHaveProperty('storagePath');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('accepts the public download token only in a bounded JSON body and does not need account sign-in', async () => {
    mock.auth = false;
    const response = await DOWNLOAD(request('/api/preparer-handoffs/download', { id, token }));
    expect(response.status).toBe(200); expect(mock.download).toHaveBeenCalledWith(id, token); expect(mock.gate).not.toHaveBeenCalled();
    expect((await DOWNLOAD(request('/api/preparer-handoffs/download', 'x'.repeat(3000)))).status).toBe(413);
    mock.download.mockResolvedValueOnce(null); expect((await DOWNLOAD(request('/api/preparer-handoffs/download', { id, token }))).status).toBe(404);
  });
  it('does not leak provider errors or return a partial ZIP on source failures', async () => {
    mock.build.mockRejectedValueOnce(new Error('secret Storage connection details'));
    const response = await ZIP(request('/api/reports/preparer-package', { year: 2026 }));
    expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/secret|Storage/); expect(mock.create).not.toHaveBeenCalled();
  });
  it('serves a minimal standalone landing with no third-party scripts or token interpolation', async () => {
    const response = await LANDING(request(`/preparer/${id}`), { params: Promise.resolve({ id }) });
    const html = await response.text();
    expect(html).toContain('location.hash'); expect(html).toContain("history.replaceState(null,'',location.pathname)");
    expect(html).not.toMatch(/<script[^>]+src=|googletag|firebase|stripe|plaid|_next|gtag/);
    expect(response.headers.get('content-security-policy')).toMatch(/default-src 'none'.*script-src 'sha256-/);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer'); expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect((await LANDING(request('/preparer/invalid'), { params: Promise.resolve({ id: '<script>' }) })).status).toBe(404);
  });
});
