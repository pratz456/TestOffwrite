import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[],
  request: vi.fn(), userId: 'owner' as string | undefined }));
vi.mock('@/lib/firebase/client', () => ({ auth: { get currentUser() { return h.userId ? { uid: h.userId } : null; } } }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: h.request }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return { ...actual,
    useState(initial: unknown) {
      const i = h.cursor++;
      if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial;
      return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next; }];
    },
    useRef(initial: unknown) {
      const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = { current: initial }; return h.slots[i];
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const i = h.cursor++, previous = h.slots[i] as { deps?: unknown[]; callback: unknown } | undefined;
      if (!same(previous?.deps, deps)) h.slots[i] = { deps, callback };
      return (h.slots[i] as { callback: unknown }).callback;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const i = h.cursor++, previous = h.slots[i] as { deps?: unknown[]; cleanup?: () => void } | undefined;
      if (!same(previous?.deps, deps)) {
        const next: { deps: unknown[]; cleanup?: () => void } = { deps }; h.slots[i] = next;
        h.effects.push(() => { previous?.cleanup?.(); const cleanup = effect(); if (cleanup) next.cleanup = cleanup; });
      }
    },
  };
});
import { loadAiAvailability, useAiAvailability } from '../lib/hooks/use-ai-availability';

const configured = () => Response.json({ configured: true, provider: 'openai', model: 'synthetic-model', reason: null });
function AvailabilityHarness() {
  h.cursor = 0; const value = useAiAvailability(h.userId);
  h.effects.splice(0).forEach(effect => effect()); return value;
}
const render = () => AvailabilityHarness();
function unmount() {
  for (const slot of h.slots) if (slot && typeof slot === 'object' && 'cleanup' in slot && typeof slot.cleanup === 'function') slot.cleanup();
}
beforeEach(() => {
  h.slots = []; h.cursor = 0; h.effects = []; h.userId = 'owner'; h.request.mockReset().mockImplementation(async () => configured());
  vi.useFakeTimers();
});
afterEach(() => { unmount(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('authenticated AI configuration contract', () => {
  it('uses only the no-store status endpoint and makes no provider health probe', async () => {
    const signal = new AbortController().signal;
    expect(await loadAiAvailability(signal)).toMatchObject({ status: 'configured', model: 'synthetic-model' });
    expect(h.request).toHaveBeenCalledExactlyOnceWith('/api/ai/status', { cache: 'no-store', signal });
  });
  it.each(['not_configured', 'disabled'])('keeps %s unavailable', async reason => {
    h.request.mockResolvedValueOnce(Response.json({ configured: false, provider: 'openai', model: 'synthetic-model', reason }));
    expect(await loadAiAvailability(new AbortController().signal)).toMatchObject({ status: 'unavailable' });
  });
  it.each([null, {}, { configured: 'true' },
    { configured: true, provider: 'openai', model: 'synthetic-model', reason: 'not_configured' },
    { configured: false, provider: 'openai', model: 'synthetic-model', reason: null },
  ])('never enables an incomplete or contradictory status response: %j', async body => {
    h.request.mockResolvedValueOnce(Response.json(body));
    expect(await loadAiAvailability(new AbortController().signal)).toMatchObject({ status: 'unavailable' });
  });
  it.each([401, 403, 500, 503])('keeps HTTP %s unavailable even if its body claims configured', async status => {
    h.request.mockResolvedValueOnce(Response.json({ configured: true, provider: 'openai', model: 'synthetic-model', reason: null }, { status }));
    expect(await loadAiAvailability(new AbortController().signal)).toMatchObject({ status: 'unavailable' });
  });
});

describe('AI configuration check lifecycle', () => {
  it('starts checking and enables only after the authenticated response', async () => {
    expect(render().status).toBe('checking');
    await vi.advanceTimersByTimeAsync(0);
    expect(render().status).toBe('configured');
    expect(h.request).toHaveBeenCalledOnce();
  });
  it('rechecks after missing configuration is fixed without any analysis call', async () => {
    h.request.mockResolvedValueOnce(Response.json({ configured: false, provider: 'openai', model: 'synthetic-model', reason: 'not_configured' }));
    render(); await vi.advanceTimersByTimeAsync(0);
    const unavailable = render(); expect(unavailable.status).toBe('unavailable');
    expect(await unavailable.refresh()).toBe(true);
    expect(render().status).toBe('configured');
    expect(h.request.mock.calls.map(([url]) => url)).toEqual(['/api/ai/status', '/api/ai/status']);
  });
  it('hides the old account result immediately and ignores a late prior-account response', async () => {
    let complete!: (response: Response) => void;
    h.request.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }));
    const prior = render(); h.userId = 'another-owner';
    expect(render().status).toBe('checking');
    await vi.advanceTimersByTimeAsync(0); expect(render().status).toBe('configured');
    expect(await prior.refresh()).toBe(false); // A stale callback cannot abort the new account's check.
    complete(Response.json({ configured: false, provider: 'openai', model: 'synthetic-model', reason: 'disabled' }));
    await vi.advanceTimersByTimeAsync(0); expect(render().status).toBe('configured');
    expect(h.request).toHaveBeenCalledTimes(2);
  });
  it('does not reuse a configured account after sign-out or send a signed-out request', async () => {
    render(); await vi.advanceTimersByTimeAsync(0); expect(render().status).toBe('configured');
    h.userId = undefined; expect(render().status).toBe('unavailable');
    await vi.advanceTimersByTimeAsync(0); expect(h.request).toHaveBeenCalledOnce();
  });
  it('bounds a stalled request, allows retry, and keeps timeout failures unavailable', async () => {
    h.request.mockImplementationOnce(() => new Promise(() => {}));
    render(); await vi.advanceTimersByTimeAsync(10_000);
    const failed = render(); expect(failed.status).toBe('unavailable');
    expect((h.request.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(await failed.refresh()).toBe(true); expect(render().status).toBe('configured');
  });
  it('aborts on unmount and rejects late completions without leaving timeout timers', async () => {
    let complete!: (response: Response) => void;
    h.request.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }));
    render(); unmount(); await vi.advanceTimersByTimeAsync(0);
    expect((h.request.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    complete(configured()); await vi.advanceTimersByTimeAsync(0);
    // No new hook state is published after its cleanup.
    h.cursor = 0; expect(useAiAvailability(h.userId).status).toBe('checking');
  });
});
