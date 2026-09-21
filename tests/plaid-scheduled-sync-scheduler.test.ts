import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTimeBudget, nextCursor, orderFromCursor, runWithConcurrency, TimeoutError, withTimeout } from '../functions/src/scheduler';
import { PER_USER_TIMEOUT_MS, RUN_TIME_BUDGET_MS, SYNC_CONCURRENCY, SYNC_FETCH_TIMEOUT_MS, SYNC_FUNCTION_TIMEOUT_SECONDS, SYNC_STATE_DOC } from '../functions/src/sync-config';

// Fake timers are opted into per test: faking setImmediate would stall the flush loop below.
afterEach(() => vi.useRealTimers());

describe('runWithConcurrency', () => {
  it('never runs more than the limit at once and starts items in order', async () => {
    let inFlight = 0;
    let peak = 0;
    const startOrder: number[] = [];
    const items = Array.from({ length: 12 }, (_, index) => index);
    const pending: Array<() => void> = [];
    const run = runWithConcurrency(items, 5, async item => {
      startOrder.push(item);
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise<void>(resolve => pending.push(resolve));
      inFlight--;
      return item * 2;
    });
    await Promise.resolve();
    expect(startOrder).toEqual([0, 1, 2, 3, 4]);
    while (pending.length) { pending.shift()!(); await new Promise(resolve => setImmediate(resolve)); }
    const result = await run;
    expect(peak).toBe(5);
    expect(result.started).toBe(12);
    expect(result.skipped).toBe(0);
    expect(result.outcomes.map(outcome => outcome.status === 'fulfilled' ? outcome.value : 'x')).toEqual(items.map(item => item * 2));
  });

  it('reports failures per item without aborting the others', async () => {
    const result = await runWithConcurrency(['a', 'b', 'c'], 2, async item => { if (item === 'b') throw new Error('sync failed'); return item; });
    expect(result.outcomes.map(outcome => outcome.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(result.outcomes[1]).toMatchObject({ item: 'b', status: 'rejected', reason: expect.any(Error) });
  });

  it('stops starting new items once shouldStart returns false and lets in-flight work finish', async () => {
    let allowed = 6;
    const finished: number[] = [];
    const result = await runWithConcurrency(Array.from({ length: 20 }, (_, index) => index), 3, async item => { finished.push(item); return item; },
      { shouldStart: () => allowed-- > 0 });
    expect(result.started).toBe(6);
    expect(result.skipped).toBe(14);
    expect(finished.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('rejects an invalid concurrency limit', async () => {
    await expect(runWithConcurrency([1], 0, async item => item)).rejects.toThrow('positive integer');
  });
});

describe('withTimeout and the time budget', () => {
  it('rejects with TimeoutError when work outlives its ceiling and passes results through otherwise', async () => {
    vi.useFakeTimers();
    const slow = withTimeout(new Promise(resolve => setTimeout(() => resolve('late'), 5_000)), 1_000, 'BANK_SYNC_USER_TIMEOUT');
    const rejection = expect(slow).rejects.toBeInstanceOf(TimeoutError);
    vi.advanceTimersByTime(1_001);
    await rejection;
    await expect(withTimeout(Promise.resolve('ok'), 1_000)).resolves.toBe('ok');
    await expect(withTimeout(Promise.reject(new Error('own failure')), 1_000)).rejects.toThrow('own failure');
  });

  it('only allows a unit of work to start when it can finish inside the budget', () => {
    let clock = 0;
    const budget = createTimeBudget(480_000, () => clock);
    expect(budget.canStart(100_000)).toBe(true);
    clock = 379_999;
    expect(budget.canStart(100_000)).toBe(true);
    clock = 380_001;
    expect(budget.canStart(100_000)).toBe(false);
    expect(budget.remaining()).toBe(99_999);
    clock = 500_000;
    expect(budget.remaining()).toBe(0);
    expect(budget.elapsed()).toBe(500_000);
  });

  it('keeps the scheduled sync inside the Cloud Functions timeout', () => {
    expect(SYNC_FUNCTION_TIMEOUT_SECONDS).toBe(540);
    expect(SYNC_CONCURRENCY).toBe(5);
    expect(PER_USER_TIMEOUT_MS).toBeGreaterThan(SYNC_FETCH_TIMEOUT_MS);
    // The last user may start at RUN_TIME_BUDGET_MS - PER_USER_TIMEOUT_MS and run the full ceiling,
    // leaving headroom for the state write and logging before the platform timeout.
    expect(RUN_TIME_BUDGET_MS).toBeLessThanOrEqual(SYNC_FUNCTION_TIMEOUT_SECONDS * 1000 - 30_000);
  });
});

describe('resume cursor', () => {
  it('orders deterministically, resumes after the cursor, and wraps to a new pass when exhausted', () => {
    const ids = ['charlie', 'alice', 'bob', 'alice', 'dave'];
    expect(orderFromCursor(ids, null)).toEqual(['alice', 'bob', 'charlie', 'dave']);
    expect(orderFromCursor(ids, 'bob')).toEqual(['charlie', 'dave']);
    expect(orderFromCursor(ids, 'bobby')).toEqual(['charlie', 'dave']);
    expect(orderFromCursor(ids, 'dave')).toEqual(['alice', 'bob', 'charlie', 'dave']);
  });

  it('marks the last started user while work remains and clears once the pass completes', () => {
    expect(nextCursor(['alice', 'bob'], 3)).toBe('bob');
    expect(nextCursor(['alice', 'bob'], 0)).toBeNull();
    expect(nextCursor([], 5, 'bob')).toBe('bob');
    expect(nextCursor([], 0)).toBeNull();
  });

  it('keeps the progress marker collection closed to every client', () => {
    const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
    const collection = SYNC_STATE_DOC.split('/')[0];
    const block = rules.match(new RegExp(`match /${collection}/\\{[A-Za-z]+\\}\\s*\\{([\\s\\S]*?)\\n    \\}`));
    expect(block, `${collection} rules block`).toBeDefined();
    expect(block![1]).toMatch(/allow read, write: if false;/);
    expect(block![1].match(/allow /g)).toHaveLength(1);
  });
});
