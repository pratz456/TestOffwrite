import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Data = Record<string, any>;
const mocks = vi.hoisted(() => ({
  docs: new Map<string, Data>(), enqueue: vi.fn(), lock: Promise.resolve(),
  reads: [] as string[], queries: [] as Array<{ path: string; limit: number; after: string | null; ids: string[] }>,
}));
vi.mock('@/lib/firebase/admin', () => {
  function reference(path: string): any {
    return { path, id: path.split('/').at(-1), get: async () => snapshot(path), collection: (name: string) => collection(`${path}/${name}`) };
  }
  function snapshot(path: string): any {
    mocks.reads.push(path);
    const value = mocks.docs.get(path);
    return { exists: value !== undefined, id: path.split('/').at(-1), ref: reference(path), data: () => value === undefined ? undefined : structuredClone(value) };
  }
  function collection(path: string, maximum = Infinity, after: string | null = null): any {
    return {
      doc: (id: string) => reference(`${path}/${id}`),
      orderBy: () => collection(path, maximum, after),
      limit: (value: number) => collection(path, value, after),
      startAfter: (id: string) => collection(path, maximum, id),
      get: async () => {
        const paths = [...mocks.docs.keys()].filter(key => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1)
          .sort().filter(key => after === null || key.split('/').at(-1)! > after).slice(0, maximum);
        mocks.queries.push({ path, limit: maximum, after, ids: paths.map(key => key.split('/').at(-1)!) });
        return { docs: paths.map(snapshot) };
      },
    };
  }
  return { adminDb: {
    doc: reference, collection,
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const before = mocks.lock;
      let release!: () => void;
      mocks.lock = new Promise<void>(resolve => { release = resolve; });
      await before;
      const writes: Array<() => void> = [];
      try {
        const result = await fn({ get: async (ref: any) => snapshot(ref.path),
          set: (ref: any, value: Data) => writes.push(() => mocks.docs.set(ref.path, structuredClone(value))),
          update: (ref: any, value: Data) => writes.push(() => {
            if (!mocks.docs.has(ref.path)) throw new Error('missing document');
            mocks.docs.set(ref.path, { ...mocks.docs.get(ref.path), ...structuredClone(value) });
          }),
        });
        writes.forEach(write => write());
        return result;
      } finally { release(); }
    },
  } };
});
vi.mock('@/lib/ai/analysis-jobs', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ai/analysis-jobs')>();
  return { ...actual, enqueueBankTransactionAnalysis: mocks.enqueue };
});

import { analysisProfileFieldsKey } from '@/functions-analysis/src/profile-fields';
import { enqueueProfileAnalysisRefresh, processProfileAnalysisRefresh, PROFILE_REFRESH_PAGE_SIZE } from '@/lib/ai/profile-analysis-refresh';

const uid = 'synthetic-profile-user';
const profilePath = `user_profiles/${uid}`;
const jobPath = `profile_analysis_refresh/${uid}`;
const job = () => structuredClone(mocks.docs.get(jobPath)!);
const expectedFingerprint = () => createHash('sha256').update(analysisProfileFieldsKey(mocks.docs.get(profilePath)!)).digest('hex');
const profileChange = (values: Data) => mocks.docs.set(profilePath, { ...mocks.docs.get(profilePath), ...values });
async function processCurrent() { return processProfileAnalysisRefresh(uid, job().generation); }
function account(id: string, count: number) {
  const path = `${profilePath}/accounts/${id}`;
  mocks.docs.set(path, { userId: uid, type: 'depository' });
  for (let index = 0; index < count; index++) mocks.docs.set(`${path}/transactions/tx-${String(index).padStart(3, '0')}`, { userId: uid, amount: 10, date: '2026-09-23' });
}
function pauseNextEnqueue() {
  let resolve!: (value: { status: string; enqueued: boolean }) => void;
  let reject!: (error: Error) => void;
  let started!: () => void;
  const began = new Promise<void>(done => { started = done; });
  mocks.enqueue.mockImplementationOnce(() => {
    started();
    return new Promise((done, fail) => { resolve = done; reject = fail; });
  });
  return { began, resolve: () => resolve({ status: 'queued', enqueued: true }), reject: () => reject(new Error('Synthetic enqueue interruption')) };
}

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-23T19:00:00Z'));
  mocks.docs.clear(); mocks.reads.length = 0; mocks.queries.length = 0; mocks.lock = Promise.resolve();
  mocks.docs.set(profilePath, { profession: 'Designer', business_entity: 'sole_proprietor', state: 'CA' });
  mocks.enqueue.mockResolvedValue({ status: 'queued', enqueued: true });
});
afterEach(() => vi.useRealTimers());

describe('durable profile analysis refresh', () => {
  it('deduplicates concurrent events and irrelevant metadata without restarting progress', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => enqueueProfileAnalysisRefresh(uid)));
    expect(results.filter(result => result.status === 'queued')).toHaveLength(1);
    expect(results.filter(result => result.status === 'unchanged')).toHaveLength(7);
    account('bank-a', 27);
    await processCurrent();
    const before = job();
    profileChange({ displayName: 'Updated name', lastSyncAt: Date.now(), subscriptionStatus: 'premium' });
    expect(await enqueueProfileAnalysisRefresh(uid)).toEqual({ status: 'unchanged' });
    expect(job()).toEqual(before);
  });

  it('uses the latest saved profile for reordered events and canonicalizes nested field order', async () => {
    await enqueueProfileAnalysisRefresh(uid);
    const original = job().generation;
    profileChange({ profession: 'Consultant', income_breakdown: { business: 80000, wages: 10000 } });
    await enqueueProfileAnalysisRefresh(uid);
    const newest = job();
    expect(newest.generation).not.toBe(original);
    expect(newest.fingerprint).toBe(expectedFingerprint());
    // An old event delivery can supply only an ID. It cannot restore its old profile payload.
    expect(await enqueueProfileAnalysisRefresh(uid)).toEqual({ status: 'unchanged' });
    profileChange({ income_breakdown: { wages: 10000, business: 80000 } });
    expect(await enqueueProfileAnalysisRefresh(uid)).toEqual({ status: 'unchanged' });
    expect(job()).toEqual(newest);
    expect(await processProfileAnalysisRefresh(uid, original)).toEqual({ status: 'obsolete', retry: false });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('resumes bounded 25-row pages across all accounts using durable continuation generations', async () => {
    account('bank-d', 26); account('bank-b', 3); account('bank-a', 54); account('bank-c-empty', 0);
    mocks.enqueue.mockImplementation(async (address: { accountId: string; transactionId: string }) => ({ status:
      address.accountId === 'bank-b' && address.transactionId === 'tx-001' ? 'completed' :
        address.accountId === 'bank-a' && address.transactionId === 'tx-005' ? 'skipped' : 'queued', enqueued: true }));
    await enqueueProfileAnalysisRefresh(uid);
    const generations = new Set<string>();
    let deliveries = 0;
    while (job().status !== 'completed' && deliveries++ < 20) {
      const generation = job().generation;
      expect(generations.has(generation)).toBe(false);
      generations.add(generation);
      const callsBefore = mocks.enqueue.mock.calls.length;
      const result = await processProfileAnalysisRefresh(uid, generation);
      expect(mocks.enqueue.mock.calls.length - callsBefore).toBeLessThanOrEqual(PROFILE_REFRESH_PAGE_SIZE);
      expect(result.retry).toBe(false);
      if (result.status === 'queued') {
        expect(job().generation).not.toBe(generation);
        const progress = job();
        expect(await processProfileAnalysisRefresh(uid, generation)).toEqual({ status: 'obsolete', retry: false });
        expect(job()).toEqual(progress);
      }
    }
    expect(deliveries).toBeLessThan(20);
    expect(job()).toMatchObject({ status: 'completed', scanned: 83, leaseToken: null, leaseExpiresAt: null });
    const calls = mocks.enqueue.mock.calls;
    expect(calls).toHaveLength(83);
    expect(new Set(calls.map(([address]) => `${address.accountId}/${address.transactionId}`)).size).toBe(83);
    expect(calls.every(([address, retryFailed, options]) => address.userId === uid && retryFailed === true && options.refreshProfile === true)).toBe(true);
    expect(mocks.queries.filter(query => query.path.endsWith('/transactions')).every(query => query.limit === 25 && query.ids.length <= 25)).toBe(true);
    expect(mocks.queries.some(query => query.after === 'tx-024')).toBe(true);
    expect(mocks.queries.some(query => query.after === 'tx-049')).toBe(true);
    expect(await enqueueProfileAnalysisRefresh(uid)).toEqual({ status: 'unchanged' });
  });

  it('finishes an empty account collection without enqueueing provider work', async () => {
    await enqueueProfileAnalysisRefresh(uid);
    expect(await processCurrent()).toEqual({ status: 'completed', retry: false });
    expect(job()).toMatchObject({ scanned: 0, status: 'completed' });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('skips a missing profile and retires existing work after profile deletion', async () => {
    mocks.docs.delete(profilePath);
    expect(await enqueueProfileAnalysisRefresh(uid)).toEqual({ status: 'skipped' });
    expect(mocks.docs.has(jobPath)).toBe(false);
    mocks.docs.set(profilePath, { profession: 'Designer' });
    account('bank-a', 2);
    await enqueueProfileAnalysisRefresh(uid);
    mocks.docs.delete(profilePath);
    expect(await processCurrent()).toEqual({ status: 'obsolete', retry: false });
    expect(job()).toMatchObject({ status: 'completed', leaseToken: null, leaseExpiresAt: null });
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.queries).toHaveLength(0);
  });

  it('discovers a newer saved profile during claim even before its event arrives', async () => {
    account('bank-a', 2);
    await enqueueProfileAnalysisRefresh(uid);
    const original = job().generation;
    profileChange({ profession: 'Photographer' });
    expect(await processProfileAnalysisRefresh(uid, original)).toEqual({ status: 'obsolete', retry: false });
    expect(job()).toMatchObject({ status: 'queued', scanned: 0, fingerprint: expectedFingerprint() });
    expect(job().generation).not.toBe(original);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(await enqueueProfileAnalysisRefresh(uid)).toEqual({ status: 'unchanged' });
    await processCurrent();
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
  });

  it.each(['', '.', '..', '../another-user', 'nested/user', 'back\\slash', 'control\u0000id', 'x'.repeat(257)])('rejects invalid IDs before any Firestore access: %j', async invalid => {
    expect(await enqueueProfileAnalysisRefresh(invalid)).toEqual({ status: 'invalid' });
    expect(await processProfileAnalysisRefresh(invalid, 'valid-generation')).toEqual({ status: 'invalid', retry: false });
    expect(await processProfileAnalysisRefresh(uid, invalid)).toEqual({ status: 'invalid', retry: false });
    expect(mocks.reads).toHaveLength(0);
    expect(mocks.queries).toHaveLength(0);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('ignores forged generations and a different user without touching another user\'s job', async () => {
    account('bank-a', 2);
    await enqueueProfileAnalysisRefresh(uid);
    const before = job();
    expect(await processProfileAnalysisRefresh(uid, 'forged-valid-generation')).toEqual({ status: 'obsolete', retry: false });
    expect(await processProfileAnalysisRefresh('another-user', before.generation)).toEqual({ status: 'obsolete', retry: false });
    expect(job()).toEqual(before);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('retries a partial enqueue under the same generation without skipping or double-counting rows', async () => {
    account('bank-a', 3);
    const queued = new Set<string>();
    let failedOnce = false;
    mocks.enqueue.mockImplementation(async (address: { transactionId: string }) => {
      if (address.transactionId === 'tx-001' && !failedOnce) { failedOnce = true; throw new Error('Synthetic write interruption'); }
      const enqueued = !queued.has(address.transactionId);
      queued.add(address.transactionId);
      return { status: 'queued', enqueued };
    });
    await enqueueProfileAnalysisRefresh(uid);
    const generation = job().generation;
    await expect(processCurrent()).rejects.toThrow('Synthetic write interruption');
    expect(job()).toMatchObject({ generation, status: 'queued', scanned: 0, transactionCursor: null, leaseToken: null });
    expect([...queued]).toEqual(['tx-000']);
    expect(await processCurrent()).toEqual({ status: 'queued', retry: false });
    expect(job()).toMatchObject({ scanned: 3 });
    // Enqueue progress belongs to each account's atomic analysis job. A coordinator
    // aggregate would lose successful writes that occurred before an interrupted page.
    expect(job()).not.toHaveProperty('queued');
    expect(queued.size).toBe(3);
    expect(mocks.enqueue.mock.calls.map(([address]) => address.transactionId)).toEqual(['tx-000', 'tx-001', 'tx-000', 'tx-001', 'tx-002']);
  });

  it('returns retry while a concurrent delivery owns the active lease', async () => {
    account('bank-a', 1);
    await enqueueProfileAnalysisRefresh(uid);
    const paused = pauseNextEnqueue();
    const running = processCurrent();
    await paused.began;
    expect(await processCurrent()).toEqual({ status: 'busy', retry: true });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    paused.resolve();
    expect(await running).toEqual({ status: 'queued', retry: false });
  });

  it.each(['resolve', 'reject'] as const)('a superseded page cannot overwrite a newer profile generation when enqueue %s happens', async outcome => {
    account('bank-a', 1);
    await enqueueProfileAnalysisRefresh(uid);
    const paused = pauseNextEnqueue();
    const running = processCurrent();
    await paused.began;
    profileChange({ profession: 'Musician', state: 'NY' });
    await enqueueProfileAnalysisRefresh(uid);
    const replacement = job();
    paused[outcome]();
    if (outcome === 'resolve') expect(await running).toEqual({ status: 'obsolete', retry: false });
    else await expect(running).rejects.toThrow('Synthetic enqueue interruption');
    expect(job()).toEqual(replacement);
    expect(job()).toMatchObject({ status: 'queued', fingerprint: expectedFingerprint(), scanned: 0, leaseToken: null });
  });

  it('reclaims an expired lease and discards the older worker completion', async () => {
    account('bank-a', 1);
    await enqueueProfileAnalysisRefresh(uid);
    const paused = pauseNextEnqueue();
    const running = processCurrent();
    await paused.began;
    vi.advanceTimersByTime(120_001);
    expect(await processCurrent()).toEqual({ status: 'queued', retry: false });
    const replacementProgress = job();
    paused.resolve();
    expect(await running).toEqual({ status: 'obsolete', retry: false });
    expect(job()).toEqual(replacementProgress);
    expect(job()).toMatchObject({ scanned: 1 });
  });
});
