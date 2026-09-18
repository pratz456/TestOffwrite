import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), collection: vi.fn(), doc: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: mocks.authenticate }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mocks.collection } }));
import { GET } from '../app/api/analysis-job/route';
const owner = 'alice';
function request(id = 'alice_account') { return new NextRequest(`https://writeoff.example/api/analysis-job?jobId=${encodeURIComponent(id)}`); }
function job(data: Record<string, unknown>, exists = true) { mocks.get.mockResolvedValue({ exists, id: 'synthetic-job-id', data: () => data }); }
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ user: { uid: owner }, error: null });
  mocks.collection.mockReturnValue({ doc: mocks.doc });
  mocks.doc.mockReturnValue({ get: mocks.get });
  job({ userId: owner, status: 'running' });
});
describe('analysis-job API ownership', () => {
  it('rejects unauthenticated reads before looking up jobs', async () => {
    mocks.authenticate.mockResolvedValue({ user: null, error: 'Unauthorized' });
    expect((await GET(request())).status).toBe(401);
    expect(mocks.collection).not.toHaveBeenCalled();
  });
  it.each([{ userId: owner }, { user_id: owner }])('accepts server-owned jobs regardless of their naming scheme: %j', async data => {
    job({ ...data, status: 'running' });
    const response = await GET(request('legacy-random-job'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('denies another owner even when the job ID begins with the caller’s UID', async () => {
    job({ userId: 'alice-victim', privateStatus: 'sensitive details' });
    const response = await GET(request('alice-victim_account'));
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('sensitive');
  });
  it('denies ownerless jobs rather than trusting their IDs', async () => {
    job({ status: 'running' });
    expect((await GET(request('alice_account'))).status).toBe(403);
  });
  it('preserves not-found polling behavior', async () => {
    job({}, false);
    expect((await GET(request())).status).toBe(404);
  });
  it.each(['', 'folder/nested/id', 'x'.repeat(257)])('rejects invalid document identifiers', async id => {
    expect((await GET(request(id))).status).toBe(400);
    expect(mocks.collection).not.toHaveBeenCalled();
  });
});
