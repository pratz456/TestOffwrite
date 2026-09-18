import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const canonical = vi.hoisted(() => vi.fn());
vi.mock('@/app/api/plaid/create-link-token/route', () => ({ POST: canonical }));
import { POST } from '@/app/api/plaid/link-token/route';

beforeEach(() => vi.clearAllMocks());
describe('legacy Plaid link token alias', () => {
  it('forwards the original credentials/body to the canonical ownership-checked route', async () => {
    const request = new NextRequest('https://writeoff.test/api/plaid/link-token', { method: 'POST',
      headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ itemId: 'owned-item' }) });
    canonical.mockResolvedValue(NextResponse.json({ link_token: 'sandbox-link-token', mode: 'update', itemId: 'owned-item' },
      { headers: { 'Cache-Control': 'no-store' } }));
    const response = await POST(request);
    expect(canonical).toHaveBeenCalledWith(request);
    expect(await response.json()).toEqual({ link_token: 'sandbox-link-token', linkToken: 'sandbox-link-token', mode: 'update', itemId: 'owned-item' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it.each([401, 409, 503])('preserves canonical denial status %s without a token', async status => {
    const denied = NextResponse.json({ error: 'Denied' }, { status });
    canonical.mockResolvedValue(denied);
    expect(await POST(new NextRequest('https://writeoff.test/api/plaid/link-token', { method: 'POST' }))).toBe(denied);
  });
});
