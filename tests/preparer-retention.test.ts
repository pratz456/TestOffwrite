import { describe, expect, it, vi } from 'vitest';
import { cleanupPreparerHandoffs, RETENTION_CONCURRENCY } from '../functions-analysis/src/preparer-retention';

const NOW = Date.UTC(2026, 8, 23, 12);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const docs = new Map<string, any>(), files = new Set<string>(), failures = new Set<string>();
  let failCommit = false;
  let transactionQueue = Promise.resolve();
  const ref = (path: string): any => ({ path, id: path.split('/').at(-1), get: async () => snapshot(path) });
  const snapshot = (path: string) => ({ id: path.split('/').at(-1)!, exists: docs.has(path), ref: ref(path), data: () => structuredClone(docs.get(path)) });
  const query = (filters: [string, string, number][] = [], field = '', limit = Infinity): any => ({
    where: (key: string, op: string, value: number) => query([...filters, [key, op, value]], field, limit),
    orderBy: (key: string) => query(filters, key, limit), limit: (n: number) => query(filters, field, n),
    get: async () => {
      const rows = [...docs].filter(([path, value]) => path.startsWith('preparer_handoffs/')
        && filters.every(([key, op, cutoff]) => typeof value[key] === 'number' && (op === '<=' ? value[key] <= cutoff : value[key] > cutoff)))
        .sort((a, b) => a[1][field] - b[1][field]).slice(0, limit).map(([path]) => snapshot(path));
      return { docs: rows, size: rows.length };
    },
  });
  const db: any = { collection: () => query(), doc: ref, runTransaction: (fn: any) => {
    // Serialize the mock transactions to preserve Firestore's commit isolation.
    const task = transactionQueue.then(async () => {
      const writes: (() => void)[] = [];
      const result = await fn({ get: (doc: any) => doc.get(), update: (doc: any, values: any) => writes.push(() => docs.set(doc.path, { ...docs.get(doc.path), ...structuredClone(values) })), delete: (doc: any) => writes.push(() => docs.delete(doc.path)) });
      if (failCommit) throw new Error('Synthetic Firestore outage');
      writes.forEach(write => write()); return result;
    });
    transactionQueue = task.then(() => undefined, () => undefined);
    return task;
  } };
  const deletion = vi.fn(async (path: string) => { if (failures.has(path)) throw new Error('Synthetic Storage outage'); files.delete(path); });
  const bucket = { file: (path: string) => ({ delete: (options: { ignoreNotFound: true }) => { expect(options.ignoreNotFound).toBe(true); return deletion(path); } }) };
  function add(n: number, data: Record<string, any> = {}) {
    const owner = data.userId ?? 'owner', handoffId = id(n), path = `preparer_handoffs/${owner}/${handoffId}/package.zip`;
    docs.set(`preparer_handoffs/${handoffId}`, { userId: owner, expiresAt: NOW - 1000, revokedAt: null, storagePath: path, ...data });
    const ownerPath = `preparer_handoff_owners/${owner}`;
    docs.set(ownerPath, { userId: owner, slots: { ...docs.get(ownerPath)?.slots, [handoffId]: data.expiresAt ?? NOW - 1000 } });
    files.add(path); return { path, ref: `preparer_handoffs/${handoffId}`, ownerPath, id: handoffId };
  }
  return { docs, files, failures, db, bucket, deletion, add, setFailCommit: (value: boolean) => { failCommit = value; } };
}

describe('private preparer package retention', () => {
  it('removes expired and early-revoked snapshots while preserving live links and other owner slots', async () => {
    const f = fixture(), expired = f.add(1), revoked = f.add(2, { expiresAt: NOW + 86400, revokedAt: NOW - 10 }), live = f.add(3, { expiresAt: NOW + 86400 }), other = f.add(4, { userId: 'other', expiresAt: NOW + 86400 });
    expect(await cleanupPreparerHandoffs(f.db, f.bucket, NOW)).toEqual({ examined: 2, deleted: 2, skipped: 0, failed: 0, batchFull: false });
    expect([...f.files]).toEqual([live.path, other.path]);
    expect(f.docs.has(expired.ref)).toBe(false); expect(f.docs.has(revoked.ref)).toBe(false);
    expect(f.docs.get(live.ownerPath).slots).toEqual({ [live.id]: NOW + 86400 });
    expect(f.docs.get(other.ownerPath).slots).toEqual({ [other.id]: NOW + 86400 });
  });

  it('retains metadata and its slot after Storage failure, and removes them on a later successful retry', async () => {
    const f = fixture(), failed = f.add(1), succeeded = f.add(2);
    f.failures.add(failed.path);
    expect(await cleanupPreparerHandoffs(f.db, f.bucket, NOW)).toMatchObject({ deleted: 1, failed: 1 });
    expect(f.files.has(failed.path)).toBe(true); expect(f.docs.has(failed.ref)).toBe(true);
    expect(f.docs.get(failed.ownerPath).slots[failed.id]).toBeDefined();
    expect(f.docs.has(succeeded.ref)).toBe(false);
    f.failures.clear();
    expect(await cleanupPreparerHandoffs(f.db, f.bucket, NOW)).toMatchObject({ deleted: 1, failed: 0 });
    expect(f.files.size).toBe(0); expect(f.docs.has(failed.ref)).toBe(false);
  });

  it('retries metadata removal after the blob was removed but Firestore commit failed', async () => {
    const f = fixture(), item = f.add(1); f.setFailCommit(true);
    expect(await cleanupPreparerHandoffs(f.db, f.bucket, NOW)).toMatchObject({ deleted: 0, failed: 1 });
    expect(f.files.has(item.path)).toBe(false); expect(f.docs.has(item.ref)).toBe(true);
    f.setFailCommit(false);
    expect(await cleanupPreparerHandoffs(f.db, f.bucket, NOW)).toMatchObject({ deleted: 1, failed: 0 });
    expect(f.docs.has(item.ref)).toBe(false);
  });

  it('derives deletion paths from owner and ID, and rejects path traversal owners and invalid IDs', async () => {
    const f = fixture(), valid = f.add(1, { storagePath: 'receipts/victim/private.pdf' }), malformed = f.add(2, { userId: '../victim' });
    f.files.add('receipts/victim/private.pdf');
    f.docs.set('preparer_handoffs/not-a-uuid', { userId: 'owner', expiresAt: NOW - 1 });
    expect(await cleanupPreparerHandoffs(f.db, f.bucket, NOW)).toMatchObject({ deleted: 1, failed: 2 });
    expect(f.deletion.mock.calls).toEqual([[valid.path]]);
    expect(f.files.has('receipts/victim/private.pdf')).toBe(true); expect(f.docs.has(malformed.ref)).toBe(true);
  });

  it('deduplicates a handoff that is both expired and revoked', async () => {
    const f = fixture(); f.add(1, { revokedAt: NOW - 1 });
    expect(await cleanupPreparerHandoffs(f.db, f.bucket, NOW)).toMatchObject({ examined: 1, deleted: 1 });
    expect(f.deletion).toHaveBeenCalledTimes(1);
  });

  it('does not recreate owner state removed by concurrent account deletion', async () => {
    const f = fixture(), item = f.add(1); f.docs.delete(item.ownerPath);
    expect(await cleanupPreparerHandoffs(f.db, f.bucket, NOW)).toMatchObject({ deleted: 1, failed: 0 });
    expect(f.docs.has(item.ownerPath)).toBe(false);
  });

  it('bounds each run and network concurrency, then drains the remaining eligible records on a subsequent run', async () => {
    const f = fixture();
    for (let n = 1; n <= 102; n++) f.add(n);
    for (let n = 103; n <= 204; n++) f.add(n, { expiresAt: NOW + 86400, revokedAt: NOW - 1 });
    let inFlight = 0, peak = 0;
    f.deletion.mockImplementation(async path => {
      peak = Math.max(peak, ++inFlight);
      await new Promise(resolve => setTimeout(resolve, 1));
      f.files.delete(path); inFlight--;
    });
    expect(await cleanupPreparerHandoffs(f.db, f.bucket, NOW)).toMatchObject({ examined: 200, deleted: 200, batchFull: true });
    expect(peak).toBeLessThanOrEqual(RETENTION_CONCURRENCY); expect(f.files.size).toBe(4);
    expect(await cleanupPreparerHandoffs(f.db, f.bucket, NOW)).toMatchObject({ examined: 4, deleted: 4, batchFull: false });
    expect(f.files.size).toBe(0);
  });
});
