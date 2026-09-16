import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// Actual handlers and state effects; transport/SDK are mocked, not a live browser test.
const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], request: vi.fn(), loader: vi.fn(), open: vi.fn() }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.request }));
vi.mock('@/lib/tax-filing/column-browser', async importOriginal => ({ ...await importOriginal<typeof import('../lib/tax-filing/column-browser')>(), loadColumnSandbox: harness.loader }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial: unknown) { const index = harness.cursor++; if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial; return [harness.slots[index], (next: unknown) => { harness.slots[index] = typeof next === 'function' ? next(harness.slots[index]) : next; }]; },
    useRef(initial: unknown) { const index = harness.cursor++; if (!(index in harness.slots)) harness.slots[index] = { current: initial }; return harness.slots[index]; },
    useCallback(callback: unknown, deps: unknown[]) { const index = harness.cursor++; if (!same(harness.slots[index]?.deps, deps)) harness.slots[index] = { deps, callback }; return harness.slots[index].callback; },
    useEffect(effect: () => void | (() => void), deps: unknown[]) { const index = harness.cursor++; const previous = harness.slots[index]; if (!same(previous?.deps, deps)) { const next: any = { deps }; harness.slots[index] = next; harness.effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); }); } },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
import { EmbeddedFilingCard } from '../components/embedded-filing-card';
type Element = ReactElement<Record<string, any>>;
let props = { userId: 'synthetic-owner', taxYear: 2025 };
function render(): Element { harness.cursor = 0; const tree = EmbeddedFilingCard(props) as Element; harness.effects.splice(0).forEach(effect => effect()); return tree; }
function walk(node: any): Element[] { return Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : []; }
function text(node: any): string { return Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : String(node ?? ''); }
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const response = (body: unknown, status = 200) => Response.json(body, { status });
const session = (extra = {}) => ({ environment: 'sandbox', taxYear: 2025, userUrl: 'https://app-sandbox.columnapi.com/start?token=synthetic', status: 'submitted', ...extra });
const available = (year = 2025) => ({ available: true, environment: 'sandbox', taxYear: year, status: 'submitted', message: 'Sandbox only', jurisdictions: [{ jurisdiction: 'US', submissionStatus: 'accepted' }, { jurisdiction: 'CA', submissionStatus: 'retryable' }] });
const button = (tree: Element, label: string) => walk(tree).find(node => node.props?.onClick && text(node) === label)!;
const posts = () => harness.request.mock.calls.filter(([, init]) => init?.method === 'POST');
const gets = () => harness.request.mock.calls.filter(([, init]) => !init?.method);
async function ready(consent = false) { render(); await flush(); let tree = render(); if (consent) { walk(tree).find(node => node.type === 'input')!.props.onChange({ target: { checked: true } }); tree = render(); } return tree; }
function defaultRequest(url: string, init?: RequestInit) { return Promise.resolve(response(init?.method === 'POST' ? session() : available(Number(new URL(url, 'https://localhost').searchParams.get('year'))))); }
beforeEach(() => {
  props = { userId: 'synthetic-owner', taxYear: 2025 }; harness.slots = []; harness.cursor = 0; harness.effects = [];
  harness.request.mockReset().mockImplementation(defaultRequest); harness.loader.mockReset().mockResolvedValue({ openModule: harness.open }); harness.open.mockReset();
});

describe('embedded filing actual UI handlers', () => {
  it('disabled availability does not load third-party SDK, collect consent or POST', async () => {
    harness.request.mockResolvedValue(response({ available: false, environment: null, taxYear: 2025, status: 'unavailable', message: 'In-app filing is not available yet.' }));
    const tree = await ready(); expect(text(tree)).toContain('In-app filing is not available yet.');
    expect(walk(tree).some(node => node.type === 'input')).toBe(false); expect(posts()).toHaveLength(0); expect(harness.loader).not.toHaveBeenCalled();
  });
  it('requires explicit consent even if a disabled button handler is invoked directly', async () => {
    const tree = await ready(); const open = button(tree, 'Open filing sandbox');
    expect(open.props.disabled).toBe(true); await open.props.onClick();
    expect(posts()).toHaveLength(0); expect(harness.loader).not.toHaveBeenCalled();
  });
  it('passes only consent and selected year, loads SDK after POST and preserves independent statuses', async () => {
    const tree = await ready(true); await button(tree, 'Open filing sandbox').props.onClick();
    expect(posts()).toHaveLength(1); expect(JSON.parse(posts()[0][1].body)).toEqual({ taxYear: 2025, consent: true });
    expect(harness.open).toHaveBeenCalledWith({ userUrl: session().userUrl, environment: 'sandbox', onClose: expect.any(Function) });
    const content = text(render()); expect(content).toContain('US: accepted'); expect(content).toContain('CA: retryable');
    expect(content).toContain('This sandbox cannot file an IRS or state return.');
  });
  it('coalesces double clicks before the POST resolves', async () => {
    let complete!: (value: Response) => void;
    harness.request.mockImplementation((url, init) => init?.method === 'POST' ? new Promise(resolve => { complete = resolve; }) : defaultRequest(url, init));
    const handler = button(await ready(true), 'Open filing sandbox').props.onClick;
    const first = handler(); const second = handler(); expect(posts()).toHaveLength(1);
    complete(response(session())); await Promise.all([first, second]); expect(harness.open).toHaveBeenCalledTimes(1);
  });
  it.each([{ taxYear: 2024 }, { environment: 'production' }, { userUrl: 'https://evil.invalid/start' }, { userUrl: 'https://app.columnapi.com/start' }])('does not load SDK for an invalid session response: %j', async override => {
    harness.request.mockImplementation((url, init) => init?.method === 'POST' ? Promise.resolve(response(session(override))) : defaultRequest(url, init));
    await button(await ready(true), 'Open filing sandbox').props.onClick();
    expect(harness.loader).not.toHaveBeenCalled(); expect(harness.open).not.toHaveBeenCalled(); expect(text(render())).toContain('The filing session could not be verified.');
  });
  it.each(['userId', 'taxYear'])('ignores an old POST after %s changes and clears prior consent', async field => {
    let complete!: (value: Response) => void;
    harness.request.mockImplementation((url, init) => init?.method === 'POST' ? new Promise(resolve => { complete = resolve; }) : defaultRequest(url, init));
    const launch = button(await ready(true), 'Open filing sandbox').props.onClick();
    props = field === 'userId' ? { ...props, userId: 'other-owner' } : { ...props, taxYear: 2024 };
    render(); await flush(); complete(response(session())); await launch;
    expect(harness.loader).not.toHaveBeenCalled(); expect(harness.open).not.toHaveBeenCalled();
    expect(walk(render()).find(node => node.type === 'input')!.props.checked).toBe(false);
  });
  it.each(['userId', 'taxYear'])('does not open an old session after SDK loading finishes for changed %s', async field => {
    let complete!: (value: unknown) => void;
    harness.loader.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const launch = button(await ready(true), 'Open filing sandbox').props.onClick(); await flush();
    expect(harness.loader).toHaveBeenCalledOnce();
    props = field === 'userId' ? { ...props, userId: 'other-owner' } : { ...props, taxYear: 2024 };
    render(); await flush(); complete({ openModule: harness.open }); await launch;
    expect(harness.open).not.toHaveBeenCalled();
  });
  it('does not reopen an abandoned request after leaving and returning to the same account', async () => {
    let complete!: (value: Response) => void;
    harness.request.mockImplementation((url, init) => init?.method === 'POST' ? new Promise(resolve => { complete = resolve; }) : defaultRequest(url, init));
    const launch = button(await ready(true), 'Open filing sandbox').props.onClick();
    props = { ...props, userId: 'other-owner' }; render(); await flush();
    props = { ...props, userId: 'synthetic-owner' }; render(); await flush();
    complete(response(session())); await launch;
    expect(harness.loader).not.toHaveBeenCalled(); expect(harness.open).not.toHaveBeenCalled();
    expect(walk(render()).find(node => node.type === 'input')!.props.checked).toBe(false);
  });
  it('provider close callback only refreshes GET; it cannot invent an accepted/filed status', async () => {
    await button(await ready(true), 'Open filing sandbox').props.onClick();
    harness.request.mockImplementation((url, init) => init?.method === 'POST' ? defaultRequest(url, init) : Promise.resolve(response({ ...available(), status: 'started', jurisdictions: [] })));
    harness.open.mock.calls[0][0].onClose(); await flush();
    expect(posts()).toHaveLength(1); expect(gets()).toHaveLength(2); expect(text(render())).toContain('Sandbox return: started');
    expect(text(render())).not.toContain('US: accepted');
  });
  it('ignores close callbacks after leaving the account/year and allows a safe retry after SDK error', async () => {
    harness.loader.mockRejectedValueOnce(new Error('Sandbox unavailable'));
    await button(await ready(true), 'Open filing sandbox').props.onClick();
    expect(text(render())).toContain('Sandbox unavailable'); expect(harness.open).not.toHaveBeenCalled();
    await button(render(), 'Open filing sandbox').props.onClick(); expect(harness.open).toHaveBeenCalledOnce();
    const onClose = harness.open.mock.calls[0][0].onClose;
    props = { ...props, userId: 'other-owner' }; render(); await flush(); const requestCount = gets().length;
    onClose(); await flush(); expect(gets()).toHaveLength(requestCount);
  });
  it('failed status/launch responses never create SDK sessions or false available state', async () => {
    harness.request.mockResolvedValueOnce(response({ error: 'Filing status could not be verified.' }, 503));
    expect(text(await ready())).toContain('In-app filing status is unavailable.'); expect(harness.loader).not.toHaveBeenCalled();
    await button(render(), 'Retry filing status').props.onClick(); const tree = render();
    walk(tree).find(node => node.type === 'input')!.props.onChange({ target: { checked: true } });
    harness.request.mockResolvedValueOnce(response({ error: 'Fresh verified sandbox security information is required.' }, 409));
    await button(render(), 'Open filing sandbox').props.onClick();
    expect(harness.loader).not.toHaveBeenCalled(); expect(text(render())).toContain('Fresh verified sandbox security information is required.');
  });
});
