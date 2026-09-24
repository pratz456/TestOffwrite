import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ auth: vi.fn(), act: vi.fn(), view: vi.fn(), latest: vi.fn() }));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: h.auth }));
vi.mock('@/lib/plaid/reconnect', () => ({ actOnReconnect: h.act, getReconnectView: h.view, latestReconnectSession: h.latest, ReconnectError: class extends Error {} }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
import { GET, POST } from '@/app/api/plaid/reconnect/route';
import { ReconnectError } from '@/lib/plaid/reconnect';
import { resetRateLimitStore } from './fixtures/rate-limit-store';
beforeEach(() => { vi.clearAllMocks(); resetRateLimitStore(); h.auth.mockResolvedValue({ uid: 'owner' }); h.latest.mockResolvedValue(null); });
const request = (body: unknown) => new Request('https://writeoff.test/api/plaid/reconnect', { method: 'POST', body: JSON.stringify(body) });
describe('authenticated reconnect API', () => {
  it.each(['', '{'])('rejects malformed JSON without attempting a bank action: %j', async body => {
    const response = await POST(new Request('https://writeoff.test/api/plaid/reconnect', { method: 'POST', body }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON body' });
    expect(h.act).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
  it('requires authentication before read, start, or decisions', async () => {
    h.auth.mockRejectedValue(new Error('unauthenticated'));
    expect((await GET(new Request('https://writeoff.test/api/plaid/reconnect'))).status).toBe(401);
    expect((await POST(request({ action: 'start' }))).status).toBe(401);
    expect(h.latest).not.toHaveBeenCalled(); expect(h.act).not.toHaveBeenCalled();
  });
  it('read-only lookup returns no session without creating one', async () => {
    const response = await GET(new Request('https://writeoff.test/api/plaid/reconnect'));
    expect(await response.json()).toEqual({ success: true, reconnect: null }); expect(h.act).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
  it('takes owner identity from auth and passes explicit session and cursor to owner-scoped loader', async () => {
    h.view.mockResolvedValue({ sessionId: 'review' });
    const response = await GET(new Request('https://writeoff.test/api/plaid/reconnect?sessionId=review&cursor=record&uid=forged'));
    expect(response.status).toBe(200); expect(h.view).toHaveBeenCalledWith('owner', 'review', 'record');
  });
  it('returns actionable validation errors but suppresses database/provider internals', async () => {
    h.act.mockRejectedValueOnce(new ReconnectError('Saved record changed. Refresh and review again.'));
    expect(await (await POST(request({ action: 'activate', sessionId: 'review' }))).json()).toMatchObject({ error: 'Saved record changed. Refresh and review again.' });
    h.act.mockRejectedValueOnce(new Error('secret database configuration'));
    expect(JSON.stringify(await (await POST(request({ action: 'start' }))).json())).not.toContain('secret');
  });
});
