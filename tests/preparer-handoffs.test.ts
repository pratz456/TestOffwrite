import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ docs: new Map<string, any>(), files: new Map<string, Buffer>(), onDownload: null as null | (() => void), saved: vi.fn(), reads: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => {
  const ref = (path: string): any => ({ path, id: path.split('/').at(-1), get: async () => snap(path), delete: async () => mock.docs.delete(path), update: async (data: any) => mock.docs.set(path, { ...mock.docs.get(path), ...data }) });
  const snap = (path: string) => ({ exists: mock.docs.has(path), id: path.split('/').at(-1)!, ref: ref(path), data: () => structuredClone(mock.docs.get(path)) });
  return { adminDb: { doc: ref, collection: (name: string) => ({ where: (key: string, _op: string, value: unknown) => ({ limit: (limit: number) => ({ get: async () => ({ docs: [...mock.docs].filter(([path, data]) => path.startsWith(`${name}/`) && data[key] === value).slice(0, limit).map(([path]) => snap(path)) }) }) }) }), runTransaction: async (fn: any) => {
    const writes: any[] = []; const result = await fn({ get: (value: any) => value.get(), set: (value: any, data: any) => writes.push(() => mock.docs.set(value.path, structuredClone(data))), update: (value: any, data: any) => writes.push(() => mock.docs.set(value.path, { ...mock.docs.get(value.path), ...structuredClone(data) })) }); writes.forEach(write => write()); return result;
  } } };
});
vi.mock('@/lib/firebase/receipt-security', () => ({ receiptBucket: () => ({ file: (path: string) => ({ save: async (bytes: Buffer, options: any) => { mock.saved(path, options); mock.files.set(path, Buffer.from(bytes)); }, delete: async () => mock.files.delete(path),
  getMetadata: async () => { mock.reads(path); return [{ size: mock.files.get(path)?.length }]; }, download: async () => { mock.onDownload?.(); return [mock.files.get(path)!]; } }), deleteFiles: async ({ prefix }: { prefix: string }) => { for (const key of mock.files.keys()) if (key.startsWith(prefix)) mock.files.delete(key); } }) }));
vi.mock('@/lib/reports/preparer-package', () => ({ MAX_PACKAGE_BYTES: 20 * 1024 * 1024, PreparerPackageError: class extends Error { constructor(message: string, public code: string, public status: number) { super(message); } } }));
import { createPreparerHandoff, downloadPreparerHandoff, listPreparerHandoffs, revokePreparerHandoff, deletePreparerHandoffsForUser } from '@/lib/preparer/handoffs';
const bundle = () => ({ bytes: Buffer.from('synthetic zip bytes'), filename: 'writeoff-preparer-2026.zip', manifest: { taxYear: 2026, receiptFiles: 1, receiptIssues: 0, unresolvedQuestions: 2 } as any });
beforeEach(() => { vi.clearAllMocks(); mock.docs.clear(); mock.files.clear(); mock.onDownload = null; mock.docs.set('user_profiles/owner', { name: 'Synthetic owner' }); });
describe('scoped preparer handoff snapshots', () => {
  it('stores only a hash of the 256-bit token and downloads the same immutable bytes', async () => {
    const created = await createPreparerHandoff('owner', bundle(), 3);
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = mock.docs.get(`preparer_handoffs/${created.id}`);
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify([...mock.docs])).not.toContain(created.token);
    expect(mock.saved.mock.calls[0][1]).toMatchObject({ preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/zip', cacheControl: 'private, no-store' } });
    expect(await downloadPreparerHandoff(created.id, created.token)).toMatchObject({ bytes: bundle().bytes });
    expect(await listPreparerHandoffs('owner')).toEqual([expect.objectContaining({ id: created.id, taxYear: 2026 })]);
    expect(JSON.stringify(await listPreparerHandoffs('owner'))).not.toMatch(/tokenHash|storagePath|userId/);
  });
  it('rejects wrong, revoked and expired tokens before reading a snapshot', async () => {
    const created = await createPreparerHandoff('owner', bundle(), 1), ref = `preparer_handoffs/${created.id}`;
    expect(await downloadPreparerHandoff(created.id, 'A'.repeat(43))).toBeNull();
    mock.docs.set(ref, { ...mock.docs.get(ref), expiresAt: Date.now() - 1 });
    expect(await downloadPreparerHandoff(created.id, created.token)).toBeNull();
    mock.docs.set(ref, { ...mock.docs.get(ref), expiresAt: Date.now() + 10000, revokedAt: Date.now() });
    expect(await downloadPreparerHandoff(created.id, created.token)).toBeNull(); expect(mock.reads).not.toHaveBeenCalled();
  });
  it('blocks cross-owner revoke and never follows a substituted Storage path', async () => {
    const created = await createPreparerHandoff('owner', bundle(), 1), ref = `preparer_handoffs/${created.id}`;
    expect(await revokePreparerHandoff('victim', created.id)).toBe(false);
    mock.docs.set(ref, { ...mock.docs.get(ref), storagePath: 'receipts/victim/bank/secret.pdf' });
    expect(await downloadPreparerHandoff(created.id, created.token)).toBeNull(); expect(mock.reads).not.toHaveBeenCalled();
  });
  it('stops downloads revoked while the snapshot is being read', async () => {
    const created = await createPreparerHandoff('owner', bundle(), 1), ref = `preparer_handoffs/${created.id}`;
    mock.onDownload = () => mock.docs.set(ref, { ...mock.docs.get(ref), revokedAt: Date.now() });
    expect(await downloadPreparerHandoff(created.id, created.token)).toBeNull();
  });
  it('rejects changed snapshot content even when byte length is unchanged', async () => {
    const created = await createPreparerHandoff('owner', bundle(), 1), path = mock.docs.get(`preparer_handoffs/${created.id}`).storagePath;
    mock.files.set(path, Buffer.alloc(bundle().bytes.length, 65));
    await expect(downloadPreparerHandoff(created.id, created.token)).rejects.toMatchObject({ code: 'HANDOFF_UNAVAILABLE' });
  });
  it('revokes access first and lets the owner reuse an active-link slot', async () => {
    const created = await createPreparerHandoff('owner', bundle(), 1);
    expect(await revokePreparerHandoff('owner', created.id)).toBe(true);
    expect(await listPreparerHandoffs('owner')).toEqual([]); expect(mock.files.size).toBe(0);
    expect(await downloadPreparerHandoff(created.id, created.token)).toBeNull();
    expect(await createPreparerHandoff('owner', bundle(), 7)).toMatchObject({ id: expect.any(String) });
  });
  it('bounds active links and expiry; failed creates remove their snapshot', async () => {
    for (let index = 0; index < 5; index++) await createPreparerHandoff('owner', bundle(), 1);
    await expect(createPreparerHandoff('owner', bundle(), 1)).rejects.toMatchObject({ code: 'HANDOFF_LIMIT', status: 409 });
    expect(mock.files.size).toBe(5);
    await expect(createPreparerHandoff('owner', bundle(), 8)).rejects.toMatchObject({ status: 400 });
  });
  it('blocks new shares and existing downloads when account deletion starts', async () => {
    const created = await createPreparerHandoff('owner', bundle(), 1);
    mock.docs.set('account_deletions/owner', { deletionRequested: true });
    expect(await downloadPreparerHandoff(created.id, created.token)).toBeNull();
    await expect(createPreparerHandoff('owner', bundle(), 1)).rejects.toMatchObject({ code: 'HANDOFF_UNAVAILABLE' });
  });
  it('deletes owner snapshots, cap state and orphans without touching another owner', async () => {
    await createPreparerHandoff('owner', bundle(), 1); mock.files.set('preparer_handoffs/owner/orphan/package.zip', Buffer.from('orphan')); mock.files.set('preparer_handoffs/owner-other/private/package.zip', Buffer.from('other'));
    await deletePreparerHandoffsForUser('owner');
    expect(mock.docs.has('preparer_handoff_owners/owner')).toBe(false);
    expect([...mock.docs.keys()].some(path => path.startsWith('preparer_handoffs/'))).toBe(false);
    expect([...mock.files.keys()]).toEqual(['preparer_handoffs/owner-other/private/package.zip']);
  });
});
