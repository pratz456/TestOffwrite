import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { analysisJobView, parseAnalysisJob, parseAnalysisQueue, type AnalysisJob } from '../lib/ai/client-job-progress';

const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[],
  uid: 'owner', accountId: 'acct_with_underscores', push: vi.fn(), api: vi.fn(), fetch: vi.fn(),
  info: vi.fn(), warning: vi.fn(), error: vi.fn(), subscribe: vi.fn(),
}));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial: unknown) {
      const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial;
      return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next; }];
    },
    useRef(initial: unknown) { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = { current: initial }; return h.slots[i]; },
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
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
const router = { push: h.push };
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ accountId: h.accountId }) }));
vi.mock('react-plaid-link', () => ({ usePlaidLink: () => ({ open: vi.fn(), ready: false }) }));
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: { id: h.uid }, loading: false }) }));
vi.mock('@/lib/firebase/client', () => ({ db: {}, auth: { get currentUser() { return { uid: h.uid, getIdToken: async () => 'synthetic-token' }; } } }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: h.uid, getIdToken: async () => 'synthetic-token' } }) }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, collection: string, id: string) => ({ collection, id }), onSnapshot: h.subscribe }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: h.api }));
vi.mock('sonner', () => ({ toast: { info: h.info, warning: h.warning, error: h.error } }));
import { useJobProgress } from '../lib/hooks/useJobProgress';
import { JobProgress } from '../components/JobProgress';
import { PlaidLinkScreen } from '../components/plaid-link-screen';
import AccountUsagePage from '../app/protected/account-usage/[accountId]/page';

type Props = { children?: unknown; onClick?: () => void | Promise<void>; value?: string; onChange?: (event: { target: { value: string } }) => void };
type Element = ReactElement<Props>;
function walk(node: unknown): Element[] { return Array.isArray(node) ? node.flatMap(walk) : isValidElement<Props>(node) ? [node, ...walk(node.props.children)] : []; }
function text(node: unknown): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement<Props>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function render<T>(component: () => T): T { h.cursor = 0; const result = component(); h.effects.splice(0).forEach(effect => effect()); return result; }
function HookHarness() { return useJobProgress(h.accountId); }
const link = () => PlaidLinkScreen({ user: { id: h.uid }, onSuccess() {}, onBack() {} });
const queuedJob = (): AnalysisJob => ({ status: 'running', phase: 'queued', total: 2, processed: 0, succeeded: 0, failed: 0 });
const finishedJob = (failed = 0): AnalysisJob => ({ status: failed ? 'failed' : 'done', total: 2, processed: 2, succeeded: 2 - failed, failed });
function publish(job: unknown, call = h.subscribe.mock.calls.length - 1) {
  h.subscribe.mock.calls[call][1]({ exists: () => job !== null, data: () => job });
}
function cleanup() { for (const slot of h.slots) if (slot && typeof slot === 'object' && 'cleanup' in slot && typeof slot.cleanup === 'function') slot.cleanup(); }
const action = (tree: unknown, label: string) => walk(tree).find(node => typeof node.props.onClick === 'function' && text(node) === label)!;
beforeEach(() => {
  h.slots = []; h.cursor = 0; h.effects = []; h.uid = 'owner'; h.accountId = 'acct_with_underscores'; vi.resetAllMocks(); vi.useFakeTimers();
  vi.stubGlobal('window', { location: { origin: 'http://localhost:3000', search: `?accountId=${h.accountId}&analyzing=true` } });
  vi.stubGlobal('fetch', h.fetch); h.subscribe.mockImplementation(() => vi.fn());
  h.api.mockImplementation(async () => Response.json({ success: true, data: queuedJob() }));
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('durable analysis job contract', () => {
  it('keeps queued work distinct from saved suggestions', () => {
    expect(analysisJobView(queuedJob())).toMatchObject({ status: 'queued', terminal: false });
    expect(parseAnalysisQueue({ jobId: 'owner_account', queued: 2, status: 'queued' })).toMatchObject({ queued: 2 });
    expect(parseAnalysisQueue({ jobId: 'owner_account', queued: 0, status: 'idle' })).toMatchObject({ status: 'idle' });
    expect(parseAnalysisQueue({ jobId: 'owner_account', queued: 0, status: 'queued' })).toBeNull();
  });
  it('does not convert processed failures, a running counter at 100%, or empty jobs into success', () => {
    expect(analysisJobView(finishedJob(1)).status).toBe('error');
    expect(analysisJobView({ ...finishedJob(1), status: 'done' }).status).toBe('error');
    expect(analysisJobView({ ...finishedJob(), status: 'running' }).status).toBe('analyzing');
    expect(analysisJobView({ ...queuedJob(), status: 'done', total: 0 }).status).toBe('idle');
    expect(analysisJobView(finishedJob()).status).toBe('completed');
  });
  it.each([{}, { ...queuedJob(), failed: 1 }, { ...queuedJob(), processed: 3 }, { ...queuedJob(), succeeded: NaN }])('rejects incomplete counts: %j', job => {
    expect(parseAnalysisJob(job)).toBeNull();
  });
});

describe('owner-scoped job subscriptions and display', () => {
  it('prefixes the authenticated user even when an account ID contains underscores', () => {
    expect(render(HookHarness).loading).toBe(true);
    expect(h.subscribe.mock.calls[0][0]).toEqual({ collection: 'analysis_jobs', id: 'owner_acct_with_underscores' });
    publish(queuedJob()); expect(render(HookHarness).job).toMatchObject({ phase: 'queued' });
  });
  it('clears previous progress on account/user changes and ignores stale snapshots', () => {
    render(HookHarness); publish(finishedJob()); expect(render(HookHarness).job?.status).toBe('done');
    h.uid = 'another-user'; expect(render(HookHarness)).toMatchObject({ job: null, loading: true });
    publish(finishedJob(), 0); expect(render(HookHarness).job).toBeNull();
    publish(queuedJob()); expect(render(HookHarness).job?.status).toBe('running');
    expect(h.subscribe.mock.results[0].value).toHaveBeenCalledOnce();
  });
  it('shows failures as failed records and opens the actual review route', () => {
    const component = () => JobProgress({ accountId: h.accountId });
    render(component); publish({ ...finishedJob(2), lastErrorCode: 'AI_UNAVAILABLE' }); const tree = render(component);
    expect(text(tree)).toContain('Analysis needs attention'); expect(text(tree)).toContain('0 suggestions saved · 2 failed');
    expect(text(tree)).not.toContain('Analysis Complete'); expect(text(tree)).not.toContain('2 of 2 analyzed');
    action(tree, 'Review Transactions').props.onClick!();
    expect(h.push).toHaveBeenCalledWith('/protected?screen=review-transactions&accountId=acct_with_underscores');
  });
});

describe('Plaid progress never guesses completion', () => {
  it('monitors the existing durable job without starting duplicate analysis on mount', async () => {
    render(link); await vi.advanceTimersByTimeAsync(0); const tree = render(link);
    expect(text(tree)).toContain('Analysis queued');
    expect(h.api.mock.calls.every(([url]) => url.startsWith('/api/analysis-job?jobId=owner_acct_with_underscores'))).toBe(true);
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.push).not.toHaveBeenCalled();
  });
  it('shows a fully processed failed job and enables explicit retry, without redirecting as successful', async () => {
    h.api.mockImplementation(async () => Response.json({ success: true, data: { ...finishedJob(2), lastErrorCode: 'AI_UNAVAILABLE' } }));
    render(link); await vi.advanceTimersByTimeAsync(0); const tree = render(link);
    expect(text(tree)).toContain('Analysis needs attention'); expect(text(tree)).toContain('AI is unavailable');
    await vi.advanceTimersByTimeAsync(5000); expect(h.push).not.toHaveBeenCalled();
    h.api.mockImplementation(async (url: string) => url.includes('auto-analyze')
      ? Response.json({ jobId: 'owner_acct_with_underscores', queued: 2, status: 'queued' })
      : Response.json({ success: true, data: queuedJob() }));
    await action(tree, 'Retry AI analysis').props.onClick!();
    expect(text(render(link))).toContain('Analysis queued');
    const request = h.api.mock.calls.find(([url]) => url === '/api/plaid/auto-analyze')!;
    expect(JSON.parse(request[1].body)).toEqual({ accountId: h.accountId });
  });
  it('a progress timeout offers manual review rather than forcing completion', async () => {
    render(link); await vi.advanceTimersByTimeAsync(303000); const tree = render(link);
    expect(text(tree)).toContain('Progress monitoring timed out');
    expect(text(tree)).not.toContain('Analysis Complete!'); expect(h.push).not.toHaveBeenCalled();
    expect(action(tree, 'Review transactions manually')).toBeDefined();
  });
  it('ignores an older pending poll after realtime failure and does not overwrite its retry state', async () => {
    let complete!: (response: Response) => void;
    h.api.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve; }));
    render(link); render(link); // Mount the account-scoped subscription after URL state is applied.
    publish(finishedJob(2)); render(link);
    complete(Response.json({ success: true, data: queuedJob() }));
    await vi.advanceTimersByTimeAsync(0);
    const tree = render(link);
    expect(text(tree)).toContain('Analysis needs attention');
    expect(action(tree, 'Retry AI analysis')).toBeDefined();
    expect(h.push).not.toHaveBeenCalled();
  });
});

describe('account usage queue responses', () => {
  it.each(['queued', 'idle', 'unavailable'])('handles %s without claiming analysis completed', async status => {
    h.fetch.mockImplementation(async (url: string) => url.includes('/usage') ? Response.json({ success: true })
      : status === 'unavailable' ? Response.json({ error: 'AI analysis is unavailable.' }, { status: 503 })
        : Response.json({ jobId: 'owner_acct_with_underscores', queued: status === 'queued' ? 2 : 0, status }));
    const tree = render(AccountUsagePage);
    await action(tree, 'Save & Start Analysis').props.onClick!();
    expect(h.push).toHaveBeenCalledWith(status === 'queued'
      ? '/protected?screen=plaid-link&accountId=acct_with_underscores&analyzing=true'
      : '/protected?screen=review-transactions&accountId=acct_with_underscores');
    expect([...h.info.mock.calls, ...h.warning.mock.calls].flat().join(' ')).not.toMatch(/completed|successfully analyzed/i);
    expect(h.error).not.toHaveBeenCalled();
  });
  it('shows an honest empty-bank state and opens banks when zero imported records produce an idle queue', async () => {
    window.location.search = '?imported=0';
    h.fetch.mockImplementation(async (url: string) => url.includes('/usage') ? Response.json({ success: true })
      : Response.json({ jobId: 'owner_acct_with_underscores', queued: 0, status: 'idle' }));
    render(AccountUsagePage);
    const tree = render(AccountUsagePage);
    expect(text(tree)).toContain('Bank connected; no transactions have arrived yet. Activity will appear as available.');
    await action(tree, 'Save & Continue').props.onClick!();
    expect(h.push).toHaveBeenCalledExactlyOnceWith('/protected?screen=banks-detail');
    expect(h.info).toHaveBeenCalledWith('Bank connected; no transactions have arrived yet. Activity will appear as available.');
    expect(h.error).not.toHaveBeenCalled();
  });
  it('follows real queued work if records arrived after the initial empty import', async () => {
    window.location.search = '?imported=0';
    h.fetch.mockImplementation(async (url: string) => url.includes('/usage') ? Response.json({ success: true })
      : Response.json({ jobId: 'owner_acct_with_underscores', queued: 2, status: 'queued' }));
    render(AccountUsagePage);
    await action(render(AccountUsagePage), 'Save & Continue').props.onClick!();
    expect(h.push).toHaveBeenCalledExactlyOnceWith('/protected?screen=plaid-link&accountId=acct_with_underscores&analyzing=true');
    expect(h.info).toHaveBeenCalledWith('2 records queued for analysis. Suggestions still require your review.');
  });
  it.each(['http-error', 'invalid-acknowledgement', 'network-error'])('does not claim personal classification or navigate after %s', async failure => {
    h.fetch.mockImplementation(async (url: string) => {
      if (url.includes('/usage')) return Response.json({ success: true });
      if (failure === 'network-error') throw new Error('Connection interrupted. Please retry.');
      return failure === 'http-error' ? Response.json({ error: 'Failed' }, { status: 503 }) : Response.json({ ok: true });
    });
    const tree = render(AccountUsagePage);
    walk(tree).find(node => node.props.value === 'personal')!.props.onChange!({ target: { value: 'personal' } });
    await action(render(AccountUsagePage), 'Mark as Personal & Continue').props.onClick!();
    expect(h.error).toHaveBeenCalled();
    expect(h.info).not.toHaveBeenCalled(); expect(h.push).not.toHaveBeenCalled();
    expect(JSON.parse(h.fetch.mock.calls[0][1].body)).toEqual({ usageType: 'personal' });
  });
  it.each([0, 2])('only reports verified personal classification of %s saved rows', async count => {
    window.location.search = '?imported=0';
    h.fetch.mockImplementation(async (url: string) => url.includes('/usage') ? Response.json({ success: true }) : Response.json({ ok: true, count }));
    const tree = render(AccountUsagePage);
    expect(text(tree)).not.toContain('Personal accounts are not used for tax calculations');
    walk(tree).find(node => node.props.value === 'personal')!.props.onChange!({ target: { value: 'personal' } });
    await action(render(AccountUsagePage), 'Mark as Personal & Continue').props.onClick!();
    expect(h.info).toHaveBeenCalledWith(count === 0
      ? 'Bank connected; no transactions have arrived yet. Activity will appear as available.'
      : '2 saved transactions were marked as personal based on your choice. Review any business expenses separately.');
    expect(h.push).toHaveBeenCalledWith(count === 0 ? '/protected?screen=banks-detail' : '/protected');
    expect(h.fetch.mock.calls.some(([url]) => url === '/api/plaid/auto-analyze')).toBe(false);
  });
});
