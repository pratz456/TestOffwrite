import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const model = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  createdAt: '2026-10-22T19:00:00.000Z',
  emailVerified: false,
  getUser: vi.fn(),
  sets: 0,
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifyIdToken: vi.fn(async (token: string) => {
      if (token !== 'new-user-token') throw new Error('bad token');
      return { uid: 'new-user', email_verified: model.emailVerified };
    }),
    verifySessionCookie: vi.fn(async () => { throw new Error('no session'); }),
    getUser: (...args: unknown[]) => model.getUser(...args),
  },
  adminDb: {
    doc: (path: string) => ({ path }),
    runTransaction: async (callback: (transaction: {
      get: (ref: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
      set: (ref: { path: string }, data: Record<string, unknown>, options: { merge: boolean }) => void;
    }) => Promise<void>) => callback({
      get: async ref => {
        const data = model.docs.get(ref.path);
        return { exists: data !== undefined, data: () => data };
      },
      set: (ref, data, options) => {
        model.sets += 1;
        const previous = options.merge ? model.docs.get(ref.path) ?? {} : {};
        model.docs.set(ref.path, { ...previous, ...data });
      },
    }),
  },
}));

import { POST } from '@/app/api/account/acquisition/route';

const NOW = Date.parse('2026-10-22T19:00:00.000Z');
const acquisition = {
  utm_source: 'Newsletter',
  utm_medium: 'person@example.com',
  utm_campaign: 'https://evil.test/path?token=secret',
  utm_content: 'a'.repeat(80),
  referrerHost: 'https://news.ycombinator.com/item?id=9&email=person@example.com',
  landingPath: '/pricing?email=person@example.com',
  capturedAt: '2026-10-22T18:30:00.000Z',
};

function request(body: unknown, headers: Record<string, string> = { authorization: 'Bearer new-user-token' }) {
  return new NextRequest('https://writeoffapp.com/api/account/acquisition', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

afterEach(() => { vi.useRealTimers(); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  model.docs.clear();
  model.sets = 0;
  model.createdAt = '2026-10-22T19:00:00.000Z';
  model.emailVerified = false;
  model.getUser.mockReset();
  model.getUser.mockImplementation(async () => ({ metadata: { creationTime: model.createdAt } }));
});

describe('one-time acquisition write', () => {
  it('writes a sanitized source once on the new user profile, before the email is verified', async () => {
    const response = await POST(request({ acquisition }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true });
    expect(model.emailVerified).toBe(false);
    const stored = model.docs.get('user_profiles/new-user');
    expect(stored).toEqual({
      acquisition: {
        utm_source: 'newsletter',
        utm_content: 'a'.repeat(64),
        referrerHost: 'news.ycombinator.com',
        landingPath: '/pricing',
        capturedAt: '2026-10-22T18:30:00.000Z',
      },
    });
    expect(JSON.stringify(stored)).not.toContain('@');
    expect(JSON.stringify(stored)).not.toContain('token');
    expect(JSON.stringify(stored)).not.toContain('evil.test');

    const again = await POST(request({ acquisition: { ...acquisition, utm_source: 'other', utm_medium: 'cpc' } }));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ saved: false });
    expect(model.docs.get('user_profiles/new-user')).toEqual(stored);
    expect(model.sets).toBe(1);
  });

  it('writes creatorRef as a flat string from ref, without a nested creator object', async () => {
    const response = await POST(request({
      acquisition: {
        ref: 'Jane_Partner',
        utm_source: 'other',
        utm_medium: 'creator',
        capturedAt: '2026-10-22T18:30:00.000Z',
      },
    }));
    expect(response.status).toBe(200);
    const stored = model.docs.get('user_profiles/new-user')?.acquisition as Record<string, unknown>;
    expect(stored.creatorRef).toBe('jane_partner');
    expect(stored.ref).toBeUndefined();
    expect(stored.creator).toBeUndefined();
    expect(typeof stored.creatorRef).toBe('string');
  });

  it('merges onto an existing profile without replacing its other fields', async () => {
    model.docs.set('user_profiles/new-user', { name: 'New customer' });
    expect((await POST(request({ acquisition }))).status).toBe(200);
    expect(model.docs.get('user_profiles/new-user')?.name).toBe('New customer');
    expect(model.docs.get('user_profiles/new-user')?.acquisition).toMatchObject({ utm_source: 'newsletter' });
  });

  it('does not write when nothing was captured', async () => {
    for (const body of [{}, { acquisition: {} }, { acquisition: { landingPath: '/', utm_source: 'person@example.com' } }]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }
    expect(model.docs.size).toBe(0);
    expect(model.getUser).not.toHaveBeenCalled();
    expect(model.sets).toBe(0);
  });

  it('does not write onto an account older than the capture window', async () => {
    model.createdAt = '2026-09-01T00:00:00.000Z';
    const response = await POST(request({ acquisition }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: false });
    expect(model.docs.size).toBe(0);
    expect(model.sets).toBe(0);
  });

  it('rejects anonymous and cross-site callers', async () => {
    expect((await POST(request({ acquisition }, {}))).status).toBe(401);
    const crossSite = await POST(request({ acquisition }, {
      authorization: 'Bearer new-user-token', origin: 'https://attacker.example.test', 'sec-fetch-site': 'cross-site',
    }));
    expect(crossSite.status).toBe(403);
    expect(model.docs.size).toBe(0);
  });
});
