/**
 * Pure scheduling helpers for long-running scheduled functions: bounded concurrency, per-item
 * timeouts, a wall-clock budget, and a resumable cursor over a deterministic list of IDs.
 * No Firebase imports so the logic is unit-testable from the root test suite.
 */

export interface TimeBudget {
  readonly totalMs: number;
  elapsed(): number;
  remaining(): number;
  /** True when a unit of work expected to take `estimatedMs` can still finish inside the budget. */
  canStart(estimatedMs: number): boolean;
}

export function createTimeBudget(totalMs: number, now: () => number = Date.now): TimeBudget {
  if (!Number.isFinite(totalMs) || totalMs <= 0) throw new Error('Time budget must be a positive number of milliseconds');
  const startedAt = now();
  return {
    totalMs,
    elapsed: () => now() - startedAt,
    remaining: () => Math.max(0, totalMs - (now() - startedAt)),
    canStart: estimatedMs => now() - startedAt + Math.max(0, estimatedMs) <= totalMs,
  };
}

export class TimeoutError extends Error {
  constructor(message = 'TIMEOUT') { super(message); this.name = 'TimeoutError'; }
}

/** Rejects with TimeoutError after `ms`; the underlying promise keeps running but its outcome is ignored. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message = 'TIMEOUT'): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) throw new Error('Timeout must be a positive number of milliseconds');
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

export type ConcurrencyOutcome<T, R> =
  | { item: T; index: number; status: 'fulfilled'; value: R }
  | { item: T; index: number; status: 'rejected'; reason: unknown };

export interface ConcurrencyResult<T, R> {
  /** One entry per started item, in start order (completion order is not preserved). */
  outcomes: Array<ConcurrencyOutcome<T, R>>;
  started: number;
  /** Items never started because `shouldStart` returned false. */
  skipped: number;
}

/**
 * Run `worker` over `items` with at most `limit` in flight. Items start strictly in list order; before
 * each start `shouldStart()` is consulted so a time budget can stop new work while in-flight work
 * finishes. Never throws for worker failures; they are reported per item.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  options: { shouldStart?: () => boolean } = {},
): Promise<ConcurrencyResult<T, R>> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Concurrency limit must be a positive integer');
  const shouldStart = options.shouldStart ?? (() => true);
  const outcomes: Array<ConcurrencyOutcome<T, R>> = [];
  let next = 0;
  let stopped = false;

  async function lane(): Promise<void> {
    while (!stopped && next < items.length) {
      if (!shouldStart()) { stopped = true; return; }
      const index = next++;
      const item = items[index];
      try {
        const value = await worker(item, index);
        outcomes[index] = { item, index, status: 'fulfilled', value };
      } catch (reason) {
        outcomes[index] = { item, index, status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => lane()));
  const started = outcomes.filter(Boolean).length;
  return { outcomes: outcomes.filter(Boolean), started, skipped: items.length - started };
}

/**
 * Deterministic resume order: IDs sorted ascending, beginning after `cursor`. When the cursor is
 * missing, unknown, or already past the last ID, the full sorted list is returned (a new pass).
 */
export function orderFromCursor(ids: readonly string[], cursor: string | null | undefined): string[] {
  const sorted = [...new Set(ids)].sort();
  if (!cursor) return sorted;
  const remaining = sorted.filter(id => id > cursor);
  return remaining.length > 0 ? remaining : sorted;
}

/**
 * Marker for the next run: the last started ID while work remains, the previous cursor when nothing
 * could start (so no progress is lost), and `null` once the pass covered every ID.
 */
export function nextCursor(started: readonly string[], skipped: number, previous: string | null = null): string | null {
  if (skipped === 0) return null;
  return started.length > 0 ? started[started.length - 1] : previous;
}
