import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { captureFirstTouch, type KeyValueStorage } from '@/lib/analytics/acquisition';

const model = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  sets: 0,
  user: { uid: 'new-user', email: 'new@example.test', emailVerified: true } as { uid: string } | null,
}));

vi.mock('@/lib/firebase/api-auth', () => ({
  getAuthenticatedUser: vi.fn(async () => ({ user: model.user, error: model.user ? null : 'Unauthorized' })),
}));
vi.mock('@/lib/plaid/connections', () => ({ migrateLegacyPlaidConnection: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: {},
  FieldValue: { serverTimestamp: () => 'server-time', delete: () => 'delete-field' },
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

import { POST } from '@/app/api/database/profiles/route';

const NOW = Date.parse('2026-10-22T19:00:00.000Z');
const PRIVACY_LINE = 'When you sign up, we save where you came from: the name of the site or partner that sent you, the campaign or creator code on the link, and the first WriteOff page you visited. We use this only to see which places bring people to WriteOff and to pay partners correctly. We do not save ad click IDs, your IP address, or the full address of the page you came from.';
const acquisition = {
  utm_source: 'nuggs',
  utm_medium: 'creator',
  utm_campaign: 't1',
  referrerHost: 'https://news.example/path?gclid=abc',
  landingPath: '/blog/x?gclid=abc&fbclid=def#y',
  capturedAt: '2026-10-22T18:30:00.000Z',
};

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
}

function request(body: unknown) {
  return new NextRequest('https://writeoffapp.com/api/database/profiles', {
    method: 'POST',
    headers: { authorization: 'Bearer new-user-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  model.docs.clear();
  model.sets = 0;
  model.user = { uid: 'new-user', email: 'new@example.test', emailVerified: true };
});

describe('acquisition is written with the first profile', () => {
  it('creates the profile with created_at and acquisition in one write', async () => {
    expect(model.docs.size).toBe(0);
    const response = await POST(request({ name: 'New customer', acquisition }));
    expect(response.status).toBe(200);
    expect(model.sets).toBe(1);
    expect(model.docs.get('user_profiles/new-user')).toEqual({
      name: 'New customer',
      updated_at: 'server-time',
      created_at: 'server-time',
      acquisition: {
        utm_source: 'nuggs',
        utm_medium: 'creator',
        utm_campaign: 't1',
        creatorRef: 'nuggs',
        referrerHost: 'news.example',
        landingPath: '/blog/x',
        capturedAt: '2026-10-22T18:30:00.000Z',
      },
    });
    const raw = JSON.stringify(model.docs.get('user_profiles/new-user'));
    expect(raw).not.toContain('gclid');
    expect(raw).not.toContain('fbclid');
    expect(raw).not.toContain('/path');
  });

  it('does not overwrite acquisition on a second profile save or a later visit with different utm values', async () => {
    await POST(request({ name: 'New customer', acquisition }));
    const stored = structuredClone(model.docs.get('user_profiles/new-user'));
    const again = await POST(request({
      profession: 'Designer',
      acquisition: { ...acquisition, utm_source: 'other', utm_medium: 'cpc', utm_campaign: 't2', creatorRef: 'other' },
    }));
    expect(again.status).toBe(200);
    expect(model.sets).toBe(2);
    const profile = model.docs.get('user_profiles/new-user');
    expect(profile?.profession).toBe('Designer');
    expect(profile?.acquisition).toEqual(stored?.acquisition);
    expect(profile?.created_at).toBe('server-time');

    const storage = memoryStorage();
    captureFirstTouch(storage, NOW, {
      search: '?utm_source=nuggs&utm_medium=creator&utm_campaign=t1',
      referrer: 'https://news.example/path?gclid=abc',
      pathname: '/blog/x?gclid=abc&fbclid=def#y',
      hostname: 'writeoffapp.com',
    });
    const secondVisit = captureFirstTouch(storage, NOW + 86_400_000, {
      search: '?utm_source=other&utm_medium=cpc&utm_campaign=t2',
      referrer: 'https://other.example/later',
      pathname: '/pricing?fbclid=def',
      hostname: 'writeoffapp.com',
    });
    expect(secondVisit).toMatchObject({ utm_source: 'nuggs', utm_campaign: 't1', creatorRef: 'nuggs', landingPath: '/blog/x', referrerHost: 'news.example' });
  });

  it('does not create a user_profiles document before profile creation', async () => {
    expect(model.docs.has('user_profiles/new-user')).toBe(false);
    expect(model.sets).toBe(0);
    model.user = null;
    expect((await POST(request({ name: 'New customer', acquisition }))).status).toBe(401);
    expect(model.docs.size).toBe(0);
    expect(model.sets).toBe(0);
  });

  it('never backfills acquisition onto an existing user', async () => {
    model.docs.set('user_profiles/new-user', { name: 'Existing customer', created_at: 'server-time' });
    const response = await POST(request({ profession: 'Designer', acquisition }));
    expect(response.status).toBe(200);
    const profile = model.docs.get('user_profiles/new-user');
    expect(profile?.profession).toBe('Designer');
    expect(profile?.acquisition).toBeUndefined();
    expect(JSON.stringify(profile)).not.toContain('nuggs');
  });

  it('states the signup-source line on the privacy pages', () => {
    for (const path of ['app/privacy/privacy-page-client.tsx', 'app/protected/privacy/page.tsx']) {
      expect(readFileSync(resolve(process.cwd(), path), 'utf8')).toContain(PRIVACY_LINE);
    }
  });
});
