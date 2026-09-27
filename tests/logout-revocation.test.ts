import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  sameOrigin: true,
  user: { uid: 'logout-owner' } as { uid: string } | null,
  revoke: vi.fn(),
}));

vi.mock('@/lib/firebase/api-auth', () => ({
  isSameOriginRequest: () => mocks.sameOrigin,
  getAuthenticatedUser: async () => ({ user: mocks.user, error: mocks.user ? null : 'No authentication token found' }),
}));
vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: { revokeRefreshTokens: mocks.revoke },
}));

import { POST } from '@/app/api/auth/logout/route';

const request = () => new NextRequest('https://writeoffapp.com/api/auth/logout', {
  method: 'POST',
  headers: { origin: 'https://writeoffapp.com', cookie: '__session=synthetic' },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.sameOrigin = true;
  mocks.user = { uid: 'logout-owner' };
  mocks.revoke.mockResolvedValue(undefined);
});

describe('logout revocation', () => {
  it('revokes server sessions before clearing both browser credentials', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith('logout-owner');
    expect(response.cookies.get('__session')?.value).toBe('');
    expect(response.cookies.get('firebase-auth-token')?.value).toBe('');
  });

  it('still clears local credentials when server revocation temporarily fails', async () => {
    mocks.revoke.mockRejectedValue(new Error('private provider detail'));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private provider detail');
    expect(response.cookies.get('__session')?.value).toBe('');
  });

  it('remains idempotent for an already-expired session', async () => {
    mocks.user = null;
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
});
